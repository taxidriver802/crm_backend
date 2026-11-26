/// <reference types="jest" />
/**
 * Login history (migration 0005, docs/guide/login-history.md).
 *
 * Supertest connects from loopback, which `trust proxy` trusts, so an
 * X-Forwarded-For header here stands in for what the proxy chain sends.
 * Writes are not awaited by the routes; settleLoginEvents() waits for them.
 */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import {
  createTestUser,
  DEFAULT_COMPANY_ID,
  DEFAULT_COMPANY_SLUG,
} from './helpers/auth';
import {
  normalizeIp,
  pruneLoginEvents,
  settleLoginEvents,
  loginEventsKeepDays,
} from '../src/lib/loginEvents';
import { createPasswordReset } from '../src/lib/passwordResets';

jest.mock('../src/lib/mailer', () => ({
  isMailConfigured: () => false,
  sendMail: async () => {
    throw new Error('SMTP is not configured');
  },
}));

jest.setTimeout(60000);

const PASSWORD = 'first-password-1';
const CLIENT_IP = '198.51.100.7';
const UA = 'Mozilla/5.0 (Macintosh) TestBrowser/1.0';

async function person(
  overrides: { email?: string; status?: 'active' | 'invited' | 'disabled'; withPassword?: boolean } = {}
) {
  const { withPassword = true, ...rest } = overrides;
  const user = await createTestUser({ role: 'owner', ...rest });
  if (withPassword) {
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      await bcrypt.hash(PASSWORD, 4),
      user.id,
    ]);
  }
  return user;
}

/**
 * Sends a request and waits for the history it wrote. Writes aren't awaited
 * by the routes and can land on different pool connections, so two requests
 * in a row may insert in either order unless each one settles first.
 */
async function settled<T>(pending: PromiseLike<T>): Promise<T> {
  const res = await pending;
  await settleLoginEvents();
  return res;
}

function login(
  email: string,
  password = PASSWORD,
  { slug = DEFAULT_COMPANY_SLUG, xff = CLIENT_IP }: { slug?: string; xff?: string } = {}
) {
  return settled(
    request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', xff)
      .set('User-Agent', UA)
      .send({ email, password, company_slug: slug })
  );
}

function cookieFrom(res: { headers: Record<string, any> }) {
  const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const auth = set.find((c) => c.startsWith('access_token='));
  expect(auth).toBeTruthy();
  return auth!.split(';')[0];
}

async function rows() {
  await settleLoginEvents();
  const { rows } = await pool.query(
    `SELECT event, reason, method, company_id, user_id, company_slug,
            email_attempted, session_id, host(ip) AS ip, user_agent
     FROM login_events ORDER BY id`
  );
  return rows;
}

