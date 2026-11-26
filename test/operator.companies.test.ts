/// <reference types="jest" />
/**
 * The operator's read-only view, step 3 (PLAN_operator.md §5–6): the
 * overview, the company list, one company, and the rule that the operator
 * sees counts, never a company's work.
 */
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { uploadsRoot } from '../src/lib/uploadsDir';
import { clearStorageCacheForTests } from '../src/services/operator.service';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import {
  authHeaderFor,
  createTestCompany,
  createTestUser,
  DEFAULT_COMPANY_ID,
} from './helpers/auth';
const { upsertOperator } = require('../scripts/operator-create');

jest.setTimeout(60000);

const EMAIL = 'op@example.com';
const PASSWORD = 'a-long-operator-password';
let savedSecret: string | undefined;
let cookie = '';

async function signIn() {
  const res = await request(app)
    .post('/operator/auth/login')
    .send({ email: EMAIL, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('joist_op='))!.split(';')[0];
}

const get = (url: string) => request(app).get(url).set('Cookie', cookie);

beforeAll(async () => {
  await ensureSchema();
  savedSecret = process.env.OPERATOR_JWT_SECRET;
  process.env.OPERATOR_JWT_SECRET = 'operator-test-secret-'.padEnd(64, 'x');
});

afterAll(() => {
  if (savedSecret === undefined) delete process.env.OPERATOR_JWT_SECRET;
  else process.env.OPERATOR_JWT_SECRET = savedSecret;
});

beforeEach(async () => {
  await resetDb();
  clearStorageCacheForTests();
  await upsertOperator(pool, { email: EMAIL, password: PASSWORD });
  cookie = await signIn();
});

describe('the company list', () => {
  it('needs a signed-in operator, and refuses a company owner', async () => {
    expect((await request(app).get('/operator/companies')).status).toBe(401);
    const owner = await createTestUser({ role: 'owner' });
    const asOwner = await request(app)
      .get('/operator/companies')
      .set(await authHeaderFor(owner));
    expect(asOwner.status).toBe(401);
  });

  it('lists every company with its status, seats, owner and last sign-in', async () => {
    const other = await createTestCompany({ name: 'Acme Roofing', slug: 'acme' });
    await createTestUser({
      role: 'owner',
      company_id: other.id,
      first_name: 'Ana',
      last_name: 'Acme',
      email: 'ana@acme.test',
    });
    await createTestUser({ role: 'agent', company_id: other.id, status: 'invited' });
    await createTestUser({ role: 'agent', company_id: other.id, status: 'disabled' });
    await pool.query(
      `UPDATE users SET last_login_at = '2026-11-20T10:00:00Z' WHERE email = 'ana@acme.test'`
    );

    const res = await get('/operator/companies');
    expect(res.status).toBe(200);
    const acme = res.body.companies.find((c: any) => c.slug === 'acme');
    expect(acme).toMatchObject({
      name: 'Acme Roofing',
      status: 'active',
      seats: { active: 1, invited: 1, disabled: 1 },
      owner: { name: 'Ana Acme', email: 'ana@acme.test' },
      storage_bytes: 0,
    });
    expect(new Date(acme.last_sign_in_at).toISOString()).toBe('2026-11-20T10:00:00.000Z');
    expect(res.body.companies.map((c: any) => c.id)).toContain(DEFAULT_COMPANY_ID);
  });

  it('filters by status and searches name or slug', async () => {
    const other = await createTestCompany({ name: 'Acme Roofing', slug: 'acme' });
    await pool.query(`UPDATE companies SET status = 'trial' WHERE id = $1`, [other.id]);

    const trial = await get('/operator/companies?status=trial');
    expect(trial.body.companies.map((c: any) => c.slug)).toEqual(['acme']);
    const search = await get('/operator/companies?q=acm');
    expect(search.body.companies.map((c: any) => c.slug)).toEqual(['acme']);
    const percent = await get('/operator/companies?q=%25');
    expect(percent.body.companies).toEqual([]);
    expect((await get('/operator/companies?status=deleted')).status).toBe(400);
  });

  it('measures storage from the company’s uploads folder', async () => {
    const dir = path.join(uploadsRoot(), DEFAULT_COMPANY_ID, 'nested');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.bin'), Buffer.alloc(1500));
    fs.writeFileSync(path.join(uploadsRoot(), DEFAULT_COMPANY_ID, 'b.bin'), Buffer.alloc(500));
    const res = await get('/operator/companies');
    const rooftop = res.body.companies.find((c: any) => c.id === DEFAULT_COMPANY_ID);
    expect(rooftop.storage_bytes).toBe(2000);
  });
});

describe('one company', () => {
  it('shows counts of the company’s work, its notes and its history, and never the work itself', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const lead = await request(app)
      .post('/leads')
      .set(await authHeaderFor(owner))
      .send({ first_name: 'Secretclient', last_name: 'Hiddenlane', status: 'New' });
    expect(lead.status).toBe(201);
    await pool.query(`UPDATE companies SET operator_notes = 'called them' WHERE id = $1`, [
      DEFAULT_COMPANY_ID,
    ]);
    await pool.query(
      `INSERT INTO operator_events (company_id, company_slug, event, to_status)
       VALUES ($1, 'rooftop', 'status_changed', 'active')`,
      [DEFAULT_COMPANY_ID]
    );

    const res = await get(`/operator/companies/${DEFAULT_COMPANY_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.company.counts.leads).toBeGreaterThanOrEqual(1);
    expect(res.body.company.operator_notes).toBe('called them');
    expect(res.body.company.events).toHaveLength(1);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/Secretclient|Hiddenlane/);
  });

  it('answers 404 for an unknown or malformed id', async () => {
    expect((await get('/operator/companies/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await get('/operator/companies/not-an-id')).status).toBe(404);
  });
});

describe('the overview', () => {
  it('totals by status, and queues pending companies with verified owners first', async () => {
    const unverified = await createTestCompany({ name: 'Unverified Co', slug: 'unverified' });
    const verified = await createTestCompany({ name: 'Verified Co', slug: 'verified' });
    await pool.query(`UPDATE companies SET status = 'pending' WHERE id = ANY($1)`, [
      [unverified.id, verified.id],
    ]);
    await createTestUser({ role: 'owner', company_id: unverified.id });
    const v = await createTestUser({ role: 'owner', company_id: verified.id });
    await pool.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [v.id]);

    const res = await get('/operator/overview');
    expect(res.status).toBe(200);
    expect(res.body.totals.pending).toBe(2);
    expect(res.body.totals.active).toBeGreaterThanOrEqual(1);
    expect(res.body.pending.map((c: any) => c.slug)).toEqual(['verified', 'unverified']);
  });
});

describe('counts, never content', () => {
  // A company's work. The operator's code may name these only inside COUNT(*).
  const CONTENT_TABLES = [
    'leads', 'lead_status_events', 'contacts', 'contact_methods', 'job_contacts',
    'jobs', 'job_activity', 'job_measurements', 'estimates', 'estimate_line_items',
    'estimate_templates', 'estimate_template_line_items', 'invoices',
    'invoice_line_items', 'invoice_payments', 'notes', 'tasks', 'files',
    'notifications', 'saved_views', 'portal_tokens', 'intake_tokens',
    'automation_rules', 'assignment_events', 'supplier_orders', 'supplier_accounts',
  ];
  const FILES = [
    'src/services/operator.service.ts',
    'src/services/companyAccount.service.ts',
    'src/routes/operator.routes.ts',
  ];

  it.each(FILES)('%s reads a company’s work only as COUNT(*)', (file) => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const offenders: string[] = [];
    const pattern = /\b(?:FROM|JOIN)\s+(?:public\.)?([a-z_]+)/gi;
    for (const match of source.matchAll(pattern)) {
      const table = match[1].toLowerCase();
      if (!CONTENT_TABLES.includes(table)) continue;
      const before = source.slice(Math.max(0, match.index! - 30), match.index!);
      if (!/SELECT\s+COUNT\(\*\)\s*$/i.test(before)) offenders.push(`${table} at ${match.index}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the routes import no company service', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src/routes/operator.routes.ts'), 'utf8');
    const services = [...source.matchAll(/from '\.\.\/services\/([^']+)'/g)].map((m) => m[1]);
    expect(services.sort()).toEqual(['companyAccount.service', 'operator.service']);
  });
});
