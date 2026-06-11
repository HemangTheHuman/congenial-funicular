/**
 * lib/syncQueue.ts — SQL rewrite (Turso)
 */
import { db } from '@/lib/db'
import { generateId } from '@/utils/ids'
import { nowISO } from '@/utils/date'
import type { SyncQueueEntry, SyncQueueStatus } from '@/types/sync-queue'

// ---------------------------------------------------------------------------
// Deserialiser
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEntry(row: Record<string, any>): SyncQueueEntry {
  return {
    sync_id:       String(row.sync_id ?? ''),
    task_id:       String(row.task_id ?? ''),
    ls_task_id:    String(row.ls_task_id ?? ''),
    status:        String(row.status ?? 'PENDING') as SyncQueueStatus,
    attempt_count: Number(row.attempt_count) || 0,
    last_error:    String(row.last_error ?? ''),
    created_at:    String(row.created_at ?? ''),
    updated_at:    String(row.updated_at ?? ''),
    synced_at:     String(row.synced_at ?? ''),
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the sync queue entry for a task, or null if not queued. */
export async function getSyncEntry(taskId: string): Promise<SyncQueueEntry | null> {
  const res = await db.execute({
    sql:  'SELECT * FROM sync_queue WHERE task_id = ? LIMIT 1',
    args: [taskId],
  })
  return res.rows.length > 0 ? rowToEntry(res.rows[0]) : null
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
  await db.execute({
    sql: `INSERT INTO sync_queue
            (sync_id, task_id, ls_task_id, status, attempt_count,
             last_error, created_at, updated_at, synced_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [
      entry.sync_id, entry.task_id, entry.ls_task_id, entry.status,
      entry.attempt_count, entry.last_error, entry.created_at,
      entry.updated_at, entry.synced_at,
    ],
  })
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
  const now = nowISO()
  await db.execute({
    sql: `UPDATE sync_queue SET
            status        = ?,
            attempt_count = CASE WHEN ? = 'FAILED' THEN attempt_count + 1 ELSE attempt_count END,
            last_error    = CASE WHEN ? = 'FAILED' THEN ? ELSE '' END,
            synced_at     = CASE WHEN ? = 'SYNCED'  THEN ? ELSE synced_at END,
            updated_at    = ?
          WHERE task_id = ?`,
    args: [status, status, status, error, status, now, now, taskId],
  })
}

/** Returns all entries with status PENDING. */
export async function listPendingSyncEntries(): Promise<SyncQueueEntry[]> {
  const res = await db.execute(
    "SELECT * FROM sync_queue WHERE status = 'PENDING' ORDER BY created_at ASC"
  )
  return res.rows.map(rowToEntry)
}

/** Returns all entries with status FAILED (eligible for retry). */
export async function listFailedSyncEntries(): Promise<SyncQueueEntry[]> {
  const res = await db.execute(
    "SELECT * FROM sync_queue WHERE status = 'FAILED' ORDER BY updated_at ASC"
  )
  return res.rows.map(rowToEntry)
}

/** Resets a failed entry back to PENDING so it can be retried. */
export async function requeueFailedEntry(taskId: string): Promise<void> {
  await updateSyncStatus(taskId, 'PENDING')
}
