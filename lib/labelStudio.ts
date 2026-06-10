/**
 * Label Studio API client.
 * All requests are authenticated with the LABEL_STUDIO_API_TOKEN env var.
 * All operations happen server-side only — token is never exposed to the browser.
 */

function getBaseUrl(): string {
  const url = process.env.LABEL_STUDIO_BASE_URL
  if (!url) throw new Error('Missing LABEL_STUDIO_BASE_URL env var')
  return url.replace(/\/$/, '') // strip trailing slash
}

function getToken(): string {
  const token = process.env.LABEL_STUDIO_API_TOKEN
  if (!token) throw new Error('Missing LABEL_STUDIO_API_TOKEN env var')
  return token
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Token ${getToken()}`,
    'Content-Type': 'application/json',
  }
}

// ---------------------------------------------------------------------------
// Core request helpers
// ---------------------------------------------------------------------------

export async function lsGet<T = unknown>(path: string): Promise<T> {
  const url = `${getBaseUrl()}${path}`
  const res = await fetch(url, { headers: authHeaders() })
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
    headers: authHeaders(),
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

/** List all task IDs for a project */
export async function listProjectTasks(
  projectId: string | number,
  page = 1,
  pageSize = 100
): Promise<{ tasks: { id: number }[]; total: number }> {
  return lsGet(
    `/api/tasks/?project=${projectId}&page=${page}&page_size=${pageSize}`
  ) as Promise<{ tasks: { id: number }[]; total: number }>
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
