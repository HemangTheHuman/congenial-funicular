# Phase 7 Reference: Labeler Correction Workflow

## Overview

This phase implements the correction loop where labelers fix regions that were rejected by reviewers. It completes the loop allowing tasks to move seamlessly between `LABELER` and `REVIEWER` roles until fully approved.

## Core Implementations

1. **Correction Queue (`app/labeler/page.tsx`)**
   - The labeler dashboard now includes a "Corrections Needed" section.
   - It lists tasks assigned to the current labeler that have the `NEEDS_CORRECTION` status.

2. **Atomic Correction Claim (`lib/tasks.ts` & `app/api/tasks/claim-correction/route.ts`)**
   - Implemented `claimCorrectionTask` to atomically assign the lock and transition the task from `NEEDS_CORRECTION` to `CORRECTION_IN_PROGRESS`.

3. **Correction Workspace (`app/labeler/correction/[taskId]/`)**
   - A dedicated workspace for labelers to process rejections.
   - Similar to the standard labeling workspace, but:
     - It only shows regions that need correction (or have already been corrected in the current session) in the sidebar.
     - It displays the *Reviewer's Note* so the labeler understands what needs fixing.
     - All regions are still drawn on the full-page image, but only the targeted ones are interactive.

4. **Saving and Submitting**
   - `app/api/regions/save-label/route.ts`: Updated so that saving a label on a region with `NEEDS_CORRECTION` or `CORRECTED` moves its status to `CORRECTED` (instead of `LABELED`).
   - `app/api/tasks/submit-correction/route.ts`: Submitting the task checks that there are no remaining regions in `NEEDS_CORRECTION`, and transitions the task to `READY_FOR_RE_REVIEW`.

## Key Files Created/Modified

- `app/labeler/page.tsx` (Modified to show corrections)
- `app/labeler/CorrectionTaskActions.tsx` (New: Claim action)
- `app/labeler/correction/[taskId]/page.tsx` (New: Workspace server wrapper)
- `app/labeler/correction/[taskId]/CorrectionWorkspaceClient.tsx` (New: Interactive correction UI)
- `app/api/tasks/claim-correction/route.ts` (New: API)
- `app/api/tasks/submit-correction/route.ts` (New: API)
- `app/api/regions/save-label/route.ts` (Modified: Status transition logic)
- `lib/tasks.ts` (Modified: `claimCorrectionTask` added)
- `lib/reviews.ts` (Modified: `listLatestReviewsByTask` added)

## State Transitions Handled

**Task:**
- `NEEDS_CORRECTION` → `CORRECTION_IN_PROGRESS` (on claim)
- `CORRECTION_IN_PROGRESS` → `READY_FOR_RE_REVIEW` (on submit)

**Region:**
- `NEEDS_CORRECTION` → `CORRECTED` (on save)

## Recent Enhancements & Polish (Phase 7.1)

1. **Re-Review Filtering & Context (`app/reviewer/task/[taskId]/ReviewWorkspaceClient.tsx`)**
   - During a re-review, regions that were `APPROVED` in previous rounds are excluded from the interactive queue so reviewers only focus on the corrected regions.
   - The previously approved regions are still rendered on the full-page canvas as locked, non-interactive visual references.
   - Preserves original region indexing to maintain parity with the labeler's view.

2. **Dashboard Statistics Updates**
   - Refactored `app/labeler/page.tsx` and `app/reviewer/page.tsx` to accurately count distinct tasks rather than regions for the daily and all-time aggregate stats.

3. **UX & State Fixes**
   - Fixed a `TASK_TRANSITIONS` bug in `lib/transitions.ts` that blocked tasks from moving from `CORRECTION_IN_PROGRESS` to `READY_FOR_RE_REVIEW`.
   - Prevented loading state flicker during task claim/routing transitions across Labeler and Reviewer dashboards.
   - Globally enforced `cursor-pointer` on all Base UI buttons (`components/ui/button.tsx`).

## Next Steps

Phase 8 will handle the final writeback, syncing tasks in `FINAL_APPROVED` back to Label Studio via a cron queue or an admin retry screen.
