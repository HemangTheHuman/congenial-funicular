# Phase 3 Reference — Label Studio Task Import

**Status:** Complete ✅  
**Builds on:** Phase 0 (auth, sheets), Phase 1 (proxy, roles), Phase 2 (domain libs)  
**Next phase reads:** Phase 4 (labeling UI — task assignment, labeling workspace)

---

## 1. What Phase 3 Added

Phase 3 is the **import pipeline** — pulling tasks from Label Studio into the app so labelers can begin work. Before Phase 3, the Google Sheet was empty. After Phase 3, an admin can import one task or a whole batch, and each task appears in the Sheet with its regions ready for labeling.

High-level flow:

```
Admin → /admin/import
  → selects project, picks tasks (filter: review=approved & excel=none — applied server-side by LS)
  → POST /api/admin/import-task/:lsTaskId   (single)
  → POST /api/admin/import-batch            (many)
      ↓
  Step 1  duplicate check (Sheet read)
  Step 2  getTask() from Label Studio         ← raw data + project extracted here
  Step 3  parseLsTask() → ParsedLsTask + ParsedLsRegion[]
  Step 4  createTask()        → 1 Sheets write (tasks tab)
  Step 5  createRegions()     → 1 Sheets write (regions tab, all regions at once)
  Step 6  updateTaskStatus()  → 1 Sheets write (IMPORTED → READY_FOR_LABELING)
  Step 7  logAction()         → 1 Sheets write (audit_logs tab)
  Step 8  markTaskImported()  → PATCH /api/tasks/:id/ in LS  (excel: "none" → "pending")
```

---

## 2. New Files

### `utils/bbox.ts`

Pure math — no IO, no network, fully testable.

```ts
import { pctToPixel, padBbox, pixelToPct } from '@/utils/bbox'
import type { PixelBbox } from '@/utils/bbox'
```

| Function | Purpose |
|---|---|
| `pctToPixel(xPct, yPct, widthPct, heightPct, origW, origH)` | LS `%` bbox → absolute pixel coords |
| `padBbox(bbox, origW, origH, padFraction)` | Expand bbox outward (e.g. 1.5% padding for crop preview) |
| `pixelToPct(bbox, origW, origH)` | Pixel bbox → LS `%` format (for sync writeback in Phase 11) |
| `percentToPixels(bbox, origW, origH)` | Legacy alias for `pctToPixel` (object form) — kept for Phase 0 callers |

All functions clamp to image bounds. `padBbox` never returns negative coords or coords beyond image size.

---

### `lib/labelStudioParser.ts`

Owns all knowledge of the raw LS task JSON shape.

```ts
import { parseLsTask } from '@/lib/labelStudioParser'
import type { ParsedLsTask, ParsedLsRegion } from '@/lib/labelStudioParser'
```

**Key types:**

```ts
interface ParsedLsTask {
  ls_task_id: string       // String(task.id)
  project_id: string       // String(task.project)
  image_url: string        // resolved from task.data (see §5)
  original_width: number
  original_height: number
  regions: ParsedLsRegion[]
}

interface ParsedLsRegion {
  ls_region_id: string
  order_index: number      // 0-based, sorted top-to-bottom left-to-right
  bbox_x_percent: number   // raw LS percent coords
  bbox_y_percent: number
  bbox_width_percent: number
  bbox_height_percent: number
  bbox_xmin: number        // converted pixel coords (via pctToPixel)
  bbox_ymin: number
  bbox_xmax: number
  bbox_ymax: number
  rotation: number
  script_tag: string       // value.labels[0] from the "labels" result item, or ''
}
```

**Actual LS annotation format** (confirmed from live instance — differs from LS docs):

Each region in `annotations[0].result` is represented by **two items sharing the same `id`**:

```json
// Item 1 — bounding box
{ "id": "abc", "type": "rectangle", "from_name": "bbox",
  "value": { "x": 19.7, "y": 2.6, "width": 4.1, "height": 2.9, "rotation": 0 },
  "original_width": 14105, "original_height": 10584 }

// Item 2 — script label (same id)
{ "id": "abc", "type": "labels", "from_name": "label",
  "value": { "labels": ["Devanagri"], "x": 19.7, "y": 2.6, ... } }
```

> ⚠️ **Not `rectanglelabels`** — this project uses separate `rectangle` + `labels` items. If you encounter a different LS template, update `isRectangleItem` type guard and `extractScriptTag` in the parser.

**Image URL resolution:** `task.data` field name is not fixed — the parser tries `image`, `image_url`, `img`, `file_upload`, `url`, `src` in order, then scans all string values for a URL-like string. If the project changes its data schema, check the candidate list in `resolveImageUrl()`.

