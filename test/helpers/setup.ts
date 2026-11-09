import { pool } from '../../src/db';
const { migrate } = require('../../scripts/lib/migrations');

/**
 * Bring the test database up to date with the same runner as
 * `npm run db:migrate`: the baseline on an empty database, then any new
 * sql/migrations files. A no-op once current.
 */
export async function ensureSchema() {
  const client = await pool.connect();
  try {
    await migrate(client);
  } finally {
    client.release();
  }
}
