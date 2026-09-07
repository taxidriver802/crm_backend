const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'sql', 'patch_phase15_status_aging.sql'),
    'utf8'
  );
  try {
    await pool.query(sql);
    console.log('Phase 15 status aging patch applied successfully.');
  } catch (err) {
    console.error('Failed to apply status aging patch:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
