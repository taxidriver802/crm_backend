/**
 * Applies sql/patch_notifications_constraints.sql to the database pointed to by DATABASE_URL.
 * Updates CHECK constraints on notifications.type and notifications.entity_type (e.g. new notification types).
 * Run from crm-backend: npm run db:patch-notifications
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      'DATABASE_URL is not set. Add it to .env or the environment.'
    );
    process.exit(1);
  }

  const patchPath = path.join(
    __dirname,
    '..',
    'sql',
    'patch_notifications_constraints.sql'
  );
  const sql = fs.readFileSync(patchPath, 'utf8');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(sql);
    console.log(
      'Notifications constraints patch applied successfully (notifications_type_check + notifications_entity_type_check).'
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
