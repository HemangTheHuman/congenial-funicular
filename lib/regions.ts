/**
 * lib/regions.ts — SQL rewrite (Turso)
 */
import { db } from '@/lib/db'
import { generateId } from '@/utils/ids'
import { nowISO } from '@/utils/date'
import { assertRegionTransition } from '@/lib/transitions'
import type { Region, RegionStatus } from '@/types/region'

// ---------------------------------------------------------------------------
// Deserialiser
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRegion(row: Record<string, any>): Region {
  return {
    region_id:           String(row.region_id ?? ''),
    task_id:             String(row.task_id ?? ''),
    ls_task_id:          String(row.ls_task_id ?? ''),
    ls_region_id:        String(row.ls_region_id ?? ''),
    order_index:         Number(row.order_index) || 0,
    bbox_x_percent:      Number(row.bbox_x_percent) || 0,
    bbox_y_percent:      Number(row.bbox_y_percent) || 0,
    bbox_width_percent:  Number(row.bbox_width_percent) || 0,
    bbox_height_percent: Number(row.bbox_height_percent) || 0,
    bbox_xmin:           Number(row.bbox_xmin) || 0,
    bbox_ymin:           Number(row.bbox_ymin) || 0,
    bbox_xmax:           Number(row.bbox_xmax) || 0,
    bbox_ymax:           Number(row.bbox_ymax) || 0,
    rotation:            Number(row.rotation) || 0,
    script_tag_original: String(row.script_tag_original ?? ''),
    script_tag_final:    String(row.script_tag_final ?? ''),
    status:              String(row.status ?? 'PENDING_LABEL') as RegionStatus,
    is_active:           Number(row.is_active) === 1,
    created_at:          String(row.created_at ?? ''),
    updated_at:          String(row.updated_at ?? ''),
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get a region by its region_id. */
export async function getRegionById(regionId: string): Promise<Region | null> {
  const res = await db.execute({
    sql:  'SELECT * FROM regions WHERE region_id = ? LIMIT 1',
    args: [regionId],
  })
  return res.rows.length > 0 ? rowToRegion(res.rows[0]) : null
}

/** Returns all active regions for a task, ordered by order_index. */
export async function listRegionsByTask(taskId: string): Promise<Region[]> {
  const res = await db.execute({
    sql:  'SELECT * FROM regions WHERE task_id = ? AND is_active = 1 ORDER BY order_index ASC',
    args: [taskId],
  })
  return res.rows.map(rowToRegion)
}

/** Returns all regions for a task regardless of is_active flag. */
export async function listAllRegionsByTask(taskId: string): Promise<Region[]> {
  const res = await db.execute({
    sql:  'SELECT * FROM regions WHERE task_id = ? ORDER BY order_index ASC',
    args: [taskId],
  })
  return res.rows.map(rowToRegion)
}

/**
 * Creates a new region row.
 * `region_id`, `created_at`, `updated_at` are generated automatically.
 */
export async function createRegion(
  data: Omit<Region, 'region_id' | 'created_at' | 'updated_at'>
): Promise<Region> {
  const now = nowISO()
  const region: Region = { ...data, region_id: generateId('RG'), created_at: now, updated_at: now }
  await db.execute({
    sql: `INSERT INTO regions
            (region_id, task_id, ls_task_id, ls_region_id, order_index,
             bbox_x_percent, bbox_y_percent, bbox_width_percent, bbox_height_percent,
             bbox_xmin, bbox_ymin, bbox_xmax, bbox_ymax, rotation,
             script_tag_original, script_tag_final, status, is_active,
             created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      region.region_id, region.task_id, region.ls_task_id, region.ls_region_id,
      region.order_index,
      region.bbox_x_percent, region.bbox_y_percent,
      region.bbox_width_percent, region.bbox_height_percent,
      region.bbox_xmin, region.bbox_ymin, region.bbox_xmax, region.bbox_ymax,
      region.rotation,
      region.script_tag_original, region.script_tag_final,
      region.status, region.is_active ? 1 : 0,
      region.created_at, region.updated_at,
    ],
  })
  return region
}

/**
 * Bulk-creates regions in a single batch.
 * Use this when importing a task to avoid N individual API calls.
 */
export async function createRegionsBatch(
  dataList: Omit<Region, 'region_id' | 'created_at' | 'updated_at'>[]
): Promise<Region[]> {
  if (dataList.length === 0) return []
  const now = nowISO()
  const regions: Region[] = dataList.map((data) => ({
    ...data,
    region_id:  generateId('RG'),
    created_at: now,
    updated_at: now,
  }))

  // Execute as a batch transaction
  await db.batch(
    regions.map((region) => ({
      sql: `INSERT INTO regions
              (region_id, task_id, ls_task_id, ls_region_id, order_index,
               bbox_x_percent, bbox_y_percent, bbox_width_percent, bbox_height_percent,
               bbox_xmin, bbox_ymin, bbox_xmax, bbox_ymax, rotation,
               script_tag_original, script_tag_final, status, is_active,
               created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        region.region_id, region.task_id, region.ls_task_id, region.ls_region_id,
        region.order_index,
        region.bbox_x_percent, region.bbox_y_percent,
        region.bbox_width_percent, region.bbox_height_percent,
        region.bbox_xmin, region.bbox_ymin, region.bbox_xmax, region.bbox_ymax,
        region.rotation,
        region.script_tag_original, region.script_tag_final,
        region.status, region.is_active ? 1 : 0,
        region.created_at, region.updated_at,
      ],
    })),
    'write'
  )
  return regions
}

