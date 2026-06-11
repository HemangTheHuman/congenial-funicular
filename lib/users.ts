/**
 * lib/users.ts — SQL rewrite (Turso)
 *
 * Read-only user helpers.
 * WRITE PATH: auth.ts and app/actions/auth.ts own all writes to the users table.
 * Never import auth.ts here — circular dependency.
 */
import { db } from '@/lib/db'
import type { User, SafeUser, UserRole, UserStatus } from '@/types/user'

// ---------------------------------------------------------------------------
// Deserialiser
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToUser(row: Record<string, any>): User {
  return {
    user_id:        String(row.user_id ?? ''),
    email:          String(row.email ?? ''),
    name:           String(row.name ?? ''),
    password_hash:  String(row.password_hash ?? ''),
    role:           String(row.role ?? 'PENDING') as UserRole,
    status:         String(row.status ?? 'PENDING_APPROVAL') as UserStatus,
    assigned_batch: String(row.assigned_batch ?? ''),
    created_at:     String(row.created_at ?? ''),
    updated_at:     String(row.updated_at ?? ''),
    last_login_at:  String(row.last_login_at ?? ''),
    notes:          String(row.notes ?? ''),
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
  const res = await db.execute({
    sql:  'SELECT * FROM users WHERE user_id = ? LIMIT 1',
    args: [userId],
  })
  if (res.rows.length === 0) return null
  return toSafeUser(rowToUser(res.rows[0]))
}

/** Returns a SafeUser by email (case-insensitive lookup), or null if not found. */
export async function getUserByEmail(email: string): Promise<SafeUser | null> {
  const res = await db.execute({
    sql:  'SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
    args: [email],
  })
  if (res.rows.length === 0) return null
  return toSafeUser(rowToUser(res.rows[0]))
}

/** Returns all users as SafeUser[]. Sorted alphabetically by email. */
export async function listAllUsers(): Promise<SafeUser[]> {
  const res = await db.execute('SELECT * FROM users ORDER BY email ASC')
  return res.rows.map((r) => toSafeUser(rowToUser(r)))
}

/** Returns only users with the given status. */
export async function listUsersByStatus(status: UserStatus): Promise<SafeUser[]> {
  const res = await db.execute({
    sql:  'SELECT * FROM users WHERE status = ? ORDER BY email ASC',
    args: [status],
  })
  return res.rows.map((r) => toSafeUser(rowToUser(r)))
}

/** Returns only users with the given role. */
export async function listUsersByRole(role: UserRole): Promise<SafeUser[]> {
  const res = await db.execute({
    sql:  'SELECT * FROM users WHERE role = ? ORDER BY email ASC',
    args: [role],
  })
  return res.rows.map((r) => toSafeUser(rowToUser(r)))
}
