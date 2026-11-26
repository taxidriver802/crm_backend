/// <reference types="jest" />
/**
 * Timers, deletion and the operator's second factor, step 7 of
 * PLAN_operator.md (§3, §5, §6).
 *
 * The lifecycle job is run directly with a chosen `now`. The mailer is a
 * stand-in that records what would be sent.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
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
import { totpCode, totpStep } from '../src/lib/totp';
const { upsertOperator } = require('../scripts/operator-create');

type Sent = { to: string; subject: string; text: string; html: string };
const mockMail: { on: boolean; sent: Sent[] } = { on: true, sent: [] };
jest.mock('../src/lib/mailer', () => ({
  isMailConfigured: () => mockMail.on,
  sendMail: async (message: Sent) => {
    if (!mockMail.on) throw new Error('SMTP is not configured');
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

async function signIn(code?: string) {
  return request(app)
    .post('/operator/auth/login')
    .send({ email: OP_EMAIL, password: OP_PASSWORD, ...(code ? { code } : {}) });
}

function cookieOf(res: { headers: Record<string, unknown> }) {
  const raw = res.headers['set-cookie'] as string[];
  return raw.find((c) => c.startsWith('joist_op='))!.split(';')[0];
}

const op = (url: string, body: object = {}) => request(app).post(url).set('Cookie', cookie).send(body);

async function eventually<T>(read: () => T | Promise<T>, done: (value: T) => boolean) {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > 5000) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** A company with an owner, in `status`, whose timer is due at `due`. */
async function companyIn(status: string, due: Date | null, extra: { slug?: string; billing_email?: string } = {}) {
  const company = await createTestCompany({ name: 'Ridge Roofing', slug: extra.slug });
  const owner = await createTestUser({
    role: 'owner',
    company_id: company.id,
    email: `owner-${company.slug}@example.com`,
    first_name: 'Rae',
  });
  await pool.query(
    `UPDATE companies SET status = $2, next_status_at = $3, billing_email = $4 WHERE id = $1`,
    [company.id, status, due, extra.billing_email ?? null]
  );
  return { ...company, owner };
}

async function row(companyId: string) {
  const { rows } = await pool.query(`SELECT * FROM companies WHERE id = $1`, [companyId]);
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
  mockMail.on = true;
  mockMail.sent = [];
  pings = captureOperatorPings();
  await upsertOperator(pool, { email: OP_EMAIL, password: OP_PASSWORD });
  cookie = cookieOf(await signIn());
});

