# Phase 9 Reference: Admin Analytics & Monitoring

This document outlines the architecture, flow, and key components built for the **Admin Analytics and Monitoring Dashboard** (referred to as Phase 12 in the master README). The goal of this phase is to provide administrators with a unified, real-time command center to track pipeline progress, monitor quality metrics, and manage user productivity and task locks.

---

## 1. High-Level Architecture

The Analytics dashboard relies on live SQL querying directly against the Turso (SQLite) database. To ensure data freshness and avoid the complexity of cron-based caching, all metrics are aggregated on-the-fly when the API route is called. 

The dashboard provides a **Date Range Filter** (All Time, Today, Last 7 Days) that dynamically updates the productivity and quality metrics without affecting the overall active task funnel.

---

## 2. Core Logic & Services

### `lib/analytics.ts`
The backend analytics service exposes optimized database queries to aggregate the data.

- `getTaskFunnel()`: Aggregates tasks by their exact `status` to construct the pipeline funnel (IMPORTED, LABELED, NEEDS_CORRECTION, FINAL_APPROVED, etc.).
- `getUserProductivity()`: Groups completed tasks by `assigned_labeler` and `assigned_reviewer` within the specified date range.
- `getQualityMetrics()`: Calculates rejection rates at the task level (how many tasks needed correction vs total reviewed) and unreadable rates at the region level.
- `getActiveLocks()`: Fetches a list of tasks currently locked by users, strictly filtering for locks where `lock_expires_at` is in the future.

---

## 3. API Endpoints

### `GET /api/admin/analytics`
- **Auth:** `ADMIN`
- **Query Params:** `?start=ISO_STRING&end=ISO_STRING` (Optional)
- **Purpose:** Fetches all analytics data concurrently using `Promise.all` and returns a structured JSON object containing `funnel`, `totalTasks`, `productivity`, `quality`, and `activeLocks`.

### `POST /api/admin/tasks/unlock`
- **Auth:** `ADMIN`
- **Body:** `{ taskId: string }`
- **Purpose:** Forcefully overrides an active user lock on a task by setting `locked_by = NULL` and `lock_expires_at = NULL` in the database.

---

## 4. UI Components

### `app/admin/analytics/page.tsx`
Server Component that enforces Admin authorization and renders the outer layout for the dashboard.

### `app/admin/analytics/AnalyticsDashboardClient.tsx`
The primary interactive Client Component for the dashboard. It features:
- **Date Range Picker:** Simple toggle buttons (All Time, Today, Last 7 Days) to filter data.
- **Funnel Metric Cards:** Four primary cards tracking the task pipeline (Imported/Ready, Labeled, Needs Correction, Final/Synced). Displays both raw counts and percentage completion relative to `totalTasks`.
- **User Productivity Table:** A ranked leaderboard displaying the exact number of tasks labeled and reviewed by each user.
- **Active Task Locks Table:** Displays currently locked tasks and provides individual "Unlock" buttons, alongside a global "Force Unlock All" button (with a safety confirmation prompt).

---

## 5. Key Decisions & Considerations

1. **Focus on Task Metrics:** The primary value is derived from the *number of tasks* in various states, rather than individual regions. Funnel stats and rejection rates are calculated heavily based on task-level status transitions.
2. **Real-Time Calculation:** Leveraging the speed of Turso, we avoided cron jobs. The database is fast enough to perform these aggregations live, ensuring admins never see stale data.
3. **Lock Overrides:** The "Force Unlock All" functionality was implemented to quickly clear abandoned tasks (e.g. from users closing their browser), but includes a strict UI confirmation to prevent accidentally destroying active labeling sessions.
