const { config } = require('dotenv');
config({ path: '.env.local' });
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  const tasks = await db.execute(
    'SELECT task_id, status, locked_by, lock_expires_at, region_count, labeled_region_count FROM tasks ORDER BY updated_at DESC LIMIT 5'
  );
  console.log('\n=== RECENT TASKS ===');
  tasks.rows.forEach(r => {
    console.log(JSON.stringify(r));
  });

  const regionCounts = await db.execute(
    'SELECT task_id, status, COUNT(*) as cnt FROM regions WHERE is_active=1 GROUP BY task_id, status ORDER BY task_id'
  );
  console.log('\n=== REGION STATUS COUNTS PER TASK ===');
  regionCounts.rows.forEach(r => {
    console.log(JSON.stringify(r));
  });
}

main().catch(console.error);
