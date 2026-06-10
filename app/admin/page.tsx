import { auth } from '@/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { UserBadge } from '@/components/auth/UserBadge'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Users, FileText, RefreshCw, BarChart3 } from 'lucide-react'
import Link from 'next/link'
import type { UserRole } from '@/types/user'

export default async function AdminDashboardPage() {
  const session = await auth()
  const user = session!.user

  const navItems = [
    { href: '/admin/users', label: 'User Management', description: 'Approve users and assign roles', icon: Users },
    { href: '/admin/import', label: 'Import Tasks', description: 'Import Label Studio tasks (Phase 3)', icon: FileText, disabled: true },
    { href: '/admin/sync', label: 'Sync Queue', description: 'Manage Label Studio writeback (Phase 11)', icon: RefreshCw, disabled: true },
    { href: '/admin/analytics', label: 'Analytics', description: 'Quality and productivity stats (Phase 12)', icon: BarChart3, disabled: true },
  ]

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card px-6 py-4">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground">Kaithi Labeling App</p>
          </div>
          <div className="flex items-center gap-4">
            <UserBadge name={user.name ?? ''} email={user.email ?? ''} role={user.role as UserRole} />
            <Separator orientation="vertical" className="h-8" />
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <Card
                key={item.href}
                className={item.disabled ? 'opacity-50' : 'hover:shadow-md transition-shadow'}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">{item.label}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                  {item.disabled ? (
                    <Button variant="outline" size="sm" disabled className="w-full">
                      Coming soon
                    </Button>
                  ) : (
                    <Link
                      href={item.href}
                      className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' w-full justify-center'}
                    >
                      Open →
                    </Link>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </main>
    </div>
  )
}
