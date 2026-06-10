# Kaithi Labeling Web App — Detailed Implementation Plan

## 1. Project Goal

The goal is to replace the current Excel-based labeling workflow with a lightweight web application for Kaithi OCR dataset labeling, review, correction, and final Label Studio writeback.

The application will be deployed on **Vercel** and will use **Google Sheets as the MVP workflow database**. Label Studio will remain the source of task data, bounding boxes, image URLs, and initial script tags. Final approved labels will be pushed back to Label Studio using the existing custom encoding/writeback function.

The application must work well for users with:

- unstable internet connections,
- low-spec systems,
- limited technical knowledge,
- browser-only access,
- no need to install software locally.

---

## 2. Core Design Principles

### 2.1 Label Studio remains the annotation source

Label Studio provides:

- task ID,
- image URL,
- original image width and height,
- bounding boxes,
- Label Studio region IDs,
- script tags,
- rotation metadata,
- existing annotation structure.

The web app should not replace Label Studio's geometry annotation system. It should sit on top of Label Studio as a workflow layer.

### 2.2 Web app owns workflow state

The web app will manage:

- user role assignment,
- task availability,
- task locking,
- labeler progress,
- reviewer progress,
- correction queue,
- sync queue,
- audit trail,
- retry state.

For MVP, this workflow state will be stored in Google Sheets.

### 2.3 Labelers only transcribe text

Labelers cannot edit script tags.

Labelers can only:

- view assigned/available tasks,
- open a task,
- view full page and crop,
- view readonly script tag,
- enter text transcription,
- mark a region unreadable,
- correct rejected text regions.

### 2.4 Reviewers control script correctness

Reviewers can:

- approve text,
- reject text,
- change script tag,
- approve script tag,
- mark unreadable disagreement,
- send regions back for correction,
- finalize reviewed regions.

### 2.5 Final approved data goes back to Label Studio

The app will not treat its own JSON export as the final source of truth. Instead:

1. final approved task enters `SYNC_PENDING`,
2. backend builds encoded Label Studio payload,
3. custom writeback function pushes labels to Label Studio,
4. task becomes `SYNCED_TO_LABEL_STUDIO`,
5. failed syncs become `SYNC_FAILED` and can be retried.

### 2.6 Low internet support is mandatory

The app must use:

- local autosave,
- retry queue,
- task-level locking with expiry,
- lazy image loading,
- compressed previews,
- only current crop and next crop preloading,
- clear sync status indicators.

---

## 3. Recommended Tech Stack

## 3.1 Frontend

Use:

```text
Next.js App Router
React
TypeScript
Tailwind CSS
IndexedDB or localStorage for local autosave
```

Recommended UI components:

```text
shadcn/ui or simple custom components
react-hot-toast or custom toast system
```

Avoid heavy canvas/image libraries in the MVP unless needed. Start simple with native image display and CSS overlays.

## 3.2 Backend

Use Vercel serverless API routes:

```text
/app/api/...
```

Backend responsibilities:

- read/write Google Sheets,
- call Label Studio API,
- protect API keys,
- enforce roles,
- handle locks,
- handle final Label Studio sync,
- validate submissions.

## 3.3 Database for MVP

Use Google Sheets as workflow DB.

Use one spreadsheet with multiple tabs:

```text
users
tasks
regions
labels
reviews
sync_queue
audit_logs
app_config
```

## 3.4 Authentication

Recommended MVP options:

### Option A — Google OAuth

Best if all users have Gmail/Google accounts.

Use:

```text
Auth.js / NextAuth with Google provider
```

### Option B — Simple admin-approved email login

Use if you want less setup:

- user enters email,
- OTP/magic link can be added later,
- first version can use allowlisted emails,
- role is checked from `users` sheet.

For a production-level system, Google OAuth is better.

---

## 4. Environment Variables

Create these in Vercel:

```env
LABEL_STUDIO_BASE_URL=
LABEL_STUDIO_API_TOKEN=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
GOOGLE_SHEET_ID=
NEXTAUTH_SECRET=
NEXTAUTH_URL=
ADMIN_EMAILS=
```

Optional:

```env
APP_ENV=production
TASK_LOCK_MINUTES=45
MAX_REVIEW_ROUNDS=3
```

