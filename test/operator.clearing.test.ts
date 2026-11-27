/// <reference types="jest" />
/**
 * Clearing refused sign-ups: a denied company 45 days after it was denied,
 * a pending one whose owner never confirmed their email 14 days after
 * sign-up, and the operator's "Remove now" for a denied company. Migration
 * 0010's backfill is re-run in a rolled-back transaction.
 */
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { authHeaderFor, createTestCompany, createTestUser } from './helpers/auth';
import { runLifecycleJob } from '../src/jobs/lifecycle';
import { captureOperatorPings, type OperatorPing } from '../src/lib/operatorNotify';
import { clearStorageCacheForTests } from '../src/services/operator.service';
import { uploadsRoot } from '../src/lib/uploadsDir';
import { archivePath } from '../src/services/companyExport.service';
const { upsertOperator } = require('../scripts/operator-create');

type Sent = { to: string; subject: string };
const mockMail: { sent: Sent[] } = { sent: [] };
jest.mock('../src/lib/mailer', () => ({
  isMailConfigured: () => true,
  sendMail: async (message: Sent) => {
    mockMail.sent.push(message);
  },
}));

jest.setTimeout(120000);

const DAY = 86400000;
const OP_EMAIL = 'op@example.com';
const OP_PASSWORD = 'a-long-operator-password';
let savedSecret: string | undefined;
let pings: OperatorPing[] = [];
let cookie = '';

const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'migrations', '0010_clear_refused_signups.sql'),
  'utf8'
);

const op = (url: string, body: object = {}) => request(app).post(url).set('Cookie', cookie).send(body);
const detail = (id: string) => request(app).get(`/operator/companies/${id}`).set('Cookie', cookie);

async function eventually<T>(read: () => T | Promise<T>, done: (value: T) => boolean) {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > 5000) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** A sign-up waiting in `pending`, its owner confirmed or not, made `ageDays` ago. */
async function signUp(slug: string, { confirmed = false, ageDays = 0 } = {}) {
  const company = await createTestCompany({ name: `Refused ${slug}`, slug });
  const owner = await createTestUser({
    role: 'owner',
    company_id: company.id,
    email: `owner-${slug}@example.com`,
    first_name: 'Rae',
  });
  await pool.query(
    `UPDATE companies SET status = 'pending', next_status_at = NULL,
       created_at = now() - make_interval(days => $2) WHERE id = $1`,
    [company.id, ageDays]
  );
  await pool.query(`UPDATE users SET email_verified_at = $2 WHERE id = $1`, [
    owner.id,
    confirmed ? new Date() : null,
  ]);
  return { ...company, owner };
}

async function row(companyId: string) {
  const { rows } = await pool.query(`SELECT * FROM companies WHERE id = $1`, [companyId]);
  return rows[0];
}

async function tombstone(companyId: string) {
  const { rows } = await pool.query(`SELECT * FROM company_tombstones WHERE company_id = $1`, [companyId]);
  return rows[0];
}

async function events(companyId: string) {
  const { rows } = await pool.query(
    `SELECT event, from_status, to_status, operator_id, detail FROM operator_events
     WHERE company_id = $1 ORDER BY id`,
    [companyId]
  );
  return rows;
}

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
  mockMail.sent = [];
  pings = captureOperatorPings();
  await upsertOperator(pool, { email: OP_EMAIL, password: OP_PASSWORD });
  const res = await request(app).post('/operator/auth/login').send({ email: OP_EMAIL, password: OP_PASSWORD });
  cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('joist_op='))!.split(';')[0];
});

describe('the denied timer', () => {
  it('denying sets a date 45 days out, shown as clears_at; extending moves it; approving cancels it', async () => {
    const company = await signUp('denied-timer', { confirmed: true });
    const denied = await op(`/operator/companies/${company.id}/deny`, { reason: 'Not a roofer' });
    expect(denied.status).toBe(200);
    const after = await row(company.id);
    expect(after.status).toBe('denied');
    expect((new Date(after.next_status_at).getTime() - Date.now()) / DAY).toBeCloseTo(45, 1);
    expect(new Date((await detail(company.id)).body.company.clears_at).getTime()).toBe(
      new Date(after.next_status_at).getTime()
    );

    const extended = await op(`/operator/companies/${company.id}/extend`, { days: 10 });
    expect(extended.status).toBe(200);
    expect((new Date((await row(company.id)).next_status_at).getTime() - Date.now()) / DAY).toBeCloseTo(55, 1);

    const approved = await op(`/operator/companies/${company.id}/approve`, {});
    expect(approved.status).toBe(200);
    const live = await row(company.id);
    expect(live.status).toBe('trial');
    expect((new Date(live.next_status_at).getTime() - Date.now()) / DAY).toBeCloseTo(30, 1);
    expect((await detail(company.id)).body.company.clears_at).toBeNull();

    // An approved company is never cleared, even long after the old date.
    const run = await runLifecycleJob({ now: new Date(Date.now() + 50 * DAY), dryRun: false });
    expect(run.cleared).toEqual([]);
  });
});

