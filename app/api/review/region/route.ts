import { auth } from '@/auth'
import { getTaskById, incrementRegionCount } from '@/lib/tasks'
import { getRegionById, updateRegionStatus, updateRegionScriptTag } from '@/lib/regions'
import { createReview, getLatestReviewForRegion } from '@/lib/reviews'
import { logAction } from '@/lib/auditLog'
import { APP_CONFIG } from '@/lib/appConfig'
import { updateTaskStatus } from '@/lib/tasks'
import type { ReviewStatus } from '@/types/review'

export const dynamic = 'force-dynamic'

interface ReviewRegionBody {
  task_id:          string
  region_id:        string
  review_status:    ReviewStatus
  final_script_tag: string
  review_note:      string
}

/**
 * POST /api/review/region
 * Auth: REVIEWER or ADMIN
 *
 * Records a review decision for a single region.
 *
 * Decision logic (README §10.3):
 *   APPROVED      → region.status = APPROVED     (script unchanged or SCRIPT_WRONG handled here)
 *   SCRIPT_WRONG  → region.status = APPROVED     + script_tag_final updated
 *   TEXT_WRONG    → region.status = NEEDS_CORRECTION
 *   BOTH_WRONG    → region.status = NEEDS_CORRECTION + script_tag_final updated
 */
export const POST = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { role, email } = session.user
  if (role !== 'REVIEWER' && role !== 'ADMIN') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: ReviewRegionBody
  try {
    body = await req.json() as ReviewRegionBody
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { task_id, region_id, review_status, final_script_tag, review_note } = body
  if (!task_id || !region_id || !review_status) {
    return Response.json({ error: 'task_id, region_id, and review_status are required' }, { status: 400 })
  }

  // SEC-4: Validate review_status against allowed set (includes UNREADABLE_WRONG)
  const VALID_STATUSES: ReviewStatus[] = ['APPROVED', 'SCRIPT_WRONG', 'TEXT_WRONG', 'BOTH_WRONG', 'UNREADABLE_WRONG']
  if (!VALID_STATUSES.includes(review_status)) {
    return Response.json({ error: `Invalid review_status: ${review_status}` }, { status: 400 })
  }

  // SEC-4: Validate final_script_tag against allowed list
  if (final_script_tag) {
    const formatted = final_script_tag.charAt(0).toUpperCase() + final_script_tag.slice(1).toLowerCase()
    if (!APP_CONFIG.ALLOWED_SCRIPT_TAGS.includes(formatted)) {
      return Response.json(
        { error: `Invalid script tag '${final_script_tag}'. Allowed: ${APP_CONFIG.ALLOWED_SCRIPT_TAGS.join(', ')}` },
        { status: 400 }
      )
    }
  }

  try {
    // 1. Load task + region in parallel
    const [task, region] = await Promise.all([
      getTaskById(task_id),
      getRegionById(region_id),
    ])

    if (!task)   return Response.json({ error: 'Task not found' }, { status: 404 })
    if (!region) return Response.json({ error: 'Region not found' }, { status: 404 })

    // 2. Guard: caller must hold the lock
    if (task.locked_by !== email) {
      return Response.json({ error: 'You do not hold the lock on this task' }, { status: 403 })
    }
    if (region.task_id !== task_id) {
      return Response.json({ error: 'Region does not belong to this task' }, { status: 400 })
    }

    // 3. Determine region outcome status
    // FEAT-1: UNREADABLE_WRONG sends back for correction (same as TEXT_WRONG)
    const approved = review_status === 'APPROVED' || review_status === 'SCRIPT_WRONG'
    const targetRegionStatus = approved ? 'APPROVED' : 'NEEDS_CORRECTION'

    // 4. Create review record
    const latestReview = await getLatestReviewForRegion(region_id)
    const review_round = (latestReview?.review_round ?? 0) + 1

    // FEAT-2: Enforce MAX_REVIEW_ROUNDS — flag for admin if cap exceeded
    if (!approved && review_round > APP_CONFIG.MAX_REVIEW_ROUNDS) {
      // Set a special status to signal admin escalation needed
      await updateTaskStatus(task_id, 'NEEDS_CORRECTION') // stays in correction but flagged
      await logAction(
        email ?? '',
        'REVIEW_ROUND_LIMIT_EXCEEDED',
        'task',
        task_id,
        task.status,
        JSON.stringify({ review_round, max: APP_CONFIG.MAX_REVIEW_ROUNDS, region_id }),
      )
      return Response.json(
        { error: `Maximum review rounds (${APP_CONFIG.MAX_REVIEW_ROUNDS}) exceeded. Task flagged for admin review.`, escalated: true },
        { status: 422 }
      )
    }

    const formatted_final_script_tag = final_script_tag 
      ? final_script_tag.charAt(0).toUpperCase() + final_script_tag.slice(1).toLowerCase()
      : region.script_tag_final

    const [review, updatedRegion] = await Promise.all([
      createReview({
        region_id,
        task_id,
        reviewer_email:   email ?? '',
        review_status,
        final_script_tag: formatted_final_script_tag,
        review_note:      review_note ?? '',
        review_round,
      }),
      updateRegionStatus(region_id, targetRegionStatus),
    ])

    // 5. INT-5: Always write script_tag_final on SCRIPT_WRONG or BOTH_WRONG,
    //    even when the value hasn't changed, to make the reviewer intent explicit.
    const shouldUpdateScript =
      (review_status === 'SCRIPT_WRONG' || review_status === 'BOTH_WRONG') &&
      !!final_script_tag

    if (shouldUpdateScript) {
      await updateRegionScriptTag(region_id, formatted_final_script_tag)
    }

    // 6. Increment task counters
    await incrementRegionCount(task_id, approved ? 'approved' : 'rejected', 1)

    // 7. Audit (fire-and-forget)
    logAction(
      email ?? '',
      'REGION_REVIEWED',
      'region',
      region_id,
      region.status,
      JSON.stringify({ review_status, final_script_tag: formatted_final_script_tag, review_note }),
    ).catch(() => {})

    return Response.json({ review, region: updatedRegion })
  } catch (err) {
    console.error('[POST /api/review/region]', err)
    return Response.json({ error: 'Failed to save review', detail: String(err) }, { status: 500 })
  }
})
