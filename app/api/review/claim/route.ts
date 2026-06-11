import { auth } from '@/auth'
import { db } from '@/lib/db'
import {
  getTaskById,
  listTasksForReview,
  getActiveTaskForLabeler,
  setTaskLock,
  updateTaskStatus,
} from '@/lib/tasks'
import { logAction } from '@/lib/auditLog'
import { getTaskLockMinutes } from '@/lib/appConfig'
import { addMinutes, nowISO } from '@/utils/date'

export const dynamic = 'force-dynamic'

/**
 * POST /api/review/claim
 * Auth: REVIEWER or ADMIN
 * Body: { task_id: string }
 *
 * Claims a task from the review queue. Enforces:
 *   1. Task must be READY_FOR_REVIEW or READY_FOR_RE_REVIEW.
 *   2. Caller must not already hold a live lock on another task.
 *
 * On success:
 *   - task.status            → REVIEWING_IN_PROGRESS
 *   - task.assigned_reviewer → caller email
 *   - task.locked_by         → caller email
 *   - task.lock_expires_at   → now + TASK_LOCK_MINUTES
 */
export const POST = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { role, email } = session.user
  if (role !== 'REVIEWER' && role !== 'ADMIN') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let task_id: string
  try {
    const body = await req.json()
    task_id = body?.task_id
    if (!task_id) return Response.json({ error: 'task_id is required' }, { status: 400 })
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    // 1. Task must exist
    const task = await getTaskById(task_id)
    if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })

    // 2. Task must be in the review queue
    const queue = await listTasksForReview()
    const inQueue = queue.some((t) => t.task_id === task_id)
    if (!inQueue) {
      return Response.json({ error: 'Task is not available for review' }, { status: 409 })
    }

    // 3. Caller must not already hold an active lock on a different task
    const existingTask = await getActiveTaskForLabeler(email ?? '')
    if (existingTask && existingTask.task_id !== task_id) {
      return Response.json(
        {
          error: 'You already have an active task. Complete or release it before claiming another.',
          existingTaskId: existingTask.task_id,
        },
        { status: 409 }
      )
    }

    // 4. Set lock, transition status, assign reviewer (all fast SQL updates)
    const lockMinutes = await getTaskLockMinutes()
    const expiresAt   = addMinutes(nowISO(), lockMinutes)
    const now         = nowISO()

    await setTaskLock(task_id, email ?? '', expiresAt)
    const updatedTask = await updateTaskStatus(task_id, 'REVIEWING_IN_PROGRESS')
    await db.execute({
      sql:  'UPDATE tasks SET assigned_reviewer = ?, updated_at = ? WHERE task_id = ?',
      args: [email ?? '', now, task_id],
    })

    // 5. Audit log (fire-and-forget)
    logAction(email ?? '', 'REVIEW_CLAIMED', 'task', task_id, task.status, 'REVIEWING_IN_PROGRESS')
      .catch(() => {})

    return Response.json({ task: { ...updatedTask, assigned_reviewer: email ?? '' } })
  } catch (err) {
    console.error('[POST /api/review/claim]', err)
    return Response.json({ error: 'Failed to claim task', detail: String(err) }, { status: 500 })
  }
})
