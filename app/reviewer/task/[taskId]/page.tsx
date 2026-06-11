import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { getTaskById } from '@/lib/tasks'
import { listRegionsByTask } from '@/lib/regions'
import { listLatestLabelsByTask } from '@/lib/labels'
import { listReviewsByTask } from '@/lib/reviews'
import { toProxiedImageUrl } from '@/utils/imageUrl'
import { UserBadge } from '@/components/auth/UserBadge'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ReviewWorkspaceClient } from './ReviewWorkspaceClient'
import type { UserRole } from '@/types/user'
import type { Region } from '@/types/region'
import type { Label } from '@/types/label'
import type { Review } from '@/types/review'

export const dynamic = 'force-dynamic'

export interface RegionWithCrop extends Region {
  cropXmin:   number
  cropYmin:   number
  cropWidth:  number
  cropHeight: number
}

export default async function ReviewWorkspacePage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const { email, role } = session.user
  if (role !== 'REVIEWER' && role !== 'ADMIN') redirect('/login')

  const { taskId } = await params
  const task = await getTaskById(taskId)

  // Auth guard: must hold the lock
  if (!task || task.locked_by !== email) redirect('/reviewer')

  // Parallel fetch: regions + labels + previous reviews
  const [regions, existingLabels, allReviews] = await Promise.all([
    listRegionsByTask(task.task_id),
    listLatestLabelsByTask(task.task_id),
    listReviewsByTask(task.task_id),
  ])

  // Build label map: region_id → latest Label
  const labelMap: Record<string, Label> = {}
  for (const label of existingLabels) {
    labelMap[label.region_id] = label
  }

  // Build review map: region_id → most-recent Review (for re-review context)
  const reviewMap: Record<string, Review> = {}
  for (const review of allReviews) {
    const existing = reviewMap[review.region_id]
    if (!existing || review.review_round > existing.review_round) {
      reviewMap[review.region_id] = review
    }
  }

  // Compute crop bounds (zero padding — exact bbox)
  const regionsWithCrop: RegionWithCrop[] = regions.map((r) => ({
    ...r,
    cropXmin:   r.bbox_xmin,
    cropYmin:   r.bbox_ymin,
    cropWidth:  r.bbox_xmax - r.bbox_xmin,
    cropHeight: r.bbox_ymax - r.bbox_ymin,
  }))

  const proxiedImageUrl = toProxiedImageUrl(task.image_url)
  const isReReview      = task.status === 'REVIEWING_IN_PROGRESS' &&
                          allReviews.length > 0

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="border-b bg-card px-4 py-2 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono text-sm font-semibold truncate">{task.task_id}</span>
            {task.batch_id && (
              <Badge variant="secondary" className="text-xs shrink-0">{task.batch_id}</Badge>
            )}
            {isReReview && (
              <Badge variant="outline" className="text-xs shrink-0 border-amber-400 text-amber-600">
                Re-Review
              </Badge>
            )}
            <Badge variant="outline" className="text-xs shrink-0">
              {task.region_count} regions
            </Badge>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <UserBadge
              name={session.user.name ?? ''}
              email={email ?? ''}
              role={role as UserRole}
            />
            <Separator orientation="vertical" className="h-6" />
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* ── Workspace ───────────────────────────────────────────────── */}
      <ReviewWorkspaceClient
        task={task}
        regions={regionsWithCrop}
        labelMap={labelMap}
        reviewMap={reviewMap}
        proxiedImageUrl={proxiedImageUrl}
      />
    </div>
  )
}
