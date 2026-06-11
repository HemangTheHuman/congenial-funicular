/**
 * lib/tasks.ts — SQL rewrite (Turso)
 */
import { db } from '@/lib/db'
import { generateId } from '@/utils/ids'
import { nowISO } from '@/utils/date'
import { assertTaskTransition } from '@/lib/transitions'
import type { Task, TaskStatus, SyncStatus } from '@/types/task'

// ---------------------------------------------------------------------------
// Deserialiser
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTask(row: Record<string, any>): Task {
  return {
    task_id:               String(row.task_id ?? ''),
    ls_task_id:            String(row.ls_task_id ?? ''),
    project_id:            String(row.project_id ?? ''),
    batch_id:              String(row.batch_id ?? ''),
    image_url:             String(row.image_url ?? ''),
    image_preview_url:     String(row.image_preview_url ?? ''),
    original_width:        Number(row.original_width) || 0,
    original_height:       Number(row.original_height) || 0,
    status:                String(row.status ?? 'IMPORTED') as TaskStatus,
    assigned_labeler:      String(row.assigned_labeler ?? ''),
    assigned_reviewer:     String(row.assigned_reviewer ?? ''),
    locked_by:             String(row.locked_by ?? ''),
    lock_expires_at:       String(row.lock_expires_at ?? ''),
    region_count:          Number(row.region_count) || 0,
    labeled_region_count:  Number(row.labeled_region_count) || 0,
    approved_region_count: Number(row.approved_region_count) || 0,
    rejected_region_count: Number(row.rejected_region_count) || 0,
    sync_status:           (String(row.sync_status ?? 'NOT_READY')) as SyncStatus,
    sync_attempt_count:    Number(row.sync_attempt_count) || 0,
    last_sync_error:       String(row.last_sync_error ?? ''),
    created_at:            String(row.created_at ?? ''),
    updated_at:            String(row.updated_at ?? ''),
    completed_at:          String(row.completed_at ?? ''),
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get a task by its internal task_id. */
export async function getTaskById(taskId: string): Promise<Task | null> {
  const res = await db.execute({
    sql:  'SELECT * FROM tasks WHERE task_id = ? LIMIT 1',
    args: [taskId],
  })
  return res.rows.length > 0 ? rowToTask(res.rows[0]) : null
}

/** Get a task by the Label Studio task ID. Used during import to detect duplicates. */
export async function getTaskByLsId(lsTaskId: string): Promise<Task | null> {
  const res = await db.execute({
    sql:  'SELECT * FROM tasks WHERE ls_task_id = ? LIMIT 1',
    args: [lsTaskId],
  })
  return res.rows.length > 0 ? rowToTask(res.rows[0]) : null
}

/** Returns all tasks that match any of the given statuses. */
export async function listTasksByStatus(...statuses: TaskStatus[]): Promise<Task[]> {
  if (statuses.length === 0) return []
  const placeholders = statuses.map(() => '?').join(',')
  const res = await db.execute({
    sql:  `SELECT * FROM tasks WHERE status IN (${placeholders}) ORDER BY created_at DESC`,
    args: statuses,
  })
  return res.rows.map(rowToTask)
}

/**
 * Returns tasks available for a labeler to claim.
 * Includes: READY_FOR_LABELING + tasks locked by another user whose lock has expired.
 */
export async function listAvailableTasksForLabeling(): Promise<Task[]> {
  const now = nowISO()
  const res = await db.execute({
    sql: `SELECT * FROM tasks
          WHERE status = 'READY_FOR_LABELING'
             OR (status = 'LABELING_IN_PROGRESS' AND lock_expires_at != '' AND lock_expires_at < ?)
          ORDER BY created_at ASC`,
    args: [now],
  })
  return res.rows.map(rowToTask)
}

/** Returns tasks ready for review (first review or re-review). */
export async function listTasksForReview(): Promise<Task[]> {
  return listTasksByStatus('READY_FOR_REVIEW', 'READY_FOR_RE_REVIEW')
}

/** Returns tasks assigned to a specific labeler (including corrections). */
export async function listTasksForLabeler(labelerEmail: string): Promise<Task[]> {
  const res = await db.execute({
    sql:  'SELECT * FROM tasks WHERE assigned_labeler = ? ORDER BY created_at DESC',
    args: [labelerEmail],
  })
  return res.rows.map(rowToTask)
}

/**
 * Creates a new task row.
 * `task_id`, `created_at`, `updated_at` are generated automatically.
 */
export async function createTask(
  data: Omit<Task, 'task_id' | 'created_at' | 'updated_at'>
): Promise<Task> {
  const now = nowISO()
  const task: Task = { ...data, task_id: generateId('T'), created_at: now, updated_at: now }
  await db.execute({
    sql: `INSERT INTO tasks
            (task_id, ls_task_id, project_id, batch_id, image_url, image_preview_url,
             original_width, original_height, status, assigned_labeler, assigned_reviewer,
             locked_by, lock_expires_at, region_count, labeled_region_count,
             approved_region_count, rejected_region_count, sync_status, sync_attempt_count,
             last_sync_error, created_at, updated_at, completed_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      task.task_id, task.ls_task_id, task.project_id, task.batch_id,
      task.image_url, task.image_preview_url,
      task.original_width, task.original_height,
      task.status, task.assigned_labeler, task.assigned_reviewer,
      task.locked_by, task.lock_expires_at,
      task.region_count, task.labeled_region_count,
      task.approved_region_count, task.rejected_region_count,
      task.sync_status, task.sync_attempt_count,
      task.last_sync_error, task.created_at, task.updated_at, task.completed_at,
    ],
  })
  return task
}

/**
 * Updates a task's status, enforcing transition rules.
 * Also updates `completed_at` when moving to FINAL_APPROVED.
 */
export async function updateTaskStatus(taskId: string, to: TaskStatus): Promise<Task> {
  const task = await getTaskById(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  assertTaskTransition(task.status, to)

  const now = nowISO()
  const completedAt = to === 'FINAL_APPROVED' ? now : task.completed_at
  await db.execute({
    sql:  'UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE task_id = ?',
    args: [to, now, completedAt, taskId],
  })
  return { ...task, status: to, updated_at: now, completed_at: completedAt }
}

/** Sets the task lock. `expiresAt` should be an ISO string. */
export async function setTaskLock(
  taskId: string,
  lockedBy: string,
  expiresAt: string
): Promise<void> {
  await db.execute({
    sql:  'UPDATE tasks SET locked_by = ?, lock_expires_at = ?, updated_at = ? WHERE task_id = ?',
    args: [lockedBy, expiresAt, nowISO(), taskId],
  })
}

/**
 * Atomically claims a task: transitions status, sets lock, assigns labeler — single SQL UPDATE.
 */
export async function claimTask(
  taskId: string,
  labelerEmail: string,
  expiresAt: string
): Promise<Task> {
  const task = await getTaskById(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  assertTaskTransition(task.status, 'LABELING_IN_PROGRESS')

  const now = nowISO()
  await db.execute({
    sql: `UPDATE tasks SET
            status           = 'LABELING_IN_PROGRESS',
            assigned_labeler = ?,
            locked_by        = ?,
            lock_expires_at  = ?,
            updated_at       = ?
          WHERE task_id = ?`,
    args: [labelerEmail, labelerEmail, expiresAt, now, taskId],
  })
  return {
    ...task,
    status: 'LABELING_IN_PROGRESS',
    assigned_labeler: labelerEmail,
    locked_by: labelerEmail,
    lock_expires_at: expiresAt,
    updated_at: now,
  }
}

/** Clears the task lock so another user can claim it. */
export async function releaseTaskLock(taskId: string): Promise<void> {
  await db.execute({
    sql:  "UPDATE tasks SET locked_by = '', lock_expires_at = '', updated_at = ? WHERE task_id = ?",
    args: [nowISO(), taskId],
  })
}

/** Returns true if the task's lock has expired or was never set. */
export function isLockExpired(task: Task): boolean {
  if (!task.lock_expires_at) return true
  return new Date(task.lock_expires_at) < new Date()
}

/**
 * Returns the first task where the given email holds a non-expired lock.
 * Returns null if the labeler has no active lock.
 */
export async function getActiveTaskForLabeler(email: string): Promise<Task | null> {
  const now = nowISO()
  const res = await db.execute({
    sql: `SELECT * FROM tasks
          WHERE locked_by = ? AND lock_expires_at > ?
          LIMIT 1`,
    args: [email, now],
  })
  return res.rows.length > 0 ? rowToTask(res.rows[0]) : null
}

/**
 * Returns true if the given email currently holds a non-expired lock on any task.
 */
export async function hasActiveLock(email: string): Promise<boolean> {
  return (await getActiveTaskForLabeler(email)) !== null
}

/**
 * Increments one of the region count fields by `delta` (use -1 to decrement).
 * Uses SQL arithmetic — no read required.
 */
export async function incrementRegionCount(
  taskId: string,
  field: 'labeled' | 'approved' | 'rejected',
  delta: number
): Promise<void> {
  const col =
    field === 'labeled'  ? 'labeled_region_count'  :
    field === 'approved' ? 'approved_region_count' :
                           'rejected_region_count'
  await db.execute({
    sql:  `UPDATE tasks SET ${col} = MAX(0, ${col} + ?), updated_at = ? WHERE task_id = ?`,
    args: [delta, nowISO(), taskId],
  })
}

/** Updates the sync_status and sync_attempt_count on a task. */
export async function updateTaskSyncStatus(
  taskId: string,
  syncStatus: SyncStatus,
  error = ''
): Promise<void> {
  await db.execute({
    sql: `UPDATE tasks SET
            sync_status        = ?,
            sync_attempt_count = CASE WHEN ? = 'FAILED' THEN sync_attempt_count + 1 ELSE sync_attempt_count END,
            last_sync_error    = ?,
            updated_at         = ?
          WHERE task_id = ?`,
    args: [syncStatus, syncStatus, error, nowISO(), taskId],
  })
}
