import { getTaskById, updateTaskStatus } from '@/lib/tasks'
import { listRegionsByTask } from '@/lib/regions'
import { listLatestLabelsByTask } from '@/lib/labels'
import { updateSyncStatus } from '@/lib/syncQueue'
import { getTask as getLsTask, updateAnnotation } from '@/lib/labelStudio'
import { logAction } from '@/lib/auditLog'
import type { Task } from '@/types/task'

const AKSHARAMUKHA_API_URL = 'https://www.aksharamukha.com/api/convert'
const DELIMITER = '___AKSHARAMUKHA_DELIM___'

// ---------------------------------------------------------------------------
// Transliteration Helper
// ---------------------------------------------------------------------------

async function bulkTransliterate(texts: string[]): Promise<string[]> {
  if (texts.length === 0) return []

  const combined = texts.join(DELIMITER)

  const res = await fetch(AKSHARAMUKHA_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'Devanagari',
      target: 'Kaithi',
      text: combined,
      nativize: false,
      postOptions: ['KaithiRetainSpace'],
      preOptions: []
    })
  })

  if (!res.ok) {
    throw new Error(`Aksharamukha API failed: ${res.status} ${res.statusText}`)
  }

  const output = await res.text()
  return output.split(DELIMITER)
}

// ---------------------------------------------------------------------------
// Sync Logic
// ---------------------------------------------------------------------------

import { lsPatch } from '@/lib/labelStudio'

export interface SyncStats {
  regionsRemoved: number
  scriptsChanged: number
  transcriptionsAdded: number
}

interface BuildSyncPayloadResult {
  finalPayload: any[]
  annotationId: number | string
  stats: SyncStats
  lsTaskId: string | number
  lsTaskData: Record<string, unknown>
  dbTask: Task
}

async function buildSyncPayload(taskId: string): Promise<BuildSyncPayloadResult> {
  const dbTask = await getTaskById(taskId)
  if (!dbTask) throw new Error(`Task ${taskId} not found in DB`)

  // Ensure it's in a state that can be synced
  if (dbTask.status !== 'FINAL_APPROVED' && dbTask.status !== 'SYNC_PENDING' && dbTask.status !== 'SYNC_FAILED') {
    throw new Error(`Task ${taskId} is in status ${dbTask.status}, expected FINAL_APPROVED, SYNC_PENDING, or SYNC_FAILED`)
  }

  // 1. Fetch task from Label Studio to get existing annotations
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lsTask = await getLsTask(dbTask.ls_task_id) as any
  const lsAnnotations = lsTask.annotations || []
  if (lsAnnotations.length === 0) {
    throw new Error(`Task ${dbTask.ls_task_id} has no annotations in Label Studio to patch.`)
  }

  const annotation = lsAnnotations[0]
  const annotationId = annotation.id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let oldResults: any[] = annotation.result || []

  // 2. Fetch regions and labels from DB
  const regions = await listRegionsByTask(taskId)
  const labels = await listLatestLabelsByTask(taskId)
  
  // Create a map for quick label lookup by region_id
  const labelMap = new Map(labels.map(l => [l.region_id, l]))

  // 3. Prepare for Bulk Transliteration
  const textsToTransliterate: string[] = []
  const indexMapping: { labelId: string, index: number }[] = []

  for (const label of labels) {
    if (label.is_unreadable) continue // We don't transliterate unreadable ones
    
    const region = regions.find(r => r.region_id === label.region_id)
    if (!region) continue

    const scriptTag = region.script_tag_final.trim().toUpperCase()
    if (scriptTag === 'KAITHI') {
      textsToTransliterate.push(label.text)
      indexMapping.push({ labelId: label.label_id, index: textsToTransliterate.length - 1 })
    }
  }

  // Perform transliteration
  const transliteratedResults = await bulkTransliterate(textsToTransliterate)
  const transliteratedMap = new Map<string, string>()
  for (const mapping of indexMapping) {
    transliteratedMap.set(mapping.labelId, transliteratedResults[mapping.index])
  }

  // 4. Construct the new payload
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newResults: any[] = []
  const mappedIds = new Set<string>()
  const unreadableRegionIds = new Set<string>()

  // Stats tracking
  const stats: SyncStats = {
    regionsRemoved: 0,
    scriptsChanged: 0,
    transcriptionsAdded: 0
  }

  // First pass over old results: we filter out unreadable, and update script tags
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processedOldResults: any[] = []

  for (const region of regions) {
    const label = labelMap.get(region.region_id)
    if (label && label.is_unreadable && region.status === 'FINAL_APPROVED') {
      unreadableRegionIds.add(region.ls_region_id)
    }
  }

  for (const result of oldResults) {
    if (!result.id) {
      processedOldResults.push(result)
      continue
    }

    // If this result belongs to an unreadable region, we DROP it.
    if (unreadableRegionIds.has(result.id)) {
      if (result.type === 'rectangle') stats.regionsRemoved++
      continue
    }

    // If it's the script tag label, update it.
    if (result.type === 'labels') {
      const region = regions.find(r => r.ls_region_id === result.id)
      if (region) {
        result.value = result.value || {}
        const oldTag = result.value.labels?.[0] || ''
        result.value.labels = [region.script_tag_final]
        if (oldTag !== region.script_tag_final) {
          stats.scriptsChanged++
        }
      }
    }

    processedOldResults.push(result)
  }

  // Second pass: generate textarea appended blocks
  for (const region of regions) {
    const lsRegionId = region.ls_region_id
    
    // Skip unreadable regions
    if (unreadableRegionIds.has(lsRegionId)) continue

    const label = labelMap.get(region.region_id)
    if (!label) continue

    // Look up transliteration if applicable
    let processedText = label.text
    if (transliteratedMap.has(label.label_id)) {
      processedText = transliteratedMap.get(label.label_id)!
    }

    // We need to fetch original properties from the original bbox result in LS
    const originalBbox = processedOldResults.find(r => r.id === lsRegionId && r.type === 'rectangle')
    if (!originalBbox) continue // Fallback: if we can't find the bbox, skip

    const res = {
      from_name: 'transcription',
      id: lsRegionId,
      image_rotation: originalBbox.image_rotation ?? 0,
      origin: originalBbox.origin ?? 'manual',
      original_height: originalBbox.original_height,
      original_width: originalBbox.original_width,
      to_name: originalBbox.to_name ?? 'image',
      type: 'textarea',
      value: {
        height: originalBbox.value.height,
        rotation: originalBbox.value.rotation ?? 0,
        text: [processedText],
        width: originalBbox.value.width,
        x: originalBbox.value.x,
        y: originalBbox.value.y
      }
    }

    if (!mappedIds.has(lsRegionId)) {
      newResults.push(res)
      mappedIds.add(lsRegionId)
      stats.transcriptionsAdded++
    }
  }

  const finalPayload = [...processedOldResults, ...newResults]

  return {
    finalPayload,
    annotationId,
    stats,
    lsTaskId: dbTask.ls_task_id,
    lsTaskData: lsTask.data || {},
    dbTask
  }
}

