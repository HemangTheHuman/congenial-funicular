import { auth } from '@/auth'
import {
  listAvailableTasksForLabeling,
  getActiveTaskForLabeler,
} from '@/lib/tasks'
import { db } from '@/lib/db'
import { nowISO } from '@/utils/date'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tasks/available
 * Auth: LABELER or ADMIN
 */
export const GET = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { role, email } = session.user
  if (role !== 'LABELER' && role !== 'ADMIN') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const todayPrefix = nowISO().slice(0, 10) // 'YYYY-MM-DD'

    const [available, myTask, statsRes] = await Promise.all([
      listAvailableTasksForLabeling(),
      getActiveTaskForLabeler(email ?? ''),
      db.execute({
        sql: `SELECT
                COUNT(*) as all_time,
                SUM(CASE WHEN created_at LIKE ? THEN 1 ELSE 0 END) as today
              FROM labels
              WHERE labeler_email = ? AND is_latest = 1`,
        args: [`${todayPrefix}%`, email ?? ''],
      }),
    ])

    const availableForOthers = available.filter((t) => t.locked_by !== (email ?? ''))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statsRow = statsRes.rows[0] as any
    const labeledAllTime = Number(statsRow?.all_time) || 0
    const labeledToday   = Number(statsRow?.today)    || 0

    return Response.json({
      available: availableForOthers,
      myTask,
      stats: {
        totalAvailable: availableForOthers.length,
        labeledToday,
        labeledAllTime,
      },
    })
  } catch (err) {
    console.error('[GET /api/tasks/available]', err)
    return Response.json({ error: 'Failed to load tasks', detail: String(err) }, { status: 500 })
  }
})
