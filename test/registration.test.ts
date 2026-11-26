/// <reference types="jest" />
/**
 * The registration gate, step 6 of PLAN_operator.md (§7).
 *
 * Sign-up makes a pending company and an unconfirmed owner, with no
 * session. The verify link confirms the email; the company then waits for
 * the operator, or starts its trial when it signed up with a code. The
 * mailer is a stand-in that records what would be sent.
 */
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createTestCompany, createTestUser } from './helpers/auth';
import { captureOperatorPings, type OperatorPing } from '../src/lib/operatorNotify';
import { productionConfigProblems } from '../src/config/production';
import { clearStorageCacheForTests } from '../src/services/operator.service';
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

jest.setTimeout(60000);

const OP_EMAIL = 'op@example.com';
const OP_PASSWORD = 'a-long-operator-password';
let pings: OperatorPing[] = [];
let savedSecret: string | undefined;

const SIGNUP = {
  first_name: 'Dana',
  last_name: 'Reyes',
  email: 'Dana@Northside.example',
  password: 'a-good-password',
  company_name: 'Northside Roofing',
  slug: 'northside',
};

function register(body: object = {}) {
  return request(app).post('/auth/register').send({ ...SIGNUP, ...body });
}

async function eventually<T>(read: () => T | Promise<T>, done: (value: T) => boolean) {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > 5000) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function linkIn(message: Sent) {
  const match = message.text.match(/https?:\/\/\S+/);
  expect(match).toBeTruthy();
  return match![0];
}

function tokenIn(message: Sent) {
  return new URL(linkIn(message)).searchParams.get('token')!;
}

async function companyBySlug(slug: string) {
  const { rows } = await pool.query(`SELECT * FROM companies WHERE slug = $1`, [slug]);
  return rows[0];
}