describe('the lifecycle job clears refused sign-ups', () => {
  it('a denied company past its date: tombstone, event, files gone, no email, no ping, slug free', async () => {
    const company = await signUp('gone-denied', { confirmed: true });
    await pool.query(
      `UPDATE companies SET status = 'denied', next_status_at = now() - interval '1 minute' WHERE id = $1`,
      [company.id]
    );
    const folder = path.join(uploadsRoot(), company.id);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'logo.png'), 'x');
    const { rows: exp } = await pool.query(
      `INSERT INTO company_exports (company_id, kind, status) VALUES ($1, 'self_serve', 'built') RETURNING id`,
      [company.id]
    );
    fs.mkdirSync(path.dirname(archivePath(exp[0].id)), { recursive: true });
    fs.writeFileSync(archivePath(exp[0].id), 'zip');
    const kept = await signUp('kept-denied', { confirmed: true });
    await pool.query(
      `UPDATE companies SET status = 'denied', next_status_at = now() + interval '1 day' WHERE id = $1`,
      [kept.id]
    );

    const run = await runLifecycleJob({ now: new Date(), dryRun: false });
    expect(run.cleared).toEqual([
      { company_id: company.id, slug: 'gone-denied', from: 'denied', cause: 'denied_expired' },
    ]);
    expect(await row(company.id)).toBeUndefined();
    expect((await row(kept.id)).status).toBe('denied');
    const { rows: users } = await pool.query(`SELECT 1 FROM users WHERE company_id = $1`, [company.id]);
    expect(users).toEqual([]);

    expect(await tombstone(company.id)).toMatchObject({
      slug: 'gone-denied',
      owner_email: 'owner-gone-denied@example.com',
      deleted_by: null,
      cleared: true,
    });
    expect(new Date((await tombstone(company.id)).slug_reserved_until).getTime()).toBeLessThanOrEqual(Date.now());
    expect(await events(company.id)).toEqual([
      expect.objectContaining({
        event: 'cleared',
        from_status: 'denied',
        to_status: null,
        operator_id: null,
        detail: expect.objectContaining({ cause: 'denied_expired' }),
      }),
    ]);

    expect(fs.existsSync(folder)).toBe(false);
    expect(fs.existsSync(archivePath(exp[0].id))).toBe(false);
    expect(mockMail.sent).toEqual([]);
    expect(pings).toEqual([]);

    // The slug is free at once.
    const again = await request(app).post('/auth/register').send({
      first_name: 'New', last_name: 'Owner', email: 'new@example.com', password: 'a-good-password',
      company_name: 'Gone', slug: 'gone-denied',
    });
    expect(again.status).toBe(201);

    const overview = await request(app).get('/operator/overview').set('Cookie', cookie);
    expect(overview.body.recently_deleted).toEqual([
      expect.objectContaining({ slug: 'gone-denied', cleared: true }),
    ]);
  });

  it('a pending sign-up never confirmed after 14 days; a confirmed or newer one stays', async () => {
    const stale = await signUp('stale-pending', { ageDays: 15 });
    const fresh = await signUp('fresh-pending', { ageDays: 13 });
    const confirmed = await signUp('waiting-on-me', { confirmed: true, ageDays: 60 });

    expect(new Date((await detail(fresh.id)).body.company.clears_at).getTime()).toBeGreaterThan(Date.now());
    expect((await detail(confirmed.id)).body.company.clears_at).toBeNull();

    const run = await runLifecycleJob({ now: new Date(), dryRun: false });
    expect(run.cleared).toEqual([
      { company_id: stale.id, slug: 'stale-pending', from: 'pending', cause: 'pending_unconfirmed' },
    ]);
    expect(await row(stale.id)).toBeUndefined();
    expect((await row(fresh.id)).status).toBe('pending');
    expect((await row(confirmed.id)).status).toBe('pending');
    expect((await tombstone(stale.id)).cleared).toBe(true);
    expect(mockMail.sent).toEqual([]);

    // Its owner's email can sign up again.
    const again = await request(app).post('/auth/register').send({
      first_name: 'Rae', last_name: 'Owner', email: 'owner-stale-pending@example.com',
      password: 'a-good-password', company_name: 'Stale again',
    });
    expect(again.status).toBe(201);
  });

  it('a dry run clears nothing, and lists what it would clear', async () => {
    const denied = await signUp('dry-denied', { confirmed: true });
    await pool.query(
      `UPDATE companies SET status = 'denied', next_status_at = now() - interval '1 minute' WHERE id = $1`,
      [denied.id]
    );
    const pending = await signUp('dry-pending', { ageDays: 20 });

    const run = await runLifecycleJob({ now: new Date(), dryRun: true });
    expect(run.cleared.map((c) => [c.slug, c.cause]).sort()).toEqual([
      ['dry-denied', 'denied_expired'],
      ['dry-pending', 'pending_unconfirmed'],
    ]);
    expect((await row(denied.id)).status).toBe('denied');
    expect((await row(pending.id)).status).toBe('pending');
    expect(await events(denied.id)).toEqual([]);
    expect(await tombstone(denied.id)).toBeUndefined();
  });
});

