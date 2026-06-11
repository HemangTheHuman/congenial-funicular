import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  listAvailableTasksForLabeling,
  getActiveTaskForLabeler,
} from '@/lib/tasks'
import { readSheetAsObjects } from '@/lib/googleSheets'
import { nowISO } from '@/utils/date'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { UserBadge } from '@/components/auth/UserBadge'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { ClaimButton, ReleaseButton } from '@/app/labeler/TaskActions'
import { toProxiedImageUrl } from '@/utils/imageUrl'
import {
  ClipboardList,
  CheckCircle2,
  Clock,
  LayoutGrid,
  ArrowRight,
  ImageIcon,
} from 'lucide-react'
import type { UserRole } from '@/types/user'
import type { Task } from '@/types/task'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function progressPercent(task: Task): number {
  if (!task.region_count) return 0
  return Math.round((task.labeled_region_count / task.region_count) * 100)
}

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
      <div className={`text-2xl font-bold truncate overflow-hidden ${accent ? 'text-primary' : ''}`}>{value}</div>
      {sublabel && <div className="text-xs text-muted-foreground">{sublabel}</div>}
    </div>
  )
}

function TaskThumbnail({ imageUrl, taskId, priority = false }: { imageUrl: string; taskId: string; priority?: boolean }) {
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

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-all duration-300"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function LabelerDashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const user = session.user
  const email = user.email ?? ''

  // Parallel data fetching
  const [available, myTask, labelRows] = await Promise.all([
    listAvailableTasksForLabeling(),
    getActiveTaskForLabeler(email),
    readSheetAsObjects('labels'),
  ])

  // Filter so the user's own task isn't also listed as "available"
  const availableForOthers = available.filter((t) => t.locked_by !== email)

  // Stats
  const todayPrefix = nowISO().slice(0, 10)
  let labeledToday = 0
  let labeledAllTime = 0
  for (const row of labelRows) {
    if (row.labeler_email !== email) continue
    if (row.is_latest !== 'TRUE' && row.is_latest !== 'true') continue
    labeledAllTime++
    if (row.created_at?.startsWith(todayPrefix)) labeledToday++
  }

  const myProgress = myTask ? progressPercent(myTask) : 0

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b bg-card px-6 py-4">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Labeler Dashboard</h1>
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
        {/* ── Stats Banner ───────────────────────────────────────────────────── */}
        <section aria-label="Your labeling statistics">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              icon={<LayoutGrid className="h-3.5 w-3.5" />}
              label="Available Tasks"
              value={availableForOthers.length}
              sublabel="ready to claim"
            />
            <StatCard
              icon={<Clock className="h-3.5 w-3.5" />}
              label="My Current Task"
              value={myTask ? 'Active' : '—'}
              sublabel={
                myTask
                  ? `${myTask.task_id.slice(0, 14)}… · ${myTask.labeled_region_count}/${myTask.region_count} regions`
                  : 'none claimed'
              }
              accent={!!myTask}
            />
            <StatCard
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              label="Labeled Today"
              value={labeledToday}
              sublabel="regions"
            />
            <StatCard
              icon={<ClipboardList className="h-3.5 w-3.5" />}
              label="All Time"
              value={labeledAllTime}
              sublabel="regions labeled"
            />
          </div>
        </section>

        {/* ── In Progress ────────────────────────────────────────────────────── */}
        {myTask && (
          <section aria-label="Task in progress">
            <h2 className="text-base font-semibold mb-3">In Progress</h2>
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  {/* Thumbnail */}
                  <div className="sm:w-48 shrink-0">
                    <TaskThumbnail imageUrl={myTask.image_url} taskId={myTask.task_id} priority />
                  </div>

                  {/* Info */}
                  <div className="flex flex-1 flex-col justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-semibold">{myTask.task_id}</span>
                        {myTask.batch_id && (
                          <Badge variant="secondary" className="text-xs">{myTask.batch_id}</Badge>
                        )}
                        <Badge className="text-xs bg-primary/20 text-primary border-primary/30">
                          In Progress
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {myTask.region_count} regions · {myTask.labeled_region_count} labeled
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Progress</span>
                        <span>{myProgress}%</span>
                      </div>
                      <ProgressBar percent={myProgress} />
                    </div>

                    <div className="flex items-center gap-2">
                      <Link
                        href={`/labeler/task/${myTask.task_id}`}
                        className={buttonVariants({ size: 'sm' }) + ' gap-2'}
                        id={`continue-task-${myTask.task_id}`}
                      >
                        Continue Task <ArrowRight className="h-4 w-4" />
                      </Link>
                      <ReleaseButton taskId={myTask.task_id} />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── Available Tasks ─────────────────────────────────────────────────── */}
        <section aria-label="Available tasks">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Available Tasks</h2>
            <span className="text-sm text-muted-foreground">{availableForOthers.length} tasks</span>
          </div>

          {availableForOthers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm font-medium">No tasks available right now</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Check back soon — tasks become available as they are imported or locks expire.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {availableForOthers.map((task) => (
                <Card key={task.task_id} className="flex flex-col overflow-hidden hover:shadow-md transition-shadow">
                  {/* Thumbnail */}
                  <div className="px-4 pt-4">
                    <TaskThumbnail imageUrl={task.image_url} taskId={task.task_id} />
                  </div>

                  <CardHeader className="pb-2 pt-3">
                    <div className="flex items-center gap-2">
                      <CardTitle className="font-mono text-sm">{task.task_id}</CardTitle>
                      {task.batch_id && (
                        <Badge variant="outline" className="text-xs">{task.batch_id}</Badge>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-3 pt-0 mt-auto">
                    <p className="text-sm text-muted-foreground">
                      {task.region_count} region{task.region_count !== 1 ? 's' : ''} to label
                    </p>
                    <ClaimButton taskId={task.task_id} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
