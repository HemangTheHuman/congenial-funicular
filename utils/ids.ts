import { randomUUID } from 'crypto'

type IdPrefix = 'U' | 'T' | 'RG' | 'LB' | 'RV' | 'SQ' | 'AL'

/**
 * Generates a collision-resistant ID with a typed prefix.
 * e.g. generateId('T') => 'T_a3f2c...'
 */
export function generateId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`
}
