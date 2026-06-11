import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { logAction } from '@/lib/auditLog'
import { generateId } from '@/utils/ids'
import { nowISO } from '@/utils/date'
import type { UserRole, UserStatus } from '@/types/user'

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email    = (credentials?.email    as string | undefined)?.toLowerCase().trim()
        const password =  credentials?.password as string | undefined

        if (!email || !password) return null

        const res = await db.execute({
          sql:  'SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
          args: [email],
        })

        // ── New user: register on first login ────────────────────────────────
        if (res.rows.length === 0) {
          const adminEmails = (process.env.ADMIN_EMAILS ?? '')
            .split(',').map((e) => e.trim().toLowerCase())
          const isAdmin = adminEmails.includes(email)

          const role:   UserRole   = isAdmin ? 'ADMIN'  : 'PENDING'
          const status: UserStatus = isAdmin ? 'ACTIVE' : 'PENDING_APPROVAL'
          const password_hash = await bcrypt.hash(password, 12)
          const now     = nowISO()
          const user_id = generateId('U')

          await db.execute({
            sql: `INSERT INTO users
                    (user_id, email, name, password_hash, role, status,
                     assigned_batch, created_at, updated_at, last_login_at, notes)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            args: [
              user_id, email, email.split('@')[0], password_hash,
              role, status, '', now, now, now, '',
            ],
          })

          await logAction(email, 'USER_REGISTERED', 'user', user_id, '', role)
          await logAction(email, 'USER_LOGIN',      'user', user_id)

          return { id: user_id, user_id, email, name: email.split('@')[0], role, status }
        }

        // ── Existing user ────────────────────────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = res.rows[0] as Record<string, any>

        if (row.status === 'DISABLED') return null

        const passwordOk = await bcrypt.compare(password, String(row.password_hash))
        if (!passwordOk) return null

        const now = nowISO()
        await db.execute({
          sql:  'UPDATE users SET updated_at = ?, last_login_at = ? WHERE user_id = ?',
          args: [now, now, row.user_id],
        })

        await logAction(email, 'USER_LOGIN', 'user', String(row.user_id))

        return {
          id:      String(row.user_id),
          user_id: String(row.user_id),
          email:   String(row.email),
          name:    String(row.name),
          role:    String(row.role)   as UserRole,
          status:  String(row.status) as UserStatus,
        }
      },
    }),
  ],

  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.user_id = (user as unknown as { user_id: string }).user_id
        token.role    = (user as unknown as { role: UserRole }).role
        token.status  = (user as unknown as { status: UserStatus }).status
      }
      return token
    },
    session({ session, token }) {
      session.user.user_id = token.user_id as string
      session.user.role    = token.role    as UserRole
      session.user.status  = token.status  as UserStatus
      return session
    },
  },

  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },

  pages: {
    signIn: '/login',
    error:  '/login',
  },
})
