/**
 * Converts any Label Studio task image URL into a URL safe for use in <img src>.
 *
 * LS images are stored in Azure Blob Storage and served via an authenticated
 * resolve endpoint — the browser cannot fetch them directly (401).
 *
 * This function wraps the raw URL in our server-side proxy at /api/image-proxy,
 * which handles Azure SharedKey authentication transparently.
 *
 * Usage (server components):
 *   <img src={toProxiedImageUrl(task.image_url)} />
 *   or with next/image:
 *   <Image src={toProxiedImageUrl(task.image_url)} ... unoptimized />
 */
export function toProxiedImageUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl) return ''
  return `/api/image-proxy?url=${encodeURIComponent(rawUrl)}`
}
