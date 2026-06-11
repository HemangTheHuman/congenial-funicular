# Phase 5.1 Reference — Labeling Workspace

**Status:** Complete ✅  
**Builds on:** Phase 0–4 (auth, sheets, domain libs, LS import, task claim)  
**Next phase reads:** Phase 5.2 (database migration: Google Sheets → Turso)

---

## 1. What Phase 5 Added

Phase 5 is the **labeling workspace** — the full-screen UI where a labeler opens a claimed task and transcribes each bounding-box region. Before Phase 5, `/labeler/task/[taskId]` was a placeholder stub card (\"coming soon\"). After Phase 5, a labeler can:

1. See the full task image with all bounding boxes highlighted and numbered.
2. Navigate between regions (← → keys or clicking on the image overlay).
3. Type a transcription text or mark a region as unreadable.
4. Save a single region (auto-advances to next).
5. Resume a partially-labeled task — already-saved regions are pre-populated from the DB.
6. Submit when all regions are done → task moves to `READY_FOR_REVIEW`.

High-level flow:

```
GET /labeler/task/[taskId]  (server component, auth-guarded)
  → getTaskById()           — verifies task exists and caller holds lock
  → listRegionsByTask()     — ordered by order_index, is_active=true only
  → listLatestLabelsByTask() — pre-populates saved labels
  → WorkspaceClient (RSC → Client boundary)

User labels a region:
  POST /api/regions/save-label
    → getTaskById() + getRegionById()  (parallel)
    → createNewLabelVersion()          — versioned label insert
    → updateRegionStatus()             — PENDING_LABEL → LABELED/UNREADABLE
    → incrementRegionCount()           — task.labeled_region_count++

User clicks Submit:
  POST /api/tasks/submit-labeling
    → guard: all regions LABELED or UNREADABLE
    → updateRegionStatus() × N        — each → REVIEW_PENDING
    → updateTaskStatus()              — LABELING_IN_PROGRESS → READY_FOR_REVIEW
    → releaseTaskLock()               — clears locked_by
```

---

## 2. Modified Files

### `app/labeler/task/[taskId]/page.tsx` (modified — was stub)

Server component. Replaces the Phase 4 placeholder with a full page layout.

**Auth guard:**
```ts
if (!task || task.locked_by !== email) redirect('/labeler')
```
If the user doesn't hold the lock (expired, released, or wrong user), they are immediately redirected back to the dashboard. No error page.

**Data fetching (parallel):**
```ts
const [regions, existingLabels] = await Promise.all([
  listRegionsByTask(taskId),
  listLatestLabelsByTask(taskId),
])
```

**Label map construction:**
```ts
const labelMap: Record<string, Label> = {}
for (const label of existingLabels) {
  labelMap[label.region_id] = label
}
```
Passed to `WorkspaceClient` so the client initialises with the correct `saved: true` state for already-labeled regions.

**Crop computation (server-side, no padding):**
```ts
// Exact bbox — zero padding (Phase 5 fix: CROP_PAD = 0)
cropXmin:   r.bbox_xmin,
cropYmin:   r.bbox_ymin,
cropWidth:  r.bbox_xmax - r.bbox_xmin,
cropHeight: r.bbox_ymax - r.bbox_ymin,
```
The crop is passed as `RegionWithCrop` — the client never recomputes it.

**`RegionWithCrop` type** (defined in `page.tsx`, imported by `WorkspaceClient.tsx`):
```ts
export interface RegionWithCrop extends Region {
  cropXmin:   number
  cropYmin:   number
  cropWidth:  number
  cropHeight: number
}
```

---

### `app/labeler/task/[taskId]/WorkspaceClient.tsx` (new — Client Component)

The only `'use client'` component in the workspace. All interactivity lives here.

**Layout:** Two-panel split.

```
┌─────────────────────────────┬──────────────────────────┐
│  LEFT: Full page image      │  RIGHT: Labeling panel   │
│  (lg:w-1/2 xl:w-3/5)       │  (lg:w-1/2 xl:w-2/5)    │
│                             │                          │
│  <img> full image           │  Progress header         │
│  + bbox overlays (absolute) │  Crop preview            │
│    amber = current          │  Script tag badge        │
│    indigo = others          │  Transcription textarea  │
│                             │  Unreadable checkbox     │
│                             │  Save & Next button      │
│                             │  Submit button           │
│                             │  Region grid (mini map)  │
└─────────────────────────────┴──────────────────────────┘
```

On mobile (< `lg`) only one panel is shown at a time, toggled by an Eye/EyeOff button.

---

#### State

| State | Type | Purpose |
|---|---|---|
| `currentIndex` | `number` | Which region is active (0-based) |
| `inputs` | `Record<string, RegionInput>` | Per-region `{ text, isUnreadable, saved }` |
| `saveStatus` | `'idle'\|'saving'\|'saved'\|'error'` | Spinner / feedback for save button |
| `submitStatus` | `'idle'\|'submitting'\|'success'\|'error'` | Spinner / feedback for submit |
| `showFullPage` | `boolean` | Mobile: toggle left panel visibility |

**`inputs` initialisation:** Pre-populated from `labelMap` passed by the server component. `saved: existing != null` — a region with an existing label starts as saved (green dot in the mini-map).

---

#### Crop Preview Rendering

No `<canvas>`. Uses CSS `overflow: hidden` on a sized container with an absolutely-positioned full image shifted by the crop origin:

```ts
const MAX_DISPLAY = 280  // max container dimension (px)
const MAX_SCALE   = 2.0  // never upscale more than 2× (avoids pixelation on tiny bboxes)
const scale = Math.min(MAX_DISPLAY / cropW, MAX_DISPLAY / cropH, MAX_SCALE)

// Container: exact crop dimensions at scale
<div style={{ width: displayW, height: displayH }}>
  <img style={{
    position:  'absolute',
    width:     task.original_width  * scale,
    height:    task.original_height * scale,
    left:      -region.cropXmin * scale,
    top:       -region.cropYmin * scale,
    // Rotation: pivot at the bbox centre in scaled image space
    transform:       region.rotation ? `rotate(${region.rotation}deg)` : undefined,
    transformOrigin: `${centerX}px ${centerY}px`,
  }} />
</div>
```

**Rotation handling:** `transformOrigin` is set to the centre of the bbox in scaled image coordinates so the crop rotates around the correct point:
```ts
const centerX = (region.cropXmin + cropW / 2) * scale
const centerY = (region.cropYmin + cropH / 2) * scale
```

**Why `MAX_SCALE = 2.0`?** Small bboxes (e.g. 20×8px) would be scaled up enormously without a cap, producing a blurry pixelated preview. 2× is the maximum useful upscale for a screen display.

---

#### Bbox Overlay on Full Image

All regions are drawn as `position: absolute` divs using the **percent-based** bbox fields:

```tsx
<div style={{
  position: 'absolute',
  left:   `${r.bbox_x_percent}%`,
  top:    `${r.bbox_y_percent}%`,
  width:  `${r.bbox_width_percent}%`,
  height: `${r.bbox_height_percent}%`,
  transform:       r.rotation ? `rotate(${r.rotation}deg)` : undefined,
  transformOrigin: 'center',
  border: i === currentIndex
    ? '2px solid #f59e0b'   // amber — current
    : '1.5px solid rgba(99,102,241,0.6)',  // indigo — others
  background: i === currentIndex
    ? 'rgba(245,158,11,0.18)'
    : 'rgba(99,102,241,0.08)',
}}
```

Clicking any bbox overlay jumps `currentIndex` to that region.

---

#### Lock Refresh Heartbeat

A `useEffect` sets an interval every 3 minutes that POSTs to `/api/tasks/refresh-lock`. This extends the 30-minute lock so it doesn't expire mid-labeling session. The timer is cleared on unmount.

```ts
const INTERVAL_MS = 3 * 60 * 1000
const timer = setInterval(refreshLock, INTERVAL_MS)
return () => clearInterval(timer)
```

The `/api/tasks/refresh-lock` route was built in Phase 4 and was awaiting this wiring.

---

#### Keyboard Shortcuts

| Key | Action |
|---|---|
| `→` | Next region (if not in textarea) |
| `←` | Previous region (if not in textarea) |
| `U` / `u` | Toggle unreadable on current region |
| `Ctrl + Enter` | Save & Next (fires inside textarea) |

Textarea and input elements are excluded from `→`/`←` handling so typing doesn't accidentally navigate.

---

#### `allDone` and Submit Guard

```ts
const savedCount  = regions.filter((r) => inputs[r.region_id]?.saved).length
const allDone     = savedCount === regions.length && regions.length > 0
```

The Submit button is `disabled={!allDone || submitStatus === 'submitting' || submitStatus === 'success'}`. Its label shows live progress: `"Submit for Review (3/5)"`.

On success → 1.2 second delay then `router.push('/labeler')`.

---

#### Region Grid (Mini-map)

A scrollable row of small numbered buttons at the bottom-right panel. Colour coding:

| Colour | Meaning |
|---|---|
| `bg-primary` (blue ring) | Current region |
| `bg-emerald-100 text-emerald-800` | Saved ✓ |
| `bg-muted text-muted-foreground` | Not yet saved |

Clicking any button jumps to that region.

---

## 3. New API Routes

### `POST /api/regions/save-label`

Auth: LABELER or ADMIN

**Body:**
```ts
{
  task_id:        string
  region_id:      string
  text:           string
  is_unreadable:  boolean
  local_client_id?: string  // optional — idempotency key from client
}
```

**Steps:**
1. Parallel: `getTaskById(task_id)` + `getRegionById(region_id)`
2. Guard: `task.locked_by === email`, `region.task_id === task_id`
3. `createNewLabelVersion()` — demotes old `is_latest`, inserts new label row
4. Parallel: `updateRegionStatus(region_id, 'LABELED'|'UNREADABLE')` + `incrementRegionCount(task_id, 'labeled', 1)` (skipped if already labeled)
5. `logAction()` — fire-and-forget (`.catch(() => {})`)

**Re-save behaviour:** If a region is already `LABELED` and the user re-saves it, a new label version is created (version counter increments, old `is_latest = false`). The region count is **not** incremented again (`alreadyLabeled` guard).

**Response:** `{ label: Label, region: Region }` with 200.

---

### `POST /api/tasks/submit-labeling`

Auth: LABELER or ADMIN

**Body:** `{ task_id: string }`

**Guards (in order):**
1. Task exists → 404
2. `task.locked_by === email` → 403
3. All active regions must be `LABELED` or `UNREADABLE` → 422 `{ error: "N region(s) still need to be labeled", remaining: N }`
4. At least one region exists → 422 `{ error: "Task has no active regions" }`

**Steps:**
1. `updateRegionStatus(region_id, 'REVIEW_PENDING')` for each region (sequential loop — 5–15 regions, acceptable)
2. `updateTaskStatus(task_id, 'READY_FOR_REVIEW')`
3. `releaseTaskLock(task_id)` — clears `locked_by` and `lock_expires_at`
4. `logAction('TASK_SUBMITTED')`

**Response:** `{ task: Task }` with 200.

> ⚠️ **Note (Phase 6 fix):** The original `transitions.ts` only allowed `LABELING_IN_PROGRESS → LABELED → READY_FOR_REVIEW`. This route skips the `LABELED` intermediate state and goes directly to `READY_FOR_REVIEW`. Phase 6 added `READY_FOR_REVIEW` to the allowed transitions from `LABELING_IN_PROGRESS` to fix the resulting 500 error.

---

## 4. Key Design Decisions

### No canvas — pure CSS crop
The crop preview uses `overflow: hidden` + absolute positioning instead of a `<canvas>` element. This avoids any canvas API calls, CORS issues with images, or animation frame loops. Performance is identical and the implementation is simpler.

### Zero crop padding
Phase 5 removed all crop padding (`CROP_PAD = 0`) so the preview shows **exactly** the bbox and nothing outside it. Previously padding was added to provide context, but it caused two nearby regions to bleed into each other's preview.

### Server computes crop bounds
Crop coordinates (`cropXmin`, `cropYmin`, `cropWidth`, `cropHeight`) are computed once on the server in `page.tsx` and passed as props to `WorkspaceClient`. The client never reads `bbox_xmin` etc. directly. This keeps the crop logic in one place and avoids duplicating the coordinate math.

### `inputs` state as source of truth for `saved`
The client doesn't re-fetch region status from the server after each save. `saved: true` is set optimistically after a successful `POST /api/regions/save-label` response. On page load, `saved` is initialised from `labelMap` (server-fetched labels). This means a hard refresh always reflects the true DB state.

### Lock refresh is fire-and-forget
`refreshLock` failures are silently ignored (`try/catch` with empty catch). If the lock cannot be extended, the worst case is the lock expires after 30 minutes and another user can steal the task. This is acceptable — the labeler's work is not lost (already saved to DB per-region).

### Submit disables itself immediately
After clicking Submit, `submitStatus = 'submitting'` disables the button instantly, preventing double-submit. The button does not re-enable on error — the user must refresh the page to retry (protects against repeated partial-submit attempts).

---

## 5. Files Changed in Phase 5

```
app/
  labeler/
    task/[taskId]/
      page.tsx              [MODIFIED] full server component (was Phase 4 stub)
                             — auth guard, parallel data fetch, crop math, RSC layout
      WorkspaceClient.tsx   [NEW] 'use client' — full labeling UI
                             — two-panel split, crop preview, bbox overlay,
                               textarea, unreadable toggle, save, submit,
                               keyboard shortcuts, lock heartbeat, region mini-map

  api/
    regions/
      save-label/route.ts   [NEW] POST — save one region label (versioned)
    tasks/
      submit-labeling/route.ts [NEW] POST — submit task for review

docs/
  PHASE_5_REFERENCE.md      [NEW] this file (Phase 5.1)
```

---

## 6. What Phase 5.2 Needs to Know

Phase 5.2 migrated the entire backend from Google Sheets to Turso (libSQL). The `WorkspaceClient` and `page.tsx` required **no changes** — their public API (function names, props, response shapes) was identical after the migration. The only Phase 5.1 file that changed in Phase 5.2 was `save-label/route.ts`, which was simplified to remove Sheets-specific workarounds after SQL indexed lookups made them unnecessary.

### Transition fix (done in Phase 5.2)
```ts
// transitions.ts — before Phase 5.2:
LABELING_IN_PROGRESS: ['LABELED', 'READY_FOR_LABELING']

// transitions.ts — after Phase 5.2 fix:
LABELING_IN_PROGRESS: ['LABELED', 'READY_FOR_LABELING', 'READY_FOR_REVIEW']
```
`submit-labeling` works correctly with this transition in place.
