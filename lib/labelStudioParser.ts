/**
 * lib/labelStudioParser.ts
 *
 * Parses the raw Label Studio task API response into a normalised format
 * ready for the Sheet helpers (createTask, createRegion).
 *
 * ── Actual LS task JSON shape (confirmed from live instance) ───────────────
 *
 * {
 *   id: number,
 *   project: number,
 *   data: { <imageField>: string, ... },   ← field name varies per project
 *   annotations: [
 *     {
 *       result: [
 *         // Each region = TWO items sharing the same `id`:
 *
 *         // 1. Bounding box
 *         {
 *           id: string,              ← ls_region_id
 *           type: "rectangle",
 *           from_name: "bbox",
 *           value: { x, y, width, height, rotation },
 *           original_width: number,
 *           original_height: number,
 *         },
 *
 *         // 2. Script label (same id)
 *         {
 *           id: string,              ← same ls_region_id
 *           type: "labels",
 *           from_name: "label",
 *           value: { labels: string[], x, y, width, height, rotation },
 *           original_width: number,
 *           original_height: number,
 *         }
 *       ]
 *     }
 *   ]
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { pctToPixel } from '@/utils/bbox'

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** Normalized result of parsing one LS task — ready for createTask() */
export interface ParsedLsTask {
  ls_task_id: string
  project_id: string
  image_url: string
  original_width: number
  original_height: number
  regions: ParsedLsRegion[]
}

/** One parsed region — ready for createRegion() */
export interface ParsedLsRegion {
  ls_region_id: string
  order_index: number
  bbox_x_percent: number
  bbox_y_percent: number
  bbox_width_percent: number
  bbox_height_percent: number
  bbox_xmin: number
  bbox_ymin: number
  bbox_xmax: number
  bbox_ymax: number
  rotation: number
  /** First entry from value.labels[], or '' if no label item found */
  script_tag: string
}

// ---------------------------------------------------------------------------
// Internal raw types
// ---------------------------------------------------------------------------

interface LsResultItem {
  id: string
  type: string
  from_name?: string
  value: Record<string, unknown>
  original_width?: number
  original_height?: number
}

interface LsAnnotation {
  result?: LsResultItem[]
}

interface LsTask {
  id: number
  project: number
  data: Record<string, unknown>
  annotations?: LsAnnotation[]
  original_width?: number
  original_height?: number
}

// ---------------------------------------------------------------------------
// Image URL resolution
// Tries common field names, then scans all string values for a URL.
// ---------------------------------------------------------------------------

const IMAGE_FIELD_CANDIDATES = ['image', 'image_url', 'img', 'file_upload', 'url', 'src']

function resolveImageUrl(data: Record<string, unknown>): string {
  // 1. Try known candidate keys
  for (const key of IMAGE_FIELD_CANDIDATES) {
    if (typeof data[key] === 'string' && data[key]) {
      return data[key] as string
    }
  }

  // 2. Scan all string values — return the first one that looks like a URL
  for (const val of Object.values(data)) {
    if (
      typeof val === 'string' &&
      val.length > 0 &&
      (val.startsWith('http') || val.startsWith('/') || val.includes('.'))
    ) {
      return val
    }
  }

  return ''
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw Label Studio task API response into a normalised ParsedLsTask.
 *
 * @throws {Error} with a descriptive message if required fields are missing.
 */
export function parseLsTask(rawTask: unknown): ParsedLsTask {
  const task = rawTask as LsTask

  if (!task || typeof task.id !== 'number') {
    throw new Error('parseLsTask: missing or invalid task.id')
  }
  if (typeof task.project !== 'number') {
    throw new Error(`parseLsTask: missing task.project (task id=${task.id})`)
  }

  // Resolve image URL from task.data (field name varies per project template)
  const imageUrl = resolveImageUrl(task.data ?? {})
  if (!imageUrl) {
    throw new Error(
      `parseLsTask: could not find image URL in task.data for task id=${task.id}. ` +
      `Data keys present: [${Object.keys(task.data ?? {}).join(', ')}]`
    )
  }

  // Take the first annotation's result list; empty array if no annotations
  const firstAnnotation = task.annotations?.[0]
  const resultItems: LsResultItem[] = firstAnnotation?.result ?? []

  // Group items by region id — each region has a "rectangle" + "labels" item
  const groups = new Map<string, LsResultItem[]>()
  for (const item of resultItems) {
    if (!item.id) continue
    const existing = groups.get(item.id) ?? []
    existing.push(item)
    groups.set(item.id, existing)
  }

  // Parse each group into a ParsedLsRegion
  const rawRegions: Array<ParsedLsRegion & { _yPct: number; _xPct: number }> = []

  for (const [regionId, items] of groups.entries()) {
    // Find the bbox item (type = "rectangle")
    const bboxItem = items.find((i) => i.type === 'rectangle')
    if (!bboxItem) continue  // skip groups with no rectangle (e.g. polygon, etc.)

    const bboxVal = bboxItem.value as {
      x: number; y: number; width: number; height: number; rotation?: number
    }

    const origW = bboxItem.original_width ?? (task.original_width ?? 0)
    const origH = bboxItem.original_height ?? (task.original_height ?? 0)
    const rotation = bboxVal.rotation ?? 0

    const pixel = pctToPixel(bboxVal.x, bboxVal.y, bboxVal.width, bboxVal.height, origW, origH)

    // Find the script tag from the paired "labels" item
    const labelItem = items.find((i) => i.type === 'labels')
    const labelsArr = labelItem?.value?.labels
    const scriptTag = Array.isArray(labelsArr) && labelsArr.length > 0
      ? String(labelsArr[0])
      : ''

    rawRegions.push({
      ls_region_id:        regionId,
      order_index:         0,        // assigned below after sorting
      bbox_x_percent:      bboxVal.x,
      bbox_y_percent:      bboxVal.y,
      bbox_width_percent:  bboxVal.width,
      bbox_height_percent: bboxVal.height,
      bbox_xmin:           pixel.xmin,
      bbox_ymin:           pixel.ymin,
      bbox_xmax:           pixel.xmax,
      bbox_ymax:           pixel.ymax,
      rotation,
      script_tag:          scriptTag,
      _yPct:               bboxVal.y,
      _xPct:               bboxVal.x,
    })
  }

  // Sort top-to-bottom, left-to-right (reading order)
  rawRegions.sort((a, b) => {
    const yDiff = a._yPct - b._yPct
    if (Math.abs(yDiff) > 1) return yDiff   // >1% difference = different row
    return a._xPct - b._xPct
  })

  const regions: ParsedLsRegion[] = rawRegions.map((r, i) => {
    const { _yPct: _y, _xPct: _x, ...region } = r
    void _y; void _x
    return { ...region, order_index: i }
  })

  // Get image dimensions from the first rectangle item
  const firstRect = resultItems.find((i) => i.type === 'rectangle')
  const origWidth  = firstRect?.original_width  ?? (task.original_width  ?? 0)
  const origHeight = firstRect?.original_height ?? (task.original_height ?? 0)

  return {
    ls_task_id:      String(task.id),
    project_id:      String(task.project),
    image_url:       imageUrl,
    original_width:  origWidth,
    original_height: origHeight,
    regions,
  }
}
