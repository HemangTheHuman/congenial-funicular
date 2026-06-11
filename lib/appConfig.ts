/**
 * lib/appConfig.ts
 *
 * Application configuration as a hardcoded TypeScript constant.
 * Values that benefit from env-var overrides are read from process.env.
 * No database read required — eliminates the previous Google Sheets config tab.
 */

export const APP_CONFIG = {
  /** How long a task lock lasts (minutes). Override via TASK_LOCK_MINUTES env var. */
  TASK_LOCK_MINUTES: parseInt(process.env.TASK_LOCK_MINUTES ?? '45', 10) || 45,

  /** Script tags shown in reviewer dropdowns. */
  ALLOWED_SCRIPT_TAGS: ['KAITHI', 'DEVANAGARI', 'ENGLISH', 'OTHER'] as string[],

  /** Crop padding around bbox in the workspace preview (0 = exact bbox). */
  CROP_PADDING_PERCENT: 0,

  /** Maximum review rounds before escalation. Override via MAX_REVIEW_ROUNDS env var. */
  MAX_REVIEW_ROUNDS: parseInt(process.env.MAX_REVIEW_ROUNDS ?? '3', 10) || 3,
} as const

// ---------------------------------------------------------------------------
// Compatibility shims — keep async signatures so callers need no changes
// ---------------------------------------------------------------------------

export async function getTaskLockMinutes(): Promise<number> {
  return APP_CONFIG.TASK_LOCK_MINUTES
}

export async function getAllowedScriptTags(): Promise<string[]> {
  return [...APP_CONFIG.ALLOWED_SCRIPT_TAGS]
}

export async function getCropPaddingPercent(): Promise<number> {
  return APP_CONFIG.CROP_PADDING_PERCENT
}

export async function getMaxReviewRounds(): Promise<number> {
  return APP_CONFIG.MAX_REVIEW_ROUNDS
}

/** No-op — kept for API compatibility. */
export function invalidateConfigCache(): void {}

export async function getConfig(key: keyof typeof APP_CONFIG): Promise<string | null> {
  const v = APP_CONFIG[key]
  return v !== undefined ? String(v) : null
}

export async function getConfigOrDefault(key: string, defaultValue: string): Promise<string> {
  const v = APP_CONFIG[key as keyof typeof APP_CONFIG]
  return v !== undefined ? String(v) : defaultValue
}

export async function getAllConfig(): Promise<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(APP_CONFIG).map(([k, v]) => [k, String(v)])
  )
}
