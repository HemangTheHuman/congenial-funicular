'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useRouter } from 'next/navigation'
import type { UserRole, UserStatus } from '@/types/user'

interface UserRoleActionsProps {
  userId: string
  currentRole: UserRole
  currentStatus: UserStatus
}

export function UserRoleActions({ userId, currentRole, currentStatus }: UserRoleActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectedRole, setSelectedRole] = useState<UserRole>(
    currentRole === 'PENDING' ? 'LABELER' : currentRole
  )
  const [error, setError] = useState<string | null>(null)

  async function handleAssignRole() {
    setError(null)
    const res = await fetch('/api/admin/assign-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role: selectedRole }),
    })
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to assign role')
      return
    }
    startTransition(() => router.refresh())
  }

  async function handleDisable() {
    setError(null)
    const res = await fetch('/api/admin/disable-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to disable user')
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <Select
          value={selectedRole}
          onValueChange={(v) => setSelectedRole(v as UserRole)}
          disabled={isPending || currentStatus === 'DISABLED'}
        >
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="LABELER">Labeler</SelectItem>
            <SelectItem value="REVIEWER">Reviewer</SelectItem>
            <SelectItem value="ADMIN">Admin</SelectItem>
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={handleAssignRole}
          disabled={isPending || currentStatus === 'DISABLED'}
        >
          {currentStatus === 'PENDING_APPROVAL' ? 'Approve' : 'Assign'}
        </Button>

        {currentStatus !== 'DISABLED' && (
          <Button
            size="sm"
            variant="destructive"
            className="h-8 text-xs"
            onClick={handleDisable}
            disabled={isPending}
          >
            Disable
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
