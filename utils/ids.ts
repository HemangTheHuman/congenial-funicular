type IdPrefix = 'U' | 'T' | 'RG' | 'LB' | 'RV' | 'SQ' | 'AL'

/** Generate a prefixed unique ID using the Web Crypto API (works in Node.js, Edge, and browser) */
export function generateId(prefix: IdPrefix): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '')}`
}
