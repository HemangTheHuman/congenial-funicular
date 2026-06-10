import {
  readSheetAsObjects,
  findRowByColumn,
  appendRow,
  updateRow,
  readSheet,
} from '@/lib/googleSheets'
import { generateId } from '@/utils/ids'
import { nowISO } from '@/utils/date'
import type { Label, LabelSyncState } from '@/types/label'

// ---------------------------------------------------------------------------
// Serialiser / Deserialiser
// ---------------------------------------------------------------------------

function rowToLabel(row: Record<string, string>): Label {
  return {
    label_id:       row.label_id,
    region_id:      row.region_id,
    task_id:        row.task_id,
    labeler_email:  row.labeler_email,
    text:           row.text,
    is_unreadable:  row.is_unreadable === 'TRUE' || row.is_unreadable === 'true',
    version:        parseInt(row.version, 10) || 1,
    is_latest:      row.is_latest === 'TRUE' || row.is_latest === 'true',
    created_at:     row.created_at,
    updated_at:     row.updated_at,
    local_client_id:row.local_client_id,
    sync_state:     (row.sync_state || 'SAVED') as LabelSyncState,
  }
}

function labelToRow(l: Label): (string | number | boolean)[] {
  return [
    l.label_id,
    l.region_id,
    l.task_id,
    l.labeler_email,
    l.text,
    l.is_unreadable ? 'TRUE' : 'FALSE',
    String(l.version),
    l.is_latest ? 'TRUE' : 'FALSE',
    l.created_at,
    l.updated_at,
    l.local_client_id,
    l.sync_state,
  ]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function findLabelRow(
  column: string,
  value: string
): Promise<{ label: Label; rowNumber: number } | null> {
  const result = await findRowByColumn('labels', column, value)
  if (!result) return null
  return { label: rowToLabel(result.row), rowNumber: result.rowNumber }
}

/** Reads all label rows and returns the parsed objects. */
async function readAllLabels(): Promise<Label[]> {
  const rows = await readSheetAsObjects('labels')
  return rows.map(rowToLabel)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get a label by its label_id. */
export async function getLabelById(labelId: string): Promise<Label | null> {
  const r = await findLabelRow('label_id', labelId)
  return r?.label ?? null
}

/**
 * Returns the latest label for a region.
 *
 * Resilience rule: if multiple rows have is_latest = TRUE (crash between writes),
 * return the most recent by created_at. Never throw.
 */
export async function getLatestLabelForRegion(regionId: string): Promise<Label | null> {
  const all = await readAllLabels()
  const forRegion = all.filter((l) => l.region_id === regionId && l.is_latest)
  if (forRegion.length === 0) return null
  // Sort descending by created_at and take the first
  forRegion.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return forRegion[0]
}

/** Returns all label versions for a region, sorted oldest first. */
export async function listLabelsByRegion(regionId: string): Promise<Label[]> {
  const all = await readAllLabels()
  return all
    .filter((l) => l.region_id === regionId)
    .sort((a, b) => a.version - b.version)
}

/**
 * Returns one label per region for a task — the latest version only.
 * Used when building the review screen or the final sync payload.
 */
export async function listLatestLabelsByTask(taskId: string): Promise<Label[]> {
  const all = await readAllLabels()
  const byRegion = new Map<string, Label>()

  // Collect latest labels for this task
  for (const label of all) {
    if (label.task_id !== taskId || !label.is_latest) continue
    const existing = byRegion.get(label.region_id)
    if (!existing || label.created_at > existing.created_at) {
      byRegion.set(label.region_id, label)
    }
  }
  return Array.from(byRegion.values())
}

/**
 * Low-level create — appends a single label row.
 * Prefer `createNewLabelVersion` for labeling flows.
 */
export async function createLabel(
  data: Omit<Label, 'label_id' | 'created_at' | 'updated_at'>
): Promise<Label> {
  const now = nowISO()
  const label: Label = { ...data, label_id: generateId('LB'), created_at: now, updated_at: now }
  await appendRow('labels', labelToRow(label))
  return label
}

/**
 * Creates a new label version for a region, handling the is_latest swap.
 *
 * Steps:
 *  1. Find the current latest label for the region (if any) and mark it is_latest = FALSE.
 *  2. Append new label row with is_latest = TRUE and version = prev.version + 1.
 *
 * Atomicity note: Two separate Sheet writes. If step 2 crashes, two is_latest = TRUE
 * rows may exist. `getLatestLabelForRegion` handles this by taking the most recent.
 */
export async function createNewLabelVersion(
  regionId: string,
  taskId: string,
  labelerEmail: string,
  text: string,
  isUnreadable: boolean,
  localClientId = ''
): Promise<Label> {
  // Step 1: Demote previous latest
  const prev = await findLabelRow('region_id', regionId)
  let nextVersion = 1
  if (prev && prev.label.is_latest) {
    nextVersion = prev.label.version + 1
    const demoted: Label = { ...prev.label, is_latest: false, updated_at: nowISO() }
    await updateRow('labels', prev.rowNumber, labelToRow(demoted))
  }

  // Step 2: Create new latest
  return createLabel({
    region_id:       regionId,
    task_id:         taskId,
    labeler_email:   labelerEmail,
    text:            isUnreadable ? '' : text,
    is_unreadable:   isUnreadable,
    version:         nextVersion,
    is_latest:       true,
    local_client_id: localClientId,
    sync_state:      'SAVED',
  })
}
