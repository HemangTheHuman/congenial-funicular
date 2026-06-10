'use client'

import { signOutAction } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button variant="outline" size="sm" type="submit">
        <LogOut className="mr-2 h-4 w-4" />
        Sign Out
      </Button>
    </form>
  )
}
