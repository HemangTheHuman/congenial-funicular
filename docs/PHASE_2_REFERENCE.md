# Phase 2 — Developer Reference

> **Audience:** Developers picking up Phase 3 (Label Studio task import).  
> **Purpose:** Explains every helper, type, convention, and gotcha established in Phase 2 so you call the right function rather than touching the Sheet directly.

---

## Table of Contents

1. [What Phase 2 Delivered](#1-what-phase-2-delivered)
2. [New Files](#2-new-files)
3. [Golden Rule: Never Call `googleSheets.ts` Directly From Business Logic](#3-golden-rule)
4. [Column Order Constants — `lib/sheetColumns.ts`](#4-column-order-constants)
5. [Status Transition Validator — `lib/transitions.ts`](#5-status-transition-validator)
6. [Domain Helpers — API Reference](#6-domain-helpers)
   - [lib/users.ts](#libuserts--read-only)
   - [lib/tasks.ts](#libtasksts)
   - [lib/regions.ts](#libregionsts)
   - [lib/labels.ts](#liblabelsts)
   - [lib/reviews.ts](#libreviewsts)
   - [lib/syncQueue.ts](#libsyncqueuets)
   - [lib/appConfig.ts](#libappconfigts)
7. [Serialisation Rules](#7-serialisation-rules)
8. [Known Gotchas and Design Decisions](#8-known-gotchas-and-design-decisions)
9. [Smoke Test — `GET /api/test-sheet`](#9-smoke-test)
10. [What Phase 3 Needs to Add](#10-what-phase-3-needs-to-add)

---

## 1. What Phase 2 Delivered

- **2 new types**: `SyncQueueEntry`, `AppConfigEntry`
- **`lib/sheetColumns.ts`**: Column order constants for all 6 writable Sheet tabs — single source of truth
- **`lib/transitions.ts`**: `assertTaskTransition()` + `assertRegionTransition()` — enforce valid state machine transitions
- **7 domain helper libraries**: `users`, `tasks`, `regions`, `labels`, `reviews`, `syncQueue`, `appConfig`
- All helpers are typed end-to-end — callers receive domain objects, not raw `Record<string, string>`
- Extended `/api/test-sheet` smoke test to verify all new helpers against the live Sheet

---

## 2. New Files

```
lib/
  sheetColumns.ts        ⭐ NEW — column order constants
  transitions.ts         ⭐ NEW — status transition validator
  users.ts               ⭐ NEW — read-only user helpers
  tasks.ts               ⭐ NEW — task CRUD + locking
  regions.ts             ⭐ NEW — region CRUD + script tag
  labels.ts              ⭐ NEW — versioned label creation
  reviews.ts             ⭐ NEW — review CRUD
  syncQueue.ts           ⭐ NEW — sync entry lifecycle
  appConfig.ts           ⭐ NEW — typed config getters (cached)

types/
  sync-queue.ts          ⭐ NEW — SyncQueueEntry, SyncQueueStatus
  app-config.ts          ⭐ NEW — AppConfigEntry

app/api/test-sheet/
  route.ts               ⭐ UPDATED — now validates all Phase 2 helpers
```

---

## 3. Golden Rule

> **Never call `readSheetAsObjects`, `appendRow`, `updateRow`, or `findRowByColumn` directly from API routes, Server Actions, or pages.**

Use the domain helpers instead. They:
- Parse raw strings into correct types (numbers, booleans)
- Enforce transition rules before writing status changes
- Keep column ordering in one place
- Produce consistent error messages

The **only** exceptions are:
- `auth.ts` — writes to `users` directly to avoid circular imports with `lib/users.ts`
- `app/actions/auth.ts` — same reason

---

## 4. Column Order Constants

**File:** [`lib/sheetColumns.ts`](lib/sheetColumns.ts)

```ts
import { TASK_COLUMNS, REGION_COLUMNS, LABEL_COLUMNS, REVIEW_COLUMNS, SYNC_QUEUE_COLUMNS } from '@/lib/sheetColumns'
```

Each constant is a `readonly` tuple of column names in the exact order they appear in the Sheet. Serialiser functions in every helper use these to produce the write array.

**If you add a column to the Sheet**, you must:
1. Add it to the relevant constant in `sheetColumns.ts`
2. Update the `rowToX` deserialiser in the matching helper
3. Update the `xToRow` serialiser in the matching helper
4. Update the `interface` in `types/`

---

## 5. Status Transition Validator

**File:** [`lib/transitions.ts`](lib/transitions.ts)

```ts
import { assertTaskTransition, assertRegionTransition } from '@/lib/transitions'
import { isValidTaskTransition, isValidRegionTransition } from '@/lib/transitions'
```

### Throwing versions (use in API routes and server actions)

```ts
// Throws: "Invalid task status transition: SYNCED_TO_LABEL_STUDIO → LABELED. Allowed: [none — terminal state]"
assertTaskTransition('SYNCED_TO_LABEL_STUDIO', 'LABELED')

assertRegionTransition('PENDING_LABEL', 'APPROVED') // throws — must go via LABELED first
```

### Boolean versions (use for UI conditional logic)

```ts
if (isValidTaskTransition(task.status, 'FINAL_APPROVED')) {
  // show submit button
}
```

### Transition tables (quick reference)

**Task transitions:**

| From | Allowed next statuses |
|---|---|
| `IMPORTED` | `READY_FOR_LABELING` |
| `READY_FOR_LABELING` | `LABELING_IN_PROGRESS` |
| `LABELING_IN_PROGRESS` | `LABELED`, `READY_FOR_LABELING` (release) |
| `LABELED` | `READY_FOR_REVIEW` |
| `READY_FOR_REVIEW` | `REVIEWING_IN_PROGRESS` |
| `REVIEWING_IN_PROGRESS` | `NEEDS_CORRECTION`, `FINAL_APPROVED`, `READY_FOR_REVIEW` |
| `NEEDS_CORRECTION` | `CORRECTION_IN_PROGRESS` |
| `CORRECTION_IN_PROGRESS` | `CORRECTED`, `NEEDS_CORRECTION` (release) |
| `CORRECTED` | `READY_FOR_RE_REVIEW` |
| `READY_FOR_RE_REVIEW` | `REVIEWING_IN_PROGRESS` |
| `FINAL_APPROVED` | `SYNC_PENDING` |
| `SYNC_PENDING` | `SYNC_FAILED`, `SYNCED_TO_LABEL_STUDIO` |
| `SYNC_FAILED` | `SYNC_PENDING` (retry) |
| `SYNCED_TO_LABEL_STUDIO` | *(terminal)* |

**Region transitions:**

| From | Allowed next statuses |
|---|---|
| `PENDING_LABEL` | `LABELED`, `UNREADABLE` |
| `LABELED` / `UNREADABLE` | `REVIEW_PENDING` |
| `REVIEW_PENDING` | `APPROVED`, `TEXT_WRONG`, `SCRIPT_WRONG`, `BOTH_WRONG`, `NEEDS_CORRECTION` |
| `SCRIPT_WRONG` | `APPROVED` (reviewer fixed script, no labeler correction needed) |
| `TEXT_WRONG` / `BOTH_WRONG` | `NEEDS_CORRECTION` |
| `APPROVED` | `FINAL_APPROVED` |
| `NEEDS_CORRECTION` | `CORRECTED` |
| `CORRECTED` | `APPROVED`, `NEEDS_CORRECTION` (re-rejected) |
| `FINAL_APPROVED` | *(terminal)* |

---

## 6. Domain Helpers

### `lib/users.ts` — Read-Only

> **Writes to the users sheet stay in `auth.ts` and `app/actions/auth.ts`.**

```ts
import { getUserById, getUserByEmail, listAllUsers, listUsersByStatus, listUsersByRole } from '@/lib/users'

const user = await getUserById('U_abc123')    // SafeUser | null
const user = await getUserByEmail('a@b.com')  // SafeUser | null
const all  = await listAllUsers()             // SafeUser[] sorted by email
const pending = await listUsersByStatus('PENDING_APPROVAL')
const labelers = await listUsersByRole('LABELER')
```

Returns `SafeUser` — never includes `password_hash`.

---

### `lib/tasks.ts`

```ts
import {
  getTaskById, getTaskByLsId, listTasksByStatus,
  listAvailableTasksForLabeling, listTasksForReview, listTasksForLabeler,
  createTask, updateTaskStatus, setTaskLock, releaseTaskLock,
  isLockExpired, incrementRegionCount, updateTaskSyncStatus
} from '@/lib/tasks'
```

**Key patterns:**

```ts
// Import duplicate check — used in Phase 3
const existing = await getTaskByLsId(lsTaskId)
if (existing) return Response.json({ error: 'Already imported' }, { status: 409 })

// Create a new task (after Label Studio import)
const task = await createTask({
  ls_task_id: '42',
  project_id: 'proj_1',
  batch_id: 'batch_1',
  image_url: 'https://...',
  image_preview_url: '',
  original_width: 1200,
  original_height: 1600,
  status: 'IMPORTED',
  assigned_labeler: '',
  assigned_reviewer: '',
  locked_by: '',
  lock_expires_at: '',
  region_count: 5,
  labeled_region_count: 0,
  approved_region_count: 0,
  rejected_region_count: 0,
  sync_status: 'NOT_READY',
  sync_attempt_count: 0,
  last_sync_error: '',
  completed_at: '',
})

// Claim + lock a task
const lockMinutes = await getTaskLockMinutes()
const expiresAt = new Date(Date.now() + lockMinutes * 60_000).toISOString()
await setTaskLock(task.task_id, session.user.email, expiresAt)
await updateTaskStatus(task.task_id, 'LABELING_IN_PROGRESS') // validates transition

// Check if expired before allowing another user to claim
if (isLockExpired(task)) {
  await releaseTaskLock(task.task_id)
}
```

**Performance note:** `listAvailableTasksForLabeling()` reads the full tasks sheet. Fine for MVP (~500 tasks). This is the first bottleneck if the dataset grows.

---

### `lib/regions.ts`

```ts
import {
  getRegionById, listRegionsByTask, listRegionsByTaskAndStatus,
  createRegion, updateRegionStatus, updateRegionScriptTagFinal,
  deactivateRegion, allRegionsInStatus
} from '@/lib/regions'
```

**Key patterns:**

```ts
// Import: create one region per Label Studio region
const region = await createRegion({
  task_id: task.task_id,
  ls_task_id: task.ls_task_id,
  ls_region_id: 'ls_region_abc',
  order_index: 0,
  bbox_x_percent: 10.5, bbox_y_percent: 20.0,
  bbox_width_percent: 30.0, bbox_height_percent: 5.0,
  bbox_xmin: 126, bbox_ymin: 320, bbox_xmax: 486, bbox_ymax: 400,
  rotation: 0,
  script_tag_original: 'KAITHI',
  script_tag_final: 'KAITHI',   // starts equal to original
  status: 'PENDING_LABEL',
  is_active: true,
})

// Check if labeler can submit task
const canSubmit = await allRegionsInStatus(taskId, 'LABELED', 'UNREADABLE')

// Reviewer corrects script (never the labeler)
await updateRegionScriptTagFinal(regionId, 'DEVANAGARI')

// Status update (transition guard fires automatically)
await updateRegionStatus(regionId, 'REVIEW_PENDING')
```

**is_active:** Regions are never hard-deleted. Use `deactivateRegion(regionId)` for soft-delete. `listRegionsByTask()` filters out inactive by default.

---

### `lib/labels.ts`

```ts
import {
  getLabelById, getLatestLabelForRegion, listLabelsByRegion,
  listLatestLabelsByTask, createLabel, createNewLabelVersion
} from '@/lib/labels'
```

**Key pattern — always use `createNewLabelVersion` for labeling flows:**

```ts
// First label for a region (version 1)
const label = await createNewLabelVersion(
  regionId,
  taskId,
  session.user.email,
  'कैथी text here',
  false,              // isUnreadable
  localClientId       // optional, for offline sync
)

// Correction (creates version 2, demotes version 1)
const corrected = await createNewLabelVersion(regionId, taskId, email, 'corrected text', false)

// Build review payload
const latestLabels = await listLatestLabelsByTask(taskId)
// → Map<regionId, Label> effectively

// Build final sync payload
const latest = await getLatestLabelForRegion(regionId)
```

**Atomicity caveat:** `createNewLabelVersion` does two Sheet writes (demote old → create new). If the process crashes between them, two `is_latest = TRUE` rows exist. `getLatestLabelForRegion` handles this by returning the most recent `created_at` when duplicates exist.

---

### `lib/reviews.ts`

```ts
import {
  getReviewById, listReviewsByRegion, getLatestReviewForRegion,
  listReviewsByTask, createReview
} from '@/lib/reviews'
```

```ts
// Reviewer submits a decision
const review = await createReview({
  region_id: regionId,
  task_id: taskId,
  reviewer_email: session.user.email,
  review_status: 'TEXT_WRONG',
  final_script_tag: 'KAITHI',
  review_note: 'Transcription is incorrect in the middle section',
  review_round: 1,
})
```

Reviews are **append-only** — never updated. Each correction round creates a new row with an incremented `review_round`.

---

### `lib/syncQueue.ts`

```ts
import {
  getSyncEntry, createSyncEntry, updateSyncStatus,
  listPendingSyncEntries, listFailedSyncEntries, requeueFailedEntry
} from '@/lib/syncQueue'
```

```ts
// When task reaches FINAL_APPROVED (called by the review submission route)
await createSyncEntry(task.task_id, task.ls_task_id) // idempotent

// Sync worker marks in-progress
await updateSyncStatus(taskId, 'IN_PROGRESS')

// On success
await updateSyncStatus(taskId, 'SYNCED')

// On failure
await updateSyncStatus(taskId, 'FAILED', 'HTTP 502 from Label Studio')

// Admin retries
await requeueFailedEntry(taskId) // resets to PENDING, does NOT increment attempt_count
```

`createSyncEntry` is idempotent — calling it twice for the same `taskId` returns the existing entry.

---

### `lib/appConfig.ts`

```ts
import {
  getConfig, getConfigOrDefault, getAllConfig,
  getTaskLockMinutes, getAllowedScriptTags, getCropPaddingPercent, getMaxReviewRounds,
  invalidateConfigCache
} from '@/lib/appConfig'
```

Config is cached for 1 minute in memory. Repeated calls within the same request are free.

```ts
const minutes = await getTaskLockMinutes()        // number — default 45
const tags    = await getAllowedScriptTags()       // string[] — ['KAITHI', 'DEVANAGARI', ...]
const padding = await getCropPaddingPercent()      // number — default 0.015
const maxRounds = await getMaxReviewRounds()      // number — default 3

// For any ad-hoc config key
const val = await getConfigOrDefault('MY_KEY', 'fallback')
```

The `app_config` Sheet should contain these rows for defaults to work:

| key | value |
|---|---|
| `TASK_LOCK_MINUTES` | `45` |
| `ALLOWED_SCRIPT_TAGS` | `KAITHI,DEVANAGARI,ENGLISH,OTHER` |
| `CROP_PADDING_PERCENT` | `0.015` |
| `MAX_REVIEW_ROUNDS` | `3` |

---

## 7. Serialisation Rules

These rules are applied inside every helper. Phase 3 developers must follow the same rules for any new helpers:

| Direction | Type | Rule |
|---|---|---|
| Sheet → code | integer columns | `parseInt(v, 10) \|\| 0` |
| Sheet → code | float columns | `parseFloat(v) \|\| 0` |
| Sheet → code | boolean columns | `v === 'TRUE' \|\| v === 'true'` |
| Sheet → code | string columns | `v` as-is, `''` if missing |
| Code → Sheet | boolean | `'TRUE'` or `'FALSE'` (uppercase strings) |
| Code → Sheet | number | `String(n)` |
| Code → Sheet | empty optional | `''` |

**Boolean columns in each sheet:**

| Sheet | Boolean columns |
|---|---|
| `regions` | `is_active` |
| `labels` | `is_unreadable`, `is_latest` |

---

## 8. Known Gotchas and Design Decisions

### lib/users.ts is read-only by design

`auth.ts` and `app/actions/auth.ts` write to the users sheet directly. If `lib/users.ts` wrote to users and was also imported by auth-related files, it would create a circular import chain. Keep this boundary.

### `createNewLabelVersion` two-write atomicity

Two Sheet writes: (1) set old label `is_latest = FALSE`, (2) append new label with `is_latest = TRUE`. If step 2 crashes, two `is_latest = TRUE` rows exist for the same region. Mitigation: `getLatestLabelForRegion` resolves this by sorting duplicate `is_latest = TRUE` rows by `created_at` descending.

### `listAvailableTasksForLabeling` reads the full tasks sheet

MVP is fine. Expected bottleneck at ~500 rows. If needed in future: add a separate `task_index` sheet or migrate to a real database.

### `appConfig.ts` has a 1-minute in-memory cache

The cache is per-serverless-function-instance. In production on Vercel, multiple function instances do not share this cache. Config updates in the Sheet take effect within 1 minute per instance. This is acceptable for MVP. Call `invalidateConfigCache()` in tests to reset it.

### Reviews are append-only

Never update an existing review row. Each re-review creates a new row with `review_round` incremented. The latest round is always the authoritative decision.

### `findRowByColumn` scans linearly

The underlying `googleSheets.ts` function reads the full sheet and scans for the matching column value. For small sheets this is fine. For `tasks` and `regions` (which will grow large), prefer `listTasksByStatus` + in-memory filter over repeated `findRowByColumn` calls in a loop.

---

## 9. Smoke Test

Visit **`GET /api/test-sheet`** (dev server only) to verify all Phase 2 helpers work against the live Sheet. The response looks like:

```json
{
  "ok": true,
  "results": {
    "connection": true,
    "users.listAllUsers": { "count": 2, "sample": { "user_id": "U_...", ... } },
    "tasks.listByStatus": { "count": 0 },
    "appConfig.getAllConfig": { "TASK_LOCK_MINUTES": "45", ... },
    "appConfig.getTaskLockMinutes": 45,
    "appConfig.getAllowedScriptTags": ["KAITHI", "DEVANAGARI", "ENGLISH", "OTHER"],
    "transitions": {
      "IMPORTED→READY_FOR_LABELING": "OK",
      "SYNCED→LABELED (should throw)": "OK — correctly threw",
      "PENDING_LABEL→LABELED": "OK"
    }
  }
}
```

---

## 10. What Phase 3 Needs to Add

Phase 3 is **Label Studio task import**. It will call into the helpers built in Phase 2 to write task and region rows.

### Files to create

```
app/api/admin/import-task/[lsTaskId]/route.ts   # POST — import one task
app/api/admin/import-batch/route.ts              # POST — import list of LS task IDs
app/admin/import/page.tsx                        # Import UI page
utils/bbox.ts                                    # Bbox conversion helpers
```

### Key Phase 2 functions Phase 3 will call

```ts
// Duplicate check before import
await getTaskByLsId(lsTaskId)

// Create task after parsing LS data
await createTask({ ... status: 'IMPORTED', ... })

// Transition imported task to ready
await updateTaskStatus(task.task_id, 'READY_FOR_LABELING')

// Create one region per LS region
await createRegion({ ... status: 'PENDING_LABEL', script_tag_final: script_tag_original, ... })

// Audit log the import
await logAction(adminEmail, 'TASK_IMPORTED', 'task', task.task_id, '', lsTaskId)
```

### `utils/bbox.ts` to add

```ts
// Convert Label Studio percentage bbox to pixel bbox
export function pctToPixel(
  xPct: number, yPct: number, wPct: number, hPct: number,
  origW: number, origH: number
): { xmin: number; ymin: number; xmax: number; ymax: number }
```

---

*Document generated after Phase 2 completion — 2026-06-10*
