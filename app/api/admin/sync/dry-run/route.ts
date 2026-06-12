import { auth } from '@/auth'
import { listPendingSyncEntries } from '@/lib/syncQueue'
import { dryRunTaskSync } from '@/lib/sync'
import type { SyncStats } from '@/lib/sync'

export const dynamic = 'force-dynamic'

export const POST = auth(async (req) => {
  const session = req.auth
  if (!session?.user || session.user.role !== 'ADMIN') {
    return Response.json({ error: 'Unauthorized' }, { status: 403 })
  }

  let body: { taskId?: string } = {}
  try {
    body = await req.json()
  } catch {
    // optional body
  }

  try {
    const tasksToProcess = []

    if (body.taskId) {
      tasksToProcess.push(body.taskId)
    } else {
      const pending = await listPendingSyncEntries()
      // Limit to 10 for dry run to avoid timeouts if queue is huge
      tasksToProcess.push(...pending.slice(0, 10).map(e => e.task_id))
    }

    if (tasksToProcess.length === 0) {
      return Response.json({
        tasksToPush: 0,
        regionsRemoved: 0,
        scriptsChanged: 0,
        transcriptionsAdded: 0
      })
    }

    const aggregated: SyncStats & { tasksToPush: number } = {
      tasksToPush: tasksToProcess.length,
      regionsRemoved: 0,
      scriptsChanged: 0,
      transcriptionsAdded: 0
    }

    for (const taskId of tasksToProcess) {
      try {
        const stats = await dryRunTaskSync(taskId)
        aggregated.regionsRemoved += stats.regionsRemoved
        aggregated.scriptsChanged += stats.scriptsChanged
        aggregated.transcriptionsAdded += stats.transcriptionsAdded
      } catch (err) {
        console.error(`Dry run failed for ${taskId}:`, err)
        // If a task fails dry run, we still continue to aggregate the others
      }
    }

    return Response.json(aggregated)

  } catch (err) {
    console.error('[POST /api/admin/sync/dry-run]', err)
    return Response.json({ error: 'Failed to perform dry run', detail: String(err) }, { status: 500 })
  }
})
