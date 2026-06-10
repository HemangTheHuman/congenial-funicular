import {
  readSheetAsObjects,
  findRowByColumn,
  appendRow,
  updateRow,
  readSheet,
} from '@/lib/googleSheets'
import { generateId } from '@/utils/ids'
import { nowISO } from '@/utils/date'
import { assertTaskTransition } from '@/lib/transitions'
import { TASK_COLUMNS } from '@/lib/sheetColumns'
import type { Task, TaskStatus, SyncStatus } from '@/types/task'

// ---------------------------------------------------------------------------
// Serialiser / Deserialiser
// ---------------------------------------------------------------------------

function rowToTask(row: Record<string, string>): Task {
  return {
    task_id:              row.task_id,
    ls_task_id:           row.ls_task_id,
    project_id:           row.project_id,
    batch_id:             row.batch_id,
    image_url:            row.image_url,
    image_preview_url:    row.image_preview_url,
    original_width:       parseInt(row.original_width, 10) || 0,
    original_height:      parseInt(row.original_height, 10) || 0,
    status:               row.status as TaskStatus,
    assigned_labeler:     row.assigned_labeler,
    assigned_reviewer:    row.assigned_reviewer,
    locked_by:            row.locked_by,
    lock_expires_at:      row.lock_expires_at,
    region_count:         parseInt(row.region_count, 10) || 0,
    labeled_region_count: parseInt(row.labeled_region_count, 10) || 0,
    approved_region_count:parseInt(row.approved_region_count, 10) || 0,
    rejected_region_count:parseInt(row.rejected_region_count, 10) || 0,
    sync_status:          (row.sync_status || 'NOT_READY') as SyncStatus,
    sync_attempt_count:   parseInt(row.sync_attempt_count, 10) || 0,
    last_sync_error:      row.last_sync_error,
    created_at:           row.created_at,
    updated_at:           row.updated_at,
    completed_at:         row.completed_at,
  }
}

function taskToRow(t: Task): (string | number | boolean)[] {
  return TASK_COLUMNS.map((col) => {
    const v = (t as unknown as Record<string, unknown>)[col]
    return v !== undefined && v !== null ? String(v) : ''
  })
}

// ---------------------------------------------------------------------------
// Internal: find row number alongside the task object
// ---------------------------------------------------------------------------

