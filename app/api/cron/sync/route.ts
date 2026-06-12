import { listPendingSyncEntries } from '@/lib/syncQueue'
import { syncTaskToLabelStudio } from '@/lib/sync'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/sync
 * 
 * Scheduled endpoint to process pending syncs.
 * Should be protected by a cron secret in production.
 */
export async function GET(req: Request) {
  // Simple cron secret protection
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const pending = await listPendingSyncEntries()
    if (pending.length === 0) {
      return Response.json({ message: 'Sync queue is empty' })
    }

    // Process up to 5 tasks per cron run to avoid timeout
    const batch = pending.slice(0, 5)
    let successCount = 0
    let failCount = 0

    for (const entry of batch) {
      try {
        await syncTaskToLabelStudio(entry.task_id)
        successCount++
      } catch (err) {
        console.error(`[CRON] Failed to sync task ${entry.task_id}:`, err)
        failCount++
      }
    }

    return Response.json({
      message: 'Cron executed successfully',
      processed: batch.length,
      successCount,
      failCount,
      remaining: pending.length - batch.length
    })

  } catch (err) {
    console.error('[GET /api/cron/sync] Fatal error:', err)
    return Response.json({ error: 'Fatal cron error', detail: String(err) }, { status: 500 })
  }
}
