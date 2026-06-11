# Phase 6 Reference — Reviewer Workspace

**Status:** Complete ✅
**Builds on:** Phase 5.2 (Turso migration)
**Next phase reads:** Phase 7 (Correction flow)

---

## 1. What Phase 6 Added

Phase 6 implements the **reviewer side** of the workflow. Reviewers can see tasks submitted by labelers, claim them, and approve or reject each region.

High-level workflow:
1. Reviewer sees `READY_FOR_REVIEW` and `READY_FOR_RE_REVIEW` tasks on the dashboard.
2. Reviewer claims a task (acquires lock, moves to `REVIEWING_IN_PROGRESS`).
3. Reviewer opens workspace and inspects each region.
4. For each region, reviewer selects:
   - **Approve**
   - **Text Wrong** (rejects transcription)
   - **Script Wrong** (corrects script tag)
   - **Both Wrong**
5. When all regions have a decision, reviewer submits.
6. Task moves to `FINAL_APPROVED` (if all approved) or `NEEDS_CORRECTION` (if any rejected).
7. If `FINAL_APPROVED`, a `sync_queue` row is created.

---

## 2. New Files and Routes

### `app/api/review/tasks/route.ts`
**`GET /api/review/tasks`**
Returns the dashboard stats and task lists. Used in `app/reviewer/page.tsx`.
- First review queue: `READY_FOR_REVIEW` tasks not locked by others.
- Re-review queue: `READY_FOR_RE_REVIEW` tasks not locked by others.
- Currently claimed task.

### `app/api/review/claim/route.ts`
**`POST /api/review/claim`**
Claims a task for review.
- Requires `READY_FOR_REVIEW` or `READY_FOR_RE_REVIEW`.
- Sets lock and moves to `REVIEWING_IN_PROGRESS`.
- Logs `REVIEW_CLAIMED`.

### `app/api/review/release/route.ts`
**`POST /api/review/release`**
Releases a claimed review task without submitting.
- Restores status to `READY_FOR_REVIEW`.
- Logs `REVIEW_RELEASED`.

### `app/api/review/region/route.ts`
**`POST /api/review/region`**
Saves a review decision for a single region.
- Inserts a new row into the `reviews` table.
- Region status moves to `APPROVED` or `NEEDS_CORRECTION`.
- If `final_script_tag` changed, updates the `regions` table.
- Updates task counters (`approved_region_count`, `rejected_region_count`).

### `app/api/review/submit/route.ts`
**`POST /api/review/submit`**
Submits the entire task review.
- Checks that all regions are either `APPROVED` or `NEEDS_CORRECTION`.
- If all regions are `APPROVED`, moves task to `FINAL_APPROVED` and creates a `sync_queue` entry.
- If any region is `NEEDS_CORRECTION`, moves task to `NEEDS_CORRECTION` (for labeler to fix in Phase 7).
- Releases task lock.
- Logs `REVIEW_SUBMITTED`.

### `app/reviewer/page.tsx`
The reviewer dashboard (Server Component). Displays statistics, current active task, and queues for first review and re-review. Uses the `TaskCard` component.

### `app/reviewer/ReviewerTaskActions.tsx`
Client components for the reviewer dashboard (`ReviewClaimButton`, `ReviewReleaseButton`). Handles the claim and release button state and POST requests.

### `app/reviewer/task/[taskId]/page.tsx`
The server component wrapper for the review workspace.
- Fetches `regions`, `labels`, and `reviews` in parallel.
- Passes data to `ReviewWorkspaceClient`.
- Resolves the Next.js 16 dynamic `params` Promise properly.

### `app/reviewer/task/[taskId]/ReviewWorkspaceClient.tsx`
The interactive review workspace Client Component.
- Similar two-panel layout to labeler workspace.
- Highlights current region in amber, approved in green, rejected in red.
- Displays labeler's text (read-only) and allows changing the script tag.
- Has a 3-minute lock heartbeat interval.
- Submits decisions to `/api/review/region`.
- Submits the task to `/api/review/submit`.

### `lib/tasks.ts`
Added two helpers:
- `listTasksNeedingCorrection`: Future-proofs Phase 7 correction flow.
- `incrementReviewCount`: Atomic update to task `approved_region_count` or `rejected_region_count`.

---

## 3. Key Decisions

- **Lock Sharing**: Reviewers use the same `locked_by` and `lock_expires_at` columns as labelers. The lock semantics and 3-minute heartbeat refresh (`/api/tasks/refresh-lock`) are identical.
- **Review Notes**: Reviewers can leave a text note. During re-review (after correction), the previous note is displayed as read-only context above the new decision block.
- **Script Tags**: The script tag dropdown shows all 5 options, with the current `script_tag_final` pre-selected.
- **Sync Queue**: A `sync_queue` entry is created immediately when a task reaches `FINAL_APPROVED`. The background worker (Phase 8) will process these.
- **Next.js 16 Dynamic Routes**: Next.js 16 requires dynamic route `params` to be awaited. This was correctly implemented in `page.tsx`.

---

## 4. Environment Variables

No new environment variables added in Phase 6.

---

## 5. Next Steps for Phase 7 (Correction Flow)

Phase 7 will build the **correction flow** for labelers. Labelers will see tasks in the `NEEDS_CORRECTION` status on their dashboard. They will open the labeling workspace, which will display the reviewer's reject note and allow them to fix the text or script. Once corrected, they will submit the task, which will move it to `READY_FOR_RE_REVIEW`, sending it back to the reviewer queue.
