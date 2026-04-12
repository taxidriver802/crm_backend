import fs from 'fs';
import path from 'path';
import { pool } from '../../src/db';

export async function ensureSchema() {
  const schemaPath = path.join(process.cwd(), 'sql', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const patchPath = path.join(
    process.cwd(),
    'sql',
    'patch_notifications_constraints.sql'
  );
  const patchSql = fs.readFileSync(patchPath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(patchSql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