async function findTaskRow(
  column: string,
  value: string
): Promise<{ task: Task; rowNumber: number } | null> {
  const result = await findRowByColumn('tasks', column, value)
  if (!result) return null
  return { task: rowToTask(result.row), rowNumber: result.rowNumber }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get a task by its internal task_id. */
export async function getTaskById(taskId: string): Promise<Task | null> {
  const r = await findTaskRow('task_id', taskId)
  return r?.task ?? null
}

/** Get a task by the Label Studio task ID. Used during import to detect duplicates. */
export async function getTaskByLsId(lsTaskId: string): Promise<Task | null> {
  const r = await findTaskRow('ls_task_id', lsTaskId)
  return r?.task ?? null
}

/** Returns all tasks that match any of the given statuses. */
export async function listTasksByStatus(...statuses: TaskStatus[]): Promise<Task[]> {
  const rows = await readSheetAsObjects('tasks')
  const statusSet = new Set(statuses)
  return rows.map(rowToTask).filter((t) => statusSet.has(t.status))
}

/**
 * Returns tasks available for a labeler to claim.
 * Includes: READY_FOR_LABELING + tasks locked by another user whose lock has expired.
 *
 * NOTE: Reads the full tasks sheet into memory. MVP is fine up to ~500 tasks.
 */
export async function listAvailableTasksForLabeling(): Promise<Task[]> {
  const rows = await readSheetAsObjects('tasks')
  const now = new Date()
  return rows.map(rowToTask).filter((t) => {
    if (t.status === 'READY_FOR_LABELING') return true
    if (t.status === 'LABELING_IN_PROGRESS' && t.lock_expires_at) {
      return new Date(t.lock_expires_at) < now
    }
    return false
  })
}

/** Returns tasks ready for review (first review or re-review). */
export async function listTasksForReview(): Promise<Task[]> {
  return listTasksByStatus('READY_FOR_REVIEW', 'READY_FOR_RE_REVIEW')
}

/** Returns tasks assigned to a specific labeler (including corrections). */
export async function listTasksForLabeler(labelerEmail: string): Promise<Task[]> {
  const rows = await readSheetAsObjects('tasks')
  return rows.map(rowToTask).filter((t) => t.assigned_labeler === labelerEmail)
}

/**
 * Creates a new task row in the tasks sheet.
 * `task_id`, `created_at`, `updated_at` are generated automatically.
 */
export async function createTask(
  data: Omit<Task, 'task_id' | 'created_at' | 'updated_at'>
): Promise<Task> {
  const now = nowISO()
  const task: Task = {
    ...data,
    task_id: generateId('T'),
    created_at: now,
    updated_at: now,
  }
  await appendRow('tasks', taskToRow(task))
  return task
}

/**
 * Updates a task's status, enforcing the transition rules.
 * Also updates `updated_at` and `completed_at` (when moving to FINAL_APPROVED).
 */
export async function updateTaskStatus(taskId: string, to: TaskStatus): Promise<Task> {
  const r = await findTaskRow('task_id', taskId)
  if (!r) throw new Error(`Task not found: ${taskId}`)
  assertTaskTransition(r.task.status, to)

  const now = nowISO()
  const updated: Task = {
    ...r.task,
    status: to,
    updated_at: now,
    completed_at: to === 'FINAL_APPROVED' ? now : r.task.completed_at,
  }
  await updateRow('tasks', r.rowNumber, taskToRow(updated))
  return updated
}

/** Sets the task lock. `expiresAt` should be an ISO string. */
export async function setTaskLock(
  taskId: string,
  lockedBy: string,
  expiresAt: string
): Promise<void> {
  const r = await findTaskRow('task_id', taskId)
  if (!r) throw new Error(`Task not found: ${taskId}`)
  const updated: Task = {
    ...r.task,
    locked_by: lockedBy,
    lock_expires_at: expiresAt,
    updated_at: nowISO(),
  }
  await updateRow('tasks', r.rowNumber, taskToRow(updated))
}

/** Clears the task lock so another user can claim it. */
export async function releaseTaskLock(taskId: string): Promise<void> {
  const r = await findTaskRow('task_id', taskId)
  if (!r) throw new Error(`Task not found: ${taskId}`)
  const updated: Task = {
    ...r.task,
    locked_by: '',
    lock_expires_at: '',
    updated_at: nowISO(),
  }
  await updateRow('tasks', r.rowNumber, taskToRow(updated))
}

/** Returns true if the task's lock has expired or was never set. */
export function isLockExpired(task: Task): boolean {
  if (!task.lock_expires_at) return true
  return new Date(task.lock_expires_at) < new Date()
}

/**
 * Increments one of the region count fields by `delta` (use -1 to decrement).
 * Used by region helpers when a region status changes.
 */
export async function incrementRegionCount(
  taskId: string,
  field: 'labeled' | 'approved' | 'rejected',
  delta: number
): Promise<void> {
  const r = await findTaskRow('task_id', taskId)
  if (!r) throw new Error(`Task not found: ${taskId}`)

  const updated: Task = { ...r.task, updated_at: nowISO() }
  if (field === 'labeled') updated.labeled_region_count = Math.max(0, r.task.labeled_region_count + delta)
  if (field === 'approved') updated.approved_region_count = Math.max(0, r.task.approved_region_count + delta)
  if (field === 'rejected') updated.rejected_region_count = Math.max(0, r.task.rejected_region_count + delta)

  await updateRow('tasks', r.rowNumber, taskToRow(updated))
}

/** Updates the sync_status and sync_attempt_count on a task. */
export async function updateTaskSyncStatus(
  taskId: string,
  syncStatus: SyncStatus,
  error = ''
): Promise<void> {
  const r = await findTaskRow('task_id', taskId)
  if (!r) throw new Error(`Task not found: ${taskId}`)
  const updated: Task = {
    ...r.task,
    sync_status: syncStatus,
    sync_attempt_count: r.task.sync_attempt_count + (syncStatus === 'FAILED' ? 1 : 0),
    last_sync_error: error,
    updated_at: nowISO(),
  }
  await updateRow('tasks', r.rowNumber, taskToRow(updated))
}
