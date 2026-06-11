import { auth } from '@/auth'
import { db } from '@/lib/db'
import { logAction } from '@/lib/auditLog'
import { nowISO } from '@/utils/date'
import type { UserRole, UserStatus } from '@/types/user'

export const dynamic = 'force-dynamic'

/** POST /api/admin/assign-role
 *  Body: { userId: string, role: 'LABELER' | 'REVIEWER' | 'ADMIN' }
 *  Requires: ADMIN session
 */
export const POST = auth(async (req) => {
  const session = req.auth
  if (session?.user?.role !== 'ADMIN') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { userId?: string; role?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { userId, role } = body
  const allowedRoles: UserRole[] = ['LABELER', 'REVIEWER', 'ADMIN']

  if (!userId || !role || !allowedRoles.includes(role as UserRole)) {
    return Response.json(
      { error: 'userId and a valid role (LABELER, REVIEWER, ADMIN) are required' },
      { status: 400 }
    )
  }

  const res = await db.execute({
    sql:  'SELECT role FROM users WHERE user_id = ? LIMIT 1',
    args: [userId],
  })
  if (res.rows.length === 0) {
    return Response.json({ error: 'User not found' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oldRole = String((res.rows[0] as any).role)
  const now = nowISO()

  await db.execute({
    sql:  "UPDATE users SET role = ?, status = 'ACTIVE', updated_at = ? WHERE user_id = ?",
    args: [role, now, userId],
  })

  await logAction(session.user.email ?? '', 'ROLE_ASSIGNED', 'user', userId, oldRole, role)

  return Response.json({ message: 'Role assigned successfully', userId, role, status: 'ACTIVE' })
})
