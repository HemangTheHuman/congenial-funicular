import { auth } from '@/auth'
import {
  getTaskById,
  listAvailableTasksForLabeling,
  getActiveTaskForLabeler,
  atomicClaimTaskForLabeling,
} from '@/lib/tasks'
import { logAction } from '@/lib/auditLog'
import { getTaskLockMinutes } from '@/lib/appConfig'
import { addMinutes, nowISO } from '@/utils/date'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tasks/claim
 * Auth: LABELER or ADMIN
 * Body: { task_id: string }
 *
 * Claims a task for the current user. Enforces:
 *   1. Task must exist and be currently available.
 *   2. Caller must not already hold an active lock on another task.
 *
 * On success, sets:
 *   - task.status          → LABELING_IN_PROGRESS
 *   - task.assigned_labeler → caller email
 *   - task.locked_by       → caller email
 *   - task.lock_expires_at → now + TASK_LOCK_MINUTES
 */
export const POST = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { role, email } = session.user
  if (role !== 'LABELER' && role !== 'ADMIN') {
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
    if (!task) {
      return Response.json({ error: 'Task not found' }, { status: 404 })
    }

    // 2. Task must be available right now
    const available = await listAvailableTasksForLabeling()
    const isAvailable = available.some((t) => t.task_id === task_id)
    if (!isAvailable) {
      return Response.json(
        { error: 'Task is no longer available' },
        { status: 409 }
      )
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

    // 4. INT-6: Atomic claim — single SQL UPDATE with lock condition check
    const lockMinutes = await getTaskLockMinutes()
    const expiresAt = addMinutes(nowISO(), lockMinutes)
    const claimed = await atomicClaimTaskForLabeling(task_id, email ?? '', expiresAt)

    if (!claimed) {
      // Lost the race — another request claimed it between our availability check and this write
      return Response.json({ error: 'Task was just claimed by another user. Please refresh.' }, { status: 409 })
    }

    // 5. Audit log (non-blocking)
    await logAction(email ?? '', 'TASK_CLAIMED', 'task', task_id, task.status, 'LABELING_IN_PROGRESS')

    return Response.json({ task: claimed })
  } catch (err) {
    console.error('[POST /api/tasks/claim]', err)
    return Response.json({ error: 'Failed to claim task', detail: String(err) }, { status: 500 })
  }
})
