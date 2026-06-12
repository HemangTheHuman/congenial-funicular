import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { SyncDashboardClient } from './SyncDashboardClient'
import type { UserRole } from '@/types/user'
import type { SyncQueueEntry } from '@/types/sync-queue'

export const dynamic = 'force-dynamic'

export default async function AdminSyncPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/')

  // Fetch all sync queue entries to display in the dashboard
  const res = await db.execute('SELECT * FROM sync_queue ORDER BY updated_at DESC LIMIT 100')
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries: SyncQueueEntry[] = res.rows.map((row: any) => ({
    sync_id:       String(row.sync_id ?? ''),
    task_id:       String(row.task_id ?? ''),
    ls_task_id:    String(row.ls_task_id ?? ''),
    status:        String(row.status ?? 'PENDING') as any,
    attempt_count: Number(row.attempt_count) || 0,
    last_error:    String(row.last_error ?? ''),
    created_at:    String(row.created_at ?? ''),
    updated_at:    String(row.updated_at ?? ''),
    synced_at:     String(row.synced_at ?? ''),
  }))

  const pending = entries.filter(e => e.status === 'PENDING')
  const failed = entries.filter(e => e.status === 'FAILED')
  const synced = entries.filter(e => e.status === 'SYNCED').slice(0, 50)

  return (
    <SyncDashboardClient 
      pending={pending} 
      failed={failed} 
      synced={synced} 
      user={session.user as { name?: string; email?: string; role?: UserRole }} 
    />
  )
}
