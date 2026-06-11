import { auth } from '@/auth'
import {
  listAvailableTasksForLabeling,
  getActiveTaskForLabeler,
} from '@/lib/tasks'
import { readSheetAsObjects } from '@/lib/googleSheets'
import { nowISO } from '@/utils/date'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tasks/available
 * Auth: LABELER or ADMIN
 *
 * Returns:
 *   available  — tasks any labeler can claim right now
 *   myTask     — the task the caller currently has locked (or null)
 *   stats      — totalAvailable, labeledToday, labeledAllTime
 */
export const GET = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { role, email } = session.user
  if (role !== 'LABELER' && role !== 'ADMIN') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const [available, myTask, labelRows] = await Promise.all([
      listAvailableTasksForLabeling(),
      getActiveTaskForLabeler(email ?? ''),
      readSheetAsObjects('labels'),
    ])

    // Filter available tasks: exclude the one already held by this user
    // (it shows up in the myTask section instead)
    const availableForOthers = available.filter(
      (t) => t.locked_by !== (email ?? '')
    )

    // Compute label stats for this user
    const todayPrefix = nowISO().slice(0, 10) // 'YYYY-MM-DD'
    let labeledToday = 0
    let labeledAllTime = 0

    for (const row of labelRows) {
      if (row.labeler_email !== email) continue
      if (row.is_latest !== 'TRUE' && row.is_latest !== 'true') continue
      labeledAllTime++
      if (row.created_at?.startsWith(todayPrefix)) labeledToday++
    }

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
