'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { UserBadge } from '@/components/auth/UserBadge'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { RefreshCw, Play, AlertCircle, CheckCircle2, Loader2, ArrowLeft } from 'lucide-react'
import type { SyncQueueEntry } from '@/types/sync-queue'
import type { UserRole } from '@/types/user'

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { TriangleAlert } from 'lucide-react'
import type { SyncStats } from '@/lib/sync'

interface Props {
  pending: SyncQueueEntry[]
  failed: SyncQueueEntry[]
  synced: SyncQueueEntry[]
  user: { name?: string; email?: string; role?: UserRole }
}

export function SyncDashboardClient({ pending, failed, synced, user }: Props) {
  const router = useRouter()
  const [processing, setProcessing] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  
  // Dry run state
  const [showModal, setShowModal] = useState(false)
  const [dryRunStats, setDryRunStats] = useState<(SyncStats & { tasksToPush: number }) | null>(null)

  async function handleProcessQueueClick() {
    setProcessing(true)
    setShowModal(true)
    setDryRunStats(null)

    try {
      const res = await fetch('/api/admin/sync/dry-run', { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        alert(`Dry Run Failed: ${data.error}`)
        setShowModal(false)
      } else {
        setDryRunStats(data)
      }
    } catch (err) {
      alert(`Error fetching dry run stats: ${err}`)
      setShowModal(false)
    } finally {
      setProcessing(false)
    }
  }

  async function handleConfirmSync() {
    setProcessing(true)
    try {
      const res = await fetch('/api/admin/sync/process', { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        alert(`Failed: ${data.error}`)
      } else {
        alert(`Processed ${data.processed} tasks. Success: ${data.successCount}, Failed: ${data.failCount}`)
      }
      setShowModal(false)
      router.refresh()
    } catch (err) {
      alert(`Error processing queue: ${err}`)
    } finally {
      setProcessing(false)
    }
  }

  async function handleRetry(taskId: string) {
    setRetryingId(taskId)
    try {
      const res = await fetch('/api/admin/sync/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, retryFailed: true })
      })
      const data = await res.json()
      if (data.error) alert(`Failed: ${data.error}`)
      router.refresh()
    } catch (err) {
      alert(`Error retrying task: ${err}`)
    } finally {
      setRetryingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card px-6 py-4 shrink-0">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">Label Studio Sync Dashboard</h1>
              <p className="text-sm text-muted-foreground">Manage writebacks to Label Studio</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <UserBadge name={user.name ?? ''} email={user.email ?? ''} role={user.role as UserRole} />
            <Separator orientation="vertical" className="h-6" />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-6xl w-full px-6 py-8 space-y-6">
        
        {/* PENDING */}
        <Card className="border-primary/20">
          <CardHeader className="bg-primary/5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <RefreshCw className="h-5 w-5" /> Pending Syncs
                  <Badge variant="secondary" className="ml-2 bg-primary/20 hover:bg-primary/20 text-primary">
                    {pending.length}
                  </Badge>
                </CardTitle>
                <CardDescription className="mt-1.5">
                  Tasks that are FINAL_APPROVED but have not yet been written back to Label Studio.
                </CardDescription>
              </div>
              <Button 
                onClick={handleProcessQueueClick} 
                disabled={pending.length === 0 || processing}
                className="gap-2 shadow-sm"
              >
                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Process Queue
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {pending.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No pending tasks.
              </div>
            ) : (
              <div className="divide-y max-h-64 overflow-y-auto">
                {pending.map(p => (
                  <div key={p.sync_id} className="p-4 flex items-center justify-between hover:bg-muted/30">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-sm font-medium">{p.task_id}</span>
                      <span className="text-xs text-muted-foreground">LS Task ID: {p.ls_task_id}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Added: {new Date(p.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* FAILED */}
        {failed.length > 0 && (
          <Card className="border-destructive/30">
            <CardHeader className="bg-destructive/5 pb-4">
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" /> Failed Syncs
                <Badge variant="destructive" className="ml-2">
                  {failed.length}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1.5 text-destructive/80">
                Tasks that failed to sync. Review the errors and retry.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y max-h-64 overflow-y-auto">
                {failed.map(f => (
                  <div key={f.sync_id} className="p-4 flex flex-col gap-3 hover:bg-destructive/5">
                    <div className="flex items-start justify-between">
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-sm font-medium">{f.task_id}</span>
                        <span className="text-xs text-muted-foreground">LS Task ID: {f.ls_task_id}</span>
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => handleRetry(f.task_id)}
                        disabled={retryingId === f.task_id}
                        className="gap-2 border-destructive/20 hover:bg-destructive/10"
                      >
                        {retryingId === f.task_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Retry
                      </Button>
                    </div>
                    <div className="bg-destructive/10 text-destructive text-xs p-2 rounded whitespace-pre-wrap font-mono">
                      {f.last_error || 'Unknown error'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Attempts: {f.attempt_count} • Last tried: {new Date(f.updated_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* RECENTLY SYNCED */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" /> Recently Synced
              <Badge variant="outline" className="ml-2 bg-green-500/10 text-green-600 border-green-500/20">
                {synced.length}
              </Badge>
            </CardTitle>
            <CardDescription className="mt-1.5">
              Tasks successfully written back to Label Studio.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {synced.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No synced tasks yet.
              </div>
            ) : (
              <div className="divide-y max-h-64 overflow-y-auto">
                {synced.map(s => (
                  <div key={s.sync_id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-muted/30">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-sm font-medium">{s.task_id}</span>
                      <span className="text-xs text-muted-foreground">LS Task ID: {s.ls_task_id}</span>
                    </div>
                    <div className="flex flex-col gap-1 sm:text-right text-xs text-muted-foreground">
                      <span>Synced: {s.synced_at ? new Date(s.synced_at).toLocaleString() : 'Unknown'}</span>
                      {s.attempt_count > 1 && <span>Took {s.attempt_count} attempts</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </main>

      {/* DRY RUN CONFIRMATION MODAL */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Sync to Label Studio</DialogTitle>
            <DialogDescription>
              Review the changes that will be pushed to Label Studio.
            </DialogDescription>
          </DialogHeader>

          {dryRunStats === null ? (
            <div className="flex flex-col items-center justify-center p-8 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Calculating dry-run statistics...</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="border rounded-md p-4 text-center">
                  <div className="text-3xl font-bold">{dryRunStats.tasksToPush}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">Tasks Syncing</div>
                </div>
                <div className="border rounded-md p-4 text-center">
                  <div className="text-3xl font-bold text-destructive">{dryRunStats.regionsRemoved}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">Regions Dropped</div>
                </div>
                <div className="border rounded-md p-4 text-center">
                  <div className="text-3xl font-bold text-amber-500">{dryRunStats.scriptsChanged}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">Scripts Changed</div>
                </div>
                <div className="border rounded-md p-4 text-center">
                  <div className="text-3xl font-bold text-green-500">{dryRunStats.transcriptionsAdded}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">Transcriptions</div>
                </div>
              </div>

              <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive mt-4">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Warning: Permanent Data Change</AlertTitle>
                <AlertDescription>
                  This action will immediately modify annotations in Label Studio, and the task status will be updated to APPROVED. This process cannot be automatically reversed.
                </AlertDescription>
              </Alert>

              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => setShowModal(false)} disabled={processing}>Cancel</Button>
                <Button variant="destructive" onClick={handleConfirmSync} disabled={processing}>
                  {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Confirm & Sync Data
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
