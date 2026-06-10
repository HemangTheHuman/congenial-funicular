export type RegionStatus =
  | 'PENDING_LABEL'
  | 'LABELED'
  | 'UNREADABLE'
  | 'REVIEW_PENDING'
  | 'APPROVED'
  | 'TEXT_WRONG'
  | 'SCRIPT_WRONG'
  | 'BOTH_WRONG'
  | 'NEEDS_CORRECTION'
  | 'CORRECTED'
  | 'FINAL_APPROVED'

export interface Region {
  region_id: string
  task_id: string
  ls_task_id: string
  ls_region_id: string
  order_index: number
  /** Percentage values from Label Studio */
  bbox_x_percent: number
  bbox_y_percent: number
  bbox_width_percent: number
  bbox_height_percent: number
  /** Pixel values computed at import time */
  bbox_xmin: number
  bbox_ymin: number
  bbox_xmax: number
  bbox_ymax: number
  rotation: number
  /** Script tag as it came from Label Studio — never changes */
  script_tag_original: string
  /** Reviewer-approved script tag — starts as script_tag_original */
  script_tag_final: string
  status: RegionStatus
  /** Soft delete flag */
  is_active: boolean
  created_at: string
  updated_at: string
}
