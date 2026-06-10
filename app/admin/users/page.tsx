import { auth } from '@/auth'
import { readSheetAsObjects } from '@/lib/googleSheets'
import { UserBadge } from '@/components/auth/UserBadge'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { Separator } from '@/components/ui/separator'
import { buttonVariants } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { UserRoleActions } from './UserRoleActions'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { UserRole, UserStatus } from '@/types/user'

const statusColors: Record<UserStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  PENDING_APPROVAL: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  DISABLED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  const session = await auth()
  const currentUser = session!.user

  const users = await readSheetAsObjects('users')
  // Sort: pending first, then active, then disabled
  const sorted = [...users].sort((a, b) => {
    const order: Record<string, number> = { PENDING_APPROVAL: 0, ACTIVE: 1, DISABLED: 2 }
    return (order[a.status] ?? 9) - (order[b.status] ?? 9)
  })

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card px-6 py-4">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />Admin
            </Link>
            <Separator orientation="vertical" className="h-6" />
            <div>
              <h1 className="text-xl font-bold">User Management</h1>
              <p className="text-sm text-muted-foreground">{sorted.length} user(s)</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <UserBadge name={currentUser.name ?? ''} email={currentUser.email ?? ''} role={currentUser.role as UserRole} />
            <Separator orientation="vertical" className="h-8" />
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Table */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No users yet.
                  </TableCell>
                </TableRow>
              )}
              {sorted.map((user) => (
                <TableRow key={user.user_id}>
                  <TableCell className="font-medium">{user.name || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    <span className="text-xs font-semibold">{user.role}</span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColors[user.status as UserStatus]}`}>
                      {user.status.replace('_', ' ')}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {user.last_login_at
                      ? new Date(user.last_login_at).toLocaleDateString()
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {user.user_id !== currentUser.user_id ? (
                      <UserRoleActions
                        userId={user.user_id}
                        currentRole={user.role as UserRole}
                        currentStatus={user.status as UserStatus}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground italic">You</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  )
}
