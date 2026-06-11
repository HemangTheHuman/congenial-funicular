import { auth } from '@/auth'
import { getTaskById, releaseTaskLock, updateTaskStatus } from '@/lib/tasks'
import { logAction } from '@/lib/auditLog'

export const dynamic = 'force-dynamic'

/**
 * POST /api/review/release
 * Auth: REVIEWER or ADMIN
 * Body: { task_id: string }
 *
 * Releases the reviewer's lock on a task and returns it to READY_FOR_REVIEW.
 * Only the lock holder can release.
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
    const task = await getTaskById(task_id)
    if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })
    if (task.locked_by !== email) {
      return Response.json({ error: 'You do not hold the lock on this task' }, { status: 403 })
    }

    await releaseTaskLock(task_id)
    const updatedTask = await updateTaskStatus(task_id, 'READY_FOR_REVIEW')

    logAction(email ?? '', 'REVIEW_RELEASED', 'task', task_id, task.status, 'READY_FOR_REVIEW').catch(() => {})

    return Response.json({ task: updatedTask })
  } catch (err) {
    console.error('[POST /api/review/release]', err)
    return Response.json({ error: 'Failed to release task', detail: String(err) }, { status: 500 })
  }
})