async function ownerOf(companyId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE company_id = $1 AND role = 'owner'`,
    [companyId]
  );
  return rows[0];
}

async function operatorCookie() {
  await upsertOperator(pool, { email: OP_EMAIL, password: OP_PASSWORD });
  const res = await request(app).post('/operator/auth/login').send({ email: OP_EMAIL, password: OP_PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('joist_op='))!.split(';')[0];
}

beforeAll(async () => {
  await ensureSchema();
  savedSecret = process.env.OPERATOR_JWT_SECRET;
  process.env.OPERATOR_JWT_SECRET = 'operator-test-secret-'.padEnd(64, 'x');
});

afterAll(() => {
  process.env.REGISTRATION_MODE = 'open';
  delete process.env.REGISTRATION_INVITE_CODES;
  if (savedSecret === undefined) delete process.env.OPERATOR_JWT_SECRET;
  else process.env.OPERATOR_JWT_SECRET = savedSecret;
});

beforeEach(async () => {
  await resetDb();
  clearStorageCacheForTests();
  process.env.REGISTRATION_MODE = 'approval';
  delete process.env.REGISTRATION_INVITE_CODES;
  mockMail.on = true;
  mockMail.sent = [];
  pings = captureOperatorPings();
});

describe('signing up in approval mode', () => {
  it('makes a pending company and an unconfirmed owner, with no session, and emails a link', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      next: 'verify_email',
      email: 'dana@northside.example',
      email_sent: true,
      mail: true,
    });
    expect(res.body.user).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();

    const company = await companyBySlug('northside');
    expect(company.status).toBe('pending');
    expect(company.registered_via).toBe('approval');
    expect(company.next_status_at).toBeNull();
    const owner = await ownerOf(company.id);
    expect(owner.email_verified_at).toBeNull();
    expect(owner.last_login_at).toBeNull();

    expect(mockMail.sent).toHaveLength(1);
    expect(mockMail.sent[0].to).toBe('dana@northside.example');
    expect(mockMail.sent[0].subject).toBe('Confirm your email for Northside Roofing');
    expect(linkIn(mockMail.sent[0])).toMatch(/\/verify-email\?token=[0-9a-f]{64}$/);

    const { rows } = await pool.query(
      `SELECT event, to_status, detail FROM operator_events WHERE company_id = $1`,
      [company.id]
    );
    expect(rows).toEqual([{ event: 'registered', to_status: 'pending', detail: { via: 'approval' } }]);
  });

  it('keeps the owner out: first until they confirm, then until the operator approves', async () => {
    await register();
    const signIn = () =>
      request(app)
        .post('/auth/login')
        .send({ email: SIGNUP.email, password: SIGNUP.password, company_slug: 'northside' });
    const before = await signIn();
    expect(before.status).toBe(403);
    expect(before.body.code).toBe('email_unverified');

    await request(app).post('/auth/verify-email').send({ token: tokenIn(mockMail.sent[0]) });
    const after = await signIn();
    expect(after.status).toBe(403);
    expect(after.body.code).toBe('company_pending');
  });

  it('confirms the email once, then emails the owner and pings the operator', async () => {
    await register();
    const token = tokenIn(mockMail.sent[0]);

    const res = await request(app).post('/auth/verify-email').send({ token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, company: { slug: 'northside', status: 'pending' } });

    const company = await companyBySlug('northside');
    expect((await ownerOf(company.id)).email_verified_at).not.toBeNull();
    await eventually(() => mockMail.sent.length, (n) => n >= 2);
    expect(mockMail.sent[1].subject).toBe('Northside Roofing is waiting for review');
    await eventually(() => pings.length, (n) => n >= 1);
    expect(pings[0].title).toBe('New company to review');
    expect(pings[0].message).toContain('Northside Roofing (northside)');

    // The same link again: already confirmed, nothing sent twice.
    const again = await request(app).post('/auth/verify-email').send({ token });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ ok: true, already: true });
    expect(mockMail.sent).toHaveLength(2);
    expect(pings).toHaveLength(1);
  });

  it('refuses a token it never made, and one that has expired', async () => {
    const bad = await request(app).post('/auth/verify-email').send({ token: 'f'.repeat(64) });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ ok: false, status: 'invalid' });

    await register();
    await pool.query(`UPDATE email_verifications SET expires_at = now() - interval '1 minute'`);
    const expired = await request(app)
      .post('/auth/verify-email')
      .send({ token: tokenIn(mockMail.sent[0]) });
    expect(expired.status).toBe(400);
    expect(expired.body.status).toBe('expired');
  });

  it('resends a new link that supersedes the old one, for an unconfirmed owner only', async () => {
    await register();
    const first = tokenIn(mockMail.sent[0]);

    const res = await request(app)
      .post('/auth/verify-email/resend')
      .send({ email: SIGNUP.email, company_slug: 'northside' });
    expect(res.body).toEqual({ ok: true, mail: true });
    await eventually(() => mockMail.sent.length, (n) => n >= 2);
    const second = tokenIn(mockMail.sent[1]);
    expect(second).not.toBe(first);

    const old = await request(app).post('/auth/verify-email').send({ token: first });
    expect(old.body.status).toBe('superseded');
    expect((await request(app).post('/auth/verify-email').send({ token: second })).status).toBe(200);

    // Confirmed now: a resend answers the same and sends nothing.
    await eventually(() => mockMail.sent.length, (n) => n >= 3); // the "received" email
    const sentBefore = mockMail.sent.length;
    const after = await request(app)
      .post('/auth/verify-email/resend')
      .send({ email: SIGNUP.email, company_slug: 'northside' });
    expect(after.body).toEqual({ ok: true, mail: true });
    // And for nobody at all, the same answer.
    const nobody = await request(app)
      .post('/auth/verify-email/resend')
      .send({ email: 'nobody@example.com', company_slug: 'northside' });
    expect(nobody.body).toEqual({ ok: true, mail: true });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(mockMail.sent).toHaveLength(sentBefore);
  });

  it('limits resends for one account', async () => {
    await register();
    const send = () =>
      request(app).post('/auth/verify-email/resend').send({ email: SIGNUP.email, company_slug: 'northside' });
    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    // Let the three sends finish before the next test empties the database.
    await eventually(() => mockMail.sent.length, (n) => n >= 4);
  });

  it('still makes the company when mail is off, and says so', async () => {
    mockMail.on = false;
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ next: 'verify_email', email_sent: false, mail: false });
    expect((await companyBySlug('northside')).status).toBe('pending');
  });
});

describe('the operator decides', () => {
  let cookie = '';
  beforeEach(async () => {
    cookie = await operatorCookie();
  });

  it('asks to confirm before approving an unconfirmed owner, then sends the welcome email', async () => {
    await register();
    const company = await companyBySlug('northside');
    mockMail.sent = [];

    const refused = await request(app)
      .post(`/operator/companies/${company.id}/approve`)
      .set('Cookie', cookie)
      .send({});
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/hasn't confirmed their email/);
    expect((await companyBySlug('northside')).status).toBe('pending');

    const res = await request(app)
      .post(`/operator/companies/${company.id}/approve`)
      .set('Cookie', cookie)
      .send({ confirm_unverified: true });
    expect(res.status).toBe(200);
    expect(res.body.company.status).toBe('trial');

    await eventually(() => mockMail.sent.length, (n) => n >= 1);
    const welcome = mockMail.sent[0];
    expect(welcome.subject).toBe('Northside Roofing is ready');
    expect(linkIn(welcome)).toMatch(/\/login\?company=northside$/);
    expect(welcome.text).toContain('30-day trial');
    expect(welcome.text).toContain('Company login id: northside');

    const { rows } = await pool.query(
      `SELECT detail FROM operator_events WHERE company_id = $1 AND event = 'approved'`,
      [company.id]
    );
    expect(rows[0].detail).toMatchObject({ owner_unverified: true });

    const login = await request(app)
      .post('/auth/login')
      .send({ email: SIGNUP.email, password: SIGNUP.password, company_slug: 'northside' });
    expect(login.status).toBe(200);
  });

  it('approves a confirmed owner without asking', async () => {
    await register();
    await request(app).post('/auth/verify-email').send({ token: tokenIn(mockMail.sent[0]) });
    const company = await companyBySlug('northside');
    const res = await request(app)
      .post(`/operator/companies/${company.id}/approve`)
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(200);
  });

  it('emails a denial only when asked, and never the reason', async () => {
    await register({ slug: 'quiet-co', email: 'quiet@example.com' });
    await register({ slug: 'told-co', email: 'told@example.com' });
    const quiet = await companyBySlug('quiet-co');
    const told = await companyBySlug('told-co');
    mockMail.sent = [];

    await request(app)
      .post(`/operator/companies/${quiet.id}/deny`)
      .set('Cookie', cookie)
      .send({ reason: 'Looks like spam' })
      .expect(200);
    await request(app)
      .post(`/operator/companies/${told.id}/deny`)
      .set('Cookie', cookie)
      .send({ reason: 'Looks like spam', notify: true })
      .expect(200);

    await eventually(() => mockMail.sent.length, (n) => n >= 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockMail.sent.map((m) => m.to)).toEqual(['told@example.com']);
    expect(mockMail.sent[0].subject).toBe('About your sign-up for Northside Roofing');
    expect(mockMail.sent[0].text).not.toContain('spam');
    expect(mockMail.sent[0].html).not.toContain('spam');
  });
});

describe('the other modes', () => {
  it('closed: refuses every sign-up', async () => {
    process.env.REGISTRATION_MODE = 'closed';
    const res = await register();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('registration_closed');
    expect(await companyBySlug('northside')).toBeUndefined();
    const mode = await request(app).get('/auth/registration');
    expect(mode.body).toEqual({ ok: true, mode: 'closed', mail: true });
  });

  it('invite_code: a right code skips the queue once the email is confirmed', async () => {
    process.env.REGISTRATION_MODE = 'invite_code';
    process.env.REGISTRATION_INVITE_CODES = 'first-code, spring-2027';
    const res = await register({ invite_code: 'spring-2027' });
    expect(res.status).toBe(201);
    const company = await companyBySlug('northside');
    expect(company.status).toBe('pending');
    expect(company.registered_via).toBe('invite_code');

    const verified = await request(app)
      .post('/auth/verify-email')
      .send({ token: tokenIn(mockMail.sent[0]) });
    expect(verified.body.company.status).toBe('trial');
    expect((await companyBySlug('northside')).status).toBe('trial');
    await eventually(() => mockMail.sent.length, (n) => n >= 2);
    expect(mockMail.sent[1].subject).toBe('Northside Roofing is ready');
    expect(pings).toHaveLength(0);
  });

  it('invite_code: a wrong code is refused; none at all goes to the queue', async () => {
    process.env.REGISTRATION_MODE = 'invite_code';
    process.env.REGISTRATION_INVITE_CODES = 'spring-2027';
    const wrong = await register({ invite_code: 'spring-2026' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('invite_code_invalid');
    expect(await companyBySlug('northside')).toBeUndefined();

    const none = await register();
    expect(none.status).toBe(201);
    expect((await companyBySlug('northside')).registered_via).toBe('approval');
  });

  it('open: an active company and a signed-in owner, as before the gate', async () => {
    process.env.REGISTRATION_MODE = 'open';
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body.user).toBeTruthy();
    expect(res.headers['set-cookie']).toBeTruthy();
    const company = await companyBySlug('northside');
    expect(company.status).toBe('active');
    expect(company.registered_via).toBe('open');
    expect(mockMail.sent).toHaveLength(0);
  });

  it('production refuses open, and approval without mail', () => {
    const base = {
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://joist.example.com',
      FRONTEND_URL: 'https://joist.example.com',
      JWT_SECRET: 'a'.repeat(64),
    };
    const mail = { SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'f@example.com' };
    expect(productionConfigProblems({ ...base, ...mail })).toEqual([]);
    expect(productionConfigProblems({ ...base, ...mail, REGISTRATION_MODE: 'open' }).join('\n')).toMatch(
      /REGISTRATION_MODE=open/
    );
    expect(productionConfigProblems(base).join('\n')).toMatch(/REGISTRATION_MODE=approval sends a link/);
    expect(productionConfigProblems({ ...base, REGISTRATION_MODE: 'closed' })).toEqual([]);
    expect(
      productionConfigProblems({ ...base, ...mail, REGISTRATION_MODE: 'invite_code' }).join('\n')
    ).toMatch(/REGISTRATION_INVITE_CODES/);
    expect(productionConfigProblems({ ...base, ...mail, REGISTRATION_MODE: 'later' }).join('\n')).toMatch(
      /must be one of/
    );
  });
});

describe('employees', () => {
  async function invite(owner: { id: string }, companyId: string, sendEmail: boolean) {
    const { authHeaderFor } = require('./helpers/auth');
    const res = await request(app)
      .post('/users/invite')
      .set(await authHeaderFor(owner))
      .send({ first_name: 'Sam', last_name: 'Lee', email: `sam-${sendEmail}@example.com`, role: 'agent' });
    expect(res.status).toBe(201);
    return { user: res.body.user, url: res.body.invite_url as string, companyId };
  }

  it('an emailed invite confirms the address; one copied by hand does not', async () => {
    const company = await createTestCompany();
    const owner = await createTestUser({ role: 'owner', company_id: company.id });

    const emailed = await invite(owner, company.id, true);
    mockMail.on = false;
    const copied = await invite(owner, company.id, false);
    mockMail.on = true;

    for (const { url } of [emailed, copied]) {
      const token = new URL(url).searchParams.get('token');
      const res = await request(app).post('/auth/accept-invite').send({ token, password: 'a-good-password' });
      expect(res.status).toBe(200);
    }
    const { rows } = await pool.query(
      `SELECT email, email_verified_at FROM users WHERE company_id = $1 AND role = 'agent' ORDER BY email`,
      [company.id]
    );
    expect(rows.map((r) => [r.email, Boolean(r.email_verified_at)])).toEqual([
      ['sam-false@example.com', false],
      ['sam-true@example.com', true],
    ]);
  });
});
