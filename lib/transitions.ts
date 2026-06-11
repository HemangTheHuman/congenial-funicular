import type { TaskStatus } from '@/types/task'
import type { RegionStatus } from '@/types/region'

// ---------------------------------------------------------------------------
// Task status transitions
// ---------------------------------------------------------------------------

/**
 * Allowed next statuses for each task status.
 * Empty array = terminal state (no further transitions allowed).
 */
const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  IMPORTED:                ['READY_FOR_LABELING'],
  READY_FOR_LABELING:      ['LABELING_IN_PROGRESS'],
  // Release lock sends task back to READY_FOR_LABELING.
  // Submit sends directly to READY_FOR_REVIEW (skipping the transient LABELED state).
  LABELING_IN_PROGRESS:    ['LABELED', 'READY_FOR_LABELING', 'READY_FOR_REVIEW'],
  LABELED:                 ['READY_FOR_REVIEW'],
  READY_FOR_REVIEW:        ['REVIEWING_IN_PROGRESS'],
  // Reviewer can release (back to READY_FOR_REVIEW), approve all (FINAL_APPROVED),
  // or find corrections needed (NEEDS_CORRECTION)
  REVIEWING_IN_PROGRESS:   ['NEEDS_CORRECTION', 'FINAL_APPROVED', 'READY_FOR_REVIEW'],
  NEEDS_CORRECTION:        ['CORRECTION_IN_PROGRESS'],
  // Release lock sends task back to NEEDS_CORRECTION
  CORRECTION_IN_PROGRESS:  ['CORRECTED', 'NEEDS_CORRECTION'],
  CORRECTED:               ['READY_FOR_RE_REVIEW'],
  READY_FOR_RE_REVIEW:     ['REVIEWING_IN_PROGRESS'],
  FINAL_APPROVED:          ['SYNC_PENDING'],
  SYNC_PENDING:            ['SYNC_FAILED', 'SYNCED_TO_LABEL_STUDIO'],
  SYNC_FAILED:             ['SYNC_PENDING'], // retry
  SYNCED_TO_LABEL_STUDIO:  [],              // terminal
}

// ---------------------------------------------------------------------------
// Region status transitions
// ---------------------------------------------------------------------------

/**
 * Allowed next statuses for each region status.
 */
const REGION_TRANSITIONS: Record<RegionStatus, RegionStatus[]> = {
  PENDING_LABEL:    ['LABELED', 'UNREADABLE'],
  // Allow reset to PENDING_LABEL if a task is released mid-progress
  LABELED:          ['REVIEW_PENDING', 'PENDING_LABEL'],
  UNREADABLE:       ['REVIEW_PENDING', 'PENDING_LABEL'],
  REVIEW_PENDING:   ['APPROVED', 'TEXT_WRONG', 'SCRIPT_WRONG', 'BOTH_WRONG', 'NEEDS_CORRECTION'],
  // Script wrong but text ok — reviewer fixes script, region becomes APPROVED
  SCRIPT_WRONG:     ['APPROVED'],
  // Text wrong — labeler must correct
  TEXT_WRONG:       ['NEEDS_CORRECTION'],
  BOTH_WRONG:       ['NEEDS_CORRECTION'],
  APPROVED:         ['FINAL_APPROVED'],
  NEEDS_CORRECTION: ['CORRECTED'],
  // After re-review: approved again, or rejected again
  CORRECTED:        ['APPROVED', 'NEEDS_CORRECTION'],
  FINAL_APPROVED:   [], // terminal
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Throws a descriptive error if the task transition is not allowed.
 * Use this before calling `updateTaskStatus` to guard against illegal moves.
 */
export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  const allowed = TASK_TRANSITIONS[from] ?? []
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid task status transition: ${from} → ${to}. ` +
      `Allowed: [${allowed.join(', ') || 'none — terminal state'}]`
    )
  }
}

/**
 * Throws a descriptive error if the region transition is not allowed.
 */
export function assertRegionTransition(from: RegionStatus, to: RegionStatus): void {
  const allowed = REGION_TRANSITIONS[from] ?? []
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid region status transition: ${from} → ${to}. ` +
      `Allowed: [${allowed.join(', ') || 'none — terminal state'}]`
    )
  }
}

/**
 * Returns true if the transition is valid (non-throwing version).
 */
export function isValidTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (TASK_TRANSITIONS[from] ?? []).includes(to)
}

export function isValidRegionTransition(from: RegionStatus, to: RegionStatus): boolean {
  return (REGION_TRANSITIONS[from] ?? []).includes(to)
}
