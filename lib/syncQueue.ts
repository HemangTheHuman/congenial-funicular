import {
  readSheetAsObjects,
  findRowByColumn,
  appendRow,
  updateRow,
} from '@/lib/googleSheets'
import { generateId } from '@/utils/ids'
import { nowISO } from '@/utils/date'
import type { SyncQueueEntry, SyncQueueStatus } from '@/types/sync-queue'

// ---------------------------------------------------------------------------
// Serialiser / Deserialiser
// ---------------------------------------------------------------------------

function rowToEntry(row: Record<string, string>): SyncQueueEntry {
  return {
    sync_id:       row.sync_id,
    task_id:       row.task_id,
    ls_task_id:    row.ls_task_id,
    status:        row.status as SyncQueueStatus,
    attempt_count: parseInt(row.attempt_count, 10) || 0,
    last_error:    row.last_error,
    created_at:    row.created_at,
    updated_at:    row.updated_at,
    synced_at:     row.synced_at,
  }
}

function entryToRow(e: SyncQueueEntry): (string | number | boolean)[] {
  return [
    e.sync_id,
    e.task_id,
    e.ls_task_id,
    e.status,
    String(e.attempt_count),
    e.last_error,
    e.created_at,
    e.updated_at,
    e.synced_at,
  ]
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function findEntryRow(
  column: string,
  value: string
): Promise<{ entry: SyncQueueEntry; rowNumber: number } | null> {
  const result = await findRowByColumn('sync_queue', column, value)
  if (!result) return null
  return { entry: rowToEntry(result.row), rowNumber: result.rowNumber }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the sync queue entry for a task, or null if not queued. */
export async function getSyncEntry(taskId: string): Promise<SyncQueueEntry | null> {
  const r = await findEntryRow('task_id', taskId)
  return r?.entry ?? null
}

/**
 * Creates a sync queue entry when a task is final-approved.
 * Idempotent: if an entry already exists (FAILED state retrying), returns existing.
 */
export async function createSyncEntry(
  taskId: string,
  lsTaskId: string
): Promise<SyncQueueEntry> {
  const existing = await getSyncEntry(taskId)
  if (existing) return existing

  const now = nowISO()
  const entry: SyncQueueEntry = {
    sync_id:       generateId('SQ'),
    task_id:       taskId,
    ls_task_id:    lsTaskId,
    status:        'PENDING',
    attempt_count: 0,
    last_error:    '',
    created_at:    now,
    updated_at:    now,
    synced_at:     '',
  }
  await appendRow('sync_queue', entryToRow(entry))
  return entry
}

/**
 * Updates the sync status and optionally records an error message.
 * Automatically increments attempt_count on FAILED and sets synced_at on SYNCED.
 */
export async function updateSyncStatus(
  taskId: string,
  status: SyncQueueStatus,
  error = ''
): Promise<void> {
  const r = await findEntryRow('task_id', taskId)
  if (!r) throw new Error(`Sync queue entry not found for task: ${taskId}`)

  const now = nowISO()
  const updated: SyncQueueEntry = {
    ...r.entry,
    status,
    attempt_count: status === 'FAILED' ? r.entry.attempt_count + 1 : r.entry.attempt_count,
    last_error:    status === 'FAILED' ? error : '',
    synced_at:     status === 'SYNCED' ? now : r.entry.synced_at,
    updated_at:    now,
  }
  await updateRow('sync_queue', r.rowNumber, entryToRow(updated))
}

/** Returns all entries with status PENDING. */
export async function listPendingSyncEntries(): Promise<SyncQueueEntry[]> {
  const rows = await readSheetAsObjects('sync_queue')
  return rows.map(rowToEntry).filter((e) => e.status === 'PENDING')
}

/** Returns all entries with status FAILED (eligible for retry). */
export async function listFailedSyncEntries(): Promise<SyncQueueEntry[]> {
  const rows = await readSheetAsObjects('sync_queue')
  return rows.map(rowToEntry).filter((e) => e.status === 'FAILED')
}

/** Resets a failed entry back to PENDING so it can be retried. */
export async function requeueFailedEntry(taskId: string): Promise<void> {
  await updateSyncStatus(taskId, 'PENDING')
}