describe('the lifecycle job moves companies on', () => {
  it('trial → suspended, past_due → suspended, suspended → pending_deletion, each with its email', async () => {
    const now = new Date();
    const trial = await companyIn('trial', new Date(now.getTime() - 1000));
    const late = await companyIn('past_due', new Date(now.getTime() - 1000));
    const quiet = await companyIn('suspended', new Date(now.getTime() - 1000));

    const run = await runLifecycleJob({ now, dryRun: false });
    expect(run.moved.map((m) => [m.company_id, m.from, m.to]).sort()).toEqual(
      [
        [trial.id, 'trial', 'suspended'],
        [late.id, 'past_due', 'suspended'],
        [quiet.id, 'suspended', 'pending_deletion'],
      ].sort()
    );

    const t = await row(trial.id);
    expect(t.status).toBe('suspended');
    expect(t.status_reason).toBe('The trial ended.');
    expect((new Date(t.next_status_at).getTime() - Date.now()) / DAY).toBeCloseTo(30, 0);
    expect(await events(trial.id)).toEqual([
      expect.objectContaining({ event: 'timer_moved', from_status: 'trial', to_status: 'suspended', operator_id: null }),
    ]);
    expect((await row(quiet.id)).status).toBe('pending_deletion');

    const subjects = mockMail.sent.map((m) => [m.to, m.subject]).sort();
    expect(subjects).toEqual(
      [
        [trial.owner.email, 'Ridge Roofing is read-only'],
        [late.owner.email, 'Ridge Roofing is read-only'],
        [quiet.owner.email, expect.stringMatching(/^Ridge Roofing will be deleted on /)],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    );
    const trialEmail = mockMail.sent.find((m) => m.to === trial.owner.email)!;
    expect(trialEmail.text).toContain('Your trial has ended.');
    expect(trialEmail.text).toContain('/login?company=');
  });

  it('leaves alone a timer not yet due, a company on hold, and one with no timer', async () => {
    const now = new Date();
    const soon = await companyIn('trial', new Date(now.getTime() + 60000));
    const active = await companyIn('active', null);
    const run = await runLifecycleJob({ now, dryRun: false });
    expect(run.moved).toEqual([]);
    expect((await row(soon.id)).status).toBe('trial');
    expect((await row(active.id)).status).toBe('active');
  });

  it('changes nothing on a dry run, and says what it would do', async () => {
    const now = new Date();
    const trial = await companyIn('trial', new Date(now.getTime() - 1000));
    const closing = await companyIn('pending_deletion', new Date(now.getTime() - 1000));
    const run = await runLifecycleJob({ now, dryRun: true });
    expect(run.dryRun).toBe(true);
    expect(run.moved).toEqual([expect.objectContaining({ company_id: trial.id, to: 'suspended' })]);
    expect(run.ready_to_delete).toEqual([expect.objectContaining({ company_id: closing.id })]);
    expect((await row(trial.id)).status).toBe('trial');
    expect(await events(closing.id)).toEqual([]);
    expect(mockMail.sent).toEqual([]);
    expect(pings).toEqual([]);
  });

  it('flags a company ready to delete once, pings the operator, and never deletes it', async () => {
    const now = new Date();
    const closing = await companyIn('pending_deletion', new Date(now.getTime() - 1000));
    await runLifecycleJob({ now, dryRun: false });
    await runLifecycleJob({ now, dryRun: false });

    expect((await row(closing.id)).status).toBe('pending_deletion');
    expect((await events(closing.id)).map((e) => e.event)).toEqual(['ready_to_delete']);
    expect(pings).toHaveLength(1);
    expect(pings[0].title).toBe('Company ready to delete');

    const overview = await request(app).get('/operator/overview').set('Cookie', cookie);
    expect(overview.body.ready_to_delete.map((c: { id: string }) => c.id)).toEqual([closing.id]);
    expect(overview.body.timers_7d.map((c: { id: string }) => c.id)).not.toContain(closing.id);
    const detail = await request(app).get(`/operator/companies/${closing.id}`).set('Cookie', cookie);
    expect(detail.body.company.ready_to_delete).toBe(true);
  });
});

describe('reminders', () => {
  it('sends each reminder once per timer, and only the nearest when the run comes late', async () => {
    const now = new Date();
    const trial = await companyIn('trial', new Date(now.getTime() + 6.5 * DAY));

    await runLifecycleJob({ now, dryRun: false });
    await runLifecycleJob({ now, dryRun: false });
    expect(mockMail.sent.map((m) => m.subject)).toEqual(['Your trial ends in 7 days']);

    // A day before: the 1-day reminder.
    mockMail.sent = [];
    await runLifecycleJob({ now: new Date(now.getTime() + 6 * DAY), dryRun: false });
    expect(mockMail.sent.map((m) => m.subject)).toEqual(['Your trial ends tomorrow']);

    // A late first run on another company: one email, not two.
    const late = await companyIn('pending_deletion', new Date(now.getTime() + 0.5 * DAY));
    mockMail.sent = [];
    await runLifecycleJob({ now, dryRun: false });
    expect(mockMail.sent.filter((m) => m.to === late.owner.email).map((m) => m.subject)).toEqual([
      'Ridge Roofing will be deleted tomorrow',
    ]);

    // Extending the timer sends the reminders again.
    await op(`/operator/companies/${trial.id}/extend`, { days: 10 }).expect(200);
    mockMail.sent = [];
    const extended = await row(trial.id);
    await runLifecycleJob({ now: new Date(new Date(extended.next_status_at).getTime() - 3 * DAY), dryRun: false });
    expect(mockMail.sent.filter((m) => m.to === trial.owner.email).map((m) => m.subject)).toEqual([
      'Your trial ends in 3 days',
    ]);

    expect((await events(trial.id)).filter((e) => e.event === 'reminder_sent').length).toBeGreaterThanOrEqual(2);
  });

  it('claims nothing while mail is off, so the reminder goes once it is on', async () => {
    const now = new Date();
    await companyIn('suspended', new Date(now.getTime() + 5 * DAY));
    mockMail.on = false;
    await runLifecycleJob({ now, dryRun: false });
    mockMail.on = true;
    await runLifecycleJob({ now, dryRun: false });
    expect(mockMail.sent.map((m) => m.subject)).toEqual(['Ridge Roofing closes in 5 days']);
  });
});

describe('emails when the operator changes a state', () => {
  it('payment missed, and the one notice a hold sends', async () => {
    const company = await companyIn('active', null);
    await op(`/operator/companies/${company.id}/status`, { to: 'past_due', reason: 'Card declined' }).expect(200);
    await op(`/operator/companies/${company.id}/hold`, { reason: 'Chargeback' }).expect(200);
    await eventually(() => mockMail.sent.length, (n) => n >= 2);
    expect(mockMail.sent.map((m) => m.subject)).toEqual([
      'Payment missed for Ridge Roofing',
      'Ridge Roofing is on hold',
    ]);
    expect(mockMail.sent.map((m) => m.text).join('\n')).not.toMatch(/Card declined|Chargeback/);
  });
});

describe('deleting a company', () => {
  const BACKEND_ROOT = path.resolve(__dirname, '..');

  it('is refused before the date, and without the slug typed in', async () => {
    const company = await companyIn('pending_deletion', new Date(Date.now() + DAY));
    const early = await op(`/operator/companies/${company.id}/delete`, { confirm_slug: company.slug });
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/deletion date has passed/);

    await pool.query(`UPDATE companies SET next_status_at = now() - interval '1 minute' WHERE id = $1`, [company.id]);
    const wrong = await op(`/operator/companies/${company.id}/delete`, { confirm_slug: 'not-it' });
    expect(wrong.status).toBe(400);
    expect(await row(company.id)).toBeTruthy();
  });

  it('refuses a company token', async () => {
    const company = await companyIn('pending_deletion', new Date(Date.now() - DAY));
    const res = await request(app)
      .post(`/operator/companies/${company.id}/delete`)
      .set(await authHeaderFor(company.owner))
      .send({ confirm_slug: company.slug });
    expect(res.status).toBe(401);
    expect(await row(company.id)).toBeTruthy();
  });

  it('removes every row and file of a full company, keeps a tombstone and the history, and holds the slug', async () => {
    // A company full of work, from the demo seed, plus a file on disk.
    const demo = await createTestCompany({ name: 'Demo', slug: 'demo' });
    await createTestUser({ role: 'owner', company_id: demo.id, email: 'demo.owner@example.com', first_name: 'Dee' });
    const seeded = spawnSync(process.execPath, [path.join('scripts', 'seed-demo-company.js')], {
      cwd: BACKEND_ROOT,
      encoding: 'utf8',
      env: { ...process.env, DEMO_TEAM_PASSWORD: '' },
    });
    expect(seeded.status).toBe(0);
    const folder = path.join(uploadsRoot(), demo.id);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'photo.jpg'), 'x');

    const other = await companyIn('active', null);
    await pool.query(
      `UPDATE companies SET status = 'pending_deletion', next_status_at = now() - interval '1 minute',
         billing_email = 'billing@demo.example' WHERE id = $1`,
      [demo.id]
    );
    await pool.query(
      `INSERT INTO operator_events (company_id, company_slug, event, from_status, to_status)
       VALUES ($1, 'demo', 'timer_moved', 'suspended', 'pending_deletion')`,
      [demo.id]
    );

    const res = await op(`/operator/companies/${demo.id}/delete`, { confirm_slug: ' DEMO ', reason: 'Never paid' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: demo.id, slug: 'demo', deleted: true });

    // Every table with a company_id is empty for it.
    const { rows: tables } = await pool.query(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'company_id'
         AND table_name NOT IN ('operator_events', 'company_tombstones', 'login_events')`
    );
    for (const { table_name } of tables) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM public."${table_name}" WHERE company_id = $1`,
        [demo.id]
      );
      expect([table_name, rows[0].n]).toEqual([table_name, 0]);
    }
    expect(await row(demo.id)).toBeUndefined();
    expect((await row(other.id)).status).toBe('active');

    const { rows: stones } = await pool.query(`SELECT * FROM company_tombstones WHERE company_id = $1`, [demo.id]);
    expect(stones[0]).toMatchObject({
      name: 'Demo',
      slug: 'demo',
      owner_email: 'demo.owner@example.com',
      billing_email: 'billing@demo.example',
      final_export_sent: false,
    });
    expect((new Date(stones[0].slug_reserved_until).getTime() - Date.now()) / DAY).toBeCloseTo(180, 0);
    expect(stones[0].status_path).toEqual([expect.objectContaining({ status: 'pending_deletion' })]);
    expect((await events(demo.id)).map((e) => e.event)).toEqual(['timer_moved', 'deleted']);

    await eventually(() => fs.existsSync(folder), (exists) => !exists);
    expect(fs.existsSync(folder)).toBe(false);
    await eventually(() => mockMail.sent.length, (n) => n >= 1);
    expect(mockMail.sent[0]).toMatchObject({ to: 'billing@demo.example', subject: 'Demo has been deleted' });
    expect(mockMail.sent[0].text).toContain('backups expire within 14 days');

    // The slug is held back: asked for exactly, it's taken; generated, it moves on.
    const exact = await request(app).post('/auth/register').send({
      first_name: 'New', last_name: 'Owner', email: 'new@example.com', password: 'a-good-password',
      company_name: 'Demo', slug: 'demo',
    });
    expect(exact.status).toBe(409);
    const generated = await request(app).post('/auth/register').send({
      first_name: 'New', last_name: 'Owner', email: 'new@example.com', password: 'a-good-password',
      company_name: 'Demo',
    });
    expect(generated.status).toBe(201);
    expect(generated.body.company.slug).toBe('demo-2');

    const overview = await request(app).get('/operator/overview').set('Cookie', cookie);
    expect(overview.body.recently_deleted).toEqual([expect.objectContaining({ slug: 'demo' })]);
  });
});

