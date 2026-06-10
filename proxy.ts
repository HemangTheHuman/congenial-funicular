import { auth } from '@/auth'
import { NextResponse } from 'next/server'
import type { NextAuthRequest } from 'next-auth'

/**
 * Route protection proxy (Next.js 16 — replaces middleware.ts).
 * Runs on Node.js runtime by default in Next.js 16.
 *
 * Rules:
 *  /admin/*          → ADMIN only
 *  /labeler/*        → LABELER or ADMIN
 *  /reviewer/*       → REVIEWER or ADMIN
 *  /pending-approval → any authenticated user
 *  /login            → redirect to dashboard if already logged in
 */
export default auth(function proxy(req: NextAuthRequest) {
  const { nextUrl } = req
  const session = req.auth
  const user = session?.user

  const isAuthenticated = !!user
  const role = user?.role
  const status = user?.status
  const path = nextUrl.pathname

  // ── Public paths — always allow ─────────────────────────────────────
  if (path.startsWith('/api/auth')) return NextResponse.next()

  // ── Unauthenticated ──────────────────────────────────────────────────
  if (!isAuthenticated) {
    if (path.startsWith('/login')) return NextResponse.next()
    return NextResponse.redirect(new URL('/login', nextUrl.origin))
  }

  // ── Pending approval ─────────────────────────────────────────────────
  if (status === 'PENDING_APPROVAL') {
    if (path.startsWith('/pending-approval')) return NextResponse.next()
    return NextResponse.redirect(new URL('/pending-approval', nextUrl.origin))
  }

  // ── Disabled — sign out ──────────────────────────────────────────────
  if (status === 'DISABLED') {
    return NextResponse.redirect(new URL('/api/auth/signout', nextUrl.origin))
  }

  // ── Already logged in — bounce away from /login ──────────────────────
  if (path.startsWith('/login')) {
    return NextResponse.redirect(new URL(dashboardFor(role), nextUrl.origin))
  }

  // ── Role-gated routes ────────────────────────────────────────────────
  if (path.startsWith('/admin') && role !== 'ADMIN') {
    return NextResponse.redirect(new URL(dashboardFor(role), nextUrl.origin))
  }
  if (path.startsWith('/labeler') && role !== 'LABELER' && role !== 'ADMIN') {
    return NextResponse.redirect(new URL(dashboardFor(role), nextUrl.origin))
  }
  if (path.startsWith('/reviewer') && role !== 'REVIEWER' && role !== 'ADMIN') {
    return NextResponse.redirect(new URL(dashboardFor(role), nextUrl.origin))
  }

  return NextResponse.next()
})

function dashboardFor(role: string | undefined): string {
  switch (role) {
    case 'ADMIN':    return '/admin'
    case 'LABELER':  return '/labeler'
    case 'REVIEWER': return '/reviewer'
    default:         return '/pending-approval'
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/health|api/test-sheet).*)',
  ],
}
