export type LabelSyncState = 'LOCAL_PENDING' | 'SAVED' | 'FAILED'

export interface Label {
  label_id: string
  region_id: string
  task_id: string
  labeler_email: string
  text: string
  is_unreadable: boolean
  version: number
  is_latest: boolean
  created_at: string
  updated_at: string
  /** Client-side uuid generated before the save API call */
  local_client_id: string
  sync_state: LabelSyncState
}
