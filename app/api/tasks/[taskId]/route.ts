import { auth } from '@/auth'
import { getTaskById } from '@/lib/tasks'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tasks/[taskId]
 * Auth: LABELER, REVIEWER, or ADMIN
 *
 * Returns the full Task object for the given task_id.
 * Used by the Phase 5 workspace page and the Phase 5 stub.
 */
export const GET = auth(async (req, { params }) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { role } = session.user
  if (role !== 'LABELER' && role !== 'REVIEWER' && role !== 'ADMIN') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { taskId } = await (params as Promise<{ taskId: string }>)

  try {
    const task = await getTaskById(taskId)
    if (!task) {
      return Response.json({ error: 'Task not found' }, { status: 404 })
    }
    return Response.json({ task })
  } catch (err) {
    console.error('[GET /api/tasks/[taskId]]', err)
    return Response.json({ error: 'Failed to fetch task', detail: String(err) }, { status: 500 })
  }
})
