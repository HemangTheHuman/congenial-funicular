'use server'

import { signIn, signOut } from '@/auth'
import { AuthError } from 'next-auth'
import { db } from '@/lib/db'
import { logAction } from '@/lib/auditLog'
import { generateId } from '@/utils/ids'
import { nowISO } from '@/utils/date'
import bcrypt from 'bcryptjs'
import type { UserRole, UserStatus } from '@/types/user'
import { redirect } from 'next/navigation'

export type AuthFormState = {
  error?: string
  fieldErrors?: { name?: string; email?: string; password?: string }
} | undefined

// ── Login ──────────────────────────────────────────────────────────────────

export async function loginAction(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email    = (formData.get('email')    as string | null)?.trim().toLowerCase()
  const password =  formData.get('password') as string | null

  if (!email || !password) {
    return { error: 'Email and password are required.' }
  }

  try {
    await signIn('credentials', { email, password, redirect: false })
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.type === 'CredentialsSignin') {
        return { error: 'Invalid email or password.' }
      }
      return { error: 'Something went wrong. Please try again.' }
    }
    throw err
  }

  redirect('/')
}

// ── Register ───────────────────────────────────────────────────────────────

export async function registerAction(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const name     = (formData.get('name')     as string | null)?.trim()
  const email    = (formData.get('email')    as string | null)?.trim().toLowerCase()
  const password =  formData.get('password') as string | null

  const fieldErrors: NonNullable<AuthFormState>['fieldErrors'] = {}
  if (!name || name.length < 2) fieldErrors.name = 'Name must be at least 2 characters.'
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fieldErrors.email = 'Please enter a valid email address.'
  if (!password || password.length < 8)
    fieldErrors.password = 'Password must be at least 8 characters.'

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  // Check if email already registered
  const existing = await db.execute({
    sql:  'SELECT user_id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
    args: [email!],
  })
  if (existing.rows.length > 0) {
    return { fieldErrors: { email: 'This email is already registered. Please log in.' } }
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',').map((e) => e.trim().toLowerCase())
  const isAdmin = adminEmails.includes(email!)

  const role:   UserRole   = isAdmin ? 'ADMIN'  : 'PENDING'
  const status: UserStatus = isAdmin ? 'ACTIVE' : 'PENDING_APPROVAL'
  const password_hash = await bcrypt.hash(password!, 12)
  const now     = nowISO()
  const user_id = generateId('U')

  await db.execute({
    sql: `INSERT INTO users
            (user_id, email, name, password_hash, role, status,
             assigned_batch, created_at, updated_at, last_login_at, notes)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [user_id, email!, name!, password_hash, role, status, '', now, now, '', ''],
  })

  await logAction(email!, 'USER_REGISTERED', 'user', user_id, '', role)

  try {
    await signIn('credentials', { email, password, redirect: false })
  } catch {
    redirect('/login')
  }

  redirect('/')
}

// ── Sign Out ───────────────────────────────────────────────────────────────

export async function signOutAction() {
  await signOut({ redirectTo: '/login' })
}
