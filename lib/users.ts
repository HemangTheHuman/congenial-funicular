/**
 * lib/users.ts — Read-only user helpers.
 *
 * WRITE PATH: auth.ts and app/actions/auth.ts own all writes to the users sheet.
 * This file provides read-only access for admin pages and API routes.
 * Never import auth.ts here — it would create a circular dependency.
 */
import { readSheetAsObjects, findRowByColumn } from '@/lib/googleSheets'
import type { User, SafeUser, UserRole, UserStatus } from '@/types/user'

// ---------------------------------------------------------------------------
// Deserialiser
// ---------------------------------------------------------------------------

function rowToUser(row: Record<string, string>): User {
  return {
    user_id:        row.user_id,
    email:          row.email,
    name:           row.name,
    password_hash:  row.password_hash,
    role:           row.role as UserRole,
    status:         row.status as UserStatus,
    assigned_batch: row.assigned_batch,
    created_at:     row.created_at,
    updated_at:     row.updated_at,
    last_login_at:  row.last_login_at,
    notes:          row.notes,
  }
}

function toSafeUser(u: User): SafeUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash, ...safe } = u
  return safe
}

// ---------------------------------------------------------------------------
// Public API (read-only)
// ---------------------------------------------------------------------------

/** Returns a SafeUser (no password_hash) by user_id, or null if not found. */
export async function getUserById(userId: string): Promise<SafeUser | null> {
  const result = await findRowByColumn('users', 'user_id', userId)
  return result ? toSafeUser(rowToUser(result.row)) : null
}

/** Returns a SafeUser by email (case-insensitive lookup), or null if not found. */
export async function getUserByEmail(email: string): Promise<SafeUser | null> {
  const result = await findRowByColumn('users', 'email', email.toLowerCase())
  return result ? toSafeUser(rowToUser(result.row)) : null
}

/** Returns all users as SafeUser[]. Sorted alphabetically by email. */
export async function listAllUsers(): Promise<SafeUser[]> {
  const rows = await readSheetAsObjects('users')
  return rows
    .map((r) => toSafeUser(rowToUser(r)))
    .sort((a, b) => a.email.localeCompare(b.email))
}

/** Returns only users with the given status. */
export async function listUsersByStatus(status: UserStatus): Promise<SafeUser[]> {
  const all = await listAllUsers()
  return all.filter((u) => u.status === status)
}

/** Returns only users with the given role. */
export async function listUsersByRole(role: UserRole): Promise<SafeUser[]> {
  const all = await listAllUsers()
  return all.filter((u) => u.role === role)
}
