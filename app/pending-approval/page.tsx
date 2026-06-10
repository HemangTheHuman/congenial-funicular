import { auth } from '@/auth'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { Clock } from 'lucide-react'

export default async function PendingApprovalPage() {
  const session = await auth()
  const email = session?.user?.email ?? ''

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="space-y-3 pb-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900">
            <Clock className="h-7 w-7 text-yellow-600 dark:text-yellow-400" />
          </div>
          <CardTitle className="text-xl">Account Pending Approval</CardTitle>
          <CardDescription className="text-base">
            Your account has been created and is waiting for an administrator to
            assign you a role.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="rounded-md bg-muted px-4 py-2 text-sm font-medium text-muted-foreground">
            {email}
          </div>
          <p className="text-xs text-muted-foreground">
            Please contact your project administrator to get access.
            You can safely close this page and come back later.
          </p>
          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  )
}
