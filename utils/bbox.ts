/**
 * utils/bbox.ts — Bounding box conversion utilities.
 *
 * Label Studio stores bbox as percentage of the original image dimensions.
 * These pure functions convert to/from pixel coordinates.
 * No IO — fully unit-testable.
 */

export interface PixelBbox {
  xmin: number
  ymin: number
  xmax: number
  ymax: number
}

/**
 * Convert a Label Studio percentage bbox to absolute pixel coordinates.
 *
 * Label Studio format:
 *   x, y       = top-left corner as % of image width/height
 *   width      = bbox width as % of image width
 *   height     = bbox height as % of image height
 *
 * @param xPct       - x position in percent (0–100)
 * @param yPct       - y position in percent (0–100)
 * @param widthPct   - bbox width in percent (0–100)
 * @param heightPct  - bbox height in percent (0–100)
 * @param origWidth  - original image width in pixels
 * @param origHeight - original image height in pixels
 */
export function pctToPixel(
  xPct: number,
  yPct: number,
  widthPct: number,
  heightPct: number,
  origWidth: number,
  origHeight: number
): PixelBbox {
  return {
    xmin: Math.round((xPct / 100) * origWidth),
    ymin: Math.round((yPct / 100) * origHeight),
    xmax: Math.round(((xPct + widthPct) / 100) * origWidth),
    ymax: Math.round(((yPct + heightPct) / 100) * origHeight),
  }
}

/**
 * Legacy alias — same as pctToPixel but accepts an object.
 * Kept for backward compatibility with any Phase 0 callers.
 */
export function percentToPixels(
  bbox: { x: number; y: number; width: number; height: number },
  originalWidth: number,
  originalHeight: number
): PixelBbox {
  return pctToPixel(bbox.x, bbox.y, bbox.width, bbox.height, originalWidth, originalHeight)
}

/**
 * Expand a pixel bbox outward by a fraction of the image dimensions.
 * Used to add padding around a crop so it's not flush with the text edges.
 *
 * @param bbox        - original pixel bbox
 * @param origWidth   - original image width in pixels
 * @param origHeight  - original image height in pixels
 * @param padFraction - padding as fraction of image dimensions (e.g. 0.015 = 1.5%)
 */
export function padBbox(
  bbox: PixelBbox,
  origWidth: number,
  origHeight: number,
  padFraction: number
): PixelBbox {
  const padX = Math.round(origWidth * padFraction)
  const padY = Math.round(origHeight * padFraction)
  return {
    xmin: Math.max(0, bbox.xmin - padX),
    ymin: Math.max(0, bbox.ymin - padY),
    xmax: Math.min(origWidth, bbox.xmax + padX),
    ymax: Math.min(origHeight, bbox.ymax + padY),
  }
}

/**
 * Convert a pixel bbox back to Label Studio percentage format.
 * Useful when building the final sync payload for Label Studio writeback.
 */
export function pixelToPct(
  bbox: PixelBbox,
  origWidth: number,
  origHeight: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: (bbox.xmin / origWidth) * 100,
    y: (bbox.ymin / origHeight) * 100,
    width: ((bbox.xmax - bbox.xmin) / origWidth) * 100,
    height: ((bbox.ymax - bbox.ymin) / origHeight) * 100,
  }
}
