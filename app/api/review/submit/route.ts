import { auth } from '@/auth'
import { getTaskById, updateTaskStatus, releaseTaskLock } from '@/lib/tasks'
import { listRegionsByTask, updateRegionStatus } from '@/lib/regions'
import { createSyncEntry } from '@/lib/syncQueue'
import { logAction } from '@/lib/auditLog'

export const dynamic = 'force-dynamic'

/**
 * POST /api/review/submit
 * Auth: REVIEWER or ADMIN
 * Body: { task_id: string }
 *
 * Submits a completed review. All regions must be APPROVED or NEEDS_CORRECTION.
 *
 * Outcomes:
 *   All regions APPROVED  → APPROVED → FINAL_APPROVED, sync queue entry created
 *   Any NEEDS_CORRECTION  → task → NEEDS_CORRECTION (labeler must correct)
 *
 * On success:
 *   - Regions advanced (APPROVED → FINAL_APPROVED if full approval)
 *   - Task status updated
 *   - Lock cleared
 *   - Sync queue entry created (PENDING) if fully approved
 *   - Audit logged
 */
export const POST = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { role, email } = session.user
  if (role !== 'REVIEWER' && role !== 'ADMIN') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { task_id: string }
  try {
    body = await req.json() as { task_id: string }
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { task_id } = body
  if (!task_id) return Response.json({ error: 'task_id is required' }, { status: 400 })

  try {
    // 1. Load task and verify lock
    const task = await getTaskById(task_id)
    if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })
    if (task.locked_by !== email) {
      return Response.json({ error: 'You do not hold the lock on this task' }, { status: 403 })
    }

    // 2. Load regions and check completion
    const regions = await listRegionsByTask(task_id)
    if (regions.length === 0) {
      return Response.json({ error: 'Task has no active regions' }, { status: 422 })
    }

    const TERMINAL_REVIEW_STATUSES = new Set(['APPROVED', 'NEEDS_CORRECTION'])
    const unreviewed = regions.filter((r) => !TERMINAL_REVIEW_STATUSES.has(r.status))
    if (unreviewed.length > 0) {
      return Response.json(
        { error: `${unreviewed.length} region(s) have not been reviewed yet`, remaining: unreviewed.length },
        { status: 422 }
      )
    }

    // 3. Determine outcome
    const allApproved = regions.every((r) => r.status === 'APPROVED')
    const outcome: 'FINAL_APPROVED' | 'NEEDS_CORRECTION' = allApproved
      ? 'FINAL_APPROVED'
      : 'NEEDS_CORRECTION'

    // 4a. Full approval path — advance all regions to FINAL_APPROVED + queue sync
    if (allApproved) {
      for (const region of regions) {
        await updateRegionStatus(region.region_id, 'FINAL_APPROVED')
      }
      await createSyncEntry(task_id, task.ls_task_id)
    }

    // 4b. Transition task status
    const updatedTask = await updateTaskStatus(task_id, outcome)

    // 5. Clear lock
    await releaseTaskLock(task_id)

    // 6. Audit log
    await logAction(email ?? '', 'REVIEW_SUBMITTED', 'task', task_id, task.status, outcome)

    return Response.json({ task: updatedTask, outcome })
  } catch (err) {
    console.error('[POST /api/review/submit]', err)
    return Response.json({ error: 'Failed to submit review', detail: String(err) }, { status: 500 })
  }
})
