import { auth } from '@/auth'
import { getTaskById, setTaskLock } from '@/lib/tasks'
import { getTaskLockMinutes } from '@/lib/appConfig'
import { addMinutes, nowISO } from '@/utils/date'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tasks/refresh-lock
 * Auth: LABELER or ADMIN
 * Body: { task_id: string }
 *
 * Extends the lock expiry on an already-claimed task.
 * Called every 3 minutes by the Phase 5 workspace page.
 * Only the current lock holder can refresh.
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

    if (task.locked_by !== email) {
      return Response.json(
        { error: 'You do not hold the lock on this task' },
        { status: 403 }
      )
    }

    const lockMinutes = await getTaskLockMinutes()
    const newExpiry = addMinutes(nowISO(), lockMinutes)
    await setTaskLock(task_id, email ?? '', newExpiry)

    return Response.json({ lock_expires_at: newExpiry })
  } catch (err) {
    console.error('[POST /api/tasks/refresh-lock]', err)
    return Response.json({ error: 'Failed to refresh lock', detail: String(err) }, { status: 500 })
  }
})
