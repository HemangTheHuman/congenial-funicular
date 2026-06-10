interface PercentBbox {
  x: number
  y: number
  width: number
  height: number
}

interface PixelBbox {
  xmin: number
  ymin: number
  xmax: number
  ymax: number
}

/**
 * Converts Label Studio percentage-based bbox values to absolute pixel coords.
 *
 * Label Studio stores bbox as percentage of the original image dimensions:
 *   x, y = top-left corner as percentage
 *   width, height = dimensions as percentage
 *
 * Formula (from README §8.2):
 *   xmin = originalWidth  * x / 100
 *   ymin = originalHeight * y / 100
 *   xmax = originalWidth  * (x + width) / 100
 *   ymax = originalHeight * (y + height) / 100
 */
export function percentToPixels(
  bbox: PercentBbox,
  originalWidth: number,
  originalHeight: number
): PixelBbox {
  return {
    xmin: Math.round((originalWidth * bbox.x) / 100),
    ymin: Math.round((originalHeight * bbox.y) / 100),
    xmax: Math.round((originalWidth * (bbox.x + bbox.width)) / 100),
    ymax: Math.round((originalHeight * (bbox.y + bbox.height)) / 100),
  }
}
