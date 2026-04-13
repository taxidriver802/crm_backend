/**
 * Applies sql/patch_phase12_team_visibility.sql to the database pointed to by DATABASE_URL.
 * Run from crm-backend: npm run db:patch-phase12-team-visibility
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
    'patch_phase12_team_visibility.sql'
  );
  const sql = fs.readFileSync(patchPath, 'utf8');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(sql);
    console.log('Phase 12 team visibility patch applied successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
