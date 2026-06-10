import { auth } from '@/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { UserBadge } from '@/components/auth/UserBadge'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { Separator } from '@/components/ui/separator'
import { CheckSquare } from 'lucide-react'
import type { UserRole } from '@/types/user'

export default async function ReviewerDashboardPage() {
  const session = await auth()
  const user = session!.user

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <h1 className="text-xl font-bold">Reviewer Dashboard</h1>
          <div className="flex items-center gap-4">
            <UserBadge name={user.name ?? ''} email={user.email ?? ''} role={user.role as UserRole} />
            <Separator orientation="vertical" className="h-8" />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Card className="max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckSquare className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Review Queue</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Review queue coming in Phase 7.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
