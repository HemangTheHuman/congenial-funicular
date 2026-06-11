/**
 * scripts/migrate.ts
 *
 * Run ONCE to initialise the Turso schema and seed existing users.
 * Usage:
 *   npx tsx scripts/migrate.ts
 *
 * Prerequisites:
 *   1. TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env.local (or shell env)
 *   2. scripts/users-seed.json populated with user rows
 *
 * After running successfully you can delete this file and users-seed.json.
 */

// ── Load .env.local FIRST ─────────────────────────────────────────────────────
// dotenv/config only reads .env; Next.js uses .env.local.
// We must call dotenvConfig() before createClient() reads process.env.
import { config as dotenvConfig } from 'dotenv'
import { resolve, join } from 'path'
dotenvConfig({ path: resolve(process.cwd(), '.env.local') })
dotenvConfig() // fallback to .env

// ── Imports that may read process.env at call-time ───────────────────────────
import { createClient } from '@libsql/client'
import { readFileSync, existsSync } from 'fs'

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  user_id       TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'PENDING',
  status        TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  assigned_batch TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_login_at TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id               TEXT PRIMARY KEY,
  ls_task_id            TEXT NOT NULL DEFAULT '',
  project_id            TEXT NOT NULL DEFAULT '',
  batch_id              TEXT NOT NULL DEFAULT '',
  image_url             TEXT NOT NULL DEFAULT '',
  image_preview_url     TEXT NOT NULL DEFAULT '',
  original_width        INTEGER NOT NULL DEFAULT 0,
  original_height       INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'IMPORTED',
  assigned_labeler      TEXT NOT NULL DEFAULT '',
  assigned_reviewer     TEXT NOT NULL DEFAULT '',
  locked_by             TEXT NOT NULL DEFAULT '',
  lock_expires_at       TEXT NOT NULL DEFAULT '',
  region_count          INTEGER NOT NULL DEFAULT 0,
  labeled_region_count  INTEGER NOT NULL DEFAULT 0,
  approved_region_count INTEGER NOT NULL DEFAULT 0,
  rejected_region_count INTEGER NOT NULL DEFAULT 0,
  sync_status           TEXT NOT NULL DEFAULT 'NOT_READY',
  sync_attempt_count    INTEGER NOT NULL DEFAULT 0,
  last_sync_error       TEXT NOT NULL DEFAULT '',
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  completed_at          TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS regions (
  region_id           TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES tasks(task_id),
  ls_task_id          TEXT NOT NULL DEFAULT '',
  ls_region_id        TEXT NOT NULL DEFAULT '',
  order_index         INTEGER NOT NULL DEFAULT 0,
  bbox_x_percent      REAL NOT NULL DEFAULT 0,
  bbox_y_percent      REAL NOT NULL DEFAULT 0,
  bbox_width_percent  REAL NOT NULL DEFAULT 0,
  bbox_height_percent REAL NOT NULL DEFAULT 0,
  bbox_xmin           REAL NOT NULL DEFAULT 0,
  bbox_ymin           REAL NOT NULL DEFAULT 0,
  bbox_xmax           REAL NOT NULL DEFAULT 0,
  bbox_ymax           REAL NOT NULL DEFAULT 0,
  rotation            REAL NOT NULL DEFAULT 0,
  script_tag_original TEXT NOT NULL DEFAULT '',
  script_tag_final    TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'PENDING_LABEL',
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS labels (
  label_id        TEXT PRIMARY KEY,
  region_id       TEXT NOT NULL REFERENCES regions(region_id),
  task_id         TEXT NOT NULL REFERENCES tasks(task_id),
  labeler_email   TEXT NOT NULL,
  text            TEXT NOT NULL DEFAULT '',
  is_unreadable   INTEGER NOT NULL DEFAULT 0,
  version         INTEGER NOT NULL DEFAULT 1,
  is_latest       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  local_client_id TEXT NOT NULL DEFAULT '',
  sync_state      TEXT NOT NULL DEFAULT 'SAVED'
);

CREATE TABLE IF NOT EXISTS reviews (
  review_id        TEXT PRIMARY KEY,
  region_id        TEXT NOT NULL REFERENCES regions(region_id),
  task_id          TEXT NOT NULL REFERENCES tasks(task_id),
  reviewer_email   TEXT NOT NULL,
  review_status    TEXT NOT NULL,
  final_script_tag TEXT NOT NULL DEFAULT '',
  review_note      TEXT NOT NULL DEFAULT '',
  review_round     INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
  sync_id       TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(task_id),
  ls_task_id    TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  synced_at     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id      TEXT PRIMARY KEY,
  timestamp   TEXT NOT NULL,
  user_email  TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id   TEXT NOT NULL DEFAULT '',
  old_value   TEXT NOT NULL DEFAULT '',
  new_value   TEXT NOT NULL DEFAULT '',
  metadata    TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_locked_by   ON tasks(locked_by);
CREATE INDEX IF NOT EXISTS idx_regions_task_id   ON regions(task_id);
CREATE INDEX IF NOT EXISTS idx_regions_status    ON regions(status);
CREATE INDEX IF NOT EXISTS idx_labels_region_id  ON labels(region_id);
CREATE INDEX IF NOT EXISTS idx_labels_task_id    ON labels(task_id);
CREATE INDEX IF NOT EXISTS idx_labels_is_latest  ON labels(is_latest);
CREATE INDEX IF NOT EXISTS idx_reviews_task_id   ON reviews(task_id);
CREATE INDEX IF NOT EXISTS idx_reviews_region_id ON reviews(region_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp   ON audit_logs(timestamp);
`

interface UserSeedRow {
  user_id:        string
  email:          string
  name:           string
  password_hash:  string
  role:           string
  status:         string
  assigned_batch: string
  created_at:     string
  updated_at:     string
  last_login_at:  string
  notes:          string
}

async function main() {
  const url       = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN

  if (!url)       { console.error('❌ TURSO_DATABASE_URL is not set in .env.local'); process.exit(1) }
  if (!authToken) { console.error('❌ TURSO_AUTH_TOKEN is not set in .env.local');   process.exit(1) }

  // createClient is called here — after dotenvConfig() ran at top-level
  const db = createClient({ url, authToken })

  console.log('🔧 Running Turso migration…')
  console.log(`   → ${url}\n`)

  // 1. Create tables + indexes
  console.log('  ▶ Creating tables and indexes…')
  const statements = SCHEMA
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (const sql of statements) {
    await db.execute(sql)
  }
  console.log('  ✓ Schema ready')

  // 2. Seed users
  const seedPath = join(process.cwd(), 'scripts', 'users-seed.json')
  if (!existsSync(seedPath)) {
    console.warn('\n  ⚠ scripts/users-seed.json not found — skipping user seed.')
    console.log('\n✅ Migration complete (no users seeded)')
    process.exit(0)
  }

  const users: UserSeedRow[] = JSON.parse(readFileSync(seedPath, 'utf-8'))
  console.log(`\n  ▶ Seeding ${users.length} user(s)…`)

  for (const u of users) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO users
              (user_id, email, name, password_hash, role, status,
               assigned_batch, created_at, updated_at, last_login_at, notes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        u.user_id, u.email, u.name, u.password_hash,
        u.role, u.status, u.assigned_batch ?? '',
        u.created_at, u.updated_at, u.last_login_at ?? '', u.notes ?? '',
      ],
    })
    console.log(`    ✓ ${u.email} (${u.role})`)
  }

  console.log('\n✅ Migration complete!')
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})