**Reading order sort:** Regions are sorted by `y` then `x` percent. A 1% y-tolerance groups regions on the same row before sorting left-to-right.

---

### `lib/labelStudio.ts` (modified)

Previously used `Authorization: Token <token>` (DRF style). **Changed to JWT Bearer flow** because this LS instance (v1.23.0) uses simplejwt.

**Auth strategy:**
- `.env.local` stores the **refresh token** (`LABEL_STUDIO_API_TOKEN`)
- Before each request, `getAccessToken()` exchanges it for a short-lived **access token** via `POST /api/token/refresh/`
- Access token is cached in-process for 4 minutes (expires in ~5 min)
- All requests use `Authorization: Bearer <access_token>`

**Never** send the refresh token directly to LS API endpoints — it will 401. Only use it with `/api/token/refresh/`.

**`listProjectTasks` — server-side filter support:**

```ts
import { listProjectTasks } from '@/lib/labelStudio'
import type { LsFilterQuery, LsTaskListEntry } from '@/lib/labelStudio'

const result = await listProjectTasks(
  projectId,
  page,
  pageSize,
  query   // optional LsFilterQuery — passed as ?query=<JSON> to LS
)
// result: { tasks: LsTaskListEntry[], total: number }
// LsTaskListEntry: { id: number, data: Record<string, unknown> }
```

**Filter format** (LS `?query=` parameter):

```ts
const IMPORT_FILTER: LsFilterQuery = {
  filters: {
    conjunction: 'and',
    items: [
      { filter: 'filter:tasks:data.review', operator: 'equal', type: 'String', value: 'approved' },
      { filter: 'filter:tasks:data.excel',  operator: 'equal', type: 'String', value: 'none'     },
    ],
  },
}
```

This is equivalent to the curl:
```bash
curl -G "$LS_URL/api/tasks/" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'query={"filters":{"conjunction":"and","items":[]}}'
```

**`lsPatch` — PATCH helper:**

```ts
import { lsPatch } from '@/lib/labelStudio'
await lsPatch('/api/tasks/156/', { project: 1, data: { ... } })
```

Same auth flow as `lsGet` / `lsPost` — uses the cached Bearer access token.

**`markTaskImported` — post-import LS writeback:**

```ts
import { markTaskImported } from '@/lib/labelStudio'

// Called as the LAST step in importSingleTask(), after all Sheet writes succeed.
await markTaskImported(
  lsTaskId,         // number or string
  lsProjectId,      // from raw.project (number)
  lsOriginalData    // from raw.data — full object, preserves "ocr" and all other fields
)
```

The PATCH body is:
```json
{
  "project": <projectId>,
  "data": {
    ...originalData,     // all existing fields preserved (especially "ocr")
    "review": "approved",
    "excel": "pending"   // was "none" — this removes it from future import batches
  }
}
```

---

### `lib/regions.ts` (modified — `createRegions` added)

```ts
import { createRegions } from '@/lib/regions'
```

**Critical:** Never loop `createRegion()` for bulk inserts — one call per region = one Sheets write per region = quota exhaustion (confirmed: task with 80 regions hit the 60 writes/min/user limit).

```ts
// ❌ WRONG — N Sheets API calls
for (const r of parsedRegions) {
  await createRegion({ ...r })
}

// ✅ CORRECT — 1 Sheets API call for all regions
const regions = await createRegions(parsedRegions.map(r => ({ ...r })))
```

`createRegions` generates unique `region_id` (prefix `RG`) and timestamps for each row, then calls `appendRows` (a new helper in `googleSheets.ts`) to write all rows in a single `spreadsheets.values.append` call.

---

### `lib/googleSheets.ts` (modified — `appendRows` added)

```ts
import { appendRows } from '@/lib/googleSheets'

// Writes all rows in ONE API call
await appendRows('regions', [
  ['RG001', 'TSK001', ...],
  ['RG002', 'TSK001', ...],
])
```

---

## 3. API Routes

### `POST /api/admin/import-task/:lsTaskId`

**Auth:** ADMIN only  
**Body:** `{ batch_id?: string }`

**Response codes:**

| Code | Meaning |
|---|---|
| `200` | `{ task, regionCount, message }` |
| `409` | Already imported — `{ task_id, ls_task_id }` |
| `422` | Task has no annotations/regions |
| `502` | Label Studio unreachable or returned error |
| `500` | Parse error or Sheet write failure |

**Exports `importSingleTask()`** — the core import logic lives in this file and is re-exported for the batch route. Do not duplicate it.

```ts
import { importSingleTask } from '@/app/api/admin/import-task/[lsTaskId]/route'
// Returns: { task, regions, regionCount, alreadyExisted }
```

---

### `POST /api/admin/import-batch`

