# Phase 1 — Developer Reference

> **Audience:** Developers picking up Phase 2 (Google Sheet Schema Helpers).  
> **Purpose:** Explains every decision, file, pattern, and convention established in Phase 1 so you can build on top of it without guessing.

---

## Table of Contents

1. [What Phase 1 Delivered](#1-what-phase-1-delivered)
2. [Updated Project Structure](#2-updated-project-structure)
3. [Critical Next.js 16 File Convention Changes](#3-critical-nextjs-16-file-convention-changes)
4. [Authentication — `auth.ts`](#4-authentication--authts)
5. [Route Protection — `proxy.ts`](#5-route-protection--proxyts)
6. [Session Usage in Server Components & API Routes](#6-session-usage-in-server-components--api-routes)
7. [Audit Logging — `lib/auditLog.ts`](#7-audit-logging--libauditlogts)
8. [Admin API Routes](#8-admin-api-routes)
9. [Server Actions — `app/actions/auth.ts`](#9-server-actions--appactionsauthts)
10. [UI Components — shadcn/ui](#10-ui-components--shadcnui)
11. [Page Structure](#11-page-structure)
12. [Updated Utilities](#12-updated-utilities)
13. [Key Conventions](#13-key-conventions)
14. [Known Gotchas & Bugs Fixed](#14-known-gotchas--bugs-fixed)
15. [What Phase 2 Needs to Add](#15-what-phase-2-needs-to-add)

---

## 1. What Phase 1 Delivered

- Full **email + password authentication** (register + login on one page, tab toggle)
- **next-auth v5 beta** Credentials provider backed by the `users` Google Sheet
- **7-day JWT sessions** — users stay logged in across browser sessions
- **`proxy.ts`** — edge-compatible route guard for `/admin`, `/labeler`, `/reviewer`
- **Admin user management** — full table at `/admin/users` with Approve / Assign Role / Disable
- **Audit logging** — `USER_LOGIN`, `USER_REGISTERED`, `ROLE_ASSIGNED`, `USER_DISABLED` written to the `audit_logs` sheet
- **Stub dashboards** for all three roles: `/admin`, `/labeler`, `/reviewer`
- **shadcn/ui** installed with 10 components

---

## 2. Updated Project Structure

```
congenial-funicular/
│
├── auth.ts                          # ⭐ NEW: next-auth v5 config (root level)
├── proxy.ts                         # ⭐ NEW: route protection (replaces middleware.ts)
│
├── app/
│   ├── actions/
│   │   └── auth.ts                  # ⭐ NEW: loginAction + registerAction Server Actions
│   ├── api/
│   │   ├── auth/[...nextauth]/
│   │   │   └── route.ts             # ⭐ NEW: next-auth catch-all handler
│   │   ├── admin/
│   │   │   ├── assign-role/route.ts # ⭐ NEW: POST — assign role to user
│   │   │   └── disable-user/route.ts# ⭐ NEW: POST — disable a user
│   │   ├── me/route.ts              # ⭐ NEW: GET — current session user
│   │   ├── health/route.ts          # Phase 0
│   │   └── test-sheet/route.ts      # Phase 0 (DEV ONLY)
│   ├── admin/
│   │   ├── page.tsx                 # ⭐ NEW: Admin landing dashboard
│   │   └── users/
│   │       ├── page.tsx             # ⭐ NEW: User management table (server component)
│   │       └── UserRoleActions.tsx  # ⭐ NEW: Role/disable buttons (client component)
│   ├── labeler/
│   │   └── page.tsx                 # ⭐ NEW: Stub dashboard
│   ├── login/
│   │   └── page.tsx                 # ⭐ REPLACED: Full login+register UI
│   ├── pending-approval/
│   │   └── page.tsx                 # ⭐ NEW: Waiting screen for unapproved users
│   ├── reviewer/
│   │   └── page.tsx                 # ⭐ NEW: Stub dashboard
│   ├── globals.css                  # Updated by shadcn (new CSS vars)
│   ├── layout.tsx                   # Restored to Inter font
│   └── page.tsx                     # Redirects to /login
│
├── components/
│   ├── auth/
│   │   ├── SignOutButton.tsx         # ⭐ NEW: Reusable sign-out form button
│   │   └── UserBadge.tsx            # ⭐ NEW: Name + email + role badge
│   └── ui/                          # ⭐ NEW: shadcn/ui components (10 total)
│       ├── alert.tsx
│       ├── badge.tsx
│       ├── button.tsx
│       ├── card.tsx
│       ├── input.tsx
│       ├── label.tsx
│       ├── select.tsx
│       ├── separator.tsx
│       ├── table.tsx
│       └── tabs.tsx
│
├── lib/
│   ├── auditLog.ts                  # ⭐ NEW: Audit log helper
│   ├── googleSheets.ts              # Phase 0
│   └── labelStudio.ts               # Phase 0
│
├── types/
│   ├── next-auth.d.ts               # ⭐ NEW: Session type augmentation
│   ├── user.ts                      # Phase 0
│   └── ...                          # Phase 0
│
└── utils/
    ├── ids.ts                       # ⭐ UPDATED: now uses globalThis.crypto
    └── ...                          # Phase 0
```

---

## 3. Critical Next.js 16 File Convention Changes

### `middleware.ts` → `proxy.ts`

In Next.js 16, `middleware.ts` is **deprecated**. The file must be named `proxy.ts` and the default export function must be named `proxy`.

```ts
// ❌ Old (Next.js < 16)
export default function middleware(req) { ... }

// ✅ New (Next.js 16)
export default function proxy(req) { ... }
// OR when wrapping with next-auth:
export default auth(function proxy(req) { ... })
```

The `config.matcher` export is unchanged.

### Proxy now runs on Node.js runtime by default

In Next.js 16, `proxy.ts` runs on the **Node.js runtime** by default (not Edge). This means:
- You CAN use `process.env` in proxy
- You CAN import Node.js built-in modules (with caution)
- No more `import { randomUUID } from 'crypto'` edge errors

### `utils/ids.ts` — Web Crypto API

The `generateId` function was updated from `import { randomUUID } from 'crypto'` to `globalThis.crypto.randomUUID()`. This works in all environments (Node.js, Edge, browser) without import overhead:

```ts
// ✅ Current implementation
export function generateId(prefix: IdPrefix): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '')}`
}
```

---

## 4. Authentication — `auth.ts`

**File:** [`auth.ts`](auth.ts) (project root)

Exports four named exports used throughout the app:

```ts
import { auth, signIn, signOut, handlers } from '@/auth'
```

| Export | Used where |
|---|---|
| `auth` | Server components, API routes — reads session |
| `signIn` | Server Actions — initiates login |
| `signOut` | Server Actions — clears session |
| `handlers` | `app/api/auth/[...nextauth]/route.ts` |

### Login flow

1. User submits email + password from the login form
2. `signIn('credentials', { email, password })` is called from a Server Action
3. The `authorize()` function in `auth.ts` runs on the server:
   - Looks up the user: `findRowByColumn('users', 'email', email)`
   - **If not found** → creates new row, assigns `PENDING_APPROVAL` status (or `ADMIN` if email is in `ADMIN_EMAILS`)
   - **If found + DISABLED** → returns `null` (login fails)
   - **If found** → bcrypt compares password, updates `last_login_at`, logs `USER_LOGIN`
4. On success, next-auth creates a **7-day JWT cookie** with `user_id`, `role`, `status`

### ADMIN_EMAILS seeding

When a user registers with an email listed in `ADMIN_EMAILS` env var, they are automatically assigned `role: ADMIN` and `status: ACTIVE` — no approval required. This is how the bootstrap admin account is created.

```ts
const adminEmails = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
const isAdmin = adminEmails.includes(email)
```

### Session JWT contents

The JWT cookie contains:

```ts
{
  user_id: string   // 'U_abc123...'
  role: UserRole    // 'ADMIN' | 'LABELER' | 'REVIEWER' | 'PENDING'
  status: UserStatus // 'ACTIVE' | 'PENDING_APPROVAL' | 'DISABLED'
  // standard next-auth fields: name, email, sub, iat, exp, jti
}
```

> **Important:** The JWT is signed with `NEXTAUTH_SECRET` and stored as an HTTP-only cookie. It is **never accessible to client-side JavaScript**.

### Type augmentation

[`types/next-auth.d.ts`](types/next-auth.d.ts) augments next-auth's built-in types so TypeScript knows about our custom session fields. You never need to cast `session.user` — `role`, `status`, and `user_id` are typed.

---

## 5. Route Protection — `proxy.ts`

**File:** [`proxy.ts`](proxy.ts) (project root)

Wraps `auth()` from next-auth to read the JWT session on every request.

### Protection rules

| Path | Requires | Redirects if fails |
|---|---|---|
| `/admin/*` | `role === 'ADMIN'` | → role dashboard |
| `/labeler/*` | `role === 'LABELER' \| 'ADMIN'` | → role dashboard |
| `/reviewer/*` | `role === 'REVIEWER' \| 'ADMIN'` | → role dashboard |
| `/pending-approval` | authenticated | → `/login` |
| `/login` | unauthenticated | → role dashboard |
| `/api/auth/*` | none | always pass-through |

### `dashboardFor(role)` helper

```ts
function dashboardFor(role?: string): string {
  switch (role) {
    case 'ADMIN':    return '/admin'
    case 'LABELER':  return '/labeler'
    case 'REVIEWER': return '/reviewer'
    default:         return '/pending-approval'
  }
}
```

### Matcher

```ts
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/health|api/test-sheet).*)',
  ],
}
```

Static assets and the health/test-sheet dev routes are excluded from the proxy.

---

## 6. Session Usage in Server Components & API Routes

### In server components (pages)

```ts
import { auth } from '@/auth'

export default async function MyPage() {
  const session = await auth()
  const user = session!.user  // safe to non-null assert inside protected pages

  return <div>Hello {user.name} — you are a {user.role}</div>
}
```

### In API routes

```ts
import { auth } from '@/auth'

export const GET = auth(async (req) => {
  const session = req.auth
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // req.auth.user is typed as our augmented User
  return Response.json({ user: req.auth.user })
})
```

### In Server Actions

```ts
'use server'
import { auth } from '@/auth'

export async function myAction() {
  const session = await auth()
  if (session?.user?.role !== 'ADMIN') throw new Error('Forbidden')
  // ...
}
```

---

## 7. Audit Logging — `lib/auditLog.ts`

**File:** [`lib/auditLog.ts`](lib/auditLog.ts)

Writes rows to the `audit_logs` Google Sheet. Failures are **caught and logged to console** — they never crash the main request.

### Usage

```ts
import { logAction } from '@/lib/auditLog'

await logAction(
  userEmail,   // string
  action,      // AuditAction (typed union)
  entityType,  // 'user' | 'task' | 'region' | 'label' | 'review' | 'system'
  entityId,    // the ID of the entity being acted on
  oldValue,    // optional: previous value (for change tracking)
  newValue,    // optional: new value
  metadata     // optional: Record<string, unknown> — serialized to JSON
)
```

### Defined actions (current)

```ts
type AuditAction =
  | 'USER_LOGIN' | 'USER_REGISTERED' | 'ROLE_ASSIGNED' | 'USER_DISABLED'
  | 'TASK_IMPORTED' | 'TASK_CLAIMED' | 'TASK_RELEASED'
  | 'REGION_LABELED' | 'REGION_REVIEWED' | 'REGION_CORRECTED'
  | 'TASK_FINAL_APPROVED'
  | 'SYNC_STARTED' | 'SYNC_FAILED' | 'SYNC_SUCCESS'
```

Add new actions here as later phases need them.

> **Rule:** Always call `logAction` from server-side code only (API routes, Server Actions, `auth.ts`). Never from client components.

---

## 8. Admin API Routes

Both routes require `session.user.role === 'ADMIN'` — they return `403` otherwise.

### `POST /api/admin/assign-role`

**File:** [`app/api/admin/assign-role/route.ts`](app/api/admin/assign-role/route.ts)

```ts
// Body
{ userId: string, role: 'LABELER' | 'REVIEWER' | 'ADMIN' }

// Response 200
{ message: 'Role assigned successfully', userId, role, status: 'ACTIVE' }
```

- Finds user row by `user_id` column
- Updates `role` and sets `status` to `ACTIVE`
- Logs `ROLE_ASSIGNED` to audit_logs

### `POST /api/admin/disable-user`

**File:** [`app/api/admin/disable-user/route.ts`](app/api/admin/disable-user/route.ts)

```ts
// Body
{ userId: string }

// Response 200
{ message: 'User disabled', userId }
```

- Prevents self-disable (returns 400 if `userId === session.user.user_id`)
- Sets `status` to `DISABLED`
- Logs `USER_DISABLED`

### `GET /api/me`

**File:** [`app/api/me/route.ts`](app/api/me/route.ts)

Returns the current session user as `SafeUser` (no `password_hash`). Returns `401` if unauthenticated.

---

## 9. Server Actions — `app/actions/auth.ts`

**File:** [`app/actions/auth.ts`](app/actions/auth.ts)

Uses the `useActionState` + Server Action pattern from the Next.js 16 auth guide.

### `loginAction(prevState, formData)`

```ts
import { loginAction } from '@/app/actions/auth'

// In a 'use client' component:
const [state, formAction, pending] = useActionState(loginAction, undefined)
```

Returns `{ error: string }` on failure. On success, redirects to `/` (proxy handles role-based routing).

### `registerAction(prevState, formData)`

```ts
import { registerAction } from '@/app/actions/auth'
```

- Validates: name (≥2 chars), email (valid format), password (≥8 chars)
- Checks for duplicate email before creating
- Creates user row directly in the `users` sheet (bypasses `auth.ts` authorize — avoids double-write)
- Calls `signIn('credentials', ...)` to sign in immediately after registration
- Returns `{ fieldErrors: { name?, email?, password? } }` on validation failure

### `signOutAction()`

```ts
import { signOutAction } from '@/app/actions/auth'

// In a form:
<form action={signOutAction}><button type="submit">Sign Out</button></form>
```

Calls `signOut({ redirectTo: '/login' })`.

### `AuthFormState` type

```ts
type AuthFormState = {
  error?: string
  fieldErrors?: { name?: string; email?: string; password?: string }
} | undefined
```

---

## 10. UI Components — shadcn/ui

**Installed:** shadcn v4.11.0, using `@base-ui/react` primitives.

> **Critical difference from standard shadcn:** This version uses `@base-ui/react/button` — the `Button` component does **NOT** support the `asChild` prop. Use `buttonVariants()` directly on a `<Link>` instead:
>
> ```tsx
> // ❌ Won't work — no asChild
> <Button asChild><Link href="/admin">Go</Link></Button>
>
> // ✅ Correct pattern
> import { buttonVariants } from '@/components/ui/button'
> <Link href="/admin" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Go</Link>
> ```

### Available components

All are in `components/ui/`:

| Component | Import | Usage |
|---|---|---|
| `Button` | `@/components/ui/button` | Action buttons, form submits |
| `buttonVariants` | `@/components/ui/button` | Apply button styling to `<Link>` |
| `Input` | `@/components/ui/input` | Text, email, password fields |
| `Card`, `CardHeader`, `CardTitle`, `CardContent`, `CardDescription` | `@/components/ui/card` | Content containers |
| `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | `@/components/ui/table` | Data tables |
| `Badge` | `@/components/ui/badge` | Status chips |
| `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue` | `@/components/ui/select` | Dropdown selectors |
| `Label` | `@/components/ui/label` | Form field labels |
| `Separator` | `@/components/ui/separator` | Horizontal/vertical dividers |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | `@/components/ui/tabs` | Tab navigation |
| `Alert`, `AlertDescription` | `@/components/ui/alert` | Error/info banners |

### Custom auth components

| Component | File | Purpose |
|---|---|---|
| `SignOutButton` | `components/auth/SignOutButton.tsx` | Client component that submits signOutAction |
| `UserBadge` | `components/auth/UserBadge.tsx` | Name + email + color-coded role badge |

---

## 11. Page Structure

### `/login`

`'use client'` page. Login and Register tabs on the same page using `useActionState`.

### `/pending-approval`

Server component. Reads session to show the user's email. Has a `SignOutButton`.

### `/admin`

Server component (requires `role: ADMIN` via proxy). Navigation cards to sub-sections. Items for phases not yet built are shown as disabled.

### `/admin/users`

- **Server component** (`export const dynamic = 'force-dynamic'`) — fetches all users from the `users` sheet on every request
- Sorts: `PENDING_APPROVAL` first, then `ACTIVE`, then `DISABLED`
- Each row has a **`UserRoleActions`** client component for role/disable buttons
- `UserRoleActions` calls `/api/admin/assign-role` or `/api/admin/disable-user` then `router.refresh()` to re-fetch the table without a full page reload

### `/labeler` and `/reviewer`

Stub server components. Will be replaced in Phases 4 and 7 respectively.

---

## 12. Updated Utilities

### `utils/ids.ts` — `generateId(prefix)`

No change to the API. Implementation changed to use Web Crypto API:

```ts
generateId('U')   // → 'U_4a3f2c8b1d...'  (user)
generateId('AL')  // → 'AL_...'            (audit log)
// etc.
```

Works in all environments without imports.

---

## 13. Key Conventions

### Security: never expose password_hash

The `User` type (in `types/user.ts`) includes `password_hash`. The `SafeUser` type (`Omit<User, 'password_hash'>`) is what you return from API routes. The session JWT contains **no** password hash — only `user_id`, `email`, `name`, `role`, `status`.

### Checking roles in API routes

Always check role from the JWT session, not from the Sheet:

```ts
// ✅ Fast — reads from the JWT cookie, no Sheet call
const session = req.auth
if (session?.user?.role !== 'ADMIN') return Response.json(..., { status: 403 })

// ❌ Slow — unnecessary Sheet read
const userFromSheet = await findRowByColumn('users', 'user_id', session.user.user_id)
if (userFromSheet?.row.role !== 'ADMIN') ...
```

The JWT is refreshed every time the user logs in. Role changes in the Sheet take effect on the user's **next login**.

### Route handler auth pattern

```ts
export const POST = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  // ...
})
```

### `force-dynamic` on data routes

All routes that read from Google Sheets must export:

```ts
export const dynamic = 'force-dynamic'
```

This prevents Next.js from caching the response.

---

## 14. Known Gotchas & Bugs Fixed

### `middleware.ts` → `proxy.ts` (Next.js 16)

If you see the warning `The "middleware" file convention is deprecated`, the file must be renamed `proxy.ts` and the function renamed to `proxy`. The codemod is:

```bash
npx @next/codemod@canary middleware-to-proxy .
```

### `import { randomUUID } from 'crypto'` breaks the proxy bundle

Any file imported (transitively) into `proxy.ts` must not use Node.js-only modules. Use `globalThis.crypto.randomUUID()` instead, which is the Web Crypto API and works everywhere.

### shadcn v4 `Button` has no `asChild`

This shadcn version uses `@base-ui/react/button` which doesn't support the Slot/`asChild` pattern. Use `buttonVariants()` on a `<Link>` directly (see Section 10).

### shadcn `init` overwrites `layout.tsx`

shadcn's `init` command modifies `layout.tsx` to add Geist font. After running `npx shadcn init`, you must restore `layout.tsx` to your setup (Inter font, no `cn()` import). Our current `layout.tsx` is correct.

### JWT role is stale after admin changes it

When an admin changes a user's role via `/api/admin/assign-role`, the change is written to the Sheet immediately. However, the affected user's **JWT cookie still holds the old role** until they log out and log back in. This is by design for a JWT-stateless session — just document this for users.

---

## 15. What Phase 2 Needs to Add

Phase 2 — Google Sheet Schema Helpers — builds data access utilities on top of the auth and Sheets infrastructure established in Phases 0 and 1.

### Recommended additions

```
lib/users.ts        # getUserById, getUserByEmail, updateUserField helpers
lib/tasks.ts        # getTask, listTasks, claimTask, releaseTask helpers
lib/regions.ts      # getRegionsByTask, createRegion, updateRegion helpers
lib/labels.ts       # getLabelsByRegion, createLabel, updateLabel helpers
lib/reviews.ts      # getReviewsByRegion, createReview helpers
lib/statusTransitions.ts  # validateAndApplyTransition() — enforces allowed status changes
```

### Pattern to follow

Wrap the raw `readSheetAsObjects` / `appendRow` / `updateRow` from `lib/googleSheets.ts` in typed, domain-specific helpers. Each helper should:
- Return typed domain objects (using `types/` interfaces), not raw `Record<string, string>`
- Parse string values from sheets into the correct types (numbers, booleans, dates)
- Include a typed `row → entity` deserializer function

Example pattern:

```ts
// lib/tasks.ts
import { findRowByColumn, updateRow } from '@/lib/googleSheets'
import type { Task, TaskStatus } from '@/types/task'

function rowToTask(row: Record<string, string>): Task {
  return {
    task_id: row.task_id,
    ls_task_id: row.ls_task_id,
    status: row.status as TaskStatus,
    region_count: parseInt(row.region_count, 10),
    // ...
  }
}

export async function getTaskById(taskId: string): Promise<Task | null> {
  const result = await findRowByColumn('tasks', 'task_id', taskId)
  return result ? rowToTask(result.row) : null
}
```

### Status transition validation

Phase 2 should implement a `validateAndApplyTransition` helper that enforces the allowed status transitions defined in the README (e.g., a task can only move from `READY_FOR_LABELING` → `LABELING_IN_PROGRESS`, not backwards). This prevents data corruption from concurrent updates.

---

*Document generated after Phase 1 completion — 2026-06-10*
