/**
 * Azure Blob Storage — server-side fetch utility.
 *
 * Uses Azure SharedKey authentication (HMAC-SHA256 signature) via Node.js
 * built-in `crypto` — no additional packages required.
 *
 * Environment variables required:
 *   AZURE_STORAGE_ACCOUNT_NAME  — storage account name
 *   AZURE_STORAGE_ACCOUNT_KEY   — base64-encoded account key (key1 or key2)
 */

import { createHmac } from 'crypto'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAccount(): string {
  const v = process.env.AZURE_STORAGE_ACCOUNT_NAME
  if (!v) throw new Error('Missing AZURE_STORAGE_ACCOUNT_NAME env var')
  return v
}

function getAccountKey(): string {
  const v = process.env.AZURE_STORAGE_ACCOUNT_KEY
  if (!v) throw new Error('Missing AZURE_STORAGE_ACCOUNT_KEY env var')
  return v
}

/** Zero-pads a number to 2 digits. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Formats a Date as RFC 1123 (required by Azure REST API). */
function toRfc1123(date: Date): string {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return (
    `${DAYS[date.getUTCDay()]}, ` +
    `${pad2(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())} GMT`
  )
}

// ---------------------------------------------------------------------------
// URI parsing
// ---------------------------------------------------------------------------

/**
 * Parses an `azure-blob://` URI into container and blob path components.
 *
 * Input:  "azure-blob://kaithi/data/pages/017_CRCD000538095809-page-40.jpg"
 * Output: { container: "kaithi", blobPath: "data/pages/017_CRCD...jpg" }
 */
export function parseAzureBlobUri(uri: string): { container: string; blobPath: string } | null {
  if (!uri.startsWith('azure-blob://')) return null
  const rest = uri.slice('azure-blob://'.length)
  const slashIdx = rest.indexOf('/')
  if (slashIdx === -1) return null
  return {
    container: rest.slice(0, slashIdx),
    blobPath: rest.slice(slashIdx + 1),
  }
}

/**
 * Decodes a Label Studio resolve URL into an azure-blob:// URI.
 *
 * Input:  "https://ls.example.com/tasks/119/resolve/?fileuri=YXp1cmUtYmxvYjo..."
 * Output: "azure-blob://kaithi/data/pages/017_CRCD000538095809-page-40.jpg"
 *
 * Returns null if the URL is not a resolve URL or has no fileuri param.
 */
export function decodeLsResolveUrl(lsUrl: string): string | null {
  try {
    // Handle both full URLs and just the resolve path
    const url = lsUrl.startsWith('http') ? new URL(lsUrl) : null
    const fileuri = url?.searchParams.get('fileuri')
    if (!fileuri) return null
    return Buffer.from(fileuri, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

/**
 * Extracts the azure-blob:// URI from either:
 *  - A LS resolve URL (decodes the fileuri param)
 *  - A raw azure-blob:// URI (returned as-is)
 *
 * Returns null for all other URL types (plain https CDN URLs need no special handling).
 */
export function extractBlobUri(rawUrl: string): string | null {
  if (rawUrl.startsWith('azure-blob://')) return rawUrl
  if (rawUrl.includes('/resolve/')) return decodeLsResolveUrl(rawUrl)
  return null
}

// ---------------------------------------------------------------------------
// Authenticated fetch
// ---------------------------------------------------------------------------

/**
 * Fetches a blob from Azure Blob Storage using SharedKey authentication.
 *
 * Uses the Azure Blob Storage REST API v2020-12-06.
 * The SharedKey signature is computed using HMAC-SHA256 and the account key.
 *
 * @param container  Container name (e.g. "kaithi")
 * @param blobPath   Blob path within the container (e.g. "data/pages/file.jpg")
 */
export async function fetchAzureBlob(container: string, blobPath: string): Promise<Response> {
  const account = getAccount()
  const accountKey = getAccountKey()
  const apiVersion = '2020-12-06'
  const date = toRfc1123(new Date())

  // CanonicalizedHeaders — must be sorted lexicographically by header name
  // Format: lowercased_header_name + ":" + trimmed_value + "\n"
  const canonicalizedHeaders =
    `x-ms-date:${date}\n` +
    `x-ms-version:${apiVersion}\n`

  // CanonicalizedResource
  // For a GET with no query params: "/{account}/{container}/{blob}"
  const canonicalizedResource = `/${account}/${container}/${blobPath}`

  // StringToSign for GET blob (Azure SharedKey scheme):
  // https://learn.microsoft.com/en-us/rest/api/storageservices/authorize-with-shared-key
  //
  // Each header field is separated by \n.
  // CanonicalizedHeaders already ends with \n — CanonicalizedResource follows directly (NO extra \n).
  // Using explicit concatenation to avoid .join('\n') adding a spurious newline between
  // CanonicalizedHeaders and CanonicalizedResource.
  const stringToSign =
    'GET\n' +           // VERB
    '\n' +              // Content-Encoding
    '\n' +              // Content-Language
    '\n' +              // Content-Length (empty for GET)
    '\n' +              // Content-MD5
    '\n' +              // Content-Type
    '\n' +              // Date (empty — using x-ms-date canonicalized header instead)
    '\n' +              // If-Modified-Since
    '\n' +              // If-Match
    '\n' +              // If-None-Match
    '\n' +              // If-Unmodified-Since
    '\n' +              // Range
    canonicalizedHeaders +    // "x-ms-date:{date}\nx-ms-version:{version}\n"
    canonicalizedResource     // "/{account}/{container}/{blobPath}"  — no trailing \n

  const signature = createHmac('sha256', Buffer.from(accountKey, 'base64'))
    .update(stringToSign, 'utf8')
    .digest('base64')

  const blobUrl = `https://${account}.blob.core.windows.net/${container}/${blobPath}`

  return fetch(blobUrl, {
    headers: {
      Authorization: `SharedKey ${account}:${signature}`,
      'x-ms-date': date,
      'x-ms-version': apiVersion,
    },
    cache: 'no-store',
  })
}
