# Phase 8 Reference: Label Studio Sync & Writeback

This document outlines the architecture, flow, and key components built for **Phase 8 (Label Studio Sync)**. The goal of this phase is to take tasks that have reached `FINAL_APPROVED` and securely push their final transliterations back to Label Studio without destroying existing metrics (like "Annotated By").

---

## 1. High-Level Workflow

The synchronization process moves data from the local SQLite (Turso) database back to Label Studio via the Label Studio REST API.

```text
  [ FINAL_APPROVED ] → (Sync Queue: PENDING)
          ↓
  Admin clicks "Process Queue" OR Cron job runs
          ↓
  Dry Run Calculation (fetch tasks, regions, compute diffs)
          ↓
  Confirmation Modal (Admin confirms)
          ↓
  [ SYNC_PENDING ] (Task actively syncing)
          ↓
  1. Fetch original Label Studio Annotation
  2. Drop unreadable regions from payload
  3. Bulk Transliterate (Devanagari → Kaithi) via Aksharamukha
  4. Append `<textarea>` blocks to payload
  5. PATCH Label Studio Annotation
  6. PATCH Label Studio Task (excel = 'approved')
          ↓
  [ SYNCED_TO_LABEL_STUDIO ] / (Sync Queue: SYNCED)
```

---

## 2. Core Logic & Files

### `lib/sync.ts`
The heart of the sync logic. It provides two main exports: `dryRunTaskSync` and `syncTaskToLabelStudio`, both of which rely on an internal `buildSyncPayload` function.

- **Unreadable Filtering:** Automatically filters out any regions marked as `is_unreadable` by the reviewer. These are fully removed from the final payload sent to Label Studio.
- **Bulk Transliteration:** Batches all text from regions tagged as `Kaithi`. Uses a custom delimiter (`___AKSHARAMUKHA_DELIM___`) to send a single `POST` request to `https://www.aksharamukha.com/api/convert`.
- **Space Retention:** Uses `postOptions: ['KaithiRetainSpace']` to prevent the Aksharamukha API from replacing spaces with Kaithi word separators (U+2E31).
- **Non-Destructive Patching:** Uses `PATCH /api/annotations/{id}/` to preserve the original author's metadata.

### `lib/labelStudio.ts`
Updated to include:
- `updateAnnotation(annotationId, payload)`: Hits `PATCH /api/annotations/:id/`.
- `lsPatch()`: General-purpose `PATCH` helper for Label Studio endpoints.

### `lib/syncQueue.ts`
Provides Turso DB helpers for managing the queue:
- `createSyncEntry()`: Enqueues a task when it hits `FINAL_APPROVED`.
- `listPendingSyncEntries()`, `listFailedSyncEntries()`.
- `updateSyncStatus()`: Handles retries, incrementing `attempt_count`, and recording `last_error`.

---

## 3. API Endpoints

### `POST /api/admin/sync/dry-run`
- **Auth:** `ADMIN`
- **Purpose:** Calculates the expected changes without modifying Label Studio.
- **Response:** Aggregates `tasksToPush`, `regionsRemoved`, `scriptsChanged`, and `transcriptionsAdded`.

### `POST /api/admin/sync/process`
- **Auth:** `ADMIN`
- **Body:** `{ taskId?: string, retryFailed?: boolean }`
- **Purpose:** Executes the actual writeback. Processes batches of up to 10 tasks at a time to prevent serverless function timeouts. Can also retry specific failed tasks.

### `GET /api/cron/sync`
- **Auth:** Standard Bearer Token (`CRON_SECRET`)
- **Purpose:** Headless endpoint for external schedulers (e.g., GitHub Actions, Vercel Cron) to process the sync queue in the background.

---

## 4. UI Components

### `app/admin/sync/page.tsx` & `SyncDashboardClient.tsx`
The dedicated Admin Sync Dashboard:
- **Pending Syncs:** Displays the queue of tasks ready to push. Includes a **Process Queue** button.
- **Dry Run Modal:** Intercepts the "Process Queue" click to display calculated statistics and require explicit confirmation before running destructive actions.
- **Failed Syncs:** Shows tasks that threw errors during sync. Displays the exact error stack trace and provides a **Retry** button.
- **Recently Synced:** Displays successful tasks and their timestamps.

---

## 5. Task Status Transitions

A strict state machine governs the sync phase to prevent double-syncing or invalid states:

1. `FINAL_APPROVED` → `SYNC_PENDING` (Lock the task while the sync is running)
2. `SYNC_PENDING` → `SYNCED_TO_LABEL_STUDIO` (Success)
3. `SYNC_PENDING` → `SYNC_FAILED` (Error occurred)
4. `SYNC_FAILED` → `SYNC_PENDING` (Admin clicks Retry)

*Note: The Label Studio Task metadata is also updated (`excel: 'approved'`) after a successful sync to maintain parity with the Phase 3 import exclusion logic.*
