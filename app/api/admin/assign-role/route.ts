import { auth } from '@/auth'
import { findRowByColumn, updateRow } from '@/lib/googleSheets'
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

  const result = await findRowByColumn('users', 'user_id', userId)
  if (!result) {
    return Response.json({ error: 'User not found' }, { status: 404 })
  }

  const { row, rowNumber } = result
  const oldRole = row.role
  const now = nowISO()

  await updateRow('users', rowNumber, [
    row.user_id, row.email, row.name, row.password_hash,
    role,          // updated role
    'ACTIVE' as UserStatus, // activate the user
    row.assigned_batch,
    row.created_at, now, row.last_login_at, row.notes,
  ])

  await logAction(
    session.user.email,
    'ROLE_ASSIGNED',
    'user',
    userId,
    oldRole,
    role
  )

  return Response.json({
    message: 'Role assigned successfully',
    userId,
    role,
    status: 'ACTIVE',
  })
})
