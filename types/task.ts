export type TaskStatus =
  | 'IMPORTED'
  | 'READY_FOR_LABELING'
  | 'LABELING_IN_PROGRESS'
  | 'LABELED'
  | 'READY_FOR_REVIEW'
  | 'REVIEWING_IN_PROGRESS'
  | 'NEEDS_CORRECTION'
  | 'CORRECTION_IN_PROGRESS'
  | 'CORRECTED'
  | 'READY_FOR_RE_REVIEW'
  | 'FINAL_APPROVED'
  | 'SYNC_PENDING'
  | 'SYNC_FAILED'
  | 'SYNCED_TO_LABEL_STUDIO'

export type SyncStatus = 'NOT_READY' | 'PENDING' | 'FAILED' | 'SYNCED'

export interface Task {
  task_id: string
  ls_task_id: string
  project_id: string
  batch_id: string
  image_url: string
  image_preview_url: string
  original_width: number
  original_height: number
  status: TaskStatus
  assigned_labeler: string
  assigned_reviewer: string
  locked_by: string
  lock_expires_at: string
  region_count: number
  labeled_region_count: number
  approved_region_count: number
  rejected_region_count: number
  sync_status: SyncStatus
  sync_attempt_count: number
  last_sync_error: string
  created_at: string
  updated_at: string
  completed_at: string
}
