/**
 * Canonical column order for every Google Sheet tab.
 *
 * IMPORTANT: These arrays are the single source of truth.
 * - Serialiser functions (xToRow) must output values in this exact order.
 * - If a column is added/removed in the Sheet, update ONLY here.
 * - Never hard-code column positions anywhere else.
 */

export const USER_COLUMNS = [
  'user_id',
  'email',
  'name',
  'password_hash',
  'role',
  'status',
  'assigned_batch',
  'created_at',
  'updated_at',
  'last_login_at',
  'notes',
] as const

export const TASK_COLUMNS = [
  'task_id',
  'ls_task_id',
  'project_id',
  'batch_id',
  'image_url',
  'image_preview_url',
  'original_width',
  'original_height',
  'status',
  'assigned_labeler',
  'assigned_reviewer',
  'locked_by',
  'lock_expires_at',
  'region_count',
  'labeled_region_count',
  'approved_region_count',
  'rejected_region_count',
  'sync_status',
  'sync_attempt_count',
  'last_sync_error',
  'created_at',
  'updated_at',
  'completed_at',
] as const

export const REGION_COLUMNS = [
  'region_id',
  'task_id',
  'ls_task_id',
  'ls_region_id',
  'order_index',
  'bbox_x_percent',
  'bbox_y_percent',
  'bbox_width_percent',
  'bbox_height_percent',
  'bbox_xmin',
  'bbox_ymin',
  'bbox_xmax',
  'bbox_ymax',
  'rotation',
  'script_tag_original',
  'script_tag_final',
  'status',
  'is_active',
  'created_at',
  'updated_at',
] as const

export const LABEL_COLUMNS = [
  'label_id',
  'region_id',
  'task_id',
  'labeler_email',
  'text',
  'is_unreadable',
  'version',
  'is_latest',
  'created_at',
  'updated_at',
  'local_client_id',
  'sync_state',
] as const

export const REVIEW_COLUMNS = [
  'review_id',
  'region_id',
  'task_id',
  'reviewer_email',
  'review_status',
  'final_script_tag',
  'review_note',
  'review_round',
  'created_at',
  'updated_at',
] as const

export const SYNC_QUEUE_COLUMNS = [
  'sync_id',
  'task_id',
  'ls_task_id',
  'status',
  'attempt_count',
  'last_error',
  'created_at',
  'updated_at',
  'synced_at',
] as const

export const APP_CONFIG_COLUMNS = [
  'key',
  'value',
  'description',
  'updated_at',
] as const
