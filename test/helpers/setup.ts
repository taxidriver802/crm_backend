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

  const patchPhase9Path = path.join(process.cwd(), 'sql', 'patch_phase9.sql');
  const patchPhase9Sql = fs.readFileSync(patchPhase9Path, 'utf8');
  const patchPhase10NotesPath = path.join(
    process.cwd(),
    'sql',
    'patch_phase10_notes.sql'
  );
  const patchPhase10NotesSql = fs.readFileSync(patchPhase10NotesPath, 'utf8');
  const patchPhase12TeamVisibilityPath = path.join(
    process.cwd(),
    'sql',
    'patch_phase12_team_visibility.sql'
  );
  const patchPhase12TeamVisibilitySql = fs.readFileSync(
    patchPhase12TeamVisibilityPath,
    'utf8'
  );
  const patchPhase12SavedViewsPath = path.join(
    process.cwd(),
    'sql',
    'patch_phase12_saved_views.sql'
  );
  const patchPhase12SavedViewsSql = fs.readFileSync(
    patchPhase12SavedViewsPath,
    'utf8'
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(patchSql);
    await client.query(patchPhase9Sql);
    await client.query(patchPhase10NotesSql);
    await client.query(patchPhase12TeamVisibilitySql);
    await client.query(patchPhase12SavedViewsSql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
