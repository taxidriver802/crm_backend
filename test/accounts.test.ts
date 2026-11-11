/// <reference types="jest" />
/**
 * A way back in, and sessions that end (EXPERIMENT_SAAS.md prospect 4).
 *
 * The mailer is replaced by a stand-in that records what would be sent;
 * `mockMail.on` says whether this host "has SMTP". Every link is checked by
 * using it, through the same routes the app calls.
 */
import bcrypt from 'bcryptjs';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { startTestServer } from './helpers/server';
import {
  createTestUser,
  DEFAULT_COMPANY_SLUG,
  type TestUserRole,
} from './helpers/auth';
import { buildResetEmail } from '../src/lib/reset-email';
import { buildInviteEmail } from '../src/lib/invite-email';
import * as sessions from '../src/lib/sessions';
const { issueResetLink } = require('../scripts/reset-link');

type Sent = { to: string; subject: string; text: string; html: string };
const mockMail: { on: boolean; sent: Sent[]; fail: boolean } = {
  on: false,
  sent: [],
  fail: false,
};
jest.mock('../src/lib/mailer', () => ({
  isMailConfigured: () => mockMail.on,
  sendMail: async (message: Sent) => {
    if (!mockMail.on) throw new Error('SMTP is not configured');
    if (mockMail.fail) throw new Error('SMTP refused');
    mockMail.sent.push(message);
  },
}));

jest.setTimeout(60000);

let server: Awaited<ReturnType<typeof startTestServer>>;
const api = () => server.api();

const PASSWORD = 'first-password-1';

async function personWithPassword(
  role: TestUserRole = 'agent',
  overrides: { email?: string; status?: 'active' | 'invited' | 'disabled' } = {}
) {
  const user = await createTestUser({ role, ...overrides });
  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
    await bcrypt.hash(PASSWORD, 4),
    user.id,
  ]);
  return user;
}

/** Signs in through the route; returns the cookie header to send back. */
async function signIn(email: string, password = PASSWORD) {
  const res = await api()
    .post('/auth/login')
    .send({ email, password, company_slug: DEFAULT_COMPANY_SLUG });
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

function cookieFrom(res: { headers: Record<string, any> }) {
  const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const auth = set.find((c) => c.startsWith('access_token='));
  expect(auth).toBeTruthy();
  return auth!.split(';')[0];
}

async function me(cookie: string) {
  return (await api().get('/auth/me').set('Cookie', cookie)).status;
}

async function events(userId: string) {
  const { rows } = await pool.query(
    `SELECT event, actor_id, detail FROM account_events WHERE user_id = $1 ORDER BY id`,
    [userId]
  );
  return rows;
}

/** Forgot does its work after answering; wait for what it leaves behind. */
async function eventually<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean
) {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() - started > 5000) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function tokenFrom(url: string) {
  return new URL(url).searchParams.get('token')!;
}

