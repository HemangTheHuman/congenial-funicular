import { auth } from '@/auth'
import { importSingleTask } from '@/app/api/admin/import-task/[lsTaskId]/route'

export const dynamic = 'force-dynamic'

interface BatchRequestBody {
  lsTaskIds: (number | string)[]
  batch_id?: string
}

interface BatchResultItem {
  lsTaskId: string
  success: boolean
  task_id: string | null
  regionCount: number
  skipped: boolean
  error: string | null
}

export const POST = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return Response.json({ error: 'Forbidden' }, { status: 403 })

  let body: BatchRequestBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.lsTaskIds) || body.lsTaskIds.length === 0) {
    return Response.json({ error: 'lsTaskIds must be a non-empty array' }, { status: 400 })
  }

  const batchId = body.batch_id ?? ''
  const adminEmail = session.user.email ?? ''
  const results: BatchResultItem[] = []

  // Sequential — avoids concurrent Sheet write races
  for (const rawId of body.lsTaskIds) {
    const lsTaskId = String(rawId)
    try {
      const result = await importSingleTask(lsTaskId, adminEmail, batchId)
      results.push({
        lsTaskId,
        success: !result.alreadyExisted,
        task_id: result.task.task_id,
        regionCount: result.regionCount,
        skipped: result.alreadyExisted,
        error: null,
      })
    } catch (err) {
      results.push({
        lsTaskId,
        success: false,
        task_id: null,
        regionCount: 0,
        skipped: false,
        error: String(err),
      })
    }
  }

  const summary = {
    total: results.length,
    imported: results.filter((r) => r.success).length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => !r.success && !r.skipped).length,
  }

  return Response.json({ ...summary, results })
})
