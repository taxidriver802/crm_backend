/**
 * The one way the CRM database gets its schema.
 *
 *   sql/schema.sql         the baseline: the whole schema as of phase 24
 *   sql/migrations/*.sql   changes since, applied once each, in name order
 *                          (0001_add_x.sql, 0002_…)
 *   sql/archive/*.sql      the old patch chain, kept only to bring a database
 *                          that was built from it up to the baseline
 *
 * `migrate(client)` takes a connected pg client and:
 *   1. on an empty database, applies the baseline;
 *   2. on a database built from the old patches (it has tables but no
 *      schema_migrations), applies the archived patches once more, in their
 *      historical order, so it matches the baseline (they are idempotent);
 *   3. applies every migration not yet recorded in schema_migrations.
 *
 * Each step runs in its own transaction and is recorded with a checksum. A
 * recorded migration whose file has since been edited stops the run: write a
 * new migration instead.
 *
 * Plain CommonJS so the CLI (scripts/migrate.js), the backend's Jest setup
 * and crm_qa can all call the same code.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SQL_DIR = path.join(__dirname, '..', '..', 'sql');
const BASELINE = 'baseline';
const MIGRATION_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

/** The historical apply order of sql/archive. Frozen: never add to it. */
const ARCHIVED_PATCHES = Object.freeze([
  'schema_pre_baseline.sql',
  'patch_notifications_constraints.sql',
  'patch_phase9.sql',
  'patch_phase10_notes.sql',
  'patch_phase12_team_visibility.sql',
  'patch_phase12_saved_views.sql',
  'patch_phase12_invoicing.sql',
  'patch_phase13_automation.sql',
  'patch_phase13_portal.sql',
  'patch_phase14_events.sql',
  'patch_phase15_status_aging.sql',
  'patch_phase16_communication.sql',
  'patch_phase17_quotes_photos.sql',
  'patch_phase18_acquisition_portal.sql',
  'patch_phase19_appointments_workload.sql',
  'patch_phase20_companies.sql',
  'patch_phase21_company_branding.sql',
  'patch_assignment_notifications.sql',
  'patch_phase22_performance_history.sql',
  'patch_phase23_job_lifecycle_money.sql',
  'patch_phase24_workspace_preferences.sql',
]);

// Any fixed key: one migrate run at a time per database.
const LOCK_KEY = 4207311;

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

function read(...parts) {
  return fs.readFileSync(path.join(...parts), 'utf8');
}

const STARTING_ROWS_MARKER = '--\n-- Starting rows\n--\n';

/**
 * The rows a new database starts with (the built-in company and its estimate
 * templates): the last section of the baseline. Tests re-insert them after
 * truncating.
 */
function startingRowsSql(sqlDir = SQL_DIR) {
  const baseline = read(sqlDir, 'schema.sql');
  const at = baseline.indexOf(STARTING_ROWS_MARKER);
  if (at < 0) throw new Error('sql/schema.sql has no "Starting rows" section');
  return baseline.slice(at + STARTING_ROWS_MARKER.length);
}

/** sql/migrations/*.sql in apply order. */
function listMigrations(sqlDir = SQL_DIR) {
  const dir = path.join(sqlDir, 'migrations');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.sql'));
  const bad = files.filter((name) => !MIGRATION_NAME.test(name));
  if (bad.length) {
    throw new Error(
      `Migration files must be named like 0001_short_name.sql:\n  ${bad.join('\n  ')}`
    );
  }
  return files.sort();
}

async function inTransaction(client, fn) {
  await client.query('BEGIN');
  try {
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function exists(client, relation) {
  const res = await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [relation]);
  return res.rows[0].present;
}

const CREATE_LEDGER = `
  CREATE TABLE IF NOT EXISTS public.schema_migrations (
    name        text PRIMARY KEY,
    checksum    text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )`;

async function record(client, name, sql) {
  await client.query('INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)', [
    name,
    checksum(sql),
  ]);
}

/**
 * Bring the database `client` is connected to up to date.
 * Returns the names applied this run (empty when already current).
 */
async function migrate(client, { sqlDir = SQL_DIR, log = () => {} } = {}) {
  const applied = [];
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    if (!(await exists(client, 'public.schema_migrations'))) {
      const baselineSql = read(sqlDir, 'schema.sql');
      if (!(await exists(client, 'public.companies'))) {
        await inTransaction(client, async () => {
          await client.query(baselineSql);
          await client.query(CREATE_LEDGER);
          await record(client, BASELINE, baselineSql);
        });
        log('applied the baseline (sql/schema.sql)');
      } else {
        await inTransaction(client, async () => {
          for (const name of ARCHIVED_PATCHES) {
            await client.query(read(sqlDir, 'archive', name));
          }
          await client.query(CREATE_LEDGER);
          await record(client, BASELINE, baselineSql);
        });
        log('brought a database built from the old patches up to the baseline');
      }
      applied.push(BASELINE);
    }

    const done = new Map(
      (await client.query('SELECT name, checksum FROM public.schema_migrations')).rows.map((r) => [
        r.name,
        r.checksum,
      ])
    );

    for (const name of listMigrations(sqlDir)) {
      const sql = read(sqlDir, 'migrations', name);
      if (done.has(name)) {
        if (done.get(name) !== checksum(sql)) {
          throw new Error(
            `sql/migrations/${name} was edited after it was applied. ` +
              'Put the change in a new migration instead.'
          );
        }
        continue;
      }
      await inTransaction(client, async () => {
        await client.query(sql);
        await record(client, name, sql);
      });
      log(`applied ${name}`);
      applied.push(name);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
  return applied;
}

module.exports = { migrate, listMigrations, startingRowsSql, ARCHIVED_PATCHES, SQL_DIR };
