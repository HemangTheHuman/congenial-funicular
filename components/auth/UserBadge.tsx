import { Badge } from '@/components/ui/badge'
import type { UserRole } from '@/types/user'

const roleColors: Record<UserRole, string> = {
  ADMIN: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  LABELER: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  REVIEWER: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
}

interface UserBadgeProps {
  name: string
  email: string
  role: UserRole
}

export function UserBadge({ name, email, role }: UserBadgeProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium leading-none">{name}</span>
        <span className="text-xs text-muted-foreground">{email}</span>
      </div>
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${roleColors[role]}`}
      >
        {role}
      </span>
    </div>
  )
}