describe('two-step sign-in for the operator', () => {
  async function turnOn() {
    const setup = await op('/operator/auth/totp/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.uri).toMatch(/^otpauth:\/\/totp\/Joist%20operator%3Aop%40example\.com\?secret=/);
    const secret = setup.body.secret as string;
    const wrong = await op('/operator/auth/totp/enable', { code: '000000' });
    expect(wrong.status).toBe(400);
    const on = await op('/operator/auth/totp/enable', { code: totpCode(secret, totpStep() - 1) });
    expect(on.body).toEqual({ ok: true, totp_enabled: true });
    return secret;
  }

  it('turns on with a code, then asks for one at every sign-in, and no code works twice', async () => {
    const secret = await turnOn();
    const { rows } = await pool.query(`SELECT totp_secret FROM operators`);
    expect(rows[0].totp_secret).toMatch(/^v1:/);
    expect(rows[0].totp_secret).not.toContain(secret);

    const me = await request(app).get('/operator/auth/me').set('Cookie', cookie);
    expect(me.body.operator.totp_enabled).toBe(true);

    const noCode = await signIn();
    expect(noCode.status).toBe(401);
    expect(noCode.body.code).toBe('totp_required');
    expect(noCode.headers['set-cookie']).toBeUndefined();

    const bad = await signIn('123456');
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('totp_invalid');

    const code = totpCode(secret, totpStep());
    const good = await signIn(code);
    expect(good.status).toBe(200);
    const again = await signIn(code);
    expect(again.body.code).toBe('totp_invalid');

    const { rows: log } = await pool.query(
      `SELECT event, reason, method FROM login_events WHERE scope = 'operator' ORDER BY id DESC LIMIT 3`
    );
    expect(log).toEqual([
      expect.objectContaining({ event: 'login_failed', reason: 'bad_totp' }),
      expect.objectContaining({ event: 'login_success', method: 'totp' }),
      expect.objectContaining({ event: 'login_failed', reason: 'bad_totp' }),
    ]);
  });

  it('turns off only with the password and a code; the CLI can clear it', async () => {
    const secret = await turnOn();
    const noPassword = await op('/operator/auth/totp/disable', { password: 'wrong', code: totpCode(secret, totpStep()) });
    expect(noPassword.status).toBe(400);
    const off = await op('/operator/auth/totp/disable', { password: OP_PASSWORD, code: totpCode(secret, totpStep()) });
    expect(off.body).toEqual({ ok: true, totp_enabled: false });
    expect((await signIn()).status).toBe(200);

    await turnOn();
    await upsertOperator(pool, { email: OP_EMAIL, password: OP_PASSWORD, reset: true, clearTotp: true });
    expect((await signIn()).status).toBe(200);
  });

  it('refuses a company token', async () => {
    const company = await companyIn('active', null);
    const res = await request(app)
      .post('/operator/auth/totp/setup')
      .set(await authHeaderFor(company.owner));
    expect(res.status).toBe(401);
  });
});
