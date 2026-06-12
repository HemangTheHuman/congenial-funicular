/**
 * lib/reviews.ts — SQL rewrite (Turso)
 */
import { db } from '@/lib/db'
import { generateId } from '@/utils/ids'
import { nowISO } from '@/utils/date'
import type { Review, ReviewStatus } from '@/types/review'

// ---------------------------------------------------------------------------
// Deserialiser
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToReview(row: Record<string, any>): Review {
  return {
    review_id:        String(row.review_id ?? ''),
    region_id:        String(row.region_id ?? ''),
    task_id:          String(row.task_id ?? ''),
    reviewer_email:   String(row.reviewer_email ?? ''),
    review_status:    String(row.review_status ?? '') as ReviewStatus,
    final_script_tag: String(row.final_script_tag ?? ''),
    review_note:      String(row.review_note ?? ''),
    review_round:     Number(row.review_round) || 1,
    created_at:       String(row.created_at ?? ''),
    updated_at:       String(row.updated_at ?? ''),
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get a review by its review_id. */
export async function getReviewById(reviewId: string): Promise<Review | null> {
  const res = await db.execute({
    sql:  'SELECT * FROM reviews WHERE review_id = ? LIMIT 1',
    args: [reviewId],
  })
  return res.rows.length > 0 ? rowToReview(res.rows[0]) : null
}

/** Returns all reviews for a region (all rounds), sorted oldest first. */
export async function listReviewsByRegion(regionId: string): Promise<Review[]> {
  const res = await db.execute({
    sql:  'SELECT * FROM reviews WHERE region_id = ? ORDER BY review_round ASC',
    args: [regionId],
  })
  return res.rows.map(rowToReview)
}

/** Returns the most recent review for a region. */
export async function getLatestReviewForRegion(regionId: string): Promise<Review | null> {
  const res = await db.execute({
    sql:  'SELECT * FROM reviews WHERE region_id = ? ORDER BY review_round DESC LIMIT 1',
    args: [regionId],
  })
  return res.rows.length > 0 ? rowToReview(res.rows[0]) : null
}

/** Returns all reviews for a task (all regions, all rounds). */
export async function listReviewsByTask(taskId: string): Promise<Review[]> {
  const res = await db.execute({
    sql:  'SELECT * FROM reviews WHERE task_id = ? ORDER BY region_id, review_round ASC',
    args: [taskId],
  })
  return res.rows.map(rowToReview)
}

/** Returns the most recent review for each region in a task. */
export async function listLatestReviewsByTask(taskId: string): Promise<Review[]> {
  const res = await db.execute({
    sql: `SELECT * FROM reviews 
          WHERE task_id = ? 
          AND review_id IN (
            SELECT review_id FROM (
              SELECT review_id, ROW_NUMBER() OVER(PARTITION BY region_id ORDER BY review_round DESC) as rn 
              FROM reviews 
              WHERE task_id = ?
            ) WHERE rn = 1
          )`,
    args: [taskId, taskId],
  })
  return res.rows.map(rowToReview)
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
    review_id:  generateId('RV'),
    created_at: now,
    updated_at: now,
  }
  await db.execute({
    sql: `INSERT INTO reviews
            (review_id, region_id, task_id, reviewer_email, review_status,
             final_script_tag, review_note, review_round, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      review.review_id, review.region_id, review.task_id, review.reviewer_email,
      review.review_status, review.final_script_tag, review.review_note,
      review.review_round, review.created_at, review.updated_at,
    ],
  })
  return review
}
