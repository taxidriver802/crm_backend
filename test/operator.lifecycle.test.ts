/// <reference types="jest" />
/**
 * Step 4 (PLAN_operator.md §3, §6): the operator changes a company's
 * account, and the account's state decides what its staff and its clients
 * can do.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { clearStorageCacheForTests } from '../src/services/operator.service';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { authHeaderFor, createTestCompany, createTestUser } from './helpers/auth';
const { upsertOperator } = require('../scripts/operator-create');

jest.setTimeout(60000);

const EMAIL = 'op@example.com';
const PASSWORD = 'a-long-operator-password';
const DAY = 86400000;
let savedSecret: string | undefined;
let cookie = '';

async function signIn() {
  const res = await request(app).post('/operator/auth/login').send({ email: EMAIL, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('joist_op='))!.split(';')[0];
}

const op = (method: 'post' | 'patch', url: string, body: object = {}) =>
  request(app)[method](url).set('Cookie', cookie).send(body);

async function setStatus(companyId: string, status: string, nextStatusAt: Date | null = null) {
  await pool.query(
    `UPDATE companies SET status = $2, next_status_at = $3,
       held_from_status = CASE WHEN $2 = 'on_hold' THEN 'active' END
     WHERE id = $1`,
    [companyId, status, nextStatusAt]
  );
}

async function company(companyId: string) {
  const { rows } = await pool.query(`SELECT * FROM companies WHERE id = $1`, [companyId]);
  return rows[0];
}

async function events(companyId: string) {
  const { rows } = await pool.query(
    `SELECT event, from_status, to_status, detail FROM operator_events WHERE company_id = $1 ORDER BY id`,
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
  await upsertOperator(pool, { email: EMAIL, password: PASSWORD });
  cookie = await signIn();
});

describe('changing an account', () => {
  it('refuses a company owner', async () => {
    const other = await createTestCompany();
    const owner = await createTestUser({ role: 'owner', company_id: other.id });
    const res = await request(app)
      .post(`/operator/companies/${other.id}/approve`)
      .set(await authHeaderFor(owner));
    expect(res.status).toBe(401);
  });

  it('approves a pending company into a 30-day trial, and records it', async () => {
    const other = await createTestCompany();
    await setStatus(other.id, 'pending');
    const res = await op('post', `/operator/companies/${other.id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.company.status).toBe('trial');
    const row = await company(other.id);
    expect(row.approved_at).not.toBeNull();
    const days = (new Date(row.trial_ends_at).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect(row.next_status_at).toEqual(row.trial_ends_at);
    expect(await events(other.id)).toEqual([
      expect.objectContaining({ event: 'approved', from_status: 'pending', to_status: 'trial' }),
    ]);
  });

  it('refuses a move the lifecycle does not allow', async () => {
    const other = await createTestCompany();
    await setStatus(other.id, 'pending');
    const res = await op('post', `/operator/companies/${other.id}/status`, { to: 'active' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/can move to trial, denied/);
    expect((await company(other.id)).status).toBe('pending');
    expect(await events(other.id)).toEqual([]);
  });

  it('needs a reason to take access away', async () => {
    const other = await createTestCompany();
    const bare = await op('post', `/operator/companies/${other.id}/status`, { to: 'suspended' });
    expect(bare.status).toBe(400);
    const res = await op('post', `/operator/companies/${other.id}/status`, {
      to: 'suspended',
      reason: 'card declined twice',
    });
    expect(res.status).toBe(200);
    const row = await company(other.id);
    expect(row.status).toBe('suspended');
    expect(row.status_reason).toBe('card declined twice');
    expect((new Date(row.next_status_at).getTime() - Date.now()) / DAY).toBeCloseTo(30, 0);
  });

  it('restores from pending deletion to suspended with 14 days, or straight to active', async () => {
    const a = await createTestCompany();
    await setStatus(a.id, 'pending_deletion', new Date(Date.now() + 3 * DAY));
    const res = await op('post', `/operator/companies/${a.id}/restore`, { reason: 'paid by phone' });
    expect(res.status).toBe(200);
    const row = await company(a.id);
    expect(row.status).toBe('suspended');
    expect((new Date(row.next_status_at).getTime() - Date.now()) / DAY).toBeCloseTo(14, 0);
    expect((await events(a.id))[0]).toMatchObject({ event: 'restored', to_status: 'suspended' });

    const b = await createTestCompany();
    await setStatus(b.id, 'pending_deletion', new Date(Date.now() + 3 * DAY));
    await op('post', `/operator/companies/${b.id}/restore`, { to: 'active', reason: 'closed by mistake' });
    const rowB = await company(b.id);
    expect(rowB.status).toBe('active');
    expect(rowB.next_status_at).toBeNull();

    const c = await createTestCompany();
    const notPending = await op('post', `/operator/companies/${c.id}/restore`, {});
    expect(notPending.status).toBe(409);
  });

  it('holds a company with its clock stopped, and releases it with the time it had left', async () => {
    const other = await createTestCompany();
    await setStatus(other.id, 'past_due', new Date(Date.now() + 5 * DAY));
    expect((await op('post', `/operator/companies/${other.id}/hold`, {})).status).toBe(400);
    const held = await op('post', `/operator/companies/${other.id}/hold`, { reason: 'chargeback' });
    expect(held.status).toBe(200);
    let row = await company(other.id);
    expect(row.status).toBe('on_hold');
    expect(row.held_from_status).toBe('past_due');
    expect(row.next_status_at).toBeNull();
    // Nothing moves a held company but release.
    expect((await op('post', `/operator/companies/${other.id}/status`, { to: 'active' })).status).toBe(409);

    // Two days pass on hold; the five days left are kept.
    await pool.query(`UPDATE companies SET status_changed_at = now() - interval '2 days' WHERE id = $1`, [other.id]);
    const released = await op('post', `/operator/companies/${other.id}/release`, {});
    expect(released.status).toBe(200);
    row = await company(other.id);
    expect(row.status).toBe('past_due');
    expect(row.held_from_status).toBeNull();
    expect((new Date(row.next_status_at).getTime() - Date.now()) / DAY).toBeCloseTo(5, 1);
    expect((await events(other.id)).map((e) => e.event)).toEqual(['held', 'released']);
  });

  it('extends a timer from when it was due', async () => {
    const other = await createTestCompany();
    const due = new Date(Date.now() + 2 * DAY);
    await pool.query(
      `UPDATE companies SET status = 'trial', next_status_at = $2, trial_ends_at = $2 WHERE id = $1`,
      [other.id, due]
    );
    const res = await op('post', `/operator/companies/${other.id}/extend`, { days: 7 });
    expect(res.status).toBe(200);
    const row = await company(other.id);
    expect(new Date(row.next_status_at).getTime()).toBe(due.getTime() + 7 * DAY);
    expect(row.trial_ends_at).toEqual(row.next_status_at);

    const active = await createTestCompany();
    expect((await op('post', `/operator/companies/${active.id}/extend`, { days: 7 })).status).toBe(409);
    expect((await op('post', `/operator/companies/${other.id}/extend`, { days: 0 })).status).toBe(400);
  });

  it('edits the account; a slug change has to be repeated', async () => {
    const other = await createTestCompany({ name: 'Acme', slug: 'acme' });
    await createTestCompany({ slug: 'taken' });
    const res = await op('patch', `/operator/companies/${other.id}`, {
      name: 'Acme Roofing',
      plan: 'pro',
      billing_email: 'billing@acme.test',
      operator_notes: 'Called on the 3rd.',
    });
    expect(res.status).toBe(200);
    expect(res.body.company.name).toBe('Acme Roofing');

    const unconfirmed = await op('patch', `/operator/companies/${other.id}`, { slug: 'acme-roofing' });
    expect(unconfirmed.status).toBe(400);
    const taken = await op('patch', `/operator/companies/${other.id}`, { slug: 'taken', confirm_slug: 'taken' });
    expect(taken.status).toBe(409);
    const renamed = await op('patch', `/operator/companies/${other.id}`, {
      slug: 'acme-roofing',
      confirm_slug: 'acme-roofing',
    });
    expect(renamed.status).toBe(200);
    expect((await company(other.id)).slug).toBe('acme-roofing');

    const edits = (await events(other.id)).filter((e) => e.event === 'edited');
    expect(edits).toHaveLength(2);
    // The notes changed, but what they say is not copied into the history.
    expect(edits[0].detail.changed.operator_notes).toEqual({ from: null, to: null });
    expect(edits[0].detail.changed.name).toEqual({ from: 'Acme', to: 'Acme Roofing' });
  });
});

describe('what the account state allows staff', () => {
  async function staff(status: string) {
    const other = await createTestCompany();
    const user = await createTestUser({ role: 'owner', company_id: other.id });
    await setStatus(other.id, status, new Date('2026-12-31T00:00:00Z'));
    return { other, user, headers: await authHeaderFor(user) };
  }

  it('past due: everything still works, and /auth/me says so', async () => {
    const { headers } = await staff('past_due');
    const me = await request(app).get('/auth/me').set(headers);
    expect(me.status).toBe(200);
    expect(me.body.account.status).toBe('past_due');
    const lead = await request(app)
      .post('/leads')
      .set(headers)
      .send({ first_name: 'Pat', last_name: 'Lee', status: 'New' });
    expect(lead.status).toBe(201);
  });

  it('suspended: reading works, writing is refused', async () => {
    const { headers } = await staff('suspended');
    expect((await request(app).get('/leads').set(headers)).status).toBe(200);
    const lead = await request(app)
      .post('/leads')
      .set(headers)
      .send({ first_name: 'Pat', last_name: 'Lee', status: 'New' });
    expect(lead.status).toBe(403);
    expect(lead.body.code).toBe('company_read_only');
    const invite = await request(app)
      .post('/users/invite')
      .set(headers)
      .send({ email: 'new@example.com', first_name: 'N', last_name: 'P', role: 'agent' });
    expect(invite.status).toBe(403);
  });

  it.each(['pending', 'denied', 'pending_deletion', 'on_hold'])('%s: nothing but signing out', async (status) => {
    const { headers } = await staff(status);
    const res = await request(app).get('/leads').set(headers);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(`company_${status}`);
    expect((await request(app).post('/auth/logout').set(headers)).status).toBe(200);
  });

  it('tells a person with the right password why they cannot sign in', async () => {
    const other = await createTestCompany({ slug: 'closing-co' });
    const user = await createTestUser({ role: 'owner', company_id: other.id, email: 'o@closing.test' });
    await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
      user.id,
      await bcrypt.hash('right-password-1', 4),
    ]);
    await setStatus(other.id, 'pending_deletion', new Date('2026-12-31T00:00:00Z'));
    const wrong = await request(app)
      .post('/auth/login')
      .send({ email: 'o@closing.test', password: 'wrong-password-1', company_slug: 'closing-co' });
    expect(wrong.status).toBe(401);
    const right = await request(app)
      .post('/auth/login')
      .send({ email: 'o@closing.test', password: 'right-password-1', company_slug: 'closing-co' });
    expect(right.status).toBe(403);
    expect(right.body.code).toBe('company_pending_deletion');
    expect(right.body.error).toMatch(/2026-12-31/);
    expect(right.headers['set-cookie']).toBeUndefined();
  });
});

describe('what the account state allows clients', () => {
  async function intakeLink(status: string) {
    const other = await createTestCompany();
    const user = await createTestUser({ role: 'owner', company_id: other.id });
    const token = crypto.randomBytes(16).toString('hex');
    await pool.query(
      `INSERT INTO intake_tokens (user_id, token_hash, company_id) VALUES ($1, $2, $3)`,
      [user.id, crypto.createHash('sha256').update(token).digest('hex'), other.id]
    );
    await setStatus(other.id, status);
    return token;
  }

  it('suspended: the link opens, but answers are refused', async () => {
    const token = await intakeLink('suspended');
    expect((await request(app).get(`/public/intake/${token}`)).status).toBe(200);
    const sent = await request(app).post(`/public/intake/${token}`).send({ first_name: 'A' });
    expect(sent.status).toBe(403);
    expect(sent.body.code).toBe('client_view_only');
  });

  it('closed: the link is gone', async () => {
    const token = await intakeLink('pending_deletion');
    const res = await request(app).get(`/public/intake/${token}`);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('client_unavailable');
  });

  it('a token that matches nothing gets the route’s own answer', async () => {
    const res = await request(app).get(`/public/intake/not-a-real-token`);
    expect(res.status).not.toBe(410);
    expect(res.status).not.toBe(403);
  });
});
