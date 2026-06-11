# Phase 5.2 Reference — Database Migration: Google Sheets → Turso (libSQL)

**Status:** Complete ✅  
**Builds on:** Phase 5.1 (labeling workspace — WorkspaceClient, save-label, submit-labeling)  
**Next phase reads:** Phase 6 (reviewer workspace — review queue, approval, correction flow)

---

## 1. What Phase 5.2 Added

Phase 5.2 is the **full database migration** from Google Sheets to [Turso](https://turso.tech/) (libSQL / SQLite-over-HTTP). Before Phase 5.2, every API call read or wrote entire spreadsheet tabs over the Sheets REST API, resulting in 8–12 second save times. After Phase 5.2:

- All data lives in a **Turso cloud database** with indexed SQL tables.
- Save-label latency dropped from **~8 000ms → ~430ms** (18× faster).
- Task claim dropped from **~7 000ms → ~406ms** (17× faster).
- Dashboard load dropped from **~6 000ms → ~436ms** (14× faster).
- `googleapis` package removed (47 fewer packages, smaller cold-start).

High-level what changed:

```
Before (Sheets)                        After (Turso)
──────────────────────────────────     ──────────────────────────────────
lib/googleSheets.ts  (sheet API)  →   lib/db.ts          (Turso client)
lib/sheetColumns.ts  (col order)  →   deleted
lib/users.ts         (Sheets)     →   lib/users.ts        (SQL)
lib/tasks.ts         (Sheets)     →   lib/tasks.ts        (SQL)
lib/regions.ts       (Sheets)     →   lib/regions.ts      (SQL)
lib/labels.ts        (Sheets)     →   lib/labels.ts       (SQL)
lib/reviews.ts       (Sheets)     →   lib/reviews.ts      (SQL)
lib/syncQueue.ts     (Sheets)     →   lib/syncQueue.ts    (SQL)
lib/auditLog.ts      (Sheets)     →   lib/auditLog.ts     (SQL)
lib/appConfig.ts     (Sheets)     →   lib/appConfig.ts    (hardcoded const)
auth.ts              (Sheets)     →   auth.ts             (SQL)
app/actions/auth.ts  (Sheets)     →   app/actions/auth.ts (SQL)
```

---

## 2. New / Replaced Files

### `lib/db.ts` (NEW)

Turso singleton client. Reads credentials from `process.env` at module load time.

```ts
import { createClient } from '@libsql/client'

export const db = createClient({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
})
```

Import this anywhere that previously imported `lib/googleSheets.ts`. Every `db.execute()` call goes to Turso via HTTPS.

**Connection semantics:** `@libsql/client` keeps one HTTP connection open. There is no connection pool to configure. Each `db.execute()` is a separate HTTP request. Use `db.batch()` for multi-statement transactions.

---

### `scripts/migrate.ts` (NEW — one-time run)

Creates all tables + indexes in the Turso database, then seeds users from `scripts/users-seed.json`.

```bash
npx tsx scripts/migrate.ts
```

**Critical: dotenv order.** The script uses `import { config as dotenvConfig } from 'dotenv'` and calls `dotenvConfig({ path: '.env.local' })` **before** `createClient()` is invoked. Standard `import 'dotenv/config'` does not work here because ES module `import` statements are hoisted — `createClient()` would see `undefined` URLs before dotenv runs. The fix is to call `dotenvConfig()` at the top-level (side-effect) and put `createClient()` inside `main()`.

The script is **idempotent**: it uses `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE`. Safe to re-run.

---

### `scripts/users-seed.json` (NEW — one-time use)

Array of user rows to seed into the `users` table on first run. Format:

```json
[
  {
    "user_id":       "U_...",
    "email":         "admin@example.com",
    "name":          "Admin User",
    "password_hash": "$2b$12$...",
    "role":          "ADMIN",
    "status":        "ACTIVE",
    "assigned_batch": "",
    "created_at":    "2026-06-10T10:21:46.539Z",
    "updated_at":    "2026-06-10T13:03:59.773Z",
    "last_login_at": "2026-06-10T13:03:59.773Z",
    "notes":         ""
  }
]
```

Paste rows directly from the old Google Sheet. Password hashes are bcrypt — they transfer as-is.

---

## 3. Database Schema

Seven tables, all created by `scripts/migrate.ts`:

```sql
users         -- authentication, roles, login tracking
tasks         -- one row per LS task (status machine)
regions       -- one row per bounding box within a task
labels        -- one row per label version (is_latest tracks current)
reviews       -- one row per review decision
sync_queue    -- tasks queued for LS writeback
audit_logs    -- append-only event log
```

### Key Indexes

```sql
CREATE INDEX idx_tasks_status      ON tasks(status);
CREATE INDEX idx_tasks_locked_by   ON tasks(locked_by);
CREATE INDEX idx_regions_task_id   ON regions(task_id);
CREATE INDEX idx_regions_status    ON regions(status);
CREATE INDEX idx_labels_region_id  ON labels(region_id);
CREATE INDEX idx_labels_task_id    ON labels(task_id);
CREATE INDEX idx_labels_is_latest  ON labels(is_latest);
CREATE INDEX idx_reviews_task_id   ON reviews(task_id);
CREATE INDEX idx_reviews_region_id ON reviews(region_id);
CREATE INDEX idx_audit_timestamp   ON audit_logs(timestamp);
```

All hot-path queries (task by ID, regions by task, labels by region, available tasks) use these indexes.

---

## 4. Domain Library Changes

Every library was rewritten in-place. The public API (exported function signatures) is **unchanged** — callers don't need to know about the underlying storage.

### `lib/tasks.ts`

| Function | Before | After |
|---|---|---|
| `getTaskById` | Full sheet scan | `SELECT * WHERE task_id = ?` |
| `listAvailableTasksForLabeling` | Full sheet in memory + JS filter | `WHERE status = 'READY_FOR_LABELING' OR (status = 'LABELING_IN_PROGRESS' AND lock_expires_at < ?)` |
| `claimTask` | 1 read + 1 write (row scan) | Single `UPDATE` touching 4 columns |
| `incrementRegionCount` | Read row + rewrite full row | `UPDATE tasks SET col = MAX(0, col + ?) WHERE task_id = ?` — **no read needed** |
| `updateTaskSyncStatus` | Read row + full rewrite | Single `UPDATE` with `CASE` for `sync_attempt_count` |
| `releaseTaskLock` | Read row + full rewrite | `UPDATE tasks SET locked_by = '', lock_expires_at = ''` |

**Removed:** `updateTaskRowDirect()` — was a Sheets-specific optimization to skip row re-scan. Not needed with SQL indexed lookups.

---

### `lib/regions.ts`

| Function | Before | After |
|---|---|---|
| `createRegions` | `appendRows()` (one API call for all) | `db.batch()` with N `INSERT` statements |
| `listRegionsByTask` | Full sheet scan + JS filter | `SELECT * WHERE task_id = ? AND is_active = 1 ORDER BY order_index` |
| `updateRegionStatus` | Find row + full row rewrite | `UPDATE regions SET status = ?, updated_at = ?` |

**Renamed:** `createRegions` → `createRegionsBatch` to clarify that it uses a batch SQL transaction.

**New:** `createRegionsBatch(dataList)` — inserts N regions in a single `db.batch()` call. Used by the import route.

---

### `lib/labels.ts`

`createNewLabelVersion` — the most performance-critical function. Before: 2 sequential Sheets reads + 2 writes (~6s total). After: `UPDATE` (demote old latest) + `INSERT` (new version) — 2 SQL statements.

```ts
// Demote previous latest label for this region
await db.execute({
  sql:  'UPDATE labels SET is_latest = 0, updated_at = ? WHERE region_id = ? AND is_latest = 1',
  args: [now, regionId],
})

// Insert new version
await db.execute({
  sql:  `INSERT INTO labels (...) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  args: [...],
})
```

---

### `lib/appConfig.ts`

Previously read from a `app_config` Google Sheet tab. Now a **hardcoded TypeScript const**:

```ts
export const APP_CONFIG = {
  TASK_LOCK_MINUTES:      30,
  MAX_LABEL_VERSIONS:     10,
  CROP_PAD_PERCENT:       0,
  MIN_LABEL_LENGTH:       1,
  MAX_LABEL_LENGTH:       200,
  SCRIPT_TAGS:            ['KAITHI', 'DEVANAGARI', 'LATIN', 'URDU', 'OTHER'],
} as const
```

Config that changes rarely does not need a database. If runtime-configurable config is needed in future, add a `config` table with a single row.

---

## 5. Route Changes

### `auth.ts` (root)

Login no longer reads the full users sheet to find a row. Uses:

```sql
SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1
```

`last_login_at` update is a targeted single-column `UPDATE` instead of a full row rewrite.

---

### `app/api/regions/save-label/route.ts`

Simplified significantly. Removed all Sheets-specific workarounds (row number passing, `updateTaskRowDirect`).

```
Old flow:  getTask (full scan) + getRegion (full scan) → sequential → ~3–4 Sheets reads
New flow:  getTaskById (index) + getRegionById (index) → parallel → 2 SQL lookups

