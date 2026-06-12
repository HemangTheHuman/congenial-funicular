import { auth } from '@/auth'
import { getTaskById, hasActiveLock, claimCorrectionTask } from '@/lib/tasks'
import { logAction } from '@/lib/auditLog'
import { getTaskLockMinutes } from '@/lib/appConfig'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tasks/claim-correction
 * Auth: LABELER or ADMIN
 * Body: { task_id: string }
 *
 * Claims a task for correction.
 *
 * Guards:
 *   1. Task must exist.
 *   2. Task status must be NEEDS_CORRECTION.
 *   3. Caller must be the assigned labeler for the task.
 *   4. Caller cannot hold a lock on another task.
 */
export const POST = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const { role, email } = session.user
  if (role !== 'LABELER' && role !== 'ADMIN') {
    return new Response('Forbidden', { status: 403 })
  }

  let body: { task_id: string }
  try {
    body = await req.json() as { task_id: string }
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { task_id } = body
  if (!task_id) return Response.json({ error: 'task_id is required' }, { status: 400 })

  // 1. Verify task state
  const task = await getTaskById(task_id)
  if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })

  if (task.status !== 'NEEDS_CORRECTION') {
    return Response.json({ error: 'Task is not in NEEDS_CORRECTION status' }, { status: 422 })
  }

  if (task.assigned_labeler !== email) {
    return Response.json({ error: 'Only the originally assigned labeler can correct this task' }, { status: 403 })
  }

  // 2. Ensure user doesn't hold an active lock
  const alreadyHasLock = await hasActiveLock(email ?? '')
  if (alreadyHasLock) {
    return Response.json({ error: 'You already have an active task. Please finish or release it first.' }, { status: 422 })
  }

  // 3. Claim task atomically
  const lockMinutes = await getTaskLockMinutes()
  const expiresAt = new Date(Date.now() + lockMinutes * 60 * 1000).toISOString()

  
  try {
    const claimedTask = await claimCorrectionTask(task_id, email ?? '', expiresAt)
    
    await logAction(
      email ?? '',
      'CORRECTION_CLAIMED',
      'task',
      task_id,
      task.status,
      'CORRECTION_IN_PROGRESS',
    )

    return Response.json({ task: claimedTask }, { status: 200 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Claim failed' }, { status: 500 })
  }
})