Important:

- Do not expose Label Studio token to frontend.
- Do not expose Google service account key to frontend.
- All Google Sheet and Label Studio operations must happen through backend API routes.

---

# 5. Google Sheet Database Design

## 5.1 `users` tab

Purpose: manage user accounts and role assignment.

Columns:

```text
user_id
email
name
role
status
assigned_batch
created_at
updated_at
last_login_at
notes
```

Allowed roles:

```text
PENDING
ADMIN
LABELER
REVIEWER
```

Allowed status:

```text
ACTIVE
PENDING_APPROVAL
DISABLED
```

New users should be created as:

```text
role = PENDING
status = PENDING_APPROVAL
```

Admin later assigns:

```text
LABELER
REVIEWER
ADMIN
```

---

## 5.2 `tasks` tab

Purpose: track page-level workflow.

Columns:

```text
task_id
ls_task_id
project_id
batch_id
image_url
image_preview_url
original_width
original_height
status
assigned_labeler
assigned_reviewer
locked_by
lock_expires_at
region_count
labeled_region_count
approved_region_count
rejected_region_count
sync_status
sync_attempt_count
last_sync_error
created_at
updated_at
completed_at
```

Allowed task statuses:

```text
IMPORTED
READY_FOR_LABELING
LABELING_IN_PROGRESS
LABELED
READY_FOR_REVIEW
REVIEWING_IN_PROGRESS
NEEDS_CORRECTION
CORRECTION_IN_PROGRESS
CORRECTED
READY_FOR_RE_REVIEW
FINAL_APPROVED
SYNC_PENDING
SYNC_FAILED
SYNCED_TO_LABEL_STUDIO
```

Allowed sync statuses:

```text
NOT_READY
PENDING
FAILED
SYNCED
```

---

## 5.3 `regions` tab

Purpose: store each bounding box/region from Label Studio.

Columns:

```text
region_id
task_id
ls_task_id
ls_region_id
order_index
bbox_x_percent
bbox_y_percent
bbox_width_percent
bbox_height_percent
bbox_xmin
bbox_ymin
bbox_xmax
bbox_ymax
rotation
script_tag_original
script_tag_final
status
is_active
created_at
updated_at
```

Allowed region statuses:

```text
PENDING_LABEL
LABELED
UNREADABLE
REVIEW_PENDING
APPROVED
TEXT_WRONG
SCRIPT_WRONG
BOTH_WRONG
NEEDS_CORRECTION
CORRECTED
FINAL_APPROVED
```

Important rule:

```text
script_tag_original = script from Label Studio task data
script_tag_final = reviewer-approved script tag
```

At import time:

```text
script_tag_final = script_tag_original
```

Labeler can never change either script field.

Reviewer can only change `script_tag_final`.

---

## 5.4 `labels` tab

Purpose: store labeler transcription attempts.

Columns:

```text
label_id
region_id
task_id
labeler_email
text
is_unreadable
version
is_latest
created_at
updated_at
local_client_id
sync_state
```

Rules:

- Never overwrite old labels.
- Every correction creates a new version.
- Only one label per region should have `is_latest = TRUE`.

Allowed sync states:

```text
LOCAL_PENDING
SAVED
FAILED
```

---

## 5.5 `reviews` tab

Purpose: store reviewer decisions.

Columns:

```text
review_id
region_id
task_id
reviewer_email
review_status
final_script_tag
review_note
review_round
created_at
updated_at
```

Allowed review statuses:

```text
APPROVED
TEXT_WRONG
SCRIPT_WRONG
BOTH_WRONG
UNREADABLE_WRONG
```

Rules:

- If reviewer changes script but approves text, region can move to `APPROVED`.
- If text is wrong, region moves to `NEEDS_CORRECTION`.
- If both are wrong, reviewer changes script and sends text back for correction.

---

## 5.6 `sync_queue` tab

Purpose: safely manage final Label Studio writeback.

Columns:

```text
sync_id
task_id
ls_task_id
status
attempt_count
last_error
created_at
updated_at
synced_at
```

Allowed statuses:

```text
PENDING
IN_PROGRESS
FAILED
SYNCED
```