describe('login history', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await settleLoginEvents();
    await resetDb();
  });

  it('records a successful sign-in with its session, address and device', async () => {
    const user = await person({ email: 'Ana@Example.com' });
    const res = await login('ANA@example.com');
    expect(res.status).toBe(200);

    const [row] = await rows();
    expect(row).toMatchObject({
      event: 'login_success',
      reason: null,
      method: 'password',
      company_id: DEFAULT_COMPANY_ID,
      user_id: user.id,
      company_slug: DEFAULT_COMPANY_SLUG,
      email_attempted: 'ana@example.com',
      ip: CLIENT_IP,
      user_agent: UA,
    });
    const { rows: sessions } = await pool.query(
      `SELECT id FROM user_sessions WHERE user_id = $1`,
      [user.id]
    );
    expect(row.session_id).toBe(sessions[0].id);
  });

  it('records each kind of failure, with the same reply for all of them', async () => {
    const active = await person({ email: 'active@example.com' });
    const disabled = await person({ email: 'gone@example.com', status: 'disabled' });
    const noPassword = await person({ email: 'nopass@example.com', withPassword: false });

    const replies = [
      await login('active@example.com', 'wrong-password'),
      await login('nobody@example.com'),
      await login('active@example.com', PASSWORD, { slug: 'no-such-company' }),
      await login('gone@example.com'),
      await login('nopass@example.com'),
    ];
    for (const reply of replies) {
      expect(reply.status).toBe(401);
      expect(reply.body).toEqual({ ok: false, error: 'Invalid credentials' });
    }

    const got = (await rows()).map((r) => [r.event, r.reason, r.user_id, r.company_id]);
    expect(got).toEqual([
      ['login_failed', 'bad_password', active.id, DEFAULT_COMPANY_ID],
      ['login_failed', 'unknown_email', null, DEFAULT_COMPANY_ID],
      ['login_failed', 'unknown_company', null, null],
      ['login_failed', 'inactive', disabled.id, DEFAULT_COMPANY_ID],
      ['login_failed', 'no_password', noPassword.id, DEFAULT_COMPANY_ID],
    ]);
  });

  it('still refuses a disabled account with the right password', async () => {
    await person({ email: 'gone@example.com', status: 'disabled' });
    const res = await login('gone@example.com');
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('records attempts refused by the rate limits', async () => {
    await person({ email: 'target@example.com' });
    for (let i = 0; i < 10; i += 1) {
      expect((await login('target@example.com', 'wrong')).status).toBe(401);
    }
    expect((await login('target@example.com')).status).toBe(429);

    const last = (await rows()).at(-1);
    expect(last).toMatchObject({
      event: 'login_failed',
      reason: 'rate_limited_account',
      email_attempted: 'target@example.com',
      ip: CLIENT_IP,
    });
  });

  it('takes the address the trusted proxy appended, not one the client wrote', async () => {
    await person({ email: 'ana@example.com' });
    // A client's own X-Forwarded-For sits left of the address Cloudflare adds.
    await login('ana@example.com', PASSWORD, { xff: '203.0.113.9, 198.51.100.44' });
    const [row] = await rows();
    expect(row.ip).toBe('198.51.100.44');
  });

  it('cuts a long user agent and stores no password or token', async () => {
    await person({ email: 'ana@example.com' });
    const res = await settled(
      request(app)
        .post('/auth/login')
        .set('User-Agent', 'x'.repeat(2000))
        .send({ email: 'ana@example.com', password: PASSWORD, company_slug: DEFAULT_COMPANY_SLUG })
    );
    expect(res.status).toBe(200);
    const token = cookieFrom(res).split('=')[1];

    await login('ana@example.com', 'a-wrong-secret-guess');
    const all = await rows();
    expect(all[0].user_agent).toHaveLength(512);
    const text = JSON.stringify(all);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain('a-wrong-secret-guess');
    expect(text).not.toContain(token);
    expect(text).not.toMatch(/\$2[aby]\$/); // no bcrypt hash
  });

  it('records sign-out, sign-out elsewhere and a password change', async () => {
    await person({ email: 'ana@example.com' });
    const cookie = cookieFrom(await login('ana@example.com'));

    expect(
      (await settled(request(app).post('/auth/sessions/end-others').set('Cookie', cookie))).status
    ).toBe(200);
    expect(
      (
        await settled(
          request(app)
            .post('/auth/change-password')
            .set('Cookie', cookie)
            .send({ current_password: PASSWORD, new_password: 'second-password-2' })
        )
      ).status
    ).toBe(200);
    expect((await request(app).post('/auth/logout').set('Cookie', cookie)).status).toBe(200);

    const all = await rows();
    expect(all.map((r) => r.event)).toEqual([
      'login_success',
      'logout_elsewhere',
      'password_changed',
      'logout',
    ]);
    // Every one names the same browser session.
    expect(new Set(all.map((r) => r.session_id)).size).toBe(1);
  });

  it('records sign-ins that start from registering, an invite and a reset', async () => {
    const registered = await settled(
      request(app).post('/auth/register').send({
        first_name: 'Rae',
        last_name: 'Owner',
        email: 'Rae@NewCo.example',
        password: PASSWORD,
        company_name: 'New Co',
        slug: 'new-co',
      })
    );
    expect(registered.status).toBe(201);

    const invited = await createTestUser({ email: 'invitee@example.com', status: 'invited' });
    const inviteToken = crypto.randomBytes(16).toString('hex');
    await pool.query(
      `UPDATE users SET invite_token_hash = $1, invite_expires_at = now() + interval '1 day'
       WHERE id = $2`,
      [crypto.createHash('sha256').update(inviteToken).digest('hex'), invited.id]
    );
    expect(
      (
        await settled(
          request(app).post('/auth/accept-invite').send({ token: inviteToken, password: PASSWORD })
        )
      ).status
    ).toBe(200);

    const resetting = await person({ email: 'reset@example.com' });
    const { token } = await createPasswordReset(pool, {
      userId: resetting.id,
      companyId: DEFAULT_COMPANY_ID,
      via: 'operator',
    });
    expect(
      (
        await request(app)
          .post('/auth/reset-password')
          .send({ token, password: 'second-password-2' })
      ).status
    ).toBe(200);

    const got = (await rows()).map((r) => [r.event, r.method, r.email_attempted]);
    expect(got.slice(0, 2)).toEqual([
      ['login_success', 'register', 'rae@newco.example'],
      ['login_success', 'invite', 'invitee@example.com'],
    ]);
    // One request writes these two; they may land in either order.
    expect(got.slice(2)).toEqual(
      expect.arrayContaining([
        ['password_reset', null, 'reset@example.com'],
        ['login_success', 'reset', 'reset@example.com'],
      ])
    );
    expect(got).toHaveLength(4);
    const all = await rows();
    expect(all[0].company_slug).toBe('new-co');
    expect(all.every((r) => r.event !== 'login_success' || r.session_id)).toBe(true);
  });

  it('records forgot-password requests whether or not the account exists, after replying', async () => {
    const user = await person({ email: 'ana@example.com' });
    const known = await request(app)
      .post('/auth/forgot-password')
      .send({ company_slug: DEFAULT_COMPANY_SLUG, email: 'ANA@example.com' });
    const unknown = await request(app)
      .post('/auth/forgot-password')
      .send({ company_slug: DEFAULT_COMPANY_SLUG, email: 'nobody@example.com' });
    expect(known.body).toEqual(unknown.body);

    // Forgot does its work after answering.
    let all: any[] = [];
    for (let i = 0; i < 200 && all.length < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      all = await rows();
    }
    const byEmail = Object.fromEntries(all.map((r) => [r.email_attempted, r]));
    expect(byEmail['ana@example.com']).toMatchObject({
      event: 'password_reset_requested',
      user_id: user.id,
    });
    expect(byEmail['nobody@example.com']).toMatchObject({
      event: 'password_reset_requested',
      user_id: null,
      company_id: null,
    });
  });

  it('never breaks a sign-in when history can’t be written', async () => {
    await person({ email: 'ana@example.com' });
    const original = pool.query.bind(pool) as (...args: any[]) => any;
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    const spy = jest.spyOn(pool, 'query').mockImplementation(((sql: any, params?: any) => {
      const text = typeof sql === 'string' ? sql : sql?.text ?? '';
      if (/INSERT INTO (login_events|account_events)/.test(text)) {
        return Promise.reject(new Error('disk full'));
      }
      return original(sql, params);
    }) as any);
    try {
      const failed = await login('ana@example.com', 'wrong');
      expect(failed.status).toBe(401);
      const ok = await login('ana@example.com');
      expect(ok.status).toBe(200);
      const cookie = cookieFrom(ok);
      expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(200);
      expect((await request(app).post('/auth/logout').set('Cookie', cookie)).status).toBe(200);
      await settleLoginEvents();
    } finally {
      spy.mockRestore();
    }
    const logged = quiet.mock.calls.map((call) => String(call[0]));
    quiet.mockRestore();
    expect(logged.some((line) => line.includes('login_event_write_failed'))).toBe(true);
    expect(logged.some((line) => line.includes('account_event_write_failed'))).toBe(true);
    expect(await rows()).toEqual([]);
  });

  it('prunes only rows older than the retention', async () => {
    await pool.query(
      `INSERT INTO login_events (event, reason, created_at) VALUES
         ('login_failed', 'unknown_company', now() - interval '181 days'),
         ('login_failed', 'unknown_company', now() - interval '200 days'),
         ('login_failed', 'unknown_company', now() - interval '179 days'),
         ('login_failed', 'unknown_company', now())`
    );
    expect(await pruneLoginEvents({ keepDays: 180, batchSize: 1 })).toBe(2);
    const { rows: left } = await pool.query(`SELECT count(*)::int AS n FROM login_events`);
    expect(left[0].n).toBe(2);
  });
});

describe('login history helpers', () => {
  it('normalizes addresses for inet', () => {
    expect(normalizeIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
    expect(normalizeIp('unknown')).toBeNull();
    expect(normalizeIp('')).toBeNull();
  });

  it('reads the retention from LOGIN_EVENTS_KEEP_DAYS', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loginEventsKeepDays({})).toBe(180);
    expect(loginEventsKeepDays({ LOGIN_EVENTS_KEEP_DAYS: '90' })).toBe(90);
    expect(loginEventsKeepDays({ LOGIN_EVENTS_KEEP_DAYS: 'soon' })).toBe(180);
    expect(loginEventsKeepDays({ LOGIN_EVENTS_KEEP_DAYS: '0' })).toBe(180);
    warn.mockRestore();
  });
});
