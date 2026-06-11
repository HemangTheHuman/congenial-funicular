# Phase 4 Reference — Labeler Task List & Task Claim

**Status:** Complete ✅  
**Builds on:** Phase 0–3 (auth, sheets, domain libs, LS import)  
**Next phase reads:** Phase 5 (labeling workspace — region display, text input, save label)

---

## 1. What Phase 4 Added

Phase 4 is the **labeler entry point** — the dashboard where labelers see available tasks and claim one to work on. Before Phase 4, the labeler dashboard was a stub card ("coming in Phase 4"). After Phase 4, a labeler can:

1. See a live stats banner (available tasks, their current task, today's and all-time labeled regions).
2. Browse available task cards with thumbnail previews fetched from Azure Blob Storage.
3. Claim a task (lock acquired, status transitions to `LABELING_IN_PROGRESS`).
4. Be redirected to the task workspace stub (Phase 5 will fill it in).
5. Release a task back to the pool.

---

## 2. New Files

### `lib/tasks.ts` (modified — 3 new helpers)

```ts
// Returns the first task where this email holds a non-expired lock, or null.
export async function getActiveTaskForLabeler(email: string): Promise<Task | null>

// True if email currently holds a non-expired lock on any task.
export async function hasActiveLock(email: string): Promise<boolean>

// Atomic claim: transitions READY_FOR_LABELING → LABELING_IN_PROGRESS,
// sets assigned_labeler, locked_by, lock_expires_at in ONE Sheet write.
export async function claimTask(taskId: string, labelerEmail: string, expiresAt: string): Promise<Task>
```

**Why `claimTask` instead of `setTaskLock` + `updateTaskStatus`?**  
Each helper does a separate Sheet read (find row) + Sheet write (update row). Combining them into one function halves the Sheets API writes for the most frequent operation.

---

### `app/api/tasks/available/route.ts`

**`GET /api/tasks/available`** — Auth: LABELER or ADMIN

Fetches tasks + labeler stats in **3 parallel** Sheets reads:
- `listAvailableTasksForLabeling()` — tasks sheet
- `getActiveTaskForLabeler(email)` — tasks sheet
- `readSheetAsObjects('labels')` — labels sheet for stats

Response shape:
```ts
{
  available: Task[],    // tasks the caller can claim (excludes tasks the caller already holds)
  myTask: Task | null,  // the task the caller currently has locked
  stats: {
    totalAvailable: number,
    labeledToday: number,    // regions labeled today by this user (is_latest = TRUE only)
    labeledAllTime: number,  // all-time labeled regions for this user
  }
}
```

> The page component calls these same functions directly (server-side) for SSR — no client fetch to this route from the dashboard itself. The route exists for potential future client-side refresh.

---

### `app/api/tasks/claim/route.ts`

**`POST /api/tasks/claim`** — Auth: LABELER or ADMIN  
**Body:** `{ task_id: string }`

Guards (in order):
1. Task must exist → 404 if not.
2. Task must be in the available list → 409 `{ error: 'Task is no longer available' }` if taken.
3. Caller must not hold another active lock → 409 `{ error: '...', existingTaskId: '...' }` if they do.
4. Call `claimTask()` — atomic lock + status transition.
5. Log `TASK_CLAIMED` to audit_logs.

Returns `{ task: Task }` with 200.

---

### `app/api/tasks/release/route.ts`

**`POST /api/tasks/release`** — Auth: LABELER or ADMIN  
**Body:** `{ task_id: string }`

Guards:
- Task must exist → 404.
- `task.locked_by` must equal caller's email → 403 if not.

Steps:
1. `releaseTaskLock(taskId)` — clears `locked_by` and `lock_expires_at`.
2. `updateTaskStatus(taskId, 'READY_FOR_LABELING')` — transitions back.
3. Logs `TASK_RELEASED`.

> **Two Sheet writes** (lock clear + status update) — acceptable for a manual release action.

---

### `app/api/tasks/refresh-lock/route.ts`

**`POST /api/tasks/refresh-lock`** — Auth: LABELER or ADMIN  
**Body:** `{ task_id: string }`

Extends `lock_expires_at` to `now + TASK_LOCK_MINUTES`. Only the lock holder can call this.

**Built now but not wired yet** — Phase 5 workspace will call this every 3 minutes via `setInterval`.

Returns `{ lock_expires_at: string }`.

---

### `app/api/tasks/[taskId]/route.ts`

**`GET /api/tasks/[taskId]`** — Auth: LABELER, REVIEWER, or ADMIN

Returns the full `Task` object. Used by the Phase 5 workspace and the current stub page.

---

### `app/api/image-proxy/route.ts` (new)

**`GET /api/image-proxy?url=<encodeURIComponent(rawImageUrl)>`** — Auth: LABELER, REVIEWER, or ADMIN

Task images in Label Studio are stored in Azure Blob Storage and served via an authenticated LS resolve URL (e.g. `https://ls.../tasks/119/resolve/?fileuri=<base64>`). The browser cannot fetch these directly (401/403).

**Flow:**
1. Receive the raw `image_url` from the task (a LS resolve URL).
2. Decode the `fileuri` base64 param → `azure-blob://container/path/file.jpg`.
3. Parse container + blob path.
4. Fetch from `https://{account}.blob.core.windows.net/{container}/{blob}` using **Azure SharedKey** auth (HMAC-SHA256, no SDK required).
5. Stream bytes to the browser with `Cache-Control: public, max-age=86400`.

**Required env vars (`.env.local`):**
```env
AZURE_STORAGE_ACCOUNT_NAME=   # from Azure Portal → Storage account → Overview
AZURE_STORAGE_ACCOUNT_KEY=    # from Azure Portal → Storage account → Access keys → key1
```

> ⚠️ **SharedKey string-to-sign gotcha**: the `CanonicalizedHeaders` block already ends with `\n`. Do NOT use `.join('\n')` to concatenate `CanonicalizedHeaders` + `CanonicalizedResource` — it inserts a spurious extra `\n` which breaks the signature (Azure returns 403). Use explicit string concatenation instead. See `utils/azureBlob.ts`.

---

### `utils/azureBlob.ts` (new)

Server-side Azure Blob utilities. No external packages — uses Node.js built-in `crypto`.

```ts
// Parses "azure-blob://container/path/file.jpg" → { container, blobPath }
export function parseAzureBlobUri(uri: string): { container: string; blobPath: string } | null

// Decodes a LS resolve URL's fileuri param → "azure-blob://..." URI
export function decodeLsResolveUrl(lsUrl: string): string | null

// Returns the azure-blob:// URI from either a LS resolve URL or raw azure-blob:// URI
export function extractBlobUri(rawUrl: string): string | null

// Fetches a blob using Azure SharedKey auth (HMAC-SHA256)
export async function fetchAzureBlob(container: string, blobPath: string): Promise<Response>
```

---

### `utils/imageUrl.ts` (new)

```ts
// Wraps any raw task image_url in the server-side proxy for browser use
export function toProxiedImageUrl(rawUrl: string | undefined | null): string
// Returns: "/api/image-proxy?url=<encoded>" or "" for empty input
```

Use this everywhere an image URL from a Task needs to be put in an `<img src>` or `<Image src>`.

---

### `app/labeler/page.tsx` (modified — full RSC dashboard)

Server component that fetches all data in parallel and renders:

```
Header (UserBadge, SignOutButton)
  ↓
Stats Banner (4 cards: Available / My Task / Labeled Today / All Time)
  ↓
In Progress Section  (only if myTask !== null)
  ├─ Task thumbnail (priority preloaded as LCP element)
  ├─ Task ID, batch_id badge, region count
  ├─ Progress bar (labeled_region_count / region_count)
  └─ [Continue Task →] link + [Release Task] button
  ↓
Available Tasks Grid (sm:2-col, lg:3-col)
  └─ Each card: thumbnail (lazy), task ID, region count, [Claim Task] button
```

**Image thumbnails:** Use `toProxiedImageUrl()` + `next/image` with `unoptimized` and `fill` inside a `relative` container. The in-progress task image has `priority` set so Next.js preloads it (it is the LCP element).

**Stats banner "My Current Task" card:** Shows `"Active"` as the large value (not the raw task ID which is too long) and `"T_eb73b7e7… · 0/5 regions"` as the sublabel. The `StatCard` value div has `truncate overflow-hidden` as a safety net.

---

### `app/labeler/TaskActions.tsx` (new — client component)

```ts
'use client'
export function ClaimButton({ taskId })
export function ReleaseButton({ taskId })
```

**Both buttons manage their own error state internally** via `useState`. They render an inline error banner directly above themselves when something goes wrong.

> ⚠️ **RSC/Client boundary rule**: Do NOT use render props (functions as children) when passing content from a Server Component to a Client Component — React cannot serialize functions across the RSC boundary. The original `ErrorBanner` render-prop pattern (`children={fn}`) caused a "Functions are not valid as a child of Client Components" runtime crash. The fix was to move `useState` error state inside each button itself.

- `ClaimButton`: POSTs to `/api/tasks/claim` → on 200, pushes to `/labeler/task/[taskId]`. On 409 with `existingTaskId`, shows inline error.
- `ReleaseButton`: Shows a confirm dialog first, then POSTs to `/api/tasks/release` → `router.refresh()` on success.

Both use `useTransition` / `useState` for loading states.

---

### `app/labeler/ErrorBanner.tsx` (exists but unused)

This file exists from an early iteration but is no longer imported anywhere. Safe to delete in a cleanup pass — error display is now handled inside each button.

---

### `app/labeler/task/[taskId]/page.tsx` (new — Phase 5 stub)

Server component. Auth guards:
- User must be authenticated.
- `task.locked_by` must equal `user.email` — if not → `redirect('/labeler')`.

Renders a placeholder card with task ID, region count, progress, and lock expiry. Phase 5 will replace the placeholder with the full labeling workspace.

---

## 3. Key Design Decisions

### One-task-at-a-time enforcement
The claim route checks `getActiveTaskForLabeler(email)` before allowing a claim. This is server-side — the UI also blocks the button, but the server is the source of truth.

### `assigned_labeler` set at claim time
The `assigned_labeler` field is set when the lock is acquired. If a lock expires and another user claims the task, `assigned_labeler` is overwritten. If you need the original assignee preserved, add a separate `original_labeler` field in a future phase.

### Available task visibility
Tasks locked by other users with non-expired locks are hidden from the list entirely (not greyed out). The `listAvailableTasksForLabeling()` function (already in lib/tasks.ts from Phase 2) handles this — it returns `READY_FOR_LABELING` + expired `LABELING_IN_PROGRESS` tasks.

### Parallel data fetching on dashboard
```ts
const [available, myTask, labelRows] = await Promise.all([
  listAvailableTasksForLabeling(),
  getActiveTaskForLabeler(email),
  readSheetAsObjects('labels'),
])
```
Three concurrent Sheets reads instead of sequential — saves ~300–600ms on the dashboard load.

### Image serving via Azure Blob (not LS)
Images are served directly from Azure Blob Storage using SharedKey auth, bypassing Label Studio's authenticated resolve endpoint entirely. This is faster (no LS round-trip), more reliable (no LS token expiry risk), and browser-cacheable.

---

## 4. What Phase 5 Needs to Know

Phase 5 will replace the stub at `/labeler/task/[taskId]` with the full labeling workspace.

### Images in the workspace
Use `toProxiedImageUrl(task.image_url)` from `@/utils/imageUrl` for the full task image too, not just thumbnails.

### Lock refresh
Wire a `setInterval` in the workspace component:
```ts
// Every 3 minutes
setInterval(async () => {
  await fetch('/api/tasks/refresh-lock', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId }),
    headers: { 'Content-Type': 'application/json' },
  })
}, 3 * 60 * 1000)
```
The `/api/tasks/refresh-lock` route is already built and tested.

### Region display
```ts
import { listRegionsByTask } from '@/lib/regions'
// Returns regions sorted by order_index, is_active = TRUE only
const regions = await listRegionsByTask(taskId)
```

### Crop math
```ts
import { padBbox } from '@/utils/bbox'
const paddedPx = padBbox(
  { xmin: region.bbox_xmin, ymin: region.bbox_ymin, xmax: region.bbox_xmax, ymax: region.bbox_ymax },
  task.original_width,
  task.original_height,
  0.015  // getCropPaddingPercent() from appConfig
)
```

### Saving a label
Call `POST /api/regions/save-label` (to be built in Phase 5):
```ts
{ region_id, task_id, text, is_unreadable, local_client_id }
```
Backend calls `createNewLabelVersion()` from `lib/labels.ts` (already exists).

### Task submission
After all regions are `LABELED` or `UNREADABLE`:
```ts
updateTaskStatus(taskId, 'READY_FOR_REVIEW')
updateRegionStatus(regionId, 'REVIEW_PENDING')  // for each region
```

### Functions to use (already exist)
```ts
import { listRegionsByTask, updateRegionStatus } from '@/lib/regions'
import { getTaskById, updateTaskStatus, claimTask } from '@/lib/tasks'
import { createNewLabelVersion, listLatestLabelsByTask } from '@/lib/labels'
import { assertTaskTransition, assertRegionTransition } from '@/lib/transitions'
import { logAction } from '@/lib/auditLog'
import { toProxiedImageUrl } from '@/utils/imageUrl'
```

---

## 5. Files Changed in Phase 4

```
lib/
  tasks.ts                      [MODIFIED] added getActiveTaskForLabeler(), hasActiveLock(), claimTask()

utils/
  azureBlob.ts                  [NEW] Azure Blob SharedKey auth + LS resolve URL decoder
  imageUrl.ts                   [NEW] toProxiedImageUrl() — wraps raw URLs in proxy

app/
  api/
    image-proxy/route.ts        [NEW] GET — server-side Azure Blob image proxy
    tasks/
      available/route.ts        [NEW] GET — available tasks + stats
      claim/route.ts            [NEW] POST — claim with lock
      release/route.ts          [NEW] POST — release lock
      refresh-lock/route.ts     [NEW] POST — extend lock expiry (Phase 5 wires frontend timer)
      [taskId]/route.ts         [NEW] GET — single task fetch
  labeler/
    page.tsx                    [MODIFIED] full RSC dashboard
    TaskActions.tsx             [NEW] 'use client' ClaimButton + ReleaseButton (self-contained error state)
    ErrorBanner.tsx             [NEW] unused — safe to delete
    task/[taskId]/
      page.tsx                  [NEW] Phase 5 stub — auth guard + placeholder

.env.local
  AZURE_STORAGE_ACCOUNT_NAME    [NEW] Azure storage account name
  AZURE_STORAGE_ACCOUNT_KEY     [NEW] Azure storage account key (base64)

docs/
  PHASE_4_REFERENCE.md          [NEW] this file
```
