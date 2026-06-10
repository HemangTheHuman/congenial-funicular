import {
  readSheetAsObjects,
  findRowByColumn,
  appendRow,
} from '@/lib/googleSheets'
import { generateId } from '@/utils/ids'
import { nowISO } from '@/utils/date'
import type { Review, ReviewStatus } from '@/types/review'

// ---------------------------------------------------------------------------
// Serialiser / Deserialiser
// ---------------------------------------------------------------------------

function rowToReview(row: Record<string, string>): Review {
  return {
    review_id:      row.review_id,
    region_id:      row.region_id,
    task_id:        row.task_id,
    reviewer_email: row.reviewer_email,
    review_status:  row.review_status as ReviewStatus,
    final_script_tag: row.final_script_tag,
    review_note:    row.review_note,
    review_round:   parseInt(row.review_round, 10) || 1,
    created_at:     row.created_at,
    updated_at:     row.updated_at,
  }
}

function reviewToRow(r: Review): (string | number | boolean)[] {
  return [
    r.review_id,
    r.region_id,
    r.task_id,
    r.reviewer_email,
    r.review_status,
    r.final_script_tag,
    r.review_note,
    String(r.review_round),
    r.created_at,
    r.updated_at,
  ]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readAllReviews(): Promise<Review[]> {
  const rows = await readSheetAsObjects('reviews')
  return rows.map(rowToReview)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get a review by its review_id. */
export async function getReviewById(reviewId: string): Promise<Review | null> {
  const result = await findRowByColumn('reviews', 'review_id', reviewId)
  return result ? rowToReview(result.row) : null
}

/** Returns all reviews for a region (all rounds), sorted oldest first. */
export async function listReviewsByRegion(regionId: string): Promise<Review[]> {
  const all = await readAllReviews()
  return all
    .filter((r) => r.region_id === regionId)
    .sort((a, b) => a.review_round - b.review_round)
}

/** Returns the most recent review for a region. */
export async function getLatestReviewForRegion(regionId: string): Promise<Review | null> {
  const reviews = await listReviewsByRegion(regionId)
  return reviews.length > 0 ? reviews[reviews.length - 1] : null
}

/** Returns all reviews for a task (all regions, all rounds). */
export async function listReviewsByTask(taskId: string): Promise<Review[]> {
  const all = await readAllReviews()
  return all.filter((r) => r.task_id === taskId)
}

/**
 * Creates a new review row.
 * `review_id`, `created_at`, `updated_at` are generated automatically.
 */
export async function createReview(
  data: Omit<Review, 'review_id' | 'created_at' | 'updated_at'>
): Promise<Review> {
  const now = nowISO()
  const review: Review = {
    ...data,
    review_id: generateId('RV'),
    created_at: now,
    updated_at: now,
  }
  await appendRow('reviews', reviewToRow(review))
  return review
}
