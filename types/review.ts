export type ReviewStatus =
  | 'APPROVED'
  | 'TEXT_WRONG'
  | 'SCRIPT_WRONG'
  | 'BOTH_WRONG'
  | 'UNREADABLE_WRONG'

export interface Review {
  review_id: string
  region_id: string
  task_id: string
  reviewer_email: string
  review_status: ReviewStatus
  final_script_tag: string
  review_note: string
  review_round: number
  created_at: string
  updated_at: string
}
