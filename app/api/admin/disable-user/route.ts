import { auth } from '@/auth'
import { db } from '@/lib/db'
import { logAction } from '@/lib/auditLog'
import { nowISO } from '@/utils/date'

export const dynamic = 'force-dynamic'

/** POST /api/admin/disable-user
 *  Body: { userId: string }
 *  Requires: ADMIN session
 */
export const POST = auth(async (req) => {
  const session = req.auth
  if (session?.user?.role !== 'ADMIN') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { userId?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { userId } = body
  if (!userId) {
    return Response.json({ error: 'userId is required' }, { status: 400 })
  }

  if (userId === session.user.user_id) {
    return Response.json({ error: 'Cannot disable your own account' }, { status: 400 })
  }

  const res = await db.execute({
    sql:  'SELECT status FROM users WHERE user_id = ? LIMIT 1',
    args: [userId],
  })
  if (res.rows.length === 0) {
    return Response.json({ error: 'User not found' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oldStatus = String((res.rows[0] as any).status)

  await db.execute({
    sql:  "UPDATE users SET status = 'DISABLED', updated_at = ? WHERE user_id = ?",
    args: [nowISO(), userId],
  })

  await logAction(session.user.email ?? '', 'USER_DISABLED', 'user', userId, oldStatus, 'DISABLED')

  return Response.json({ message: 'User disabled', userId })
})