Rules:

- A task should enter sync queue only after all regions are final approved.
- Failed sync should be retryable.
- Do not lose final task data if Label Studio API fails.

---

## 5.7 `audit_logs` tab

Purpose: track major user actions.

Columns:

```text
log_id
timestamp
user_email
action
entity_type
entity_id
old_value
new_value
metadata
```

Example actions:

```text
USER_LOGIN
ROLE_ASSIGNED
TASK_IMPORTED
TASK_CLAIMED
REGION_LABELED
REGION_REVIEWED
REGION_CORRECTED
TASK_FINAL_APPROVED
SYNC_STARTED
SYNC_FAILED
SYNC_SUCCESS
```

---

## 5.8 `app_config` tab

Purpose: store configurable values.

Columns:

```text
key
value
description
updated_at
```

Example values:

```text
TASK_LOCK_MINUTES = 45
ALLOWED_SCRIPT_TAGS = KAITHI,DEVANAGARI,ENGLISH,OTHER
CROP_PADDING_PERCENT = 0.015
MAX_REVIEW_ROUNDS = 3
```

---

# 6. Application Routes

## 6.1 Public routes

```text
/login
/pending-approval
```

## 6.2 Admin routes

```text
/admin
/admin/users
/admin/import
/admin/tasks
/admin/sync
/admin/analytics
```

## 6.3 Labeler routes

```text
/labeler
/labeler/tasks
/labeler/task/[taskId]
/labeler/corrections
/labeler/correction/[taskId]
```

## 6.4 Reviewer routes

```text
/reviewer
/reviewer/tasks
/reviewer/task/[taskId]
/reviewer/re-review/[taskId]
```

---

# 7. Backend API Routes

## 7.1 Auth/User APIs

```text
GET  /api/me
POST /api/admin/assign-role
POST /api/admin/disable-user
```

## 7.2 Label Studio Import APIs

```text
POST /api/admin/import-task-ids
POST /api/admin/import-task/[lsTaskId]
POST /api/admin/import-batch
```

Responsibilities:

- call predefined Label Studio function to list task IDs,
- fetch task data by task ID,
- parse image URL,
- parse rectangle regions,
- pair bbox and script labels by Label Studio region ID,
- convert bbox percentages to pixel bbox,
- write task and regions to Google Sheets.

## 7.3 Task APIs

```text
GET  /api/tasks/available
GET  /api/tasks/corrections
POST /api/tasks/claim
POST /api/tasks/release
GET  /api/tasks/[taskId]
POST /api/tasks/submit-labeling
POST /api/tasks/submit-correction
```

## 7.4 Region Label APIs

```text
POST /api/regions/save-label
POST /api/regions/save-local-sync
GET  /api/regions/[regionId]
```

## 7.5 Review APIs

```text
GET  /api/review/tasks
GET  /api/review/task/[taskId]
POST /api/review/region
POST /api/review/submit-task
```

## 7.6 Sync APIs

```text
POST /api/sync/task/[taskId]
POST /api/sync/retry/[taskId]
GET  /api/sync/status/[taskId]
```

Sync APIs call your custom function to encode text and push final annotation to Label Studio.

---

# 8. Label Studio Import Logic

## 8.1 Import task data

For every Label Studio task:

1. Fetch task data using existing function.
2. Extract:
   - Label Studio task ID,
   - image URL,
   - original width,
   - original height,
   - annotation result list.
3. Group result items by Label Studio region ID.
4. For each region ID, find:
   - rectangle item,
   - labels/script item.
5. Create task row.
6. Create region rows.

## 8.2 Bbox conversion

Label Studio usually stores bbox in percentage values:

```text
x_percent
y_percent
width_percent
height_percent
```

Convert to pixels:

```text
xmin = original_width  * x / 100
ymin = original_height * y / 100
xmax = original_width  * (x + width) / 100
ymax = original_height * (y + height) / 100
```

Store both percentage and pixel values.

## 8.3 Rotation

Always store:

```text
rotation
```

MVP crop handling:

- use axis-aligned crop with padding,
- show rotation value if non-zero,
- keep rotation for final writeback.

Later improved version:

- rotated crop extraction.

---

# 9. Labeler User Flow

