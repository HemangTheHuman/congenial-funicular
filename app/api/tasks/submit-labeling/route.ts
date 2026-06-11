import { auth } from '@/auth'
import { getTaskById, updateTaskStatus, releaseTaskLock } from '@/lib/tasks'
import { listRegionsByTask, updateRegionStatus } from '@/lib/regions'
import { logAction } from '@/lib/auditLog'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tasks/submit-labeling
 * Auth: LABELER or ADMIN
 * Body: { task_id: string }
 *
 * Submits a completed labeling task for review.
 *
 * Guards:
 *   1. Task must exist.
 *   2. Caller must hold the lock.
 *   3. All active regions must be LABELED or UNREADABLE.
 *
 * On success:
 *   - All regions → REVIEW_PENDING
 *   - Task → READY_FOR_REVIEW
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
  if (task.locked_by !== email) {
    return Response.json({ error: 'You do not hold the lock on this task' }, { status: 403 })
  }

  // 2. Load active regions and check all are labeled (or already submitted)
  const regions = await listRegionsByTask(task_id)
  const done = regions.filter(
    (r) => r.status === 'LABELED' || r.status === 'UNREADABLE' || r.status === 'REVIEW_PENDING'
  )
  const remaining = regions.length - done.length

  if (remaining > 0) {
    return Response.json(
      { error: `${remaining} region(s) still need to be labeled`, remaining },
      { status: 422 }
    )
  }

  if (regions.length === 0) {
    return Response.json({ error: 'Task has no active regions' }, { status: 422 })
  }

  // 3. Transition each region to REVIEW_PENDING (skip if already there)
  for (const region of regions) {
    if (region.status !== 'REVIEW_PENDING') {
      await updateRegionStatus(region.region_id, 'REVIEW_PENDING')
    }
  }

  // 4. Transition task status
  const updatedTask = await updateTaskStatus(task_id, 'READY_FOR_REVIEW')

  // 5. Clear lock
  await releaseTaskLock(task_id)

  // 6. Audit log
  await logAction(
    email ?? '',
    'TASK_SUBMITTED',
    'task',
    task_id,
    '',
    'READY_FOR_REVIEW',
  )

  return Response.json({ task: updatedTask }, { status: 200 })
})
