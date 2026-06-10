import type { UserRole, UserStatus } from '@/types/user'

declare module 'next-auth' {
  interface Session {
    user: {
      user_id: string
      email: string
      name: string
      role: UserRole
      status: UserStatus
    }
  }

  interface User {
    user_id: string
    email: string
    name: string
    role: UserRole
    status: UserStatus
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    user_id: string
    role: UserRole
    status: UserStatus
  }
}