## 9.1 First login

```text
User logs in
  ↓
Check users sheet
  ↓
If new user: create pending user
  ↓
Show pending approval screen
```

## 9.2 Labeler dashboard

Show:

```text
Available tasks
Assigned/in-progress task
Correction tasks
Today progress
Total labeled regions
```

Task card should show:

```text
Task ID
Region count
Status
Lock status
Progress
```

## 9.3 Claim task

When user clicks task:

```text
POST /api/tasks/claim
```

Backend checks:

```text
if task.locked_by is empty OR lock expired:
    lock task
    status = LABELING_IN_PROGRESS
else:
    return task already locked
```

Lock should refresh every few minutes while task is open.

## 9.4 Labeling screen layout

Recommended layout:

```text
--------------------------------------------------
| Full page preview             | Crop preview    |
| with current bbox highlight   |                 |
|                               | Script: KAITHI  |
|                               | Text input      |
|                               | Unreadable btn  |
|                               | Save & Next     |
--------------------------------------------------
```

Labeler sees readonly:

```text
script_tag_original or script_tag_final
```

Labeler inputs:

```text
text
is_unreadable
optional note
```

Labeler cannot edit:

```text
script tag
bbox
review status
final status
```

## 9.5 Save region

When labeler saves:

1. Save immediately to IndexedDB/localStorage.
2. Call `/api/regions/save-label`.
3. If API succeeds, mark local entry as synced.
4. If API fails, keep in local retry queue.

UI status:

```text
Saved locally
Syncing
Synced
Failed - retrying
```

## 9.6 Submit task

Task can be submitted only when all regions are either:

```text
LABELED
UNREADABLE
```

Then backend changes:

```text
task.status = READY_FOR_REVIEW
all labeled regions.status = REVIEW_PENDING
```

---

# 10. Reviewer User Flow

## 10.1 Reviewer dashboard

Show:

```text
Tasks ready for review
Tasks ready for re-review
In-progress review task
Review stats
```

## 10.2 Review screen layout

Reviewer sees:

```text
Full page preview
Current crop
Labeler transcription
Unreadable flag
Original script tag
Final script tag dropdown
Reviewer note
Approve / reject controls
```

Reviewer controls:

```text
Approve
Reject text
Change script
Reject both
Unreadable disagreement
Save & Next
```

Allowed script values should come from app config:

```text
KAITHI
DEVANAGARI
ENGLISH
OTHER
```

## 10.3 Review decision logic

### Case 1 — Text and script correct

```text
review_status = APPROVED
region.status = APPROVED
script_tag_final unchanged
```

### Case 2 — Text correct, script wrong

```text
review_status = SCRIPT_WRONG
script_tag_final = reviewer selected value
region.status = APPROVED
```

This does not need to go back to labeler.

### Case 3 — Text wrong, script correct

```text
review_status = TEXT_WRONG
region.status = NEEDS_CORRECTION
```

### Case 4 — Text and script both wrong

```text
review_status = BOTH_WRONG
script_tag_final = reviewer selected value
region.status = NEEDS_CORRECTION
```

Labeler will correct text only. Script remains reviewer-controlled.

### Case 5 — Unreadable disagreement

```text
review_status = UNREADABLE_WRONG
region.status = NEEDS_CORRECTION
```

---

# 11. Correction Flow

## 11.1 Correction dashboard

Labeler sees only tasks originally completed by them and returned by reviewer.

Show:

```text
Task ID
Rejected region count
Reviewer note summary
Correction status
```

## 11.2 Correction screen

Show only rejected regions.

For each rejected region:

```text
Crop image
Readonly final script tag
Previous transcription
Reviewer note
New transcription input
Unreadable option
Save correction
```

Labeler still cannot edit script.

## 11.3 Correction submission

After labeler corrects all rejected regions:

```text
region.status = CORRECTED
task.status = READY_FOR_RE_REVIEW
```

Reviewer then sees only corrected regions.

---

# 12. Final Approval Logic

After reviewer submits review:

```text
if all regions are APPROVED or FINAL_APPROVED:
    task.status = FINAL_APPROVED
    task.sync_status = PENDING
    create sync_queue row
else:
    task.status = NEEDS_CORRECTION
```