**Auth:** ADMIN only  
**Body:** `{ lsTaskIds: (number|string)[], batch_id?: string }`

Calls `importSingleTask()` **sequentially** (not parallel) — concurrent Sheet writes cause data corruption.

**Response:**
```ts
{
  total: number,
  imported: number,
  skipped: number,   // already existed
  failed: number,
  results: {
    lsTaskId: string,
    success: boolean,
    task_id: string | null,
    regionCount: number,
    skipped: boolean,
    error: string | null
  }[]
}
```

---

### `GET /api/admin/list-projects`

Returns all LS projects for the project dropdown.

```ts
// Response
{ projects: { id: number, title: string, task_count: number }[] }
```

---

### `GET /api/admin/list-tasks?projectId=:id&page=:n`

Returns tasks filtered server-side by `IMPORT_FILTER` (review=approved, excel=none).

```ts
// Response
{
  tasks: {
    lsTaskId: number,
    alreadyImported: boolean,
    task_id: string | null,
    status: string | null
  }[],
  total: number,           // count after filter
  totalInProject: number,  // count before filter (for UI context)
  page: number
}
```

**Import-status check uses a Set** — reads all imported `ls_task_id` values from the Sheet once, then does O(1) in-memory lookup per task. Never do one Sheet read per task.

---

### `GET /api/admin/debug-task/:lsTaskId` (DEV ONLY)

Returns the raw LS task JSON. **Delete before production.** Was used to discover the real LS annotation format during Phase 3 development.

---

## 4. Admin UI

### `/admin/import` — tabbed page

**Single Task tab:**
- Input: LS task ID + optional batch label
- POST to `/api/admin/import-task/:id`
- Inline success/error with region count

**Batch tab:**
- Project dropdown (from `/api/admin/list-projects`)
- Task checklist with filter context label: *"Showing 3 of 47 tasks where review=approved and excel=none"*
- Checkboxes — already-imported tasks are greyed and disabled
- Select all / deselect all
- POST to `/api/admin/import-batch`
- Results summary: imported / skipped / failed + error detail table

**Imported Tasks table** (bottom of page):
- Lists tasks with `status = IMPORTED` or `READY_FOR_LABELING`
- Refreshes server-side on each `router.refresh()` after import

The page uses `export const dynamic = 'force-dynamic'` so the Imported Tasks table always reflects current Sheet state.

---

## 5. Data Written to the Sheet

### `tasks` tab — one row per import

| Field | Value at import |
|---|---|
| `status` | `READY_FOR_LABELING` (auto-transitioned from `IMPORTED`) |
| `image_url` | Resolved from `task.data` field (see §2 parser note) |
| `image_preview_url` | `''` — not populated at import; Phase 4 may fill this |
| `original_width` / `original_height` | From `result[].original_width/height` |
| `region_count` | `parsed.regions.length` |
| `batch_id` | From `body.batch_id` or `''` |
| `sync_status` | `NOT_READY` |

### `regions` tab — N rows per import (one call)

| Field | Value at import |
|---|---|
| `status` | `PENDING_LABEL` |
| `script_tag_original` | From LS `value.labels[0]` — immutable after import |
| `script_tag_final` | Same as `script_tag_original` at import; labelers/reviewers update this |
| `is_active` | `TRUE` |
| `order_index` | 0-based reading order (sorted top→bottom, left→right) |

### `audit_logs` tab

One row written per import with action `TASK_IMPORTED`.

---

## 6. Key Gotchas & Design Decisions

### 6.1 Sheets write quota

Google Sheets allows ~60 writes/min/user. A task with 80 regions would exhaust this instantly if written one row at a time. **Always use `createRegions()` (bulk) not `createRegion()` in a loop.**

The same principle applies to any future bulk write — add a new `createXxxBulk()` function that calls `appendRows`.

### 6.2 JWT auth — two-token flow

`.env.local` holds a **refresh token**, not an access token. The refresh token has a long TTL (years). The access token is short-lived (5 min) and cached in-process. If you restart the dev server, the cache is cleared and the first request automatically refreshes.

If you see `Label Studio token refresh failed (401)`, the refresh token has been rotated. The admin must paste a new refresh token from LS Account & Settings into `.env.local`.

### 6.3 LS region format — `rectangle` + `labels` pairs

This project does NOT use `rectanglelabels` (a single result item type). It uses two separate items per region sharing the same `id`: `type: "rectangle"` for the bbox and `type: "labels"` for the script tag. The parser groups items by `id` to reunite them.

### 6.4 `importSingleTask` is the source of truth

All import logic (fetch → parse → write → transition → audit) lives in `importSingleTask()` exported from the single-import route. The batch route calls it in a loop. Never duplicate this logic — if you need to add a step (e.g. populate `image_preview_url`), add it there.

