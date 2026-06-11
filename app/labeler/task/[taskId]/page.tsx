import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTaskById } from '@/lib/tasks'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { UserBadge } from '@/components/auth/UserBadge'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { Separator } from '@/components/ui/separator'
import { ArrowLeft, Construction } from 'lucide-react'
import type { UserRole } from '@/types/user'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ taskId: string }>
}

export default async function LabelerTaskPage({ params }: Props) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const user = session.user
  const email = user.email ?? ''

  const { taskId } = await params
  const task = await getTaskById(taskId)

  // Task must exist and be locked by this user — otherwise redirect to dashboard
  if (!task || task.locked_by !== email) {
    redirect('/labeler')
  }

  const progressPercent = task.region_count
    ? Math.round((task.labeled_region_count / task.region_count) * 100)
    : 0

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card px-6 py-4">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/labeler"
              className={buttonVariants({ variant: 'ghost', size: 'sm' }) + ' gap-2'}
            >
              <ArrowLeft className="h-4 w-4" />
              Dashboard
            </Link>
            <Separator orientation="vertical" className="h-6" />
            <span className="font-mono text-sm font-semibold">{task.task_id}</span>
            {task.batch_id && (
              <Badge variant="secondary" className="text-xs">{task.batch_id}</Badge>
            )}
          </div>
          <div className="flex items-center gap-4">
            <UserBadge name={user.name ?? ''} email={email} role={user.role as UserRole} />
            <Separator orientation="vertical" className="h-8" />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <Card className="max-w-lg mx-auto border-dashed">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Construction className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Labeling Workspace</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The full labeling workspace is coming in <strong>Phase 5</strong>. Your lock on this task is active.
            </p>

            {/* Task summary */}
            <div className="rounded-lg border bg-muted/40 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Task ID</span>
                <span className="font-mono font-medium">{task.task_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Regions</span>
                <span>{task.region_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Labeled</span>
                <span>{task.labeled_region_count} / {task.region_count} ({progressPercent}%)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lock expires</span>
                <span className="font-mono text-xs">{task.lock_expires_at}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant="outline" className="text-xs">{task.status}</Badge>
              </div>
            </div>

            <Link
              href="/labeler"
              className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' gap-2 w-full justify-center'}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Link>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