When task becomes final:

```text
all approved regions.status = FINAL_APPROVED
```

Then sync queue handles Label Studio writeback.

---

# 13. Label Studio Final Sync Logic

## 13.1 When to sync

Sync only when:

```text
task.status = FINAL_APPROVED
sync_status = PENDING
```

Do not sync every small change.

## 13.2 Sync steps

1. Load task row.
2. Load all region rows.
3. Load latest label for each region.
4. Load final script tag for each region.
5. Build final encoded payload using your custom function.
6. Push payload to Label Studio.
7. If success:
   - task.status = SYNCED_TO_LABEL_STUDIO
   - sync_queue.status = SYNCED
8. If failed:
   - task.status = SYNC_FAILED
   - sync_queue.status = FAILED
   - save error message.

## 13.3 Retry

Admin can retry failed sync from:

```text
/admin/sync
```

Retry should increment:

```text
attempt_count
```

---

# 14. Low Internet and Low Spec Optimization

## 14.1 Image loading

Do not load all crops at once.

Use this strategy:

```text
Load compressed full-page preview
Load current crop
Preload next crop only
Cache current task metadata locally
```

## 14.2 Local autosave

Use IndexedDB if possible.

Local queue structure:

```json
{
  "local_id": "uuid",
  "task_id": "T001",
  "region_id": "R001",
  "text": "...",
  "is_unreadable": false,
  "created_at": "...",
  "sync_status": "PENDING"
}
```

Retry when:

```text
browser comes online
user clicks retry
task page reloads
periodic retry timer runs
```

## 14.3 UI must show save status

Always show one of:

```text
Saved locally
Syncing...
Synced
Failed - will retry
```

## 14.4 Avoid expensive frontend processing

Avoid:

```text
loading all regions as separate images
large canvas rendering
full-resolution image redraws on every step
heavy OCR preprocessing in browser
```

Prefer:

```text
server-side crop URL if available
CSS object-position crop preview if practical
lightweight image element
small preview image
```

## 14.5 Keyboard shortcuts

Add shortcuts after MVP UI works:

```text
Enter = save and next
U = unreadable
A = approve
R = reject text
Left arrow = previous region
Right arrow = next region
Ctrl + Enter = submit task
```

---

# 15. Task Locking Design

Because Google Sheets has weak concurrency, use simple lock expiry.

## 15.1 Claim lock

When user opens task:

```text
locked_by = user_email
lock_expires_at = now + 45 minutes
```

## 15.2 Refresh lock

Frontend calls every 3-5 minutes:

```text
POST /api/tasks/refresh-lock
```

## 15.3 Expired lock

A task is available if:

```text
locked_by is empty
OR lock_expires_at < current time
```

## 15.4 Release lock

When user submits task or exits:

```text
locked_by = empty
lock_expires_at = empty
```

---

# 16. Admin Features

## 16.1 User management

Admin can:

```text
approve user
assign role
change role
disable user
assign batch
```

## 16.2 Task import

Admin can:

```text
import task IDs from Label Studio
import one task
import batch of tasks
view imported tasks
see import failures
```

## 16.3 Task monitoring

Admin dashboard should show:

```text
Total tasks
Ready for labeling
In labeling
Ready for review
Needs correction
Final approved
Synced
Sync failed
```

## 16.4 Quality monitoring

Track:

```text
regions labeled per labeler
regions approved per labeler
rejection rate per labeler
average time per task
correction count
unreadable rate
script correction rate
```

---

# 17. Suggested Folder Structure

```text
kaithi-labeling-app/
  app/
    login/
    pending-approval/
    admin/
      page.tsx
      users/
      import/
      tasks/
      sync/
    labeler/
      page.tsx
      tasks/
      task/[taskId]/
      corrections/
      correction/[taskId]/
    reviewer/
      page.tsx
      tasks/
      task/[taskId]/
      re-review/[taskId]/
    api/
      me/
      admin/
      tasks/
      regions/
      review/
      sync/
  components/
    layout/
    task/
    region/
    image/
    forms/
    status/
  lib/
    auth.ts
    googleSheets.ts
    labelStudio.ts
    locking.ts
    states.ts
    validation.ts
    localQueue.ts
    encoding.ts
  types/
    user.ts
    task.ts
    region.ts
    label.ts
    review.ts
  utils/
    bbox.ts
    date.ts
    ids.ts
```

