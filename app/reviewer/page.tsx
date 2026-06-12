import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { listTasksForReview, getActiveTaskForLabeler } from '@/lib/tasks'
import { db } from '@/lib/db'
import { nowISO } from '@/utils/date'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { UserBadge } from '@/components/auth/UserBadge'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { ReviewClaimButton, ReviewReleaseButton } from '@/app/reviewer/ReviewerTaskActions'
import { toProxiedImageUrl } from '@/utils/imageUrl'
import {
  CheckSquare,
  Clock,
  ClipboardList,
  BarChart2,
  ArrowRight,
  ImageIcon,
  RotateCcw,
} from 'lucide-react'
import type { UserRole } from '@/types/user'
import type { Task } from '@/types/task'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Sub-components (server)
// ---------------------------------------------------------------------------

function StatCard({
  icon,
  label,
  value,
  sublabel,
  accent = false,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  sublabel?: string
  accent?: boolean
}) {
  return (
    <div
      className={`rounded-xl border p-4 flex flex-col gap-1 ${
        accent ? 'border-primary/30 bg-primary/5' : 'border-border bg-card'
      }`}
    >
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold truncate overflow-hidden ${accent ? 'text-primary' : ''}`}>
        {value}
      </div>
      {sublabel && <div className="text-xs text-muted-foreground">{sublabel}</div>}
    </div>
  )
}

function TaskThumbnail({
  imageUrl,
  taskId,
  priority = false,
}: {
  imageUrl: string
  taskId: string
  priority?: boolean
}) {
  const proxiedUrl = toProxiedImageUrl(imageUrl)
  if (!proxiedUrl) {
    return (
      <div className="flex h-28 w-full items-center justify-center rounded-lg bg-muted">
        <ImageIcon className="h-8 w-8 text-muted-foreground" />
      </div>
    )
  }
  return (
    <div className="relative h-28 w-full overflow-hidden rounded-lg bg-muted">
      <Image
        src={proxiedUrl}
        alt={`Preview for task ${taskId}`}
        fill
        priority={priority}
        className="object-cover object-top"
        sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 320px"
        unoptimized
      />
    </div>
  )
}

function reviewProgress(task: Task): string {
  const approved = task.approved_region_count
  const rejected = task.rejected_region_count
  const total    = task.region_count
  return `${approved + rejected}/${total} reviewed · ${approved} approved · ${rejected} rejected`
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ReviewerDashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const user  = session.user
  const email = user.email ?? ''

  // Parallel fetch: review queue + active task + stats
  const todayPrefix = nowISO().slice(0, 10)
  const [allForReview, myTask, statsRes] = await Promise.all([
    listTasksForReview(),
    getActiveTaskForLabeler(email),
    db.execute({
      sql: `SELECT
              COUNT(DISTINCT task_id) as all_time,
              COUNT(DISTINCT CASE WHEN created_at >= ? THEN task_id ELSE NULL END) as today
            FROM reviews WHERE reviewer_email = ?`,
      args: [todayPrefix, email],
    }),
  ])

  const now = nowISO()

  // Partition into first-review and re-review queues, excluding tasks held by others
  const available = allForReview.filter((t) => {
    if (!t.locked_by || t.locked_by === email) return true
    if (!t.lock_expires_at || t.lock_expires_at < now) return true
    return false
  })
  const firstReview = available.filter((t) => t.status === 'READY_FOR_REVIEW')
  const reReview    = available.filter((t) => t.status === 'READY_FOR_RE_REVIEW')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statsRow      = statsRes.rows[0] as any
  const reviewedAllTime = Number(statsRow?.all_time) || 0
  const reviewedToday   = Number(statsRow?.today)    || 0

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="border-b bg-card px-6 py-4">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Reviewer Dashboard</h1>
            <p className="text-sm text-muted-foreground">Kaithi Labeling App</p>
          </div>
          <div className="flex items-center gap-4">
            <UserBadge name={user.name ?? ''} email={email} role={user.role as UserRole} />
            <Separator orientation="vertical" className="h-8" />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 space-y-8">
        {/* ── Stats Banner ────────────────────────────────────────────── */}
        <section aria-label="Your review statistics">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              icon={<ClipboardList className="h-3.5 w-3.5" />}
              label="Waiting for Review"
              value={firstReview.length}
              sublabel="first review"
            />
            <StatCard
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              label="Re-Review Queue"
              value={reReview.length}
              sublabel="after correction"
            />
            <StatCard
              icon={<Clock className="h-3.5 w-3.5" />}
              label="My Current Task"
              value={myTask ? 'Active' : '—'}
              sublabel={
                myTask
                  ? `${myTask.task_id.slice(0, 14)}… · ${myTask.region_count} regions`
                  : 'none claimed'
              }
              accent={!!myTask}
            />
            <StatCard
              icon={<BarChart2 className="h-3.5 w-3.5" />}
              label="Reviewed Today"
              value={reviewedToday}
              sublabel={`${reviewedAllTime} all time tasks`}
            />
          </div>
        </section>

        {/* ── In Progress ─────────────────────────────────────────────── */}
        {myTask && (
          <section aria-label="Review in progress">
            <h2 className="text-base font-semibold mb-3">In Progress</h2>
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="sm:w-48 shrink-0">
                    <TaskThumbnail imageUrl={myTask.image_url} taskId={myTask.task_id} priority />
                  </div>
                  <div className="flex flex-1 flex-col justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-semibold">{myTask.task_id}</span>
                        {myTask.batch_id && (
                          <Badge variant="secondary" className="text-xs">{myTask.batch_id}</Badge>
                        )}
                        <Badge className="text-xs bg-primary/20 text-primary border-primary/30">
                          Reviewing
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{reviewProgress(myTask)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/reviewer/task/${myTask.task_id}`}
                        className={buttonVariants({ size: 'sm' }) + ' gap-2'}
                        id={`continue-review-${myTask.task_id}`}
                      >
                        Continue Review <ArrowRight className="h-4 w-4" />
                      </Link>
                      <ReviewReleaseButton taskId={myTask.task_id} />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── First Review Queue ──────────────────────────────────────── */}
        <section aria-label="Tasks ready for review">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Review Queue</h2>
            <span className="text-sm text-muted-foreground">{firstReview.length} tasks</span>
          </div>

          {firstReview.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <CheckSquare className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm font-medium">No tasks waiting for review</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Tasks appear here after labelers submit them.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {firstReview.map((task) => (
                <TaskCard key={task.task_id} task={task} badge="1st Review" />
              ))}
            </div>
          )}
        </section>

        {/* ── Re-Review Queue ─────────────────────────────────────────── */}
        {reReview.length > 0 && (
          <section aria-label="Tasks ready for re-review">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold">Re-Review Queue</h2>
              <span className="text-sm text-muted-foreground">{reReview.length} tasks</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {reReview.map((task) => (
                <TaskCard key={task.task_id} task={task} badge="Re-Review" badgeVariant="secondary" />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TaskCard (server component)
// ---------------------------------------------------------------------------

function TaskCard({
  task,
  badge,
  badgeVariant = 'default',
}: {
  task: Task
  badge: string
  badgeVariant?: 'default' | 'secondary' | 'outline'
}) {
  return (
    <Card className="flex flex-col overflow-hidden hover:shadow-md transition-shadow">
      <div className="px-4 pt-4">
        <TaskThumbnail imageUrl={task.image_url} taskId={task.task_id} />
      </div>

      <CardHeader className="pb-2 pt-3">
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="font-mono text-sm">{task.task_id}</CardTitle>
          {task.batch_id && (
            <Badge variant="outline" className="text-xs">{task.batch_id}</Badge>
          )}
          <Badge variant={badgeVariant} className="text-xs">{badge}</Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 pt-0 mt-auto">
        <p className="text-sm text-muted-foreground">
          {task.region_count} region{task.region_count !== 1 ? 's' : ''}
          {task.labeled_region_count > 0 && ` · ${task.labeled_region_count} labeled`}
        </p>
        <ReviewClaimButton taskId={task.task_id} />
      </CardContent>
    </Card>
  )
}
