import { auth } from '@/auth'
import { lsGet } from '@/lib/labelStudio'

export const dynamic = 'force-dynamic'

interface LsProject {
  id: number
  title: string
  task_number: number
}

interface LsProjectsResponse {
  results: LsProject[]
  count: number
}

export const GET = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return Response.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const data = await lsGet<LsProjectsResponse>('/api/projects/')
    const projects = (data.results ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      task_count: p.task_number ?? 0,
    }))
    return Response.json({ projects })
  } catch (err) {
    return Response.json(
      { error: 'Failed to fetch projects from Label Studio', detail: String(err) },
      { status: 502 }
    )
  }
})