---

# 18. Development Order — Step-by-Step Build Plan

This is the exact order in which the project should be developed.

---

## Phase 0 — Preparation and project setup

### Goal

Create the basic Next.js project and connect required services.

### Build tasks

1. Create Next.js TypeScript project.
2. Add Tailwind CSS.
3. Create Vercel project.
4. Create Google Sheet with required tabs.
5. Create Google Cloud service account.
6. Give service account edit access to the Google Sheet.
7. Add environment variables in local `.env` and Vercel.
8. Create basic utility for reading/writing Google Sheets.
9. Create basic utility for calling Label Studio API.

### Output of this phase

```text
Project runs locally
Can read/write Google Sheet
Can call Label Studio API from backend
```

---

## Phase 1 — Authentication and user roles

### Goal

Users can log in, and the app shows views based on role.

### Build tasks

1. Implement login.
2. Implement `/api/me`.
3. On first login, create user row with pending status.
4. Create pending approval screen.
5. Create admin user management screen.
6. Allow admin to assign role:
   - LABELER,
   - REVIEWER,
   - ADMIN.
7. Add route protection.

### Output of this phase

```text
New users wait for approval
Admin can assign roles
Labeler/reviewer/admin see different dashboards
```

---

## Phase 2 — Google Sheet schema helpers

### Goal

Create clean helpers for Sheet operations before building UI logic.

### Build tasks

1. Create `users` helper functions.
2. Create `tasks` helper functions.
3. Create `regions` helper functions.
4. Create `labels` helper functions.
5. Create `reviews` helper functions.
6. Create `sync_queue` helper functions.
7. Create audit log helper.
8. Add ID generation utility.
9. Add status transition validation.

### Output of this phase

```text
Backend can safely create/update users, tasks, regions, labels, reviews, and sync queue rows
```

---

## Phase 3 — Label Studio task import

### Goal

Admin can import Label Studio tasks into the app.

### Build tasks

1. Build `/api/admin/import-task/[lsTaskId]`.
2. Fetch task data from Label Studio.
3. Parse image URL.
4. Parse original dimensions.
5. Parse rectangle regions.
6. Parse script labels.
7. Pair bbox and script by Label Studio region ID.
8. Convert percentage bbox to pixel bbox.
9. Create task row in `tasks`.
10. Create region rows in `regions`.
11. Add import result screen.
12. Add duplicate import protection.

### Output of this phase

```text
Admin can import one Label Studio task
Task and regions appear in Google Sheet
```

After this works, add batch import:

1. Use predefined function to list Label Studio task IDs.
2. Import selected task IDs.
3. Show success/failure count.

---

## Phase 4 — Labeler task list and task claim

### Goal

Labeler can see tasks and claim one safely.

### Build tasks

1. Create labeler dashboard.
2. Create `/api/tasks/available`.
3. Show task cards.
4. Create `/api/tasks/claim`.
5. Implement lock logic.
6. Implement lock expiry.
7. Implement task release.
8. Show locked task message if task is already claimed.

### Output of this phase

```text
Labeler can claim an available task
Two labelers cannot work on the same task at the same time
```

---

## Phase 5 — Labeler labeling screen

### Goal

Labeler can label all regions of a task.

### Build tasks

1. Create `/labeler/task/[taskId]`.
2. Load task metadata.
3. Load region list.
4. Show full page image.
5. Highlight current bbox on full page.
6. Show current crop preview.
7. Show readonly script tag.
8. Add text input.
9. Add unreadable button.
10. Add save and next.
11. Add previous/next region navigation.
12. Add progress indicator.
13. Save region label to Google Sheet.
14. Mark region as `LABELED` or `UNREADABLE`.
15. Prevent task submit until all regions are labeled/unreadable.
16. Submit task to `READY_FOR_REVIEW`.

### Output of this phase

```text
A labeler can complete a full task from start to submit
```

---

## Phase 6 — Local autosave and retry queue

### Goal

Protect labeler work from poor internet.

