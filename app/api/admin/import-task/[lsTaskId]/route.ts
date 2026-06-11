import { auth } from '@/auth'
import { getTask, markTaskImported } from '@/lib/labelStudio'
import { parseLsTask } from '@/lib/labelStudioParser'
import { getTaskByLsId, createTask, updateTaskStatus } from '@/lib/tasks'
import { createRegionsBatch } from '@/lib/regions'
import { logAction } from '@/lib/auditLog'
import type { Task } from '@/types/task'
import type { Region } from '@/types/region'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Shared import logic — used by both this route and import-batch
// ---------------------------------------------------------------------------

export interface ImportResult {
  task: Task
  regions: Region[]
  regionCount: number
  alreadyExisted: boolean
}

/**
 * Core import function — fetches, parses, and writes one LS task + its regions.
 * Called by both the single-import route and the batch route.
 *
 * @param lsTaskId   - Label Studio task ID (string or number)
 * @param adminEmail - Email of the admin triggering the import (for audit log)
 * @param batchId    - Optional batch label to group tasks
 */
export async function importSingleTask(
  lsTaskId: string,
  adminEmail: string,
  batchId = ''
): Promise<ImportResult> {
  // Step 1: Duplicate check
  const existing = await getTaskByLsId(lsTaskId)
  if (existing) {
    return { task: existing, regions: [], regionCount: existing.region_count, alreadyExisted: true }
  }

  // Step 2: Fetch from Label Studio
  const raw = await getTask(lsTaskId)

  // Extract project id and full data object now — needed for the LS PATCH later.
  // We do this before parseLsTask() so we have the original data intact.
  const rawTask = raw as { project: number; data: Record<string, unknown> }
  const lsProjectId = rawTask.project
  const lsOriginalData = rawTask.data ?? {}

  // Step 3: Parse LS JSON → normalised types
  const parsed = parseLsTask(raw)

  // Step 4: Create task row (status = IMPORTED)
  const task = await createTask({
    ls_task_id:            parsed.ls_task_id,
    project_id:            parsed.project_id,
    batch_id:              batchId,
    image_url:             parsed.image_url,
    image_preview_url:     '',
    original_width:        parsed.original_width,
    original_height:       parsed.original_height,
    status:                'IMPORTED',
    assigned_labeler:      '',
    assigned_reviewer:     '',
    locked_by:             '',
    lock_expires_at:       '',
    region_count:          parsed.regions.length,
    labeled_region_count:  0,
    approved_region_count: 0,
    rejected_region_count: 0,
    sync_status:           'NOT_READY',
    sync_attempt_count:    0,
    last_sync_error:       '',
    completed_at:          '',
  })

  // Step 5: Create ALL region rows in a single Turso batch insert
  const regions = await createRegionsBatch(
    parsed.regions.map((r) => ({
      task_id:             task.task_id,
      ls_task_id:          task.ls_task_id,
      ls_region_id:        r.ls_region_id,
      order_index:         r.order_index,
      bbox_x_percent:      r.bbox_x_percent,
      bbox_y_percent:      r.bbox_y_percent,
      bbox_width_percent:  r.bbox_width_percent,
      bbox_height_percent: r.bbox_height_percent,
      bbox_xmin:           r.bbox_xmin,
      bbox_ymin:           r.bbox_ymin,
      bbox_xmax:           r.bbox_xmax,
      bbox_ymax:           r.bbox_ymax,
      rotation:            r.rotation,
      script_tag_original: r.script_tag,
      script_tag_final:    r.script_tag,
      status:              'PENDING_LABEL' as const,
      is_active:           true,
    }))
  )

  // Step 6: Auto-transition to READY_FOR_LABELING (Q2: yes)
  const readyTask = await updateTaskStatus(task.task_id, 'READY_FOR_LABELING')

  // Step 7: Audit log
  await logAction(adminEmail, 'TASK_IMPORTED', 'task', task.task_id, '', lsTaskId)

  // Step 8: Mark task in Label Studio so it is excluded from future import batches.
  // Sets excel="pending" (was "none") while preserving ocr and all other data fields.
  // This is the LAST step — if Sheet writes above failed we'd never reach here,
  // keeping the task importable for a retry.
  await markTaskImported(lsTaskId, lsProjectId, lsOriginalData)

  return { task: readyTask, regions, regionCount: regions.length, alreadyExisted: false }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const POST = auth(async (req, { params }) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { lsTaskId } = await params as { lsTaskId: string }
  if (!lsTaskId) return Response.json({ error: 'Missing lsTaskId' }, { status: 400 })

  let batchId = ''
  try {
    const body = await req.json().catch(() => ({}))
    batchId = body?.batch_id ?? ''
  } catch {
    // body is optional
  }

  try {
    const result = await importSingleTask(lsTaskId, session.user.email ?? '', batchId)

    if (result.alreadyExisted) {
      return Response.json(
        {
          message: 'Task already imported',
          task_id: result.task.task_id,
          ls_task_id: lsTaskId,
        },
        { status: 409 }
      )
    }

    if (result.regionCount === 0) {
      return Response.json(
        { error: 'Task imported but has no regions — the LS task may have no annotations yet.' },
        { status: 422 }
      )
    }

    return Response.json({
      message: `Imported task with ${result.regionCount} regions`,
      task: result.task,
      regionCount: result.regionCount,
    })
  } catch (err) {
    const msg = String(err)
    const isLsError = msg.includes('Label Studio') || msg.includes('failed (')
    return Response.json(
      { error: isLsError ? 'Label Studio error' : 'Import failed', detail: msg },
      { status: isLsError ? 502 : 500 }
    )
  }
})