Old save:  read all labels for region → find max version → write new row + update old → ~2–4 writes
New save:  UPDATE is_latest=0 + INSERT → 2 SQL statements
```

Stats are now computed with a single SQL aggregate:

```sql
SELECT COUNT(*) as all_time,
       SUM(CASE WHEN created_at LIKE '2026-06-11%' THEN 1 ELSE 0 END) as today
FROM labels WHERE labeler_email = ? AND is_latest = 1
```

---

### `app/api/admin/list-tasks/route.ts`

Previously fetched the entire tasks sheet into memory to build an "already imported" set. Now uses a targeted `IN` query:

```sql
SELECT ls_task_id, task_id, status FROM tasks WHERE ls_task_id IN (?,?,?...)
```

Only the specific LS task IDs shown on the current import page are queried.

---

### `app/api/health/route.ts`

Updated to check Turso connectivity instead of Google Sheets:

```ts
async function testTurso(): Promise<boolean> {
  await db.execute('SELECT 1')
  return true
}
```

Response key changed from `sheets` → `database`.

---

## 6. Transition Bug Fixed

**Bug:** `submit-labeling` tried to transition `LABELING_IN_PROGRESS → READY_FOR_REVIEW` directly, which was blocked by `transitions.ts`. The original design required a detour through the `LABELED` state, but the route skipped it.

**Fix:** Added `READY_FOR_REVIEW` to allowed transitions from `LABELING_IN_PROGRESS`:

```ts
LABELING_IN_PROGRESS: ['LABELED', 'READY_FOR_LABELING', 'READY_FOR_REVIEW'],
```

`LABELED` remains as a valid intermediate state (used if a caller wants to manually advance through it), but submit can now go direct.

---

## 7. Hydration Warning Fixed

`<body suppressHydrationWarning>` added to `app/layout.tsx`. Browser extensions (Grammarly, ColorZilla) inject attributes into `<body>` after server render, causing React hydration mismatch warnings. `suppressHydrationWarning` tells React to ignore attribute differences on that element.

---

## 8. Performance Results (measured live)

| Route | Sheets (estimated) | Turso (measured) | Factor |
|---|---|---|---|
| `save-label` p50 | ~8 000ms | **432ms** | 18× |
| `save-label` p95 | ~12 000ms | **806ms** | 15× |
| Task claim | ~7 000ms | **406ms** | 17× |
| Labeler dashboard | ~6 000ms | **436ms** | 14× |
| Task workspace load | ~4 000ms | **359ms** | 11× |
| Login (bcrypt) | ~1 000ms | **1 050ms** | same — intentional |
| Task import | ~10 000ms | **1 249ms** (app) | ~8× |

Remaining latency is Turso HTTP RTT to `aws-ap-south-1` (~130–160ms per query from India) plus bcrypt on login.

---

## 9. Environment Variables

### Added
```env
# Turso database
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=eyJ...
```

### Removed
```env
# Google Sheets — no longer needed
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=...
GOOGLE_SHEET_ID=...
```

---

## 10. Packages

### Added
```
@libsql/client     — Turso HTTP client
dotenv             — for scripts/migrate.ts (tsx doesn't auto-load .env.local)
```

### Removed
```
googleapis         — Google Sheets SDK (47 packages, ~8MB removed)
```

---

## 11. Files Changed in Phase 5.2

```
lib/
  db.ts                           [NEW]      Turso singleton client
  googleSheets.ts                 [DELETED]  Replaced by db.ts
  sheetColumns.ts                 [DELETED]  Column order constants no longer needed
  appConfig.ts                    [MODIFIED] Reads hardcoded const, not Sheet
  users.ts                        [MODIFIED] Full SQL rewrite
  tasks.ts                        [MODIFIED] Full SQL rewrite (removed updateTaskRowDirect)
  regions.ts                      [MODIFIED] Full SQL rewrite (createRegions → createRegionsBatch)
  labels.ts                       [MODIFIED] Full SQL rewrite
  reviews.ts                      [MODIFIED] Full SQL rewrite
  syncQueue.ts                    [MODIFIED] Full SQL rewrite
  auditLog.ts                     [MODIFIED] Full SQL rewrite
  transitions.ts                  [MODIFIED] Added READY_FOR_REVIEW to LABELING_IN_PROGRESS

scripts/
  migrate.ts                      [NEW]      One-time schema creation + user seed
  users-seed.json                 [NEW]      User rows from old Google Sheet

auth.ts                           [MODIFIED] SQL rewrite (login, auto-register)

app/
  layout.tsx                      [MODIFIED] Added suppressHydrationWarning to <body>
  actions/
    auth.ts                       [MODIFIED] SQL rewrite (registerAction)
  api/
    test-sheet/route.ts           [DELETED]  Sheet connectivity test, no longer relevant
    health/route.ts               [MODIFIED] Tests Turso instead of Sheets
    tasks/
      available/route.ts          [MODIFIED] SQL aggregate for stats (no label sheet scan)
    regions/
      save-label/route.ts         [MODIFIED] Simplified — no Sheets workarounds
    admin/
      assign-role/route.ts        [MODIFIED] Targeted SQL UPDATE
      disable-user/route.ts       [MODIFIED] Targeted SQL UPDATE
      list-tasks/route.ts         [MODIFIED] IN query instead of full sheet scan
      import-task/[lsTaskId]/     [MODIFIED] createRegionsBatch rename
  labeler/
    page.tsx                      [MODIFIED] SQL aggregate stats (no label sheet scan)
  admin/
    users/page.tsx                [MODIFIED] Uses listAllUsers() instead of readSheetAsObjects

.env.local
  TURSO_DATABASE_URL              [NEW]
  TURSO_AUTH_TOKEN                [NEW]
  GOOGLE_SERVICE_ACCOUNT_EMAIL    [REMOVED]
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY [REMOVED]
  GOOGLE_SHEET_ID                 [REMOVED]

docs/
  PHASE_5_2_REFERENCE.md         [NEW] this file
```

---

## 12. What Phase 6 Needs to Know

Phase 6 is the **reviewer workspace** — the queue where reviewers see submitted tasks and approve/reject individual regions.

### Query patterns to use

```ts
// Get tasks ready for review
import { listTasksForReview } from '@/lib/tasks'
// Returns tasks with status READY_FOR_REVIEW or READY_FOR_RE_REVIEW

// Get latest label for display in reviewer UI
import { listLatestLabelsByTask } from '@/lib/labels'
// Returns Record<region_id, Label> (is_latest = 1 only)

// Record a review decision
import { createReview } from '@/lib/reviews'
// Inserts into reviews table

// Advance region after review
import { updateRegionStatus } from '@/lib/regions'
// REVIEW_PENDING → APPROVED | TEXT_WRONG | SCRIPT_WRONG | BOTH_WRONG | NEEDS_CORRECTION
```

### Batch region updates

When a reviewer approves all regions at once, use `db.batch()` from `lib/db.ts` for N concurrent `UPDATE` statements — do not loop sequentially. See `createRegionsBatch` in `lib/regions.ts` for the pattern.

### Lock pattern for reviewer

The reviewer lock follows the same pattern as labeler lock: `setTaskLock()` + `updateTaskStatus(taskId, 'REVIEWING_IN_PROGRESS')`. A `refresh-lock` route already exists from Phase 4.

### Submit path for reviewer

```
REVIEWING_IN_PROGRESS → FINAL_APPROVED   (all regions approved)
REVIEWING_IN_PROGRESS → NEEDS_CORRECTION (one or more regions rejected)
REVIEWING_IN_PROGRESS → READY_FOR_REVIEW (reviewer releases — rare)
```

All three transitions are already in `transitions.ts`.
