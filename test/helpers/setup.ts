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
  const patchPhase12InvoicingPath = path.join(
    process.cwd(),
    'sql',
    'patch_phase12_invoicing.sql'
  );
  const patchPhase12InvoicingSql = fs.readFileSync(
    patchPhase12InvoicingPath,
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
    await client.query(patchPhase12InvoicingSql);

    const patchPhase13AutomationPath = path.join(
      process.cwd(),
      'sql',
      'patch_phase13_automation.sql'
    );
    const patchPhase13AutomationSql = fs.readFileSync(
      patchPhase13AutomationPath,
      'utf8'
    );
    await client.query(patchPhase13AutomationSql);

    const patchPhase13PortalPath = path.join(
      process.cwd(),
      'sql',
      'patch_phase13_portal.sql'
    );
    const patchPhase13PortalSql = fs.readFileSync(
      patchPhase13PortalPath,
      'utf8'
    );
    await client.query(patchPhase13PortalSql);

    const patchPhase14EventsPath = path.join(
      process.cwd(),
      'sql',
      'patch_phase14_events.sql'
    );
    const patchPhase14EventsSql = fs.readFileSync(
      patchPhase14EventsPath,
      'utf8'
    );
    await client.query(patchPhase14EventsSql);

    const patchPhase15StatusAgingPath = path.join(
      process.cwd(),
      'sql',
      'patch_phase15_status_aging.sql'
    );
    const patchPhase15StatusAgingSql = fs.readFileSync(
      patchPhase15StatusAgingPath,
      'utf8'
    );
    await client.query(patchPhase15StatusAgingSql);

    const patchPhase16CommunicationPath = path.join(
      process.cwd(),
      'sql',
      'patch_phase16_communication.sql'
    );
    const patchPhase16CommunicationSql = fs.readFileSync(
      patchPhase16CommunicationPath,
      'utf8'
    );
    await client.query(patchPhase16CommunicationSql);

    const patchPhase17QuotesPhotosPath = path.join(
      process.cwd(),
      'sql',
      'patch_phase17_quotes_photos.sql'
    );
    const patchPhase17QuotesPhotosSql = fs.readFileSync(
      patchPhase17QuotesPhotosPath,
      'utf8'
    );
    await client.query(patchPhase17QuotesPhotosSql);

    const patchPhase18AcquisitionPortalPath = path.join(
      process.cwd(),
      'sql',
      'patch_phase18_acquisition_portal.sql'
    );
    const patchPhase18AcquisitionPortalSql = fs.readFileSync(
      patchPhase18AcquisitionPortalPath,
      'utf8'
    );
    await client.query(patchPhase18AcquisitionPortalSql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
