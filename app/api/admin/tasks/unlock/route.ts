import { auth } from '@/auth'
import { db } from '@/lib/db'

export const POST = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return Response.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const { taskId } = await req.json()
    if (!taskId) return Response.json({ error: 'Missing taskId' }, { status: 400 })

    await db.execute({
      sql: `UPDATE tasks SET locked_by = NULL, lock_expires_at = NULL WHERE task_id = ?`,
      args: [taskId],
    })

    return Response.json({ success: true })
  } catch (err: any) {
    console.error('[Admin Unlock API] Error:', err)
    return Response.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
})
