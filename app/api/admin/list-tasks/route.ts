import { auth } from '@/auth'
import { listProjectTasks } from '@/lib/labelStudio'
import type { LsFilterQuery } from '@/lib/labelStudio'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const IMPORT_FILTER: LsFilterQuery = {
  filters: {
    conjunction: 'and',
    items: [
      { filter: 'filter:tasks:data.review', operator: 'equal', type: 'String', value: 'approved' },
      { filter: 'filter:tasks:data.excel',  operator: 'equal', type: 'String', value: 'none'     },
    ],
  },
}

export const GET = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  const page = parseInt(searchParams.get('page') ?? '1', 10)

  if (!projectId) {
    return Response.json({ error: 'Missing projectId query param' }, { status: 400 })
  }

  try {
    const [lsData, totalData] = await Promise.all([
      listProjectTasks(projectId, page, 100, IMPORT_FILTER),
      listProjectTasks(projectId, 1, 1),
    ])
    const filteredTasks  = lsData.tasks  ?? []
    const totalInProject = totalData.total ?? null

    // Build a Set of already-imported ls_task_ids from Turso
    const lsIds = filteredTasks.map((t) => String(t.id))
    let importedMap: Map<string, { task_id: string; status: string }> = new Map()

    if (lsIds.length > 0) {
      const placeholders = lsIds.map(() => '?').join(',')
      const res = await db.execute({
        sql:  `SELECT ls_task_id, task_id, status FROM tasks WHERE ls_task_id IN (${placeholders})`,
        args: lsIds,
      })
      for (const row of res.rows) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = row as any
        importedMap.set(String(r.ls_task_id), { task_id: String(r.task_id), status: String(r.status) })
      }
    }

    const tasks = filteredTasks.map((t) => {
      const existing = importedMap.get(String(t.id))
      return {
        lsTaskId:        t.id,
        alreadyImported: !!existing,
        task_id:         existing?.task_id ?? null,
        status:          existing?.status  ?? null,
      }
    })

    return Response.json({ tasks, total: filteredTasks.length, totalInProject, page })
  } catch (err) {
    return Response.json(
      { error: 'Failed to fetch tasks from Label Studio', detail: String(err) },
      { status: 502 }
    )
  }
})
