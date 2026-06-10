/**
 * Label Studio API client.
 *
 * Authentication strategy:
 * - Label Studio 1.8+ uses simplejwt. The env var LABEL_STUDIO_API_TOKEN
 *   holds a long-lived **refresh token** (JWT, token_type="refresh").
 * - Before each request we exchange it for a short-lived **access token**
 *   via POST /api/token/refresh/ and send that as `Authorization: Bearer`.
 * - The access token is cached in memory for 4 minutes (expires in ~5 min).
 * - If the refresh fails (refresh token rotated/invalidated), we throw with
 *   a clear message so the dev knows to paste a new token in .env.local.
 *
 * All operations are server-side only — tokens are never exposed to the browser.
 */

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getBaseUrl(): string {
  const url = process.env.LABEL_STUDIO_BASE_URL
  if (!url) throw new Error('Missing LABEL_STUDIO_BASE_URL env var')
  return url.replace(/\/$/, '')
}

function getRefreshToken(): string {
  const token = process.env.LABEL_STUDIO_API_TOKEN
  if (!token) throw new Error('Missing LABEL_STUDIO_API_TOKEN env var')
  return token
}

// ---------------------------------------------------------------------------
// JWT access-token cache
// ---------------------------------------------------------------------------

let _cachedAccessToken: string | null = null
let _tokenExpiresAt = 0

/**
 * Returns a valid JWT access token, refreshing if the cached one is stale.
 * Uses the refresh token stored in LABEL_STUDIO_API_TOKEN.
 */
async function getAccessToken(): Promise<string> {
  const now = Date.now()
  // Keep 30-second buffer before expiry
  if (_cachedAccessToken && now < _tokenExpiresAt - 30_000) {
    return _cachedAccessToken
  }

  const refreshToken = getRefreshToken()
  const baseUrl = getBaseUrl()

  const res = await fetch(`${baseUrl}/api/token/refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh: refreshToken }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `Label Studio token refresh failed (${res.status}): ${body}\n` +
      'Your LABEL_STUDIO_API_TOKEN may be expired. ' +
      'Go to Label Studio → Account & Settings → Access Token and paste the new token in .env.local.'
    )
  }

  const data = await res.json() as { access: string }
  _cachedAccessToken = data.access
  // LS simplejwt default access token lifetime is 5 minutes
  _tokenExpiresAt = now + 4 * 60 * 1000
  return _cachedAccessToken
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken()
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

// ---------------------------------------------------------------------------
// Core request helpers
// ---------------------------------------------------------------------------

export async function lsGet<T = unknown>(path: string): Promise<T> {
  const url = `${getBaseUrl()}${path}`
  const res = await fetch(url, { headers: await authHeaders() })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Label Studio GET ${path} failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<T>
}

export async function lsPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const url = `${getBaseUrl()}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Label Studio POST ${path} failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Domain methods
// ---------------------------------------------------------------------------

/** Fetch full task data by Label Studio task ID */
export async function getTask(lsTaskId: string | number) {
  return lsGet(`/api/tasks/${lsTaskId}/`)
}

/** A task entry as returned by the LS project task list endpoint */
export interface LsTaskListEntry {
  id: number
  data: Record<string, unknown>
}

/** Label Studio filter query shape (passed as ?query= param) */
export interface LsFilterQuery {
  filters: {
    conjunction: 'and' | 'or'
    items: {
      filter: string    // e.g. "filter:tasks:data.review"
      operator: string  // e.g. "equal"
      type: string      // e.g. "String"
      value: string
    }[]
  }
}

/** List tasks for a project, with optional server-side LS filter query. */
export async function listProjectTasks(
  projectId: string | number,
  page = 1,
  pageSize = 100,
  query?: LsFilterQuery
): Promise<{ tasks: LsTaskListEntry[]; total: number }> {
  const params = new URLSearchParams({
    project:   String(projectId),
    page:      String(page),
    page_size: String(pageSize),
  })
  if (query) {
    params.set('query', JSON.stringify(query))
  }
  return lsGet(
    `/api/tasks/?${params.toString()}`
  ) as Promise<{ tasks: LsTaskListEntry[]; total: number }>
}

/**
 * Submit a final annotation to Label Studio.
 * Used by the sync queue to push approved labels back.
 */
export async function submitAnnotation(lsTaskId: string | number, payload: unknown) {
  return lsPost(`/api/tasks/${lsTaskId}/annotations/`, payload)
}

/**
 * Lightweight connection test — fetches the Label Studio health endpoint.
 * Returns true if reachable and authenticated.
 */
export async function testConnection(): Promise<boolean> {
  try {
    await lsGet('/api/health')
    return true
  } catch {
    return false
  }
}
