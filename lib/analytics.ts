import { db } from '@/lib/db'

export interface AnalyticsDateRange {
  start?: string // ISO string
  end?: string   // ISO string
}

// ── 1. Task Funnel ─────────────────────────────────────────────────────────
export async function getTaskFunnel(range: AnalyticsDateRange) {
  let sql = `SELECT status, COUNT(*) as count FROM tasks`
  const args: any[] = []

  if (range.start || range.end) {
    sql += ` WHERE 1=1`
    if (range.start) {
      sql += ` AND updated_at >= ?`
      args.push(range.start)
    }
    if (range.end) {
      sql += ` AND updated_at <= ?`
      args.push(range.end)
    }
  }

  sql += ` GROUP BY status`

  const res = await db.execute({ sql, args })
  
  const funnel: Record<string, number> = {}
  let total = 0

  for (const row of res.rows) {
    const status = row.status as string
    const count = Number(row.count)
    funnel[status] = count
    total += count
  }

  return { funnel, total }
}

// ── 2. User Productivity ───────────────────────────────────────────────────
export async function getUserProductivity(range: AnalyticsDateRange) {
  // Labelers
  let labelerSql = `
    SELECT assigned_labeler as email, COUNT(*) as tasks_completed 
    FROM tasks 
    WHERE assigned_labeler IS NOT NULL AND status IN ('LABELED', 'READY_FOR_REVIEW', 'REVIEWING_IN_PROGRESS', 'NEEDS_CORRECTION', 'CORRECTION_IN_PROGRESS', 'READY_FOR_RE_REVIEW', 'FINAL_APPROVED', 'SYNC_PENDING', 'SYNC_FAILED', 'SYNCED_TO_LABEL_STUDIO')
  `
  const labelerArgs: any[] = []
  if (range.start) { labelerSql += ` AND updated_at >= ?`; labelerArgs.push(range.start) }
  if (range.end) { labelerSql += ` AND updated_at <= ?`; labelerArgs.push(range.end) }
  labelerSql += ` GROUP BY assigned_labeler`

  // Reviewers
  let reviewerSql = `
    SELECT assigned_reviewer as email, COUNT(*) as tasks_reviewed 
    FROM tasks 
    WHERE assigned_reviewer IS NOT NULL AND status IN ('NEEDS_CORRECTION', 'CORRECTION_IN_PROGRESS', 'READY_FOR_RE_REVIEW', 'FINAL_APPROVED', 'SYNC_PENDING', 'SYNC_FAILED', 'SYNCED_TO_LABEL_STUDIO')
  `
  const reviewerArgs: any[] = []
  if (range.start) { reviewerSql += ` AND updated_at >= ?`; reviewerArgs.push(range.start) }
  if (range.end) { reviewerSql += ` AND updated_at <= ?`; reviewerArgs.push(range.end) }
  reviewerSql += ` GROUP BY assigned_reviewer`

  const [labelerRes, reviewerRes] = await Promise.all([
    db.execute({ sql: labelerSql, args: labelerArgs }),
    db.execute({ sql: reviewerSql, args: reviewerArgs }),
  ])

  const statsByEmail: Record<string, { labelerTasks: number; reviewerTasks: number }> = {}

  for (const row of labelerRes.rows) {
    const email = row.email as string
    if (!statsByEmail[email]) statsByEmail[email] = { labelerTasks: 0, reviewerTasks: 0 }
    statsByEmail[email].labelerTasks = Number(row.tasks_completed)
  }

  for (const row of reviewerRes.rows) {
    const email = row.email as string
    if (!statsByEmail[email]) statsByEmail[email] = { labelerTasks: 0, reviewerTasks: 0 }
    statsByEmail[email].reviewerTasks = Number(row.tasks_reviewed)
  }

  return Object.entries(statsByEmail).map(([email, stats]) => ({
    email,
    ...stats,
  })).sort((a, b) => (b.labelerTasks + b.reviewerTasks) - (a.labelerTasks + a.reviewerTasks))
}

// ── 3. Quality Metrics ─────────────────────────────────────────────────────
export async function getQualityMetrics(range: AnalyticsDateRange) {
  // Rejection rate at task level:
  // How many tasks have been rejected at least once? (We can track this by seeing if rejected_region_count > 0, or by audit logs).
  // Actually, tasks table has `rejected_region_count`. A task that needed correction at any point usually has rejected regions.
  let sql = `
    SELECT 
      COUNT(*) as total_reviewed_tasks,
      SUM(CASE WHEN rejected_region_count > 0 THEN 1 ELSE 0 END) as tasks_needing_correction,
      SUM(region_count) as total_regions,
      SUM(rejected_region_count) as total_rejected_regions
    FROM tasks
    WHERE status IN ('NEEDS_CORRECTION', 'CORRECTION_IN_PROGRESS', 'READY_FOR_RE_REVIEW', 'FINAL_APPROVED', 'SYNC_PENDING', 'SYNC_FAILED', 'SYNCED_TO_LABEL_STUDIO')
  `
  const args: any[] = []
  if (range.start) { sql += ` AND updated_at >= ?`; args.push(range.start) }
  if (range.end) { sql += ` AND updated_at <= ?`; args.push(range.end) }

  const res = await db.execute({ sql, args })
  const row = res.rows[0]

  // Unreadable rate at region level
  let unreadableSql = `SELECT COUNT(*) as unreadable_count FROM regions WHERE status = 'UNREADABLE'`
  const unreadableArgs: any[] = []
  if (range.start) { unreadableSql += ` AND updated_at >= ?`; unreadableArgs.push(range.start) }
  if (range.end) { unreadableSql += ` AND updated_at <= ?`; unreadableArgs.push(range.end) }

  const unreadableRes = await db.execute({ sql: unreadableSql, args: unreadableArgs })
  const unreadableRow = unreadableRes.rows[0]

  const totalReviewed = Number(row?.total_reviewed_tasks) || 0
  const tasksNeedingCorrection = Number(row?.tasks_needing_correction) || 0
  const totalRegions = Number(row?.total_regions) || 0
  const rejectedRegions = Number(row?.total_rejected_regions) || 0
  const unreadableRegions = Number(unreadableRow?.unreadable_count) || 0

  return {
    tasks: {
      totalReviewed,
      needingCorrection: tasksNeedingCorrection,
      rejectionRate: totalReviewed > 0 ? (tasksNeedingCorrection / totalReviewed) * 100 : 0,
    },
    regions: {
      totalRegions,
      rejectedRegions,
      regionRejectionRate: totalRegions > 0 ? (rejectedRegions / totalRegions) * 100 : 0,
      unreadableRegions,
      unreadableRate: totalRegions > 0 ? (unreadableRegions / totalRegions) * 100 : 0,
    }
  }
}

// ── 4. Active Locks ────────────────────────────────────────────────────────
export async function getActiveLocks() {
  const sql = `
    SELECT task_id, locked_by, lock_expires_at, status 
    FROM tasks 
    WHERE locked_by IS NOT NULL AND locked_by != ''
      AND (lock_expires_at IS NULL OR lock_expires_at > datetime('now'))
    ORDER BY lock_expires_at ASC
  `
  const res = await db.execute({ sql, args: [] })
  return res.rows.map(row => ({
    task_id: row.task_id as string,
    locked_by: row.locked_by as string,
    lock_expires_at: row.lock_expires_at as string,
    status: row.status as string,
  }))
}
