export type UserRole = 'PENDING' | 'ADMIN' | 'LABELER' | 'REVIEWER'

export type UserStatus = 'ACTIVE' | 'PENDING_APPROVAL' | 'DISABLED'

export interface User {
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
}

/** Shape returned to client — never includes password_hash */
export type SafeUser = Omit<User, 'password_hash'>
