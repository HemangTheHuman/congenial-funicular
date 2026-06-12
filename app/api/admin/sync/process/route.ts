import { auth } from '@/auth'
import { listPendingSyncEntries, getSyncEntry, requeueFailedEntry } from '@/lib/syncQueue'
import { syncTaskToLabelStudio } from '@/lib/sync'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/sync/process
 * Auth: ADMIN
 * Body: { taskId?: string, retryFailed?: boolean }
 * 
 * If taskId is provided, syncs that specific task (must be in sync_queue).
 * If retryFailed is true and taskId provided, sets it back to PENDING first.
 * If no taskId provided, processes the entire PENDING queue (up to a limit).
 */
export const POST = auth(async (req) => {
  const session = req.auth
  if (!session?.user || session.user.role !== 'ADMIN') {
    return Response.json({ error: 'Unauthorized' }, { status: 403 })
  }

  let body: { taskId?: string, retryFailed?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    // optional body
  }

  try {
    // Single task sync (like Retry)
    if (body.taskId) {
      if (body.retryFailed) {
        await requeueFailedEntry(body.taskId)
      }
      
      const entry = await getSyncEntry(body.taskId)
      if (!entry || entry.status !== 'PENDING') {
        return Response.json({ error: `Task ${body.taskId} is not in PENDING sync state` }, { status: 400 })
      }

      await syncTaskToLabelStudio(body.taskId)
      return Response.json({ success: true, processed: 1 })
    }

    // Batch sync
    const pending = await listPendingSyncEntries()
    if (pending.length === 0) {
      return Response.json({ success: true, processed: 0, message: 'Queue is empty' })
    }

    // Process up to 10 at a time to prevent timeout
    const batch = pending.slice(0, 10)
    let successCount = 0
    let failCount = 0

    for (const entry of batch) {
      try {
        await syncTaskToLabelStudio(entry.task_id)
        successCount++
      } catch (err) {
        console.error(`Failed to sync task ${entry.task_id}:`, err)
        failCount++
      }
    }

    return Response.json({ 
      success: true, 
      processed: batch.length, 
      successCount, 
      failCount,
      remaining: pending.length - batch.length
    })

  } catch (err) {
    console.error('[POST /api/admin/sync/process]', err)
    return Response.json({ error: 'Failed to process sync queue', detail: String(err) }, { status: 500 })
  }
})
