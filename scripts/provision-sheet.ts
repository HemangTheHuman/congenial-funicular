/**
 * One-off Google Sheet provisioning script.
 *
 * Creates all required tabs and writes column headers for each.
 * Safe to run multiple times — skips sheets that already exist.
 *
 * Usage:
 *   npm run provision-sheet
 *
 * Requires .env.local to be populated with:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 *   GOOGLE_SHEET_ID
 */

import { config } from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { google } from 'googleapis'

// Load .env.local relative to project root
const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../.env.local') })

// ---------------------------------------------------------------------------
// Schema definitions — exactly match README §5
// ---------------------------------------------------------------------------

const SHEETS: { name: string; headers: string[] }[] = [
  {
    name: 'users',
    headers: [
      'user_id',
      'email',
      'name',
      'password_hash',
      'role',
      'status',
      'assigned_batch',
      'created_at',
      'updated_at',
      'last_login_at',
      'notes',
    ],
  },
  {
    name: 'tasks',
    headers: [
      'task_id',
      'ls_task_id',
      'project_id',
      'batch_id',
      'image_url',
      'image_preview_url',
      'original_width',
      'original_height',
      'status',
      'assigned_labeler',
      'assigned_reviewer',
      'locked_by',
      'lock_expires_at',
      'region_count',
      'labeled_region_count',
      'approved_region_count',
      'rejected_region_count',
      'sync_status',
      'sync_attempt_count',
      'last_sync_error',
      'created_at',
      'updated_at',
      'completed_at',
    ],
  },
  {
    name: 'regions',
    headers: [
      'region_id',
      'task_id',
      'ls_task_id',
      'ls_region_id',
      'order_index',
      'bbox_x_percent',
      'bbox_y_percent',
      'bbox_width_percent',
      'bbox_height_percent',
      'bbox_xmin',
      'bbox_ymin',
      'bbox_xmax',
      'bbox_ymax',
      'rotation',
      'script_tag_original',
      'script_tag_final',
      'status',
      'is_active',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'labels',
    headers: [
      'label_id',
      'region_id',
      'task_id',
      'labeler_email',
      'text',
      'is_unreadable',
      'version',
      'is_latest',
      'created_at',
      'updated_at',
      'local_client_id',
      'sync_state',
    ],
  },
  {
    name: 'reviews',
    headers: [
      'review_id',
      'region_id',
      'task_id',
      'reviewer_email',
      'review_status',
      'final_script_tag',
      'review_note',
      'review_round',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'sync_queue',
    headers: [
      'sync_id',
      'task_id',
      'ls_task_id',
      'status',
      'attempt_count',
      'last_error',
      'created_at',
      'updated_at',
      'synced_at',
    ],
  },
  {
    name: 'audit_logs',
    headers: [
      'log_id',
      'timestamp',
      'user_email',
      'action',
      'entity_type',
      'entity_id',
      'old_value',
      'new_value',
      'metadata',
    ],
  },
  {
    name: 'app_config',
    headers: ['key', 'value', 'description', 'updated_at'],
  },
]

/** Default seed values for app_config */
const APP_CONFIG_DEFAULTS = [
  ['TASK_LOCK_MINUTES', '45', 'Minutes before a task lock expires', new Date().toISOString()],
  [
    'ALLOWED_SCRIPT_TAGS',
    'KAITHI,DEVANAGARI,ENGLISH,OTHER',
    'Comma-separated allowed script tag values',
    new Date().toISOString(),
  ],
  [
    'CROP_PADDING_PERCENT',
    '0.015',
    'Padding added around bbox when generating crop preview',
    new Date().toISOString(),
  ],
  ['MAX_REVIEW_ROUNDS', '3', 'Maximum correction/re-review cycles per region', new Date().toISOString()],
]

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  const sheetId = process.env.GOOGLE_SHEET_ID

  if (!email || !key || !sheetId) {
    console.error(
      '❌  Missing env vars. Make sure GOOGLE_SERVICE_ACCOUNT_EMAIL, ' +
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, and GOOGLE_SHEET_ID are set in .env.local'
    )
    process.exit(1)
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  const sheets = google.sheets({ version: 'v4', auth })

  // Fetch current sheet metadata
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId })
  const existingNames = new Set(
    (meta.data.sheets ?? []).map((s) => s.properties?.title ?? '')
  )

  console.log(`\n📋 Found ${existingNames.size} existing sheet(s): ${[...existingNames].join(', ') || 'none'}\n`)

  // Build batch requests for new sheets
  const addRequests = SHEETS.filter((s) => !existingNames.has(s.name)).map(
    (s) => ({
      addSheet: { properties: { title: s.name } },
    })
  )

  if (addRequests.length > 0) {
    console.log(`➕ Creating ${addRequests.length} new sheet(s)...`)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: addRequests },
    })
    console.log(`   Done.\n`)
  } else {
    console.log(`✅ All sheets already exist — skipping creation.\n`)
  }

  // Write headers for each sheet (overwrite row 1 — safe if already correct)
  console.log('📝 Writing headers...')
  for (const sheet of SHEETS) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheet.name}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [sheet.headers] },
    })
    console.log(`   ✓ ${sheet.name} (${sheet.headers.length} columns)`)
  }

  // Seed app_config defaults if the sheet was just created or is empty
  const configRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'app_config',
  })
  const configRows = configRes.data.values ?? []
  if (configRows.length <= 1) {
    console.log('\n🌱 Seeding app_config defaults...')
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'app_config',
      valueInputOption: 'RAW',
      requestBody: { values: APP_CONFIG_DEFAULTS },
    })
    console.log('   Done.')
  }

  console.log('\n✅ Google Sheet provisioning complete!\n')
}

main().catch((err) => {
  console.error('❌ Provisioning failed:', err)
  process.exit(1)
})