### Build tasks

1. Add local storage or IndexedDB queue.
2. Save every region locally before API call.
3. Add sync status indicator.
4. Retry failed saves automatically.
5. Add manual retry button.
6. On task load, restore unsynced local labels.
7. Warn user before leaving page with unsynced data.

### Output of this phase

```text
Labeler work is not lost if internet disconnects
```

---

## Phase 7 — Reviewer task list

### Goal

Reviewer can see tasks ready for review.

### Build tasks

1. Create reviewer dashboard.
2. Create `/api/review/tasks`.
3. Show tasks with status `READY_FOR_REVIEW` and `READY_FOR_RE_REVIEW`.
4. Add review claim/lock logic.
5. Show review progress.

### Output of this phase

```text
Reviewer can claim and open tasks waiting for review
```

---

## Phase 8 — Reviewer screen

### Goal

Reviewer can approve/reject text and change script tag.

### Build tasks

1. Create `/reviewer/task/[taskId]`.
2. Load task, regions, latest labels.
3. Show full page image.
4. Show current crop.
5. Show labeler transcription.
6. Show original script tag.
7. Add final script tag dropdown.
8. Add approve button.
9. Add reject text button.
10. Add reject both button.
11. Add unreadable disagreement option.
12. Add review note.
13. Save region review.
14. Update region status.
15. Submit review task.
16. If all approved, move task to `FINAL_APPROVED`.
17. If any text rejection, move task to `NEEDS_CORRECTION`.

### Output of this phase

```text
Reviewer can complete review and create correction tasks
```

---

## Phase 9 — Labeler correction workflow

### Goal

Labeler can correct only rejected regions.

### Build tasks

1. Create `/labeler/corrections`.
2. Show tasks where:
   - task status is `NEEDS_CORRECTION`,
   - assigned labeler is current user.
3. Create `/labeler/correction/[taskId]`.
4. Load only regions with `NEEDS_CORRECTION`.
5. Show previous transcription.
6. Show reviewer note.
7. Show readonly final script tag.
8. Allow text correction.
9. Save corrected label as new version.
10. Mark region as `CORRECTED`.
11. When all rejected regions are corrected, task becomes `READY_FOR_RE_REVIEW`.

### Output of this phase

```text
Correction loop works at region level
```

---

## Phase 10 — Re-review workflow

### Goal

Reviewer can re-review only corrected regions.

### Build tasks

1. In reviewer dashboard, show `READY_FOR_RE_REVIEW` tasks separately.
2. On re-review screen, load only corrected regions.
3. Reviewer approves or rejects again.
4. If approved, region becomes `FINAL_APPROVED`.
5. If rejected again, region returns to `NEEDS_CORRECTION`.
6. If all regions final, task becomes `FINAL_APPROVED`.

### Output of this phase

```text
Region-level correction and re-review loop is complete
```

---

## Phase 11 — Final Label Studio sync queue

### Goal

Final approved tasks are pushed back to Label Studio safely.

### Build tasks

1. Create sync queue row when task becomes `FINAL_APPROVED`.
2. Build `/api/sync/task/[taskId]`.
3. Load all final regions and latest labels.
4. Build encoded payload using custom encoding function.
5. Call custom Label Studio writeback function.
6. Mark sync success/failure.
7. Create `/admin/sync` page.
8. Show pending, failed, and synced tasks.
9. Add retry failed sync button.

### Output of this phase

```text
Final labels are pushed back to Label Studio
Failed syncs can be retried
```

---

## Phase 12 — Admin analytics and monitoring

### Goal

Admin can monitor work quality and progress.

### Build tasks

1. Add task status counts.
2. Add user productivity table.
3. Add labeler rejection rate.
4. Add reviewer correction stats.
5. Add unreadable rate.
6. Add sync failure list.
7. Add locked task monitor.
8. Add manual unlock option.

### Output of this phase

```text
Admin can manage production labeling workflow
```

---

## Phase 13 — UX improvements and speed optimization

### Goal

Make the tool fast and comfortable for real labelers.

### Build tasks

