import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { findRowByColumn, appendRow, updateRow } from '@/lib/googleSheets'
import { logAction } from '@/lib/auditLog'
import { generateId } from '@/utils/ids'
import { nowISO } from '@/utils/date'
import type { UserRole, UserStatus } from '@/types/user'

// Column order for the users sheet:
// user_id | email | name | password_hash | role | status | assigned_batch |
// created_at | updated_at | last_login_at | notes
function rowToValues(r: {
  user_id: string
  email: string
  name: string
  password_hash: string
  role: UserRole
  status: UserStatus
  assigned_batch: string
  created_at: string
  updated_at: string
  last_login_at: string
  notes: string
}) {
  return [
    r.user_id, r.email, r.name, r.password_hash,
    r.role, r.status, r.assigned_batch,
    r.created_at, r.updated_at, r.last_login_at, r.notes,
  ]
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = (credentials?.email as string | undefined)?.toLowerCase().trim()
        const password = credentials?.password as string | undefined

        if (!email || !password) return null

        const existing = await findRowByColumn('users', 'email', email)

        // ── New user: register on first login ──────────────────────────
        if (!existing) {
          const adminEmails = (process.env.ADMIN_EMAILS ?? '')
            .split(',')
            .map((e) => e.trim().toLowerCase())
          const isAdmin = adminEmails.includes(email)

          const role: UserRole = isAdmin ? 'ADMIN' : 'PENDING'
          const status: UserStatus = isAdmin ? 'ACTIVE' : 'PENDING_APPROVAL'
          const password_hash = await bcrypt.hash(password, 12)
          const now = nowISO()
          const user_id = generateId('U')

          await appendRow('users', rowToValues({
            user_id, email,
            name: email.split('@')[0], // placeholder; register form will provide real name
            password_hash, role, status,
            assigned_batch: '',
            created_at: now, updated_at: now, last_login_at: now, notes: '',
          }))

          await logAction(email, 'USER_REGISTERED', 'user', user_id, '', role)
          await logAction(email, 'USER_LOGIN', 'user', user_id)

          return { id: user_id, user_id, email, name: email.split('@')[0], role, status }
        }

        // ── Existing user ──────────────────────────────────────────────
        const { row, rowNumber } = existing

        if (row.status === 'DISABLED') return null

        const passwordOk = await bcrypt.compare(password, row.password_hash)
        if (!passwordOk) return null

        const now = nowISO()
        await updateRow('users', rowNumber, rowToValues({
          user_id: row.user_id,
          email: row.email,
          name: row.name,
          password_hash: row.password_hash,
          role: row.role as UserRole,
          status: row.status as UserStatus,
          assigned_batch: row.assigned_batch,
          created_at: row.created_at,
          updated_at: now,
          last_login_at: now,
          notes: row.notes,
        }))

        await logAction(email, 'USER_LOGIN', 'user', row.user_id)

        return {
          id: row.user_id,
          user_id: row.user_id,
          email: row.email,
          name: row.name,
          role: row.role as UserRole,
          status: row.status as UserStatus,
        }
      },
    }),
  ],

  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.user_id = (user as unknown as { user_id: string }).user_id
        token.role = (user as unknown as { role: UserRole }).role
        token.status = (user as unknown as { status: UserStatus }).status
      }
      return token
    },
    session({ session, token }) {
      session.user.user_id = token.user_id as string
      session.user.role = token.role as UserRole
      session.user.status = token.status as UserStatus
      return session
    },
  },

  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },
})