### 6.5 `script_tag_original` is immutable

Once written at import, `script_tag_original` must never be updated. It is the ground truth from LS. Only `script_tag_final` is modified by labelers/reviewers in later phases.

### 6.6 `markTaskImported` must be the last step

After a successful import, `markTaskImported()` PATCHes the LS task to set `excel="pending"`. This is deliberately the **last** action in `importSingleTask()`. Ordering matters:

- If any Sheet write fails (steps 4–7), the function throws before reaching step 8.
- The LS task stays as `excel="none"` → it remains in the import batch filter → admin can retry.
- If step 8 (the PATCH) fails after all Sheet writes succeed, the task is already in the Sheet. The duplicate-check at step 1 will catch it on retry and return a 409 — the admin knows it's already imported.

**Never reorder step 8 before the Sheet writes.** If you do, a failed Sheet write leaves the task permanently excluded from import batches with no data in the Sheet.

**The `ocr` field is critical.** The PATCH must spread `originalData` (the full `task.data` from LS) to preserve `ocr` and any other existing fields. Only `excel` is changed. Do not construct the data object from scratch.

---

## 7. What Phase 4 Needs to Know

Phase 4 will build the **labeling workspace** — the page where a labeler opens a task and transcribes each region. Key contracts:

### Task state on entry
When a labeler gets a task, it will have:
- `status = READY_FOR_LABELING`
- All regions with `status = PENDING_LABEL`
- `region_count` populated
- `image_url` pointing to the full-resolution image

### Region fields for the labeling UI
```ts
// From lib/regions.ts listRegionsByTask(taskId)
region.bbox_xmin     // pixel coords for crop display
region.bbox_ymin
region.bbox_xmax
region.bbox_ymax
region.order_index   // determines display order
region.script_tag_original  // show to labeler as hint (the LS annotation label)
region.script_tag_final     // labeler writes transcription here
region.status        // PENDING_LABEL → LABELED (after labeler saves)
```

### Task locking (Phase 4 must implement)
- When a labeler opens a task, set `locked_by = labeler_email` and `lock_expires_at = now + 30min`
- On lock expiry or explicit release, clear these fields and return status to `READY_FOR_LABELING`
- Check `locked_by` before assigning — never assign a locked task

### Transition to trigger
When the labeler saves the last region:
```
LABELING_IN_PROGRESS → LABELED → READY_FOR_REVIEW
```
Use `assertTaskTransition` from `lib/transitions.ts` before calling `updateTaskStatus`.

### Functions to use (already exist)
```ts
import { listRegionsByTask, updateRegionStatus } from '@/lib/regions'
import { getTaskById, updateTaskStatus, assignLabeler, lockTask, releaseTask } from '@/lib/tasks'
import { assertTaskTransition, assertRegionTransition } from '@/lib/transitions'
import { logAction } from '@/lib/auditLog'
```

---

## 8. Environment Variables (no new ones added in Phase 3)

Phase 3 reuses the two LS variables set in Phase 0:

```env
LABEL_STUDIO_BASE_URL=https://your-ls-instance.example.com
LABEL_STUDIO_API_TOKEN=<JWT refresh token from LS Account & Settings>
```

> The token format changed from Phase 0 (was `Token <opaque>`) to Phase 3 (is `Bearer <JWT access>` exchanged from the refresh token). The env var name is the same.

---

## 9. Files Changed in Phase 3

```
utils/
  bbox.ts                                         [EXPANDED] added pctToPixel, padBbox, pixelToPct

lib/
  labelStudio.ts                                  [MODIFIED] JWT Bearer auth, LsTaskListEntry type,
                                                             LsFilterQuery type, listProjectTasks + query param,
                                                             lsPatch() helper, markTaskImported() post-import writeback
  labelStudioParser.ts                            [NEW] parseLsTask(), ParsedLsTask, ParsedLsRegion
  regions.ts                                      [MODIFIED] createRegions() bulk insert
  googleSheets.ts                                 [MODIFIED] appendRows() batch write helper

app/
  api/
    admin/
      import-task/[lsTaskId]/route.ts             [NEW] POST — single import + exportable importSingleTask()
      import-batch/route.ts                       [NEW] POST — sequential batch import
      list-projects/route.ts                      [NEW] GET  — project dropdown data
      list-tasks/route.ts                         [NEW] GET  — filtered task list with import status
      debug-task/[lsTaskId]/route.ts              [NEW] GET  — DEV ONLY, delete before production
  admin/
    page.tsx                                      [MODIFIED] Import Tasks card now live (was disabled)
    import/
      page.tsx                                    [NEW] Tabbed import UI + imported tasks table
      ImportActions.tsx                           [NEW] Client components: SingleImportPanel, BatchImportPanel
```
