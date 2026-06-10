import { readSheetAsObjects } from '@/lib/googleSheets'

// ---------------------------------------------------------------------------
// Internal cache
// ---------------------------------------------------------------------------

// Avoid re-reading the config sheet for every config key in a single request.
let _cache: Map<string, string> | null = null
let _cacheAt = 0
const CACHE_TTL_MS = 60_000 // 1 minute — config rarely changes

async function loadConfig(): Promise<Map<string, string>> {
  const now = Date.now()
  if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache

  const rows = await readSheetAsObjects('app_config')
  const map = new Map<string, string>()
  for (const row of rows) {
    if (row.key) map.set(row.key, row.value ?? '')
  }
  _cache = map
  _cacheAt = now
  return map
}

// ---------------------------------------------------------------------------
// Public API — generic
// ---------------------------------------------------------------------------

/** Returns the raw string value for a config key, or null if not found. */
export async function getConfig(key: string): Promise<string | null> {
  const map = await loadConfig()
  return map.has(key) ? (map.get(key) ?? null) : null
}

/** Returns the raw string value, falling back to `defaultValue` if the key is missing. */
export async function getConfigOrDefault(key: string, defaultValue: string): Promise<string> {
  return (await getConfig(key)) ?? defaultValue
}

/** Returns all config entries as a plain object. */
export async function getAllConfig(): Promise<Record<string, string>> {
  const map = await loadConfig()
  return Object.fromEntries(map.entries())
}

// ---------------------------------------------------------------------------
// Public API — typed convenience getters
// ---------------------------------------------------------------------------

/**
 * How long a task lock lasts in minutes.
 * Sheet key: TASK_LOCK_MINUTES. Default: 45.
 */
export async function getTaskLockMinutes(): Promise<number> {
  const v = await getConfigOrDefault('TASK_LOCK_MINUTES', '45')
  return parseInt(v, 10) || 45
}

/**
 * List of script tags allowed in the reviewer dropdown.
 * Sheet key: ALLOWED_SCRIPT_TAGS. Default: KAITHI,DEVANAGARI,ENGLISH,OTHER.
 */
export async function getAllowedScriptTags(): Promise<string[]> {
  const v = await getConfigOrDefault(
    'ALLOWED_SCRIPT_TAGS',
    'KAITHI,DEVANAGARI,ENGLISH,OTHER'
  )
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * Crop padding applied around a bbox when generating the crop preview.
 * Sheet key: CROP_PADDING_PERCENT. Default: 0.015 (1.5%).
 */
export async function getCropPaddingPercent(): Promise<number> {
  const v = await getConfigOrDefault('CROP_PADDING_PERCENT', '0.015')
  return parseFloat(v) || 0.015
}

/**
 * Maximum number of review rounds before escalation.
 * Sheet key: MAX_REVIEW_ROUNDS. Default: 3.
 */
export async function getMaxReviewRounds(): Promise<number> {
  const v = await getConfigOrDefault('MAX_REVIEW_ROUNDS', '3')
  return parseInt(v, 10) || 3
}

/** Invalidates the in-memory cache — useful in tests or after admin updates config. */
export function invalidateConfigCache(): void {
  _cache = null
  _cacheAt = 0
}
