import { auth } from '@/auth'
import { getTaskById, releaseTaskLock, updateTaskStatus } from '@/lib/tasks'
import { logAction } from '@/lib/auditLog'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tasks/release
 * Auth: LABELER or ADMIN
 * Body: { task_id: string }
 *
 * Releases the caller's lock on a task and returns it to READY_FOR_LABELING.
 * Only the user who holds the lock can release it.
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
    const task = await getTaskById(task_id)
    if (!task) {
      return Response.json({ error: 'Task not found' }, { status: 404 })
    }

    // Only the lock holder can release the task
    if (task.locked_by !== email) {
      return Response.json(
        { error: 'You do not hold the lock on this task' },
        { status: 403 }
      )
    }

    // Clear lock fields, then transition status back to READY_FOR_LABELING
    await releaseTaskLock(task_id)
    const released = await updateTaskStatus(task_id, 'READY_FOR_LABELING')

    await logAction(email ?? '', 'TASK_RELEASED', 'task', task_id, 'LABELING_IN_PROGRESS', 'READY_FOR_LABELING')

    return Response.json({ task: released })
  } catch (err) {
    console.error('[POST /api/tasks/release]', err)
    return Response.json({ error: 'Failed to release task', detail: String(err) }, { status: 500 })
  }
})
