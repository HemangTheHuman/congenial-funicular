import { auth } from '@/auth'
import {
  listTasksForReview,
  getActiveTaskForLabeler,
} from '@/lib/tasks'
import { db } from '@/lib/db'
import { nowISO } from '@/utils/date'

export const dynamic = 'force-dynamic'

/**
 * GET /api/review/tasks
 * Auth: REVIEWER or ADMIN
 *
 * Returns:
 *   available  — tasks in READY_FOR_REVIEW or READY_FOR_RE_REVIEW not locked by someone else
 *   myTask     — task currently locked by this reviewer (if any)
 *   stats      — review stats for this reviewer
 */
export const GET = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { role, email } = session.user
  if (role !== 'REVIEWER' && role !== 'ADMIN') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const reviewerEmail = email ?? ''
  const now = nowISO()

  // Fetch in parallel: all review-queue tasks + active lock for this reviewer + stats
  const [allForReview, myTask, statsRes] = await Promise.all([
    listTasksForReview(),
    getActiveTaskForLabeler(reviewerEmail),   // same lock mechanic works for reviewers
    db.execute({
      sql: `SELECT
              COUNT(*) as all_time,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as today
            FROM reviews WHERE reviewer_email = ?`,
      args: [now.slice(0, 10), reviewerEmail],   // today = YYYY-MM-DD prefix
    }),
  ])

  // Filter out tasks locked by *other* reviewers with live locks
  const available = allForReview.filter((t) => {
    if (!t.locked_by || t.locked_by === reviewerEmail) return true
    if (!t.lock_expires_at || t.lock_expires_at < now) return true
    return false
  })

  const statsRow = statsRes.rows[0]
  const stats = {
    totalWaiting:    available.length,
    reviewedToday:   Number(statsRow?.today)    || 0,
    reviewedAllTime: Number(statsRow?.all_time) || 0,
  }

  return Response.json({ available, myTask, stats })
})
