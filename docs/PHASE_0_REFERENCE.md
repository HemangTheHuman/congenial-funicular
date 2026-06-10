# Phase 0 — Developer Reference

> **Audience:** Developers picking up Phase 1 (Authentication & User Roles).  
> **Purpose:** Explains every decision, file, pattern, and convention established in Phase 0 so you can build on top of it without guessing.

---

## Table of Contents

1. [Stack & Versions](#1-stack--versions)
2. [Project Structure](#2-project-structure)
3. [Environment Variables](#3-environment-variables)
4. [Google Sheets Library](#4-google-sheets-library)
5. [Label Studio Library](#5-label-studio-library)
6. [TypeScript Types](#6-typescript-types)
7. [Utility Functions](#7-utility-functions)
8. [API Routes](#8-api-routes)
9. [App Layout & Styling](#9-app-layout--styling)
10. [Scripts](#10-scripts)
11. [Key Conventions](#11-key-conventions)
12. [What Phase 1 Needs to Add](#12-what-phase-1-needs-to-add)

---

## 1. Stack & Versions

| Technology | Version | Notes |
|---|---|---|
| Next.js | 16.2.9 | App Router, Turbopack in dev |
| React | 19.2.4 | |
| TypeScript | 5.x | strict mode enabled |
| Tailwind CSS | 4.x | new `@import "tailwindcss"` syntax |
| googleapis | 173.x | Google Sheets access via service account |
| next-auth | 5.0.0-beta.31 | Credentials provider — **not yet configured, Phase 1 work** |
| bcryptjs | 3.x | Password hashing — **not yet used, Phase 1 work** |
| tsx | 4.x | Dev-only: runs the provisioning script |

> **Important:** This is Next.js **16**, not 13/14/15. Always read  
> `node_modules/next/dist/docs/` before writing any Next.js-specific code.  
> `params` in route handlers is a **Promise** — always `await params`.

---

## 2. Project Structure

```
congenial-funicular/
│
├── app/                        # Next.js App Router
│   ├── api/
│   │   ├── health/route.ts     # Tests Sheets + LS connections
│   │   └── test-sheet/route.ts # DEV ONLY — read/write smoke test
│   ├── login/page.tsx          # Stub — Phase 1 replaces this
│   ├── globals.css             # Design tokens + base styles
│   ├── layout.tsx              # Root layout (Inter font, metadata)
│   └── page.tsx                # Redirects to /login
│
├── lib/
│   ├── googleSheets.ts         # Google Sheets CRUD client
│   └── labelStudio.ts          # Label Studio API client
│
├── types/
│   ├── user.ts                 # User, UserRole, UserStatus
│   ├── task.ts                 # Task, TaskStatus, SyncStatus
│   ├── region.ts               # Region, RegionStatus
│   ├── label.ts                # Label, LabelSyncState
│   └── review.ts               # Review, ReviewStatus
│
├── utils/
│   ├── ids.ts                  # generateId(prefix)
│   ├── date.ts                 # nowISO, addMinutes, isExpired
│   └── bbox.ts                 # percentToPixels
│
├── scripts/
│   └── provision-sheet.ts      # One-off Google Sheet setup (already run)
│
├── .env.local                  # Real credentials (git-ignored)
├── .env.local.example          # Template — commit this, not .env.local
├── next.config.ts
├── tsconfig.json               # strict, paths: @/* → ./
└── package.json
```

---

## 3. Environment Variables

All vars are documented in [`.env.local.example`](.env.local.example).  
The real `.env.local` is git-ignored. Never commit it.

### Variables used in Phase 0

| Variable | Used by | Notes |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `lib/googleSheets.ts` | From service account JSON |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | `lib/googleSheets.ts` | May have `\n` escaped — handled automatically |
| `GOOGLE_SHEET_ID` | `lib/googleSheets.ts` | From Google Sheet URL |
| `LABEL_STUDIO_BASE_URL` | `lib/labelStudio.ts` | No trailing slash |
| `LABEL_STUDIO_API_TOKEN` | `lib/labelStudio.ts` | Never sent to browser |

### Variables reserved for Phase 1

| Variable | Purpose |
|---|---|
| `NEXTAUTH_SECRET` | JWT signing for NextAuth sessions |
| `NEXTAUTH_URL` | Full base URL (needed for NextAuth callbacks) |
| `ADMIN_EMAILS` | Comma-separated emails auto-assigned ADMIN role on first login |

### Reading env vars in Next.js

- **Server-only** (API routes, `lib/`, `scripts/`): use `process.env.VAR_NAME` directly.
- **Client components**: vars must be prefixed `NEXT_PUBLIC_` to be exposed — we have none of these and should keep it that way for secrets.

---

## 4. Google Sheets Library

**File:** [`lib/googleSheets.ts`](lib/googleSheets.ts)

Authentication uses `google.auth.GoogleAuth` with service account credentials. Do **not** use `JWT` from `google-auth-library` directly — it causes a TypeScript type mismatch with googleapis v173.

### Exported functions

```ts
// Returns all rows as a 2D string array (row 0 = headers)
readSheet(sheetName: string): Promise<string[][]>

// Returns rows as objects keyed by header names — most useful
readSheetAsObjects(sheetName: string): Promise<Record<string, string>[]>

// Appends one row — values must match the column order of the sheet
appendRow(sheetName: string, values: (string | number | boolean)[]): Promise<void>

// Updates a specific row by 1-indexed row number (row 1 = headers, row 2 = first data row)
updateRow(sheetName: string, rowNumber: number, values: (string | number | boolean)[]): Promise<void>

// Finds the first row where a named column equals a value
findRowByColumn(
  sheetName: string,
  column: string,
  value: string
): Promise<{ row: Record<string, string>; rowNumber: number } | null>

// Used by /api/health — returns true if sheets is reachable
testConnection(): Promise<boolean>
```

### Usage example (in an API route)

```ts
import { findRowByColumn, appendRow, updateRow } from '@/lib/googleSheets'
import { nowISO } from '@/utils/date'

// Find a user by email
const result = await findRowByColumn('users', 'email', 'someone@example.com')
if (result) {
  const { row, rowNumber } = result
  console.log(row.role) // 'LABELER'

  // Update their last_login_at in-place
  // Build a values array in the exact column order of the 'users' sheet
  await updateRow('users', rowNumber, [
    row.user_id, row.email, row.name, row.password_hash,
    row.role, row.status, row.assigned_batch,
    row.created_at, nowISO(), nowISO(), row.notes
  ])
}

// Append a new user
await appendRow('users', [
  'U_abc123', 'new@example.com', 'New User', hashedPassword,
  'PENDING', 'PENDING_APPROVAL', '',
  nowISO(), nowISO(), '', ''
])
```

### Column order for `users` sheet (Phase 1 critical)

```
user_id | email | name | password_hash | role | status | assigned_batch |
created_at | updated_at | last_login_at | notes
```

> **Rule:** When calling `appendRow` or `updateRow`, the values array must exactly match the column order in the sheet. The provisioning script defines the canonical column order — refer to `scripts/provision-sheet.ts` for all sheets.

---

## 5. Label Studio Library

**File:** [`lib/labelStudio.ts`](lib/labelStudio.ts)

All calls are server-side only. The API token is never sent to the browser.

### Exported functions

```ts
// Raw authenticated HTTP helpers
lsGet<T>(path: string): Promise<T>
lsPost<T>(path: string, body: unknown): Promise<T>

// Domain methods
getTask(lsTaskId: string | number): Promise<unknown>
listProjectTasks(projectId, page?, pageSize?): Promise<{ tasks: { id: number }[]; total: number }>
submitAnnotation(lsTaskId, payload): Promise<unknown>

// Used by /api/health
testConnection(): Promise<boolean>
```

> **Note:** The LS health endpoint is `/api/health` on the Label Studio server, not the same as our `/api/health` route.

---

## 6. TypeScript Types

**Directory:** [`types/`](types/)

All types map 1-to-1 to Google Sheet columns. Every status value is a string literal union — **never use raw strings** for statuses, always use the type.

### Quick reference

```ts
// types/user.ts
type UserRole   = 'PENDING' | 'ADMIN' | 'LABELER' | 'REVIEWER'
type UserStatus = 'ACTIVE' | 'PENDING_APPROVAL' | 'DISABLED'
type SafeUser   = Omit<User, 'password_hash'>  // always return this to the client

// types/task.ts
type TaskStatus = 'IMPORTED' | 'READY_FOR_LABELING' | 'LABELING_IN_PROGRESS' | ...
type SyncStatus = 'NOT_READY' | 'PENDING' | 'FAILED' | 'SYNCED'

// types/region.ts
type RegionStatus = 'PENDING_LABEL' | 'LABELED' | 'UNREADABLE' | 'REVIEW_PENDING' | ...

// types/label.ts
type LabelSyncState = 'LOCAL_PENDING' | 'SAVED' | 'FAILED'

// types/review.ts
type ReviewStatus = 'APPROVED' | 'TEXT_WRONG' | 'SCRIPT_WRONG' | 'BOTH_WRONG' | 'UNREADABLE_WRONG'
```

> **Phase 1 note:** The `User` type includes `password_hash`. Always return `SafeUser` (via `Omit`) from API routes — never expose the hash to the client.

---

## 7. Utility Functions

### `utils/ids.ts` — `generateId(prefix)`

```ts
import { generateId } from '@/utils/ids'

generateId('U')   // → 'U_4a3f2c8b...'   (user)
generateId('T')   // → 'T_...'            (task)
generateId('RG')  // → 'RG_...'           (region)
generateId('LB')  // → 'LB_...'           (label)
generateId('RV')  // → 'RV_...'           (review)
generateId('SQ')  // → 'SQ_...'           (sync_queue)
generateId('AL')  // → 'AL_...'           (audit_log)
```

Uses `crypto.randomUUID()` — collision-safe, no external dependency.

### `utils/date.ts`

```ts
import { nowISO, addMinutes, isExpired } from '@/utils/date'

nowISO()                          // → '2026-06-10T09:30:00.000Z'
addMinutes('2026-06-10T09:00Z', 45) // → '2026-06-10T09:45:00.000Z'
isExpired('2026-06-09T00:00Z')    // → true (past date)
isExpired(null)                   // → true (treat missing lock as expired)
isExpired(addMinutes(nowISO(), 45)) // → false (45 min in the future)
```

`isExpired` is used for task lock checking — a lock is available if `isExpired(task.lock_expires_at)` is true.

### `utils/bbox.ts` — `percentToPixels`

```ts
import { percentToPixels } from '@/utils/bbox'

const pixels = percentToPixels(
  { x: 10.5, y: 20.0, width: 30.0, height: 15.5 },
  originalWidth: 1200,
  originalHeight: 800
)
// → { xmin: 126, ymin: 160, xmax: 486, ymax: 284 }
```

Used during Label Studio task import (Phase 3).

---

## 8. API Routes

### `GET /api/health`

Tests both Google Sheets and Label Studio connections in parallel.

```json
// 200 — both OK
{ "sheets": "ok", "labelStudio": "ok", "timestamp": "..." }

// 503 — one or both failed
{ "sheets": "error", "labelStudio": "ok", "sheetsError": "...", "timestamp": "..." }
```

### `GET /api/test-sheet` ⚠️ DEV ONLY

Reads `app_config`, appends a test row to `audit_logs`. Use to verify credentials.  
**Delete or gate this route before production.**

### Writing new API routes

The pattern used throughout this project:

```ts
// app/api/example/route.ts
export const dynamic = 'force-dynamic'   // always add for data routes

export async function GET() {
  // ... server-side logic
  return Response.json({ data }, { status: 200 })
}

export async function POST(request: Request) {
  const body = await request.json()
  // ... 
  return Response.json({ result }, { status: 201 })
}
```

For dynamic segments (e.g., `/api/tasks/[taskId]`):
```ts
// app/api/tasks/[taskId]/route.ts
export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params  // params is a Promise in Next.js 16
  // ...
}
```

---

## 9. App Layout & Styling

### Font

Inter is loaded via `next/font/google` and injected as a CSS variable `--font-inter`.  
It's applied in `globals.css` via `--font-sans: var(--font-inter), ui-sans-serif, ...`.

### Design Tokens (CSS custom properties)

Defined in [`app/globals.css`](app/globals.css) on `:root`, with a `@media (prefers-color-scheme: dark)` override:

```css
--color-bg            /* page background */
--color-surface        /* card/panel background */
--color-surface-2      /* slightly darker surface */
--color-border         /* borders and dividers */
--color-text-primary   /* main text */
--color-text-secondary /* secondary/label text */
--color-text-muted     /* placeholder/hint text */
--color-accent         /* primary action colour (#4361ee light / #4d72ff dark) */
--color-accent-hover
--color-accent-foreground
--color-success / --color-warning / --color-danger / --color-info
--radius-sm / --radius-md / --radius-lg
--shadow-sm / --shadow-md
--font-sans
```

**Use these tokens in your components**, not hardcoded hex values. This ensures the system dark/light mode works automatically.

### Tailwind CSS v4

This project uses Tailwind v4, which uses `@import "tailwindcss"` (not `@tailwind base/components/utilities`). Config is in `postcss.config.mjs`. No `tailwind.config.js` is required.

---

## 10. Scripts

### `npm run dev`
Starts Next.js dev server with Turbopack on `http://localhost:3000`.

### `npm run typecheck`
Runs `tsc --noEmit` — must pass with 0 errors before every commit.

### `npm run provision-sheet`
Runs `scripts/provision-sheet.ts` via `tsx`. Creates Google Sheet tabs and writes headers.  
**Already run once** — safe to re-run (idempotent), but not needed again unless the sheet is deleted.

### `npm run lint`
Runs ESLint (Next.js eslint config).

---

## 11. Key Conventions

### Never expose secrets to the client
- `lib/googleSheets.ts` and `lib/labelStudio.ts` are **server-only** files.
- Do not import them in `'use client'` components.
- All Google Sheets and Label Studio calls go through API routes.

### Sheets row → object conversion
`readSheetAsObjects()` returns `Record<string, string>` — all values are strings, even numbers and booleans. Cast explicitly when needed:
```ts
const count = parseInt(row.region_count, 10)
const isActive = row.is_active === 'TRUE'
```

### Status transitions
All allowed statuses are defined as TypeScript string literal unions in `types/`. Phase 2 will add a status transition validation helper — for now, enforce transitions manually in each API route.

### ID generation
Always use `generateId(prefix)` from `utils/ids.ts`. Never generate IDs client-side for sheet records.

### Timestamps
Always use `nowISO()` from `utils/date.ts`. Never use `new Date().toISOString()` directly — this keeps timestamp logic centralised.

### Private key env var
The `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` may arrive with literal `\n` strings (Vercel / dotenv behaviour). Both `lib/googleSheets.ts` and `scripts/provision-sheet.ts` call `.replace(/\\n/g, '\n')` to unescape them — do the same if you need the key elsewhere.

---

## 12. What Phase 1 Needs to Add

Phase 1 builds the authentication and role system on top of what Phase 0 established. Here is exactly what needs to be created:

### New dependencies to install
```bash
npm install next-auth@beta bcryptjs
# already installed in Phase 0 — no action needed
```

### Files to create

```
lib/auth.ts                       # NextAuth config (Credentials provider)
app/api/auth/[...nextauth]/route.ts  # NextAuth catch-all handler
app/api/me/route.ts               # GET current session user from Sheet
app/api/admin/assign-role/route.ts
app/api/admin/disable-user/route.ts
app/login/page.tsx                # Replace stub with real login UI (shadcn/ui form)
app/pending-approval/page.tsx
app/admin/users/page.tsx
middleware.ts                     # Route protection (at repo root or app/)
```

### NextAuth Credentials provider pattern

The `users` Google Sheet tab is the user store. On login:
1. Find user by email: `findRowByColumn('users', 'email', credentials.email)`
2. Compare password: `bcryptjs.compare(credentials.password, row.password_hash)`
3. If no user found → create a new row with `role: 'PENDING'`, `status: 'PENDING_APPROVAL'`
4. Return `SafeUser` (without `password_hash`) as the session user

### Middleware (route protection)

Use Next.js `middleware.ts` at the project root with `next-auth`'s `auth()` helper to protect:

```
/admin/*        → require role: ADMIN
/labeler/*      → require role: LABELER or ADMIN
/reviewer/*     → require role: REVIEWER or ADMIN
/pending-approval → require authenticated but PENDING_APPROVAL status
```

### shadcn/ui setup

Install shadcn/ui when building the login form:
```bash
npx shadcn@latest init
```
Use the `slate` base colour to match the design tokens already defined.

### Admin user seeding

The `ADMIN_EMAILS` env var contains the bootstrap admin email(s). On first login by that email, `lib/auth.ts` should auto-assign `role: ADMIN` instead of `PENDING`.

---

*Document generated after Phase 0 completion — 2026-06-10*