describe('Remove now', () => {
  it('clears a denied company at once with the slug typed, silently', async () => {
    const company = await signUp('spam-co', { confirmed: true });
    await op(`/operator/companies/${company.id}/deny`, { reason: 'Spam' });

    const wrong = await op(`/operator/companies/${company.id}/remove`, { confirm_slug: 'spam' });
    expect(wrong.status).toBe(400);
    expect(await row(company.id)).toBeTruthy();

    const res = await op(`/operator/companies/${company.id}/remove`, { confirm_slug: ' Spam-Co ', reason: 'Test sign-up' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: company.id, slug: 'spam-co', removed: true });
    expect(await row(company.id)).toBeUndefined();

    const { rows: ops } = await pool.query(`SELECT id FROM operators WHERE email = $1`, [OP_EMAIL]);
    expect(await tombstone(company.id)).toMatchObject({ cleared: true, deleted_by: ops[0].id });
    expect((await events(company.id)).map((e) => [e.event, e.detail.cause, e.detail.reason])).toEqual([
      ['denied', undefined, 'Spam'],
      ['cleared', 'removed', 'Test sign-up'],
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockMail.sent).toEqual([]);
  });

  it('refuses any company that is not denied', async () => {
    for (const status of ['pending', 'trial', 'active', 'suspended', 'pending_deletion']) {
      const company = await signUp(`not-denied-${status.replace('_', '-')}`, { confirmed: true });
      await pool.query(
        `UPDATE companies SET status = $2, next_status_at = now() - interval '1 day' WHERE id = $1`,
        [company.id, status]
      );
      const res = await op(`/operator/companies/${company.id}/remove`, { confirm_slug: company.slug });
      expect([status, res.status]).toEqual([status, 409]);
      expect(await row(company.id)).toBeTruthy();
    }
  });

  it('refuses a company token', async () => {
    const company = await signUp('token-co', { confirmed: true });
    await pool.query(`UPDATE companies SET status = 'denied' WHERE id = $1`, [company.id]);
    const res = await request(app)
      .post(`/operator/companies/${company.id}/remove`)
      .set(await authHeaderFor(company.owner))
      .send({ confirm_slug: company.slug });
    expect(res.status).toBe(401);
    expect(await row(company.id)).toBeTruthy();
  });
});

describe('migration 0010', () => {
  it('gives a denied company with no timer one 45 days from when it was denied, and touches nothing else', async () => {
    const old = await signUp('old-denied', { confirmed: true });
    const dated = await signUp('dated-denied', { confirmed: true });
    const trial = await signUp('trial-co', { confirmed: true });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE companies SET status = 'denied', next_status_at = NULL,
           status_changed_at = '2026-10-01T00:00:00Z' WHERE id = $1`,
        [old.id]
      );
      await client.query(
        `UPDATE companies SET status = 'denied', next_status_at = '2027-01-01T00:00:00Z' WHERE id = $1`,
        [dated.id]
      );
      await client.query(`UPDATE companies SET status = 'trial', next_status_at = NULL WHERE id = $1`, [trial.id]);
      await client.query(MIGRATION);
      await client.query(MIGRATION);
      const { rows } = await client.query(
        `SELECT slug, next_status_at FROM companies WHERE id = ANY($1) ORDER BY slug`,
        [[old.id, dated.id, trial.id]]
      );
      expect(rows.map((r) => [r.slug, r.next_status_at && new Date(r.next_status_at).toISOString()])).toEqual([
        ['dated-denied', '2027-01-01T00:00:00.000Z'],
        ['old-denied', '2026-11-15T00:00:00.000Z'],
        ['trial-co', null],
      ]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
