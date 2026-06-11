import { auth } from '@/auth'
import { extractBlobUri, parseAzureBlobUri, fetchAzureBlob } from '@/utils/azureBlob'

export const dynamic = 'force-dynamic'

/**
 * GET /api/image-proxy?url=<encodeURIComponent(rawImageUrl)>
 * Auth: LABELER, REVIEWER, or ADMIN
 *
 * Resolves a Label Studio task image and streams it to the browser.
 *
 * Flow:
 *   1. Receive the raw image_url stored in the tasks Sheet
 *      (a LS resolve URL: https://ls.../tasks/119/resolve/?fileuri=<base64>)
 *   2. Decode the base64 fileuri → azure-blob://container/path/file.jpg
 *   3. Fetch the blob from Azure Blob Storage using SharedKey auth
 *   4. Stream bytes back with a long browser cache header
 *
 * Also handles:
 *   - Raw azure-blob:// URIs (in case they end up stored directly)
 *   - Plain https:// URLs (public CDN — fetched without auth)
 */
export const GET = auth(async (req) => {
  const session = req.auth
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { role } = session.user
  if (role !== 'LABELER' && role !== 'REVIEWER' && role !== 'ADMIN') {
    return new Response('Forbidden', { status: 403 })
  }

  const rawUrl = new URL(req.url).searchParams.get('url')
  if (!rawUrl) {
    return new Response('Missing url parameter', { status: 400 })
  }

  try {
    let upstreamRes: Response

    // Try to resolve as Azure Blob (covers LS resolve URLs + azure-blob:// URIs)
    const blobUri = extractBlobUri(rawUrl)

    if (blobUri) {
      // Azure path
      const parsed = parseAzureBlobUri(blobUri)
      if (!parsed) {
        return new Response(`Cannot parse blob URI: ${blobUri}`, { status: 400 })
      }
      upstreamRes = await fetchAzureBlob(parsed.container, parsed.blobPath)
    } else {
      // Plain https URL (public CDN, no auth needed)
      upstreamRes = await fetch(rawUrl, { cache: 'no-store' })
    }

    if (!upstreamRes.ok) {
      console.error(`[image-proxy] upstream ${upstreamRes.status} for ${rawUrl}`)
      return new Response(`Upstream returned ${upstreamRes.status}`, {
        status: upstreamRes.status,
      })
    }

    const contentType = upstreamRes.headers.get('content-type') ?? 'image/jpeg'
    const contentLength = upstreamRes.headers.get('content-length')

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      // Cache aggressively in the browser — blob content never changes for a given path
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    }
    if (contentLength) headers['Content-Length'] = contentLength

    return new Response(upstreamRes.body, { status: 200, headers })
  } catch (err) {
    console.error('[image-proxy] error:', err)
    return new Response(`Image fetch failed: ${String(err)}`, { status: 502 })
  }
})