describe('accounts: sessions, resets and history', () => {
  beforeAll(async () => {
    await ensureSchema();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    mockMail.on = false;
    mockMail.fail = false;
    mockMail.sent = [];
    process.env.APP_BASE_URL = 'https://joist.example';
  });

  afterEach(() => {
    delete process.env.APP_BASE_URL;
  });

  describe('sessions', () => {
    it('signing out ends that browser’s session and no other', async () => {
      const agent = await personWithPassword();
      const laptop = await signIn(agent.email);
      const tablet = await signIn(agent.email);
      expect(await me(laptop)).toBe(200);
      expect(await me(tablet)).toBe(200);

      const out = await api().post('/auth/logout').set('Cookie', tablet);
      expect(out.status).toBe(200);
      expect(String(out.headers['set-cookie'])).toMatch(/access_token=;/);

      // The tablet's token is refused even though its signature still holds.
      expect(await me(tablet)).toBe(401);
      expect(await me(laptop)).toBe(200);
      expect((await events(agent.id)).map((e) => e.event)).toEqual([
        'signed_in',
        'signed_in',
        'signed_out',
      ]);
    });

    it('refuses a token that names no session (one signed before sessions existed)', async () => {
      const agent = await personWithPassword();
      const jwt = require('jsonwebtoken');
      const old = jwt.sign(
        {
          userId: agent.id,
          email: agent.email,
          role: agent.role,
          companyId: agent.company_id,
        },
        process.env.JWT_SECRET
      );
      const res = await api()
        .get('/auth/me')
        .set('Authorization', `Bearer ${old}`);
      expect(res.status).toBe(401);
    });

    it('signs out everywhere else, and keeps this browser', async () => {
      const agent = await personWithPassword();
      const here = await signIn(agent.email);
      const phone = await signIn(agent.email);
      const tablet = await signIn(agent.email);

      const res = await api()
        .post('/auth/sessions/end-others')
        .set('Cookie', here);
      expect(res.body).toEqual({ ok: true, ended: 2 });
      expect([await me(here), await me(phone), await me(tablet)]).toEqual([
        200, 401, 401,
      ]);
      const last = (await events(agent.id)).pop();
      expect(last).toMatchObject({
        event: 'signed_out_elsewhere',
        detail: { sessions: 2 },
      });
    });

    it('ends every session when an account is disabled, and enabling it brings none back', async () => {
      const owner = await personWithPassword('owner');
      const agent = await personWithPassword();
      const ownerCookie = await signIn(owner.email);
      const agentCookie = await signIn(agent.email);

      await api()
        .patch(`/users/${agent.id}`)
        .set('Cookie', ownerCookie)
        .send({ status: 'disabled' })
        .expect(200);
      await api()
        .patch(`/users/${agent.id}`)
        .set('Cookie', ownerCookie)
        .send({ status: 'active' })
        .expect(200);

      expect(await me(agentCookie)).toBe(401);
      const changes = (await events(agent.id)).filter(
        (e) => e.event === 'status_changed'
      );
      expect(changes.map((e) => e.detail)).toEqual([
        { from: 'active', to: 'disabled' },
        { from: 'disabled', to: 'active' },
      ]);
      expect(changes.every((e) => e.actor_id === owner.id)).toBe(true);
    });

    it('records sign-ins, wrong passwords and the real last sign-in', async () => {
      const agent = await personWithPassword();
      await api()
        .post('/auth/login')
        .send({
          email: agent.email,
          password: 'wrong-password',
          company_slug: DEFAULT_COMPANY_SLUG,
        })
        .expect(401);
      const before = Date.now();
      await signIn(agent.email);
      const { rows } = await pool.query(
        `SELECT last_login_at FROM users WHERE id = $1`,
        [agent.id]
      );
      expect(new Date(rows[0].last_login_at).getTime()).toBeGreaterThanOrEqual(
        before - 1000
      );
      expect((await events(agent.id)).map((e) => e.event)).toEqual([
        'sign_in_failed',
        'signed_in',
      ]);
    });
  });

  describe('change password', () => {
    it('needs the current password, keeps this browser and ends the others', async () => {
      const agent = await personWithPassword();
      const here = await signIn(agent.email);
      const other = await signIn(agent.email);

      const wrong = await api()
        .post('/auth/change-password')
        .set('Cookie', here)
        .send({ current_password: 'nope', new_password: 'second-password-2' });
      expect(wrong.status).toBe(400);
      expect(await me(other)).toBe(200);

      const short = await api()
        .post('/auth/change-password')
        .set('Cookie', here)
        .send({ current_password: PASSWORD, new_password: 'short' });
      expect(short.status).toBe(400);

      const res = await api()
        .post('/auth/change-password')
        .set('Cookie', here)
        .send({
          current_password: PASSWORD,
          new_password: 'second-password-2',
        });
      expect(res.body).toEqual({ ok: true, other_sessions_ended: 1 });
      expect([await me(here), await me(other)]).toEqual([200, 401]);

      await api()
        .post('/auth/login')
        .send({
          email: agent.email,
          password: PASSWORD,
          company_slug: DEFAULT_COMPANY_SLUG,
        })
        .expect(401);
      await signIn(agent.email, 'second-password-2');
    });

    it('stops an open reset link from undoing the change', async () => {
      const owner = await personWithPassword('owner');
      const agent = await personWithPassword();
      const link = await api()
        .post(`/users/${agent.id}/reset-link`)
        .set('Cookie', await signIn(owner.email));
      const agentCookie = await signIn(agent.email);
      await api()
        .post('/auth/change-password')
        .set('Cookie', agentCookie)
        .send({ current_password: PASSWORD, new_password: 'second-password-2' })
        .expect(200);
      const check = await api()
        .get('/auth/reset-password/validate')
        .query({ token: tokenFrom(link.body.reset_url) });
      expect(check.body).toEqual({ ok: false, status: 'superseded' });
    });

    it('stops guessing the current password after 10 wrong tries', async () => {
      const agent = await personWithPassword();
      const here = await signIn(agent.email);
      for (let i = 0; i < 10; i += 1) {
        await api()
          .post('/auth/change-password')
          .set('Cookie', here)
          .send({
            current_password: `guess-${i}`,
            new_password: 'second-password-2',
          })
          .expect(400);
      }
      const blocked = await api()
        .post('/auth/change-password')
        .set('Cookie', here)
        .send({
          current_password: PASSWORD,
          new_password: 'second-password-2',
        });
      expect(blocked.status).toBe(429);
    });
  });

  describe('forgot password', () => {
    it('answers the same for an account and for nobody, and without mail sends nothing', async () => {
      const agent = await personWithPassword();
      const real = await api()
        .post('/auth/forgot-password')
        .send({ company_slug: DEFAULT_COMPANY_SLUG, email: agent.email });
      const nobody = await api().post('/auth/forgot-password').send({
        company_slug: DEFAULT_COMPANY_SLUG,
        email: 'nobody@example.com',
      });
      expect(real.status).toBe(200);
      expect(real.body).toEqual({ ok: true, mail: false });
      expect(nobody.body).toEqual(real.body);

      const recorded = await eventually(
        () => events(agent.id),
        (rows) => rows.length > 0
      );
      // The history tells an owner or admin to send a link; no link exists.
      expect(recorded).toEqual([
        {
          event: 'reset_requested',
          actor_id: null,
          detail: { emailed: false },
        },
      ]);
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM password_resets`
      );
      expect(rows[0].n).toBe(0);
    });

    it('emails a link built from APP_BASE_URL only, whatever the request claims', async () => {
      mockMail.on = true;
      const agent = await personWithPassword();
      const res = await api()
        .post('/auth/forgot-password')
        .set('X-App-Base-Url', 'https://evil.example')
        .set('Origin', 'https://evil.example')
        .set('X-Forwarded-Host', 'evil.example')
        .send({
          company_slug: DEFAULT_COMPANY_SLUG,
          email: agent.email.toUpperCase(),
        });
      expect(res.body).toEqual({ ok: true, mail: true });

      const sent = await eventually(
        async () => mockMail.sent,
        (list) => list.length > 0
      );
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(agent.email);
      expect(sent[0].text).not.toMatch(/evil/);
      const url = sent[0].text.match(
        /https:\/\/joist\.example\/reset-password\?token=[0-9a-f]{64}/
      )?.[0];
      expect(url).toBeTruthy();

      // The emailed link works.
      const check = await api()
        .get('/auth/reset-password/validate')
        .query({ token: tokenFrom(url!) });
      expect(check.body).toMatchObject({
        ok: true,
        status: 'valid',
        email: agent.email,
      });
    });

    it('sends nothing for a disabled account, an invited one or another company’s slug', async () => {
      mockMail.on = true;
      const disabled = await personWithPassword('agent', {
        status: 'disabled',
      });
      const invited = await createTestUser({ status: 'invited' });
      for (const [slug, email] of [
        [DEFAULT_COMPANY_SLUG, disabled.email],
        [DEFAULT_COMPANY_SLUG, invited.email],
        ['some-other-company', disabled.email],
      ]) {
        const res = await api()
          .post('/auth/forgot-password')
          .send({ company_slug: slug, email });
        expect(res.body).toEqual({ ok: true, mail: true });
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(mockMail.sent).toEqual([]);
    });

    it('limits requests per account', async () => {
      const agent = await personWithPassword();
      const ask = () =>
        api()
          .post('/auth/forgot-password')
          .send({ company_slug: DEFAULT_COMPANY_SLUG, email: agent.email });
      for (let i = 0; i < 3; i += 1) expect((await ask()).status).toBe(200);
      expect((await ask()).status).toBe(429);
    });
  });

  describe('reset links', () => {
    async function staffLink(targetId: string) {
      const owner = await personWithPassword('owner');
      const res = await api()
        .post(`/users/${targetId}/reset-link`)
        .set('Cookie', await signIn(owner.email));
      expect(res.status).toBe(201);
      return { owner, url: res.body.reset_url as string, body: res.body };
    }

    it('sets the new password, ends every session, signs this browser in, and works once', async () => {
      const agent = await personWithPassword();
      const laptop = await signIn(agent.email);
      const phone = await signIn(agent.email);
      const { url } = await staffLink(agent.id);
      const token = tokenFrom(url);

      // Until the new password is set, the person stays signed in.
      expect(await me(laptop)).toBe(200);

      const check = await api()
        .get('/auth/reset-password/validate')
        .query({ token });
      expect(check.body).toMatchObject({
        ok: true,
        status: 'valid',
        email: agent.email,
        company_slug: DEFAULT_COMPANY_SLUG,
      });

      const res = await api()
        .post('/auth/reset-password')
        .send({ token, password: 'brand-new-password' });
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(agent.id);
      const fresh = cookieFrom(res);
      expect([await me(laptop), await me(phone), await me(fresh)]).toEqual([
        401, 401, 200,
      ]);

      await api()
        .post('/auth/login')
        .send({
          email: agent.email,
          password: PASSWORD,
          company_slug: DEFAULT_COMPANY_SLUG,
        })
        .expect(401);
      await signIn(agent.email, 'brand-new-password');

      const again = await api()
        .post('/auth/reset-password')
        .send({ token, password: 'third-password-3' });
      expect(again.status).toBe(400);
      expect(again.body.status).toBe('used');
      const reset = (await events(agent.id)).find(
        (e) => e.event === 'password_reset'
      );
      expect(reset?.detail).toEqual({ via: 'staff', sessions_ended: 2 });
    });

    it('is used once when submitted twice at the same moment', async () => {
      const agent = await personWithPassword();
      const { url } = await staffLink(agent.id);
      const token = tokenFrom(url);
      const results = await Promise.all(
        ['parallel-one-1', 'parallel-two-2'].map((password) =>
          api().post('/auth/reset-password').send({ token, password })
        )
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    });

    it('expires after an hour, and a newer link replaces an older one', async () => {
      const agent = await personWithPassword();
      const first = await staffLink(agent.id);
      const second = await staffLink(agent.id);
      const check = (url: string) =>
        api()
          .get('/auth/reset-password/validate')
          .query({ token: tokenFrom(url) });

      expect((await check(first.url)).body).toEqual({
        ok: false,
        status: 'superseded',
      });
      const expires = new Date(second.body.expires_at).getTime();
      expect(expires - Date.now()).toBeGreaterThan(59 * 60 * 1000);
      expect(expires - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);

      await pool.query(
        `UPDATE password_resets SET expires_at = now() - interval '1 second'`
      );
      expect((await check(second.url)).body).toEqual({
        ok: false,
        status: 'expired',
      });
      const res = await api()
        .post('/auth/reset-password')
        .send({ token: tokenFrom(second.url), password: 'too-late-password' });
      expect(res.body.status).toBe('expired');
      expect(
        (await check('https://x/reset-password?token=nonsense')).body
      ).toEqual({
        ok: false,
        status: 'invalid',
      });
    });

    it('lets owners reset anyone else, admins agents and admins, and nobody themselves', async () => {
      const owner = await personWithPassword('owner');
      const otherOwner = await personWithPassword('owner');
      const admin = await personWithPassword('admin');
      const agent = await personWithPassword('agent');
      const invited = await createTestUser({ status: 'invited' });
      const disabled = await personWithPassword('agent', {
        status: 'disabled',
      });
      const ownerCookie = await signIn(owner.email);
      const adminCookie = await signIn(admin.email);
      const agentCookie = await signIn(agent.email);
      const link = (cookie: string, id: string) =>
        api().post(`/users/${id}/reset-link`).set('Cookie', cookie);

      expect((await link(ownerCookie, otherOwner.id)).status).toBe(201);
      expect((await link(ownerCookie, admin.id)).status).toBe(201);
      expect((await link(adminCookie, agent.id)).status).toBe(201);
      expect((await link(adminCookie, otherOwner.id)).status).toBe(403);
      expect((await link(ownerCookie, owner.id)).status).toBe(400);
      expect((await link(ownerCookie, invited.id)).body.error).toMatch(
        /Resend their invite/
      );
      expect((await link(ownerCookie, disabled.id)).status).toBe(400);
      expect((await link(agentCookie, admin.id)).status).toBe(403);
    });

    it('emails the link when this host can, and then never hands it back', async () => {
      mockMail.on = true;
      const owner = await personWithPassword('owner');
      await pool.query(
        `UPDATE users SET first_name = 'Dana', last_name = 'Owner' WHERE id = $1`,
        [owner.id]
      );
      const agent = await personWithPassword();
      const res = await api()
        .post(`/users/${agent.id}/reset-link`)
        .set('Cookie', await signIn(owner.email));
      expect(res.status).toBe(201);
      expect(res.body.email_sent).toBe(true);
      expect(res.body).not.toHaveProperty('reset_url');
      expect(mockMail.sent).toHaveLength(1);
      expect(mockMail.sent[0].to).toBe(agent.email);
      expect(mockMail.sent[0].text).toMatch(/Dana Owner sent you a link/);

      // A failed send hands the link back instead.
      mockMail.fail = true;
      const failed = await api()
        .post(`/users/${agent.id}/reset-link`)
        .set('Cookie', await signIn(owner.email));
      expect(failed.body.email_sent).toBe(false);
      expect(failed.body.reset_url).toMatch(/\/reset-password\?token=/);
    });
  });

  describe('invites', () => {
    it('lasts 7 days on first send and on Resend, and Resend hands over a working link', async () => {
      const owner = await personWithPassword('owner');
      const cookie = await signIn(owner.email);
      const invite = await api()
        .post('/users/invite')
        .set('Cookie', cookie)
        .send({
          first_name: 'Sam',
          last_name: 'New',
          email: 'sam.new@example.com',
          role: 'agent',
        });
      expect(invite.status).toBe(201);
      expect(invite.body.email_sent).toBe(false);
      expect(invite.body.email_error).toMatch(/can’t send email/);
      const days = (iso: string) =>
        (new Date(iso).getTime() - Date.now()) / 86400000;
      expect(days(invite.body.user.invite_expires_at)).toBeGreaterThan(6.9);

      const resend = await api()
        .post(`/users/invite/${invite.body.user.id}/resend`)
        .set('Cookie', cookie);
      expect(resend.status).toBe(200);
      expect(resend.body.email_sent).toBe(false);
      expect(resend.body.email_error).toMatch(/can’t send email/);
      expect(days(resend.body.user.invite_expires_at)).toBeGreaterThan(6.9);

      const validate = (url: string) =>
        api()
          .get('/users/invites/validate')
          .query({ token: tokenFrom(url) });
      expect((await validate(invite.body.invite_url)).body.ok).toBe(false);
      expect((await validate(resend.body.invite_url)).body.ok).toBe(true);
      expect((await events(invite.body.user.id)).map((e) => e.event)).toEqual([
        'invite_sent',
        'invite_resent',
      ]);
    });

    it('emails the new invite on Resend when this host can', async () => {
      mockMail.on = true;
      const owner = await personWithPassword('owner');
      const cookie = await signIn(owner.email);
      const invited = await createTestUser({
        status: 'invited',
        email: 'pat.invited@example.com',
      });
      const resend = await api()
        .post(`/users/invite/${invited.id}/resend`)
        .set('Cookie', cookie);
      expect(resend.body.email_sent).toBe(true);
      expect(mockMail.sent.map((m) => m.to)).toEqual([
        'pat.invited@example.com',
      ]);
      expect(mockMail.sent[0].text).toMatch(/expires in 7 days/);
    });
  });

  describe('history and the operator’s link', () => {
    it('shows owners and admins a person’s newest events, with who did them', async () => {
      const owner = await personWithPassword('owner');
      await pool.query(
        `UPDATE users SET first_name = 'Dana', last_name = 'Owner' WHERE id = $1`,
        [owner.id]
      );
      const agent = await personWithPassword();
      const cookie = await signIn(owner.email);
      await signIn(agent.email);
      await api()
        .patch(`/users/${agent.id}`)
        .set('Cookie', cookie)
        .send({ role: 'admin' })
        .expect(200);

      const res = await api()
        .get(`/users/${agent.id}/events`)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.events.map((e: any) => [e.event, e.actor_name])).toEqual([
        ['role_changed', 'Dana Owner'],
        ['signed_in', null],
      ]);
      expect(res.body.events[0].detail).toEqual({ from: 'agent', to: 'admin' });

      const agentCookie = await signIn(agent.email);
      await api()
        .patch(`/users/${agent.id}`)
        .set('Cookie', cookie)
        .send({ role: 'agent' })
        .expect(200);
      const asAgent = await api()
        .get(`/users/${owner.id}/events`)
        .set('Cookie', agentCookie);
      expect(asAgent.status).toBe(403);
    });

    it('prints a working one-hour link for the operator, and records it', async () => {
      const owner = await personWithPassword('owner');
      const made = await issueResetLink(pool, {
        company: DEFAULT_COMPANY_SLUG,
        email: owner.email.toUpperCase(),
        base: 'https://joist.example',
      });
      expect(made.url).toMatch(
        /^https:\/\/joist\.example\/reset-password\?token=[0-9a-f]{64}$/
      );

      const res = await api()
        .post('/auth/reset-password')
        .send({
          token: tokenFrom(made.url),
          password: 'operator-set-password',
        });
      expect(res.status).toBe(200);
      await signIn(owner.email, 'operator-set-password');
      const issued = (await events(owner.id)).find(
        (e) => e.event === 'reset_link_issued'
      );
      expect(issued).toMatchObject({
        actor_id: null,
        detail: { by: 'operator', emailed: false },
      });

      const invited = await createTestUser({ status: 'invited' });
      await expect(
        issueResetLink(pool, {
          company: DEFAULT_COMPANY_SLUG,
          email: invited.email,
        })
      ).rejects.toThrow(/Resend their invite/);
      await expect(
        issueResetLink(pool, { company: 'nowhere', email: owner.email })
      ).rejects.toThrow(/No one with the email/);
    });
  });

  describe('a failed session write leaves nothing half done', () => {
    // As when the database is a migration behind and user_sessions is missing.
    const failNextSession = () =>
      jest
        .spyOn(sessions, 'createSession')
        .mockRejectedValueOnce(
          new Error('relation "user_sessions" does not exist')
        );

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('sign-up keeps no company, so the same slug works on the next try', async () => {
      const body = {
        first_name: 'Pat',
        last_name: 'Owner',
        email: 'pat.owner@example.com',
        password: 'pats-password',
        company_name: 'Half Made Roofing',
        slug: 'half-made',
      };
      const failing = failNextSession();
      const first = await api().post('/auth/register').send(body);
      expect(first.status).toBe(500);
      expect(failing).toHaveBeenCalledTimes(1);
      expect(String(first.headers['set-cookie'] ?? '')).not.toMatch(
        /access_token=/
      );
      const left = await pool.query(
        `SELECT 1 FROM companies WHERE slug = 'half-made'
         UNION ALL SELECT 1 FROM users WHERE email = 'pat.owner@example.com'`
      );
      expect(left.rows).toHaveLength(0);

      const again = await api().post('/auth/register').send(body);
      expect(again.status).toBe(201);
      expect(again.body.company.slug).toBe('half-made');
      expect(await me(cookieFrom(again))).toBe(200);
    });

    it('an invite link stays usable, and two tabs using it at once let one in', async () => {
      const owner = await personWithPassword('owner');
      const invite = await api()
        .post('/users/invite')
        .set('Cookie', await signIn(owner.email))
        .send({
          first_name: 'Sam',
          last_name: 'New',
          email: 'sam.new@example.com',
          role: 'agent',
        });
      expect(invite.status).toBe(201);
      const token = tokenFrom(invite.body.invite_url);
      const accept = () =>
        api()
          .post('/auth/accept-invite')
          .send({ token, password: 'sams-password' });

      failNextSession();
      expect((await accept()).status).toBe(500);
      const { rows } = await pool.query(
        `SELECT status FROM users WHERE id = $1`,
        [invite.body.user.id]
      );
      expect(rows[0].status).toBe('invited');
      const check = await api().get('/users/invites/validate').query({ token });
      expect(check.body.ok).toBe(true);

      const both = await Promise.all([accept(), accept()]);
      expect(both.map((r) => r.status).sort()).toEqual([200, 400]);
      expect((await events(invite.body.user.id)).map((e) => e.event)).toEqual([
        'invite_sent',
        'invite_accepted',
      ]);
    });

    it('a reset link stays unused and the old password and sessions carry on', async () => {
      const agent = await personWithPassword();
      const laptop = await signIn(agent.email);
      const owner = await personWithPassword('owner');
      const link = await api()
        .post(`/users/${agent.id}/reset-link`)
        .set('Cookie', await signIn(owner.email));
      const token = tokenFrom(link.body.reset_url);
      const reset = () =>
        api()
          .post('/auth/reset-password')
          .send({ token, password: 'brand-new-password' });

      failNextSession();
      expect((await reset()).status).toBe(500);
      const check = await api()
        .get('/auth/reset-password/validate')
        .query({ token });
      expect(check.body.status).toBe('valid');
      expect(await me(laptop)).toBe(200);
      await signIn(agent.email);

      const done = await reset();
      expect(done.status).toBe(200);
      expect(await me(laptop)).toBe(401);
      expect(await me(cookieFrom(done))).toBe(200);
    });
  });

  describe('emails', () => {
    it('words each link’s lifetime and escapes what people typed', () => {
      const reset = buildResetEmail({
        firstName: '<b>Ann</b>',
        email: 'ann@example.com',
        resetUrl: 'https://joist.example/reset-password?token=abc',
        companyName: 'Hill & Sons',
        companySlug: 'hill-sons',
        via: 'forgot',
      });
      expect(reset.subject).toBe('Set a new password for Hill & Sons');
      expect(reset.text).toMatch(/expires in 1 hour/);
      expect(reset.text).toMatch(/If it wasn’t, ignore this email/);
      expect(reset.html).toContain('&lt;b&gt;Ann&lt;/b&gt;');
      expect(reset.html).toContain('Hill &amp; Sons');
      expect(reset.html).toContain('Powered by Joist');

      const invite = buildInviteEmail({
        firstName: 'Sam',
        inviteUrl: 'https://joist.example/accept-invite?token=abc',
        companyName: 'Hill & Sons',
        role: 'agent',
        expiresHours: 168,
      });
      expect(invite.text).toMatch(/expires in 7 days/);
    });
  });
});
