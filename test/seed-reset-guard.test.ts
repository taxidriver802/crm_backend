/// <reference types="jest" />
import path from 'path';
import { spawnSync } from 'child_process';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createTestCompany, createTestUser, DEFAULT_COMPANY_ID } from './helpers/auth';

const { DEMO_TABLES } = require('../scripts/seed-walkthrough-data');
const {
  assertResetTouchesOnlyCompany,
  truncateClosure,
} = require('../scripts/lib/reset-guard');
const { databaseName } = require('../scripts/lib/backup');

jest.setTimeout(60000);

const BACKEND_ROOT = path.resolve(__dirname, '..');

async function leadFor(companyId: string, ownerId: string, email: string) {
  await pool.query(
    `INSERT INTO leads (first_name, last_name, email, source, status, user_id, company_id)
     VALUES ('Lee', 'Customer', $1, 'Referral', 'New', $2, $3)`,
    [email, ownerId, companyId]
  );
}

function seedDryRunReset(...extra: string[]) {
  return spawnSync(
    process.execPath,
    [path.join('scripts', 'seed-walkthrough-data.js'), '--reset', '--dry-run', ...extra],
    { cwd: BACKEND_ROOT, encoding: 'utf8', env: { ...process.env } }
  );
}

describe('Walkthrough seed --reset', () => {
  let rooftopOwner: { id: string };

  beforeAll(async () => {
    await ensureSchema();
    // The seed is spawned against DATABASE_URL: only ever the test database.
    expect(databaseName(process.env.DATABASE_URL, 'DATABASE_URL')).toMatch(/_test$/);
  });

  beforeEach(async () => {
    await resetDb();
    rooftopOwner = await createTestUser({ role: 'owner', company_id: DEFAULT_COMPANY_ID });
    await leadFor(DEFAULT_COMPANY_ID, rooftopOwner.id, 'rooftop-lead@example.com');
  });

  afterAll(async () => {
    await resetDb();
  });

  it('knows the truncate reaches past the tables it names', async () => {
    const closure = await truncateClosure(pool, DEMO_TABLES);
    expect(closure).toEqual(expect.arrayContaining(DEMO_TABLES));
    expect(closure).toContain('lead_status_events');
  });

  it('allows a reset when only the seeded company has data', async () => {
    // Another company with people but no records loses nothing.
    const other = await createTestCompany({ name: 'Gutter Guys', slug: 'gutter-guys' });
    await createTestUser({ role: 'owner', company_id: other.id });
    await expect(
      assertResetTouchesOnlyCompany(pool, DEMO_TABLES, DEFAULT_COMPANY_ID)
    ).resolves.toContain('leads');
  });

  it('refuses once another company has data, and names it', async () => {
    const other = await createTestCompany({ name: 'Gutter Guys', slug: 'gutter-guys' });
    const otherOwner = await createTestUser({ role: 'owner', company_id: other.id });
    await leadFor(other.id, otherOwner.id, 'their-lead@example.com');

    await expect(
      assertResetTouchesOnlyCompany(pool, DEMO_TABLES, DEFAULT_COMPANY_ID)
    ).rejects.toThrow(/Refusing --reset[\s\S]*1 other company has data[\s\S]*Gutter Guys \(gutter-guys\)/);
  });

  it('the seed itself refuses, even in a dry run, and deletes nothing', async () => {
    const other = await createTestCompany({ name: 'Gutter Guys', slug: 'gutter-guys' });
    const otherOwner = await createTestUser({ role: 'owner', company_id: other.id });
    await leadFor(other.id, otherOwner.id, 'their-lead@example.com');

    const result = seedDryRunReset('--company', 'rooftop');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Refusing --reset.*Gutter Guys/);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM leads');
    expect(rows[0].n).toBe(2);
  });

  it('asks which company to seed when there is more than one', async () => {
    await createTestCompany({ name: 'Gutter Guys', slug: 'gutter-guys' });
    const result = seedDryRunReset();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/2 companies \(rooftop, gutter-guys\).*--company <slug>/);
  });

  it('the seed accepts a reset of a single-company database', () => {
    const result = seedDryRunReset();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('only this company has rows in them');
    expect(result.stdout).toContain('[dry-run] TRUNCATE TABLE');
  });
});
