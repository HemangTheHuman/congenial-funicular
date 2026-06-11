import { auth } from '@/auth'
import { getTaskById, incrementRegionCount } from '@/lib/tasks'
import { getRegionById, updateRegionStatus } from '@/lib/regions'
import { createNewLabelVersion } from '@/lib/labels'
import { logAction } from '@/lib/auditLog'

export const dynamic = 'force-dynamic'

interface SaveLabelBody {
  task_id: string
  region_id: string
  text: string
  is_unreadable: boolean
  local_client_id?: string
}

/**
 * POST /api/regions/save-label
 * Auth: LABELER or ADMIN
 *
 * With Turso all queries are fast indexed lookups — no Sheets workarounds needed.
 * Saves a label for a single region and advances its status to LABELED or UNREADABLE.
 * Re-saving an already-labeled region creates a new label version.
 */
export const POST = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const { role, email } = session.user
  if (role !== 'LABELER' && role !== 'ADMIN') {
    return new Response('Forbidden', { status: 403 })
  }

  let body: SaveLabelBody
  try {
    body = await req.json() as SaveLabelBody
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { task_id, region_id, text, is_unreadable, local_client_id = '' } = body
  if (!task_id || !region_id) {
    return Response.json({ error: 'task_id and region_id are required' }, { status: 400 })
  }

  // 1. Load task and region in parallel (fast indexed SQL lookups)
  const [task, region] = await Promise.all([
    getTaskById(task_id),
    getRegionById(region_id),
  ])

  if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })
  if (!region) return Response.json({ error: 'Region not found' }, { status: 404 })

  if (task.locked_by !== email) {
    return Response.json({ error: 'You do not hold the lock on this task' }, { status: 403 })
  }
  if (region.task_id !== task_id) {
    return Response.json({ error: 'Region does not belong to this task' }, { status: 400 })
  }

  const alreadyLabeled = region.status === 'LABELED' || region.status === 'UNREADABLE'

  // 2. Create new label version (UPDATE + INSERT, two fast SQL statements)
  const label = await createNewLabelVersion(
    region_id, task_id, email ?? '',
    is_unreadable ? '' : (text ?? ''),
    is_unreadable,
    local_client_id
  )

  // 3. Update region status + task counter in parallel
  const targetStatus = is_unreadable ? 'UNREADABLE' : 'LABELED'
  const [updatedRegion] = await Promise.all([
    updateRegionStatus(region_id, targetStatus),
    alreadyLabeled
      ? Promise.resolve()
      : incrementRegionCount(task_id, 'labeled', 1),
  ])

  // 4. Audit (fire-and-forget)
  logAction(email ?? '', 'REGION_LABELED', 'region', region_id, '',
    JSON.stringify({ text: label.text, is_unreadable })
  ).catch(() => {})

  return Response.json({ label, region: updatedRegion }, { status: 200 })
})
