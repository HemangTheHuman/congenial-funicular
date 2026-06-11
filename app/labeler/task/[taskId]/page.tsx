import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { getTaskById } from '@/lib/tasks'
import { listRegionsByTask } from '@/lib/regions'
import { listLatestLabelsByTask } from '@/lib/labels'
import { toProxiedImageUrl } from '@/utils/imageUrl'
import { WorkspaceClient } from './WorkspaceClient'
import { UserBadge } from '@/components/auth/UserBadge'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { UserRole } from '@/types/user'
import type { Region } from '@/types/region'
import type { Label } from '@/types/label'

export const dynamic = 'force-dynamic'

export interface RegionWithCrop extends Region {
  /** Padded pixel bbox — server-computed */
  cropXmin: number
  cropYmin: number
  cropWidth: number
  cropHeight: number
}

interface Props {
  params: Promise<{ taskId: string }>
}

export default async function LabelerTaskPage({ params }: Props) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const user = session.user
  const email = user.email ?? ''
  const { taskId } = await params

  // Load all data in parallel
  const task = await getTaskById(taskId)

  // Auth guard: task must exist and be locked by this user
  if (!task || task.locked_by !== email) {
    redirect('/labeler')
  }

  const [regions, existingLabels] = await Promise.all([
    listRegionsByTask(taskId),
    listLatestLabelsByTask(taskId),
  ])

  // Build label map: regionId → Label
  const labelMap: Record<string, Label> = {}
  for (const label of existingLabels) {
    labelMap[label.region_id] = label
  }

  // Compute exact crop bounds for each region (no padding — exact bbox)
  const regionsWithCrop: RegionWithCrop[] = regions.map((r) => {
    return {
      ...r,
      cropXmin: r.bbox_xmin,
      cropYmin: r.bbox_ymin,
      cropWidth: r.bbox_xmax - r.bbox_xmin,
      cropHeight: r.bbox_ymax - r.bbox_ymin,
    }
  })

  const proxiedImageUrl = toProxiedImageUrl(task.image_url)

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="border-b bg-card px-4 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/labeler"
              className={buttonVariants({ variant: 'ghost', size: 'sm' }) + ' gap-2'}
            >
              <ArrowLeft className="h-4 w-4" />
              Dashboard
            </Link>
            <Separator orientation="vertical" className="h-6" />
            <span className="font-mono text-sm font-semibold truncate max-w-40">
              {task.task_id}
            </span>
            {task.batch_id && (
              <Badge variant="secondary" className="text-xs hidden sm:inline-flex">
                {task.batch_id}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <UserBadge name={user.name ?? ''} email={email} role={user.role as UserRole} />
            <Separator orientation="vertical" className="h-8" />
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* ── Workspace ────────────────────────────────────────────────────── */}
      <WorkspaceClient
        task={task}
        regions={regionsWithCrop}
        labelMap={labelMap}
        proxiedImageUrl={proxiedImageUrl}
      />
    </div>
  )
}