1. Add keyboard shortcuts.
2. Add crop zoom.
3. Add full page zoom/pan.
4. Add contrast toggle for crop.
5. Add next crop preload.
6. Add task progress save indicator.
7. Add mobile/tablet fallback layout.
8. Reduce image load size.
9. Add clearer error handling.
10. Add retry banners for poor internet.

### Output of this phase

```text
Tool becomes comfortable for daily use
```

---

## Phase 14 — Hardening before real deployment

### Goal

Make the app safe enough for actual production labeling.

### Build tasks

1. Add role-based backend validation to every API.
2. Add rate limits where needed.
3. Validate all task status transitions.
4. Prevent reviewer from reviewing own task if required.
5. Prevent labeler from editing approved regions.
6. Prevent task submit with unsynced local labels.
7. Add full audit logging.
8. Add backup export from Google Sheet.
9. Add admin manual correction tools.
10. Test with 5-10 real users.

### Output of this phase

```text
Production-ready MVP
```

---

# 19. Recommended MVP Scope

Do not try to build everything at once.

The first useful MVP should include only:

```text
Login
Admin role assignment
Import one Label Studio task
Labeler task list
Labeler task screen
Readonly script tag
Text/unreadable labeling
Reviewer task screen
Reviewer approve/reject/change script
Correction loop
Final Label Studio sync
```

Add analytics, keyboard shortcuts, and advanced image tools after the core workflow works.

---

# 20. Testing Checklist

## 20.1 Import testing

Check:

```text
Task imports correctly
All regions imported
Script tags imported correctly
Pixel bbox values are correct
Rotation values are stored
Duplicate import is prevented
```

## 20.2 Labeler testing

Check:

```text
Labeler cannot edit script
Labeler can save text
Labeler can mark unreadable
Labeler cannot submit incomplete task
Local autosave works
Weak internet does not lose work
```

## 20.3 Reviewer testing

Check:

```text
Reviewer can approve text
Reviewer can reject text
Reviewer can change script
Reviewer can send task to correction
Reviewer can finalize task
```

## 20.4 Correction testing

Check:

```text
Only rejected regions appear
Previous text appears
Reviewer note appears
Script remains readonly
Corrected regions go back to reviewer
```

## 20.5 Sync testing

Check:

```text
Only final approved task syncs
Encoded payload is correct
Label Studio receives annotation
Failed sync is stored
Retry works
```

---

# 21. Future Migration Path

Google Sheets is fine for MVP, but if the volume grows, migrate workflow DB to:

```text
Supabase Postgres
Neon Postgres
Firebase Firestore
PlanetScale
```

Recommended future DB:

```text
Supabase Postgres
```

Why:

- real relational database,
- row locking,
- better queries,
- authentication support,
- file storage option,
- easy admin dashboard.

Keep the code modular so Google Sheet functions can later be replaced with database functions.

Recommended abstraction:

```text
lib/repository/tasks.ts
lib/repository/regions.ts
lib/repository/labels.ts
lib/repository/reviews.ts
```

Then implementation can change from Google Sheets to Postgres without rewriting UI.

---

# 22. Final Recommended Build Order Summary

```text
1. Project setup
2. Google Sheets connection
3. Label Studio connection
4. Auth and role system
5. Admin user approval
6. Label Studio task import
7. Task and region storage
8. Labeler task list
9. Task claim/lock
10. Labeler labeling screen
11. Local autosave
12. Reviewer task list
13. Reviewer review screen
14. Correction workflow
15. Re-review workflow
16. Final approval logic
17. Label Studio sync queue
18. Admin sync retry page
19. Admin analytics
20. UX and performance improvements
21. Production hardening
```

---

# 23. Final System Summary

The final app should behave like this:

```text
Admin imports Label Studio tasks.
Labelers transcribe only text from cropped regions.
Script tags are shown readonly to labelers.
Reviewers verify both text and script.
Only reviewers can change script tags.
Rejected text regions return to the original labeler.
Corrections happen region-by-region.
Fully approved tasks enter sync queue.
Custom encoded payload is pushed back to Label Studio.
Weak internet is handled with local autosave and retries.
Google Sheets stores workflow state for MVP.
Vercel hosts the frontend and backend API routes.
```

This keeps the tool lightweight, practical, and directly aligned with your current Label Studio-based OCR pipeline.
