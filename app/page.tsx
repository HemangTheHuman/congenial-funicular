import { redirect } from 'next/navigation'

/**
 * Root page — redirects to /login.
 * Will be replaced in Phase 1 with real auth-aware routing.
 */
export default function RootPage() {
  redirect('/login')
}
