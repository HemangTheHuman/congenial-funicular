import { auth } from '@/auth'
import { listProjectTasks } from '@/lib/labelStudio'
import type { LsFilterQuery } from '@/lib/labelStudio'
import { readSheetAsObjects } from '@/lib/googleSheets'

export const dynamic = 'force-dynamic'

/**
 * Filter applied to Label Studio task list.
 * Only tasks with data.review === "approved" AND data.excel === "none"
 * are eligible for import — LS handles the filtering server-side.
 */
const IMPORT_FILTER: LsFilterQuery = {
  filters: {
    conjunction: 'and',
    items: [
      {
        filter:   'filter:tasks:data.review',
        operator: 'equal',
        type:     'String',
        value:    'approved',
      },
      {
        filter:   'filter:tasks:data.excel',
        operator: 'equal',
        type:     'String',
        value:    'none',
      },
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
    // Fetch only matching tasks — LS does the filter server-side
    const lsData = await listProjectTasks(projectId, page, 100, IMPORT_FILTER)
    const filteredTasks = lsData.tasks ?? []

    // Fetch total (unfiltered) for the context line in the UI
    const totalData = await listProjectTasks(projectId, 1, 1)
    const totalInProject = totalData.total ?? null

    // Build a Set of already-imported ls_task_ids — ONE Sheet read for all tasks
    const sheetRows = await readSheetAsObjects('tasks')
    const importedSet = new Set(sheetRows.map((r) => r.ls_task_id))

    const tasks = filteredTasks.map((t) => {
      const alreadyImported = importedSet.has(String(t.id))
      const matchingRow = alreadyImported
        ? sheetRows.find((r) => r.ls_task_id === String(t.id))
        : undefined

      return {
        lsTaskId: t.id,
        alreadyImported,
        task_id: matchingRow?.task_id ?? null,
        status: matchingRow?.status ?? null,
      }
    })

    return Response.json({
      tasks,
      total: filteredTasks.length,
      totalInProject,
      page,
    })
  } catch (err) {
    return Response.json(
      { error: 'Failed to fetch tasks from Label Studio', detail: String(err) },
      { status: 502 }
    )
  }
})
