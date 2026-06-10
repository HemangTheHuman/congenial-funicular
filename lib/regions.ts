import {
  readSheetAsObjects,
  findRowByColumn,
  appendRow,
  updateRow,
} from '@/lib/googleSheets'
import { generateId } from '@/utils/ids'
import { nowISO } from '@/utils/date'
import { assertRegionTransition } from '@/lib/transitions'
import { REGION_COLUMNS } from '@/lib/sheetColumns'
import type { Region, RegionStatus } from '@/types/region'

// ---------------------------------------------------------------------------
// Serialiser / Deserialiser
// ---------------------------------------------------------------------------

function rowToRegion(row: Record<string, string>): Region {
  return {
    region_id:            row.region_id,
    task_id:              row.task_id,
    ls_task_id:           row.ls_task_id,
    ls_region_id:         row.ls_region_id,
    order_index:          parseInt(row.order_index, 10) || 0,
    bbox_x_percent:       parseFloat(row.bbox_x_percent) || 0,
    bbox_y_percent:       parseFloat(row.bbox_y_percent) || 0,
    bbox_width_percent:   parseFloat(row.bbox_width_percent) || 0,
    bbox_height_percent:  parseFloat(row.bbox_height_percent) || 0,
    bbox_xmin:            parseFloat(row.bbox_xmin) || 0,
    bbox_ymin:            parseFloat(row.bbox_ymin) || 0,
    bbox_xmax:            parseFloat(row.bbox_xmax) || 0,
    bbox_ymax:            parseFloat(row.bbox_ymax) || 0,
    rotation:             parseFloat(row.rotation) || 0,
    script_tag_original:  row.script_tag_original,
    script_tag_final:     row.script_tag_final,
    status:               row.status as RegionStatus,
    is_active:            row.is_active === 'TRUE' || row.is_active === 'true',
    created_at:           row.created_at,
    updated_at:           row.updated_at,
  }
}

function regionToRow(r: Region): (string | number | boolean)[] {
  return [
    r.region_id,
    r.task_id,
    r.ls_task_id,
    r.ls_region_id,
    String(r.order_index),
    String(r.bbox_x_percent),
    String(r.bbox_y_percent),
    String(r.bbox_width_percent),
    String(r.bbox_height_percent),
    String(r.bbox_xmin),
    String(r.bbox_ymin),
    String(r.bbox_xmax),
    String(r.bbox_ymax),
    String(r.rotation),
    r.script_tag_original,
    r.script_tag_final,
    r.status,
    r.is_active ? 'TRUE' : 'FALSE',
    r.created_at,
    r.updated_at,
  ]
}

// Sanity check — regionToRow must produce REGION_COLUMNS.length values
const _: (typeof REGION_COLUMNS)['length'] extends 20 ? true : false = true
void _

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function findRegionRow(
  column: string,
  value: string
): Promise<{ region: Region; rowNumber: number } | null> {
  const result = await findRowByColumn('regions', column, value)
  if (!result) return null
  return { region: rowToRegion(result.row), rowNumber: result.rowNumber }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get a single region by its internal region_id. */
export async function getRegionById(regionId: string): Promise<Region | null> {
  const r = await findRegionRow('region_id', regionId)
  return r?.region ?? null
}

/**
 * Returns all regions for a task, sorted by order_index ascending.
 * Only active regions (is_active = TRUE) are returned by default.
 */
export async function listRegionsByTask(
  taskId: string,
  includeInactive = false
): Promise<Region[]> {
  const rows = await readSheetAsObjects('regions')
  return rows
    .map(rowToRegion)
    .filter((r) => r.task_id === taskId && (includeInactive || r.is_active))
    .sort((a, b) => a.order_index - b.order_index)
}

/**
 * Returns regions for a task filtered by one or more statuses.
 * Only active regions are returned.
 */
export async function listRegionsByTaskAndStatus(
  taskId: string,
  ...statuses: RegionStatus[]
): Promise<Region[]> {
  const all = await listRegionsByTask(taskId)
  const statusSet = new Set(statuses)
  return all.filter((r) => statusSet.has(r.status))
}

/**
 * Creates a new region row.
 * `region_id`, `created_at`, `updated_at` are generated automatically.
 * `script_tag_final` starts as `script_tag_original` per the design spec.
 */
export async function createRegion(
  data: Omit<Region, 'region_id' | 'created_at' | 'updated_at'>
): Promise<Region> {
  const now = nowISO()
  const region: Region = {
    ...data,
    region_id: generateId('RG'),
    created_at: now,
    updated_at: now,
  }
  await appendRow('regions', regionToRow(region))
  return region
}

/**
 * Updates a region's status, enforcing transition rules.
 */
export async function updateRegionStatus(
  regionId: string,
  to: RegionStatus
): Promise<Region> {
  const r = await findRegionRow('region_id', regionId)
  if (!r) throw new Error(`Region not found: ${regionId}`)
  assertRegionTransition(r.region.status, to)

  const updated: Region = { ...r.region, status: to, updated_at: nowISO() }
  await updateRow('regions', r.rowNumber, regionToRow(updated))
  return updated
}

/**
 * Updates the reviewer-controlled script_tag_final field.
 * Labelers can never call this.
 */
export async function updateRegionScriptTagFinal(
  regionId: string,
  scriptTag: string
): Promise<void> {
  const r = await findRegionRow('region_id', regionId)
  if (!r) throw new Error(`Region not found: ${regionId}`)

  const updated: Region = {
    ...r.region,
    script_tag_final: scriptTag,
    updated_at: nowISO(),
  }
  await updateRow('regions', r.rowNumber, regionToRow(updated))
}

/**
 * Soft-deletes a region (sets is_active = FALSE).
 * Regions should never be hard-deleted.
 */
export async function deactivateRegion(regionId: string): Promise<void> {
  const r = await findRegionRow('region_id', regionId)
  if (!r) throw new Error(`Region not found: ${regionId}`)

  const updated: Region = { ...r.region, is_active: false, updated_at: nowISO() }
  await updateRow('regions', r.rowNumber, regionToRow(updated))
}

/**
 * Returns true when ALL active regions of a task are in one of the given statuses.
 * Used to determine if a task can transition (e.g., all LABELED → submit to review).
 */
export async function allRegionsInStatus(
  taskId: string,
  ...statuses: RegionStatus[]
): Promise<boolean> {
  const regions = await listRegionsByTask(taskId)
  if (regions.length === 0) return false
  const statusSet = new Set(statuses)
  return regions.every((r) => statusSet.has(r.status))
}
