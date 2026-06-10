/**
 * GET /api/admin/debug-task/:lsTaskId
 * DEV-ONLY — returns the raw Label Studio task JSON so we can inspect the
 * actual data field names used by this project's template.
 * Delete or gate this route before production.
 */
import { auth } from '@/auth'
import { getTask } from '@/lib/labelStudio'

export const dynamic = 'force-dynamic'

export const GET = auth(async (_req, { params }) => {
  const session = (_req as unknown as { auth: { user: { role: string } } | null }).auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { lsTaskId } = await params as { lsTaskId: string }

  try {
    const raw = await getTask(lsTaskId)
    return Response.json({ raw })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 })
  }
})
