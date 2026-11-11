/// <reference types="jest" />
/**
 * The startup schema check (src/lib/schemaCheck.ts): a database a migration
 * behind is named at startup; production refuses to start on it.
 *
 * The test database is current, so each case points the check at a copy of
 * sql/ with a migration added, edited or removed.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import {
  checkSchemaAtStartup,
  describeSchemaStatus,
} from '../src/lib/schemaCheck';
const { listMigrations, SQL_DIR } = require('../scripts/lib/migrations');

const made: string[] = [];

/** A copy of sql/migrations that `change` can add to, edit or trim. */
function sqlDirWith(change: (migrationsDir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joist-schema-check-'));
  made.push(dir);
  const migrations = path.join(dir, 'migrations');
  fs.mkdirSync(migrations);
  for (const name of listMigrations()) {
    fs.copyFileSync(
      path.join(SQL_DIR, 'migrations', name),
      path.join(migrations, name)
    );
  }
  change(migrations);
  return dir;
}

async function run(production: boolean, sqlDir?: string) {
  const warned: string[] = [];
  const failed: string[] = [];
  const ok = await checkSchemaAtStartup({
    production,
    sqlDir,
    log: (line) => warned.push(line),
    fail: (line) => failed.push(line),
  });
  return { ok, warned, failed };
}

const newest = () => listMigrations().slice(-1)[0] as string;

describe('startup schema check', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  afterAll(() => {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('says nothing and starts when the database is current', async () => {
    for (const production of [false, true]) {
      expect(await run(production)).toEqual({
        ok: true,
        warned: [],
        failed: [],
      });
    }
  });

  it('names the missing migration: development warns and starts, production refuses', async () => {
    const sqlDir = sqlDirWith((dir) =>
      fs.writeFileSync(path.join(dir, '9999_future_change.sql'), 'SELECT 1;')
    );

    const dev = await run(false, sqlDir);
    expect(dev.ok).toBe(true);
    expect(dev.failed).toEqual([]);
    expect(dev.warned.join('\n')).toMatch(
      /crm_test is 1 migration behind: 9999_future_change\.sql\./
    );
    expect(dev.warned.join('\n')).toMatch(/npm run db:migrate/);

    const prod = await run(true, sqlDir);
    expect(prod.ok).toBe(false);
    expect(prod.failed.join('\n')).toMatch(/1 migration behind/);
    expect(prod.failed.join('\n')).toMatch(/Refusing to start/);
  });

  it('refuses in production when an applied migration was edited', async () => {
    const name = newest();
    const sqlDir = sqlDirWith((dir) =>
      fs.appendFileSync(path.join(dir, name), '\n-- edited\n')
    );
    const prod = await run(true, sqlDir);
    expect(prod.ok).toBe(false);
    expect(prod.failed.join('\n')).toContain(
      `edited after crm_test applied it: ${name}`
    );
  });

  it('only warns, even in production, when the database is ahead of this code', async () => {
    const name = newest();
    const sqlDir = sqlDirWith((dir) => fs.rmSync(path.join(dir, name)));
    const prod = await run(true, sqlDir);
    expect(prod.ok).toBe(true);
    expect(prod.failed).toEqual([]);
    expect(prod.warned.join('\n')).toContain(
      `has a migration this code doesn't have: ${name}`
    );
  });

  it('starts anyway when the database can’t be asked', async () => {
    const warned: string[] = [];
    const ok = await checkSchemaAtStartup({
      production: true,
      db: { query: () => new Promise(() => {}) },
      timeoutMs: 50,
      log: (line) => warned.push(line),
    });
    expect(ok).toBe(true);
    expect(warned.join('\n')).toMatch(/Couldn't check the database schema/);
  });

  it('says a database with no schema yet has none', () => {
    const { blocking } = describeSchemaStatus({
      database: 'fresh_db',
      pending: ['baseline', '0001_a.sql'],
      edited: [],
      unknown: [],
    });
    expect(blocking).toEqual(['fresh_db has no schema yet.']);
  });

  it('the runner reads a real ledger', async () => {
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM schema_migrations'
    );
    expect(rows[0].n).toBe(listMigrations().length + 1);
  });
});