export async function dryRunTaskSync(taskId: string): Promise<SyncStats> {
  const result = await buildSyncPayload(taskId)
  return result.stats
}

export async function syncTaskToLabelStudio(taskId: string): Promise<Task> {
  let currentStatus = 'FINAL_APPROVED'
  try {
    const dbTaskPre = await getTaskById(taskId)
    if (dbTaskPre) currentStatus = dbTaskPre.status

    // 0. Transition task to SYNC_PENDING to indicate active processing (allowed from FINAL_APPROVED or SYNC_FAILED)
    if (currentStatus === 'FINAL_APPROVED' || currentStatus === 'SYNC_FAILED') {
      await updateTaskStatus(taskId, 'SYNC_PENDING')
      currentStatus = 'SYNC_PENDING'
    }

    const { finalPayload, annotationId, lsTaskId, lsTaskData, dbTask } = await buildSyncPayload(taskId)

    // 1. Update Annotations
    await updateAnnotation(annotationId, { result: finalPayload })

    // 2. Update Task Metadata (excel = 'approved')
    await lsPatch(`/api/tasks/${lsTaskId}/`, {
      data: {
        ...lsTaskData,
        excel: 'approved'
      }
    })

    // 3. Update local DB statuses
    await updateSyncStatus(taskId, 'SYNCED')
    const updatedTask = await updateTaskStatus(taskId, 'SYNCED_TO_LABEL_STUDIO')
    await logAction('SYSTEM', 'TASK_SYNCED', 'task', taskId, currentStatus, 'SYNCED_TO_LABEL_STUDIO')

    return updatedTask
  } catch (err) {
    // 4. On Failure, mark sync queue as FAILED
    const msg = String(err)
    await updateSyncStatus(taskId, 'FAILED', msg)
    if (currentStatus === 'SYNC_PENDING') {
      await updateTaskStatus(taskId, 'SYNC_FAILED')
    }
    throw new Error(`Sync failed: ${msg}`)
  }
}
