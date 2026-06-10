import { auth } from '@/auth'
import { listTasksByStatus } from '@/lib/tasks'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { buttonVariants } from '@/components/ui/button'
import { UserBadge } from '@/components/auth/UserBadge'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { SingleImportPanel, BatchImportPanel } from './ImportActions'
import Link from 'next/link'
import type { UserRole } from '@/types/user'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Import Tasks — Kaithi Labeling App',
  description: 'Import Label Studio tasks into the labeling workflow',
}

export default async function ImportPage() {
  const session = await auth()
  const user = session!.user

  // Fetch imported tasks for the status table at the bottom
  const importedTasks = await listTasksByStatus('IMPORTED', 'READY_FOR_LABELING')
    .catch(() => [])

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card px-6 py-4">
        <div className="mx-auto max-w-5xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              ← Admin
            </Link>
            <Separator orientation="vertical" className="h-5" />
            <div>
              <h1 className="text-xl font-bold">Import Tasks</h1>
              <p className="text-sm text-muted-foreground">Fetch tasks from Label Studio into the labeling queue</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <UserBadge name={user.name ?? ''} email={user.email ?? ''} role={user.role as UserRole} />
            <Separator orientation="vertical" className="h-8" />
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">

        {/* Import tabs */}
        <Card>
          <CardHeader>
            <CardTitle>Import from Label Studio</CardTitle>
            <CardDescription>
              Use the Single tab to import one task by ID, or Batch to select multiple tasks from a project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="single">
              <TabsList id="import-mode-tabs" className="mb-6">
                <TabsTrigger value="single" id="tab-single">Single Task</TabsTrigger>
                <TabsTrigger value="batch"  id="tab-batch">Batch Import</TabsTrigger>
              </TabsList>

              <TabsContent value="single">
                <SingleImportPanel />
              </TabsContent>

              <TabsContent value="batch">
                <BatchImportPanel />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Imported tasks table */}
        <Card>
          <CardHeader>
            <CardTitle>Imported Tasks</CardTitle>
            <CardDescription>
              Tasks with status IMPORTED or READY_FOR_LABELING — {importedTasks.length} total
            </CardDescription>
          </CardHeader>
          <CardContent>
            {importedTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks imported yet.</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task ID</TableHead>
                      <TableHead>LS Task ID</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead className="text-right">Regions</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Imported</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importedTasks.map((task) => (
                      <TableRow key={task.task_id}>
                        <TableCell className="font-mono text-xs">{task.task_id}</TableCell>
                        <TableCell className="font-mono text-sm">{task.ls_task_id}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{task.batch_id || '—'}</TableCell>
                        <TableCell className="text-right text-sm">{task.region_count}</TableCell>
                        <TableCell>
                          <Badge
                            variant={task.status === 'READY_FOR_LABELING' ? 'default' : 'secondary'}
                          >
                            {task.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(task.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
