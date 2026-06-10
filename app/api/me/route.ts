import { auth } from '@/auth'

export const dynamic = 'force-dynamic'

/** GET /api/me — returns the current session user (SafeUser) or 401 */
export const GET = auth(async (req) => {
  const session = req.auth
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Return SafeUser — no password_hash (never in session anyway)
  return Response.json({ user: session.user })
})