/**
 * Updates the status of a region, enforcing transition rules.
 * Throws if the transition is invalid.
 */
export async function updateRegionStatus(regionId: string, to: RegionStatus): Promise<Region> {
  const region = await getRegionById(regionId)
  if (!region) throw new Error(`Region not found: ${regionId}`)
  assertRegionTransition(region.status, to)
  const updated: Region = { ...region, status: to, updated_at: nowISO() }
  await db.execute({
    sql:  'UPDATE regions SET status = ?, updated_at = ? WHERE region_id = ?',
    args: [to, updated.updated_at, regionId],
  })
  return updated
}

/** Updates the script_tag_final on a region (reviewer correction). */
export async function updateRegionScriptTag(regionId: string, tag: string): Promise<Region> {
  const region = await getRegionById(regionId)
  if (!region) throw new Error(`Region not found: ${regionId}`)
  const updated: Region = { ...region, script_tag_final: tag, updated_at: nowISO() }
  await db.execute({
    sql:  'UPDATE regions SET script_tag_final = ?, updated_at = ? WHERE region_id = ?',
    args: [tag, updated.updated_at, regionId],
  })
  return updated
}

/** Soft-deletes a region by setting is_active = false. */
export async function deactivateRegion(regionId: string): Promise<void> {
  await db.execute({
    sql:  'UPDATE regions SET is_active = 0, updated_at = ? WHERE region_id = ?',
    args: [nowISO(), regionId],
  })
}

/**
 * Returns true if all active regions for a task are in one of the given statuses.
 * Used to check whether a task is ready to advance (all labeled, all reviewed, etc.).
 */
export async function allRegionsInStatus(
  taskId: string,
  statuses: RegionStatus[]
): Promise<boolean> {
  const regions = await listRegionsByTask(taskId)
  if (regions.length === 0) return false
  const statusSet = new Set(statuses)
  return regions.every((r) => statusSet.has(r.status))
}

/**
 * SEC-1: Atomically updates region status only if the caller still holds
 * a valid lock on the parent task. Returns true if successful.
 */
export async function atomicUpdateRegionStatusWithLock(
  regionId: string,
  status: RegionStatus,
  taskId: string,
  email: string
): Promise<boolean> {
  const now = nowISO()
  const result = await db.execute({
    sql: `UPDATE regions SET status = ?, updated_at = ?
          WHERE region_id = ? AND EXISTS (
            SELECT 1 FROM tasks 
            WHERE task_id = ? AND locked_by = ? AND lock_expires_at > ?
          )`,
    args: [status, now, regionId, taskId, email, now],
  })
  return (result.rowsAffected ?? 0) > 0
}
