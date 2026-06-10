/** Returns the current timestamp as an ISO 8601 string */
export function nowISO(): string {
  return new Date().toISOString()
}

/**
 * Returns a new date string with `minutes` added to `dateStr`.
 * @param dateStr - ISO 8601 date string
 * @param minutes - Number of minutes to add
 */
export function addMinutes(dateStr: string, minutes: number): string {
  const date = new Date(dateStr)
  date.setMinutes(date.getMinutes() + minutes)
  return date.toISOString()
}

/**
 * Returns true if the given ISO date string is in the past.
 * Returns true for empty/invalid strings (treat missing lock as expired).
 */
export function isExpired(dateStr: string | null | undefined): boolean {
  if (!dateStr) return true
  return new Date(dateStr) < new Date()
}
