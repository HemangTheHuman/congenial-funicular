import { auth } from '@/auth'
import { findRowByColumn, updateRow } from '@/lib/googleSheets'
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

  // Prevent admin from disabling themselves
  if (userId === session.user.user_id) {
    return Response.json({ error: 'Cannot disable your own account' }, { status: 400 })
  }

  const result = await findRowByColumn('users', 'user_id', userId)
  if (!result) {
    return Response.json({ error: 'User not found' }, { status: 404 })
  }

  const { row, rowNumber } = result
  const now = nowISO()

  await updateRow('users', rowNumber, [
    row.user_id, row.email, row.name, row.password_hash,
    row.role,
    'DISABLED',
    row.assigned_batch,
    row.created_at, now, row.last_login_at, row.notes,
  ])

  await logAction(
    session.user.email,
    'USER_DISABLED',
    'user',
    userId,
    row.status,
    'DISABLED'
  )

  return Response.json({ message: 'User disabled', userId })
})
