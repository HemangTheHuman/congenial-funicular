/**
 * lib/labels.ts — SQL rewrite (Turso)
 */
import { db } from '@/lib/db'
import { generateId } from '@/utils/ids'
import { nowISO } from '@/utils/date'
import type { Label, LabelSyncState } from '@/types/label'

// ---------------------------------------------------------------------------
// Deserialiser
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToLabel(row: Record<string, any>): Label {
  return {
    label_id:        String(row.label_id ?? ''),
    region_id:       String(row.region_id ?? ''),
    task_id:         String(row.task_id ?? ''),
    labeler_email:   String(row.labeler_email ?? ''),
    text:            String(row.text ?? ''),
    is_unreadable:   Number(row.is_unreadable) === 1,
    version:         Number(row.version) || 1,
    is_latest:       Number(row.is_latest) === 1,
    created_at:      String(row.created_at ?? ''),
    updated_at:      String(row.updated_at ?? ''),
    local_client_id: String(row.local_client_id ?? ''),
    sync_state:      (String(row.sync_state ?? 'SAVED')) as LabelSyncState,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get a label by its label_id. */
export async function getLabelById(labelId: string): Promise<Label | null> {
  const res = await db.execute({
    sql:  'SELECT * FROM labels WHERE label_id = ? LIMIT 1',
    args: [labelId],
  })
  return res.rows.length > 0 ? rowToLabel(res.rows[0]) : null
}

/**
 * Returns the latest label for a region.
 * If multiple is_latest = 1 rows exist (crash between writes), returns the most recent.
 */
export async function getLatestLabelForRegion(regionId: string): Promise<Label | null> {
  const res = await db.execute({
    sql:  'SELECT * FROM labels WHERE region_id = ? AND is_latest = 1 ORDER BY created_at DESC LIMIT 1',
    args: [regionId],
  })
  return res.rows.length > 0 ? rowToLabel(res.rows[0]) : null
}

/** Returns all label versions for a region, sorted oldest first. */
export async function listLabelsByRegion(regionId: string): Promise<Label[]> {
  const res = await db.execute({
    sql:  'SELECT * FROM labels WHERE region_id = ? ORDER BY version ASC',
    args: [regionId],
  })
  return res.rows.map(rowToLabel)
}

/**
 * Returns one label per region for a task — the latest version only.
 * Used when building the review screen or the final sync payload.
 */
export async function listLatestLabelsByTask(taskId: string): Promise<Label[]> {
  const res = await db.execute({
    sql:  'SELECT * FROM labels WHERE task_id = ? AND is_latest = 1',
    args: [taskId],
  })
  return res.rows.map(rowToLabel)
}

/**
 * Low-level create — inserts a single label row.
 * Prefer `createNewLabelVersion` for labeling flows.
 */
export async function createLabel(
  data: Omit<Label, 'label_id' | 'created_at' | 'updated_at'>
): Promise<Label> {
  const now = nowISO()
  const label: Label = { ...data, label_id: generateId('LB'), created_at: now, updated_at: now }
  await db.execute({
    sql: `INSERT INTO labels
            (label_id, region_id, task_id, labeler_email, text, is_unreadable,
             version, is_latest, created_at, updated_at, local_client_id, sync_state)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      label.label_id, label.region_id, label.task_id, label.labeler_email,
      label.text, label.is_unreadable ? 1 : 0,
      label.version, label.is_latest ? 1 : 0,
      label.created_at, label.updated_at,
      label.local_client_id, label.sync_state,
    ],
  })
  return label
}

/**
 * Creates a new label version for a region, handling the is_latest swap atomically.
 *
 * Steps (two SQL statements):
 *  1. UPDATE: set is_latest = 0 for all existing labels for this region.
 *  2. INSERT: new label row with is_latest = 1 and version = prev.version + 1.
 */
export async function createNewLabelVersion(
  regionId: string,
  taskId: string,
  labelerEmail: string,
  text: string,
  isUnreadable: boolean,
  localClientId = ''
): Promise<Label> {
  const now = nowISO()

  // Get current latest to determine next version number
  const prev = await getLatestLabelForRegion(regionId)
  const nextVersion = prev ? prev.version + 1 : 1

  // Step 1: demote all previous latest labels for this region
  await db.execute({
    sql:  'UPDATE labels SET is_latest = 0, updated_at = ? WHERE region_id = ? AND is_latest = 1',
    args: [now, regionId],
  })

  // Step 2: insert new latest
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
