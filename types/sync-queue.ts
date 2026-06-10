export type SyncQueueStatus = 'PENDING' | 'IN_PROGRESS' | 'FAILED' | 'SYNCED'

export interface SyncQueueEntry {
  sync_id: string
  task_id: string
  ls_task_id: string
  status: SyncQueueStatus
  attempt_count: number
  last_error: string
  created_at: string
  updated_at: string
  synced_at: string
}
