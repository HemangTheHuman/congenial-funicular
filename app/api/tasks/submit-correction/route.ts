import { auth } from '@/auth'
import { getTaskById, updateTaskStatus, releaseTaskLock } from '@/lib/tasks'
import { listRegionsByTask } from '@/lib/regions'
import { logAction } from '@/lib/auditLog'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tasks/submit-correction
 * Auth: LABELER or ADMIN
 * Body: { task_id: string }
 *
 * Submits a completed correction task for re-review.
 *
 * Guards:
 *   1. Task must exist.
 *   2. Task status must be CORRECTION_IN_PROGRESS.
 *   3. Caller must hold the lock.
 *   4. No regions can remain in NEEDS_CORRECTION status.
 *
 * On success:
 *   - Task → READY_FOR_RE_REVIEW
 *   - Lock cleared
 *   - Audit logged
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

  // 1. Load and verify task
  const task = await getTaskById(task_id)
  if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })
  if (task.status !== 'CORRECTION_IN_PROGRESS') {
    return Response.json({ error: 'Task is not in CORRECTION_IN_PROGRESS state' }, { status: 422 })
  }
  // INT-3: Only the originally assigned labeler can submit corrections
  if (task.assigned_labeler !== email) {
    return Response.json({ error: 'Only the originally assigned labeler can submit this correction' }, { status: 403 })
  }
  if (task.locked_by !== email) {
    return Response.json({ error: 'You do not hold the lock on this task' }, { status: 403 })
  }

  // 2. Ensure all corrections have been made
  const regions = await listRegionsByTask(task_id)
  const remaining = regions.filter((r) => r.status === 'NEEDS_CORRECTION')
  
  if (remaining.length > 0) {
    return Response.json(
      { error: `${remaining.length} region(s) still need correction`, remaining: remaining.length },
      { status: 422 }
    )
  }

  // 3. Transition task status
  const updatedTask = await updateTaskStatus(task_id, 'READY_FOR_RE_REVIEW')

  // 4. Clear lock
  await releaseTaskLock(task_id)

  // 5. Audit log
  await logAction(
    email ?? '',
    'CORRECTION_SUBMITTED',
    'task',
    task_id,
    'CORRECTION_IN_PROGRESS',
    'READY_FOR_RE_REVIEW',
  )

  return Response.json({ task: updatedTask }, { status: 200 })
})
