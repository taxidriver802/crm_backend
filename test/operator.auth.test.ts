/// <reference types="jest" />
/**
 * The operator surface, step 2 (PLAN_operator.md §4–5): migration 0006, the
 * operator's own sign-in, the Cloudflare Access gate, the CLI, and the
 * production boot rules.
 *
 * Supertest connects from loopback, which `trust proxy` trusts, so an
 * X-Forwarded-For header stands in for a client elsewhere.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { authHeaderFor, createTestUser, DEFAULT_COMPANY_ID } from './helpers/auth';
import { settleLoginEvents } from '../src/lib/loginEvents';
import { setCfAccessKeySourceForTests } from '../src/lib/cfAccess';
import { OPERATOR_COOKIE } from '../src/lib/operatorSessions';
import { productionConfigProblems } from '../src/config/production';
const { upsertOperator, parseArgs } = require('../scripts/operator-create');

jest.setTimeout(60000);

const OPERATOR_SECRET = 'operator-test-secret-'.padEnd(64, 'x');
const EMAIL = 'op@example.com';
const PASSWORD = 'a-long-operator-password';

const TEAM = 'joist-test.cloudflareaccess.com';
const AUD = 'aud-tag-for-tests';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-kid';

function accessAssertion(
  overrides: { aud?: string; iss?: string; expiresIn?: number; key?: crypto.KeyObject } = {}
) {
  return jwt.sign(
    { email: EMAIL, sub: 'cf-user-1' },
    overrides.key ?? privateKey,
    {
      algorithm: 'RS256',
      keyid: KID,
      audience: overrides.aud ?? AUD,
      issuer: overrides.iss ?? `https://${TEAM}`,
      expiresIn: overrides.expiresIn ?? 300,
    }
  );
}

/** process.env values for the length of one test. */
const savedEnv: Record<string, string | undefined> = {};
function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function cookieFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = (raw ?? []).find((c) => c.startsWith(`${OPERATOR_COOKIE}=`));
  if (!cookie) throw new Error('no operator cookie set');
  return cookie.split(';')[0];
}

async function signIn() {
  const res = await request(app)
    .post('/operator/auth/login')
    .send({ email: EMAIL, password: PASSWORD });
  expect(res.status).toBe(200);
  return { res, cookie: cookieFrom(res) };
}

async function operatorLoginEvents() {
  await settleLoginEvents();
  const { rows } = await pool.query(
    `SELECT event, reason, scope, email_attempted FROM login_events
     WHERE scope = 'operator' ORDER BY id`
  );
  return rows;
}

beforeAll(async () => {
  await ensureSchema();
});

beforeEach(async () => {
  await resetDb();
  setEnv({
    OPERATOR_JWT_SECRET: OPERATOR_SECRET,
    OPERATOR_CF_ACCESS_TEAM_DOMAIN: undefined,
    OPERATOR_CF_ACCESS_AUD: undefined,
  });
  setCfAccessKeySourceForTests(null);
  await upsertOperator(pool, { email: EMAIL, password: PASSWORD });
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete savedEnv[key];
  }
  setCfAccessKeySourceForTests(null);
});

describe('migration 0006', () => {
  it('makes existing companies active and keeps the status to the known states', async () => {
    const { rows } = await pool.query(`SELECT status FROM companies WHERE id = $1`, [
      DEFAULT_COMPANY_ID,
    ]);
    expect(rows[0].status).toBe('active');
    await expect(
      pool.query(`UPDATE companies SET status = 'deleted' WHERE id = $1`, [DEFAULT_COMPANY_ID])
    ).rejects.toThrow(/companies_status_check/);
  });

  it('only lets on_hold carry the state it returns to', async () => {
    await expect(
      pool.query(`UPDATE companies SET held_from_status = 'active' WHERE id = $1`, [
        DEFAULT_COMPANY_ID,
      ])
    ).rejects.toThrow(/companies_held_from_status_check/);
    await pool.query(
      `UPDATE companies SET status = 'on_hold', held_from_status = 'active' WHERE id = $1`,
      [DEFAULT_COMPANY_ID]
    );
  });
});

describe('the operator surface is off without its secret', () => {
  it('answers 404 to every operator route', async () => {
    setEnv({ OPERATOR_JWT_SECRET: undefined });
    const login = await request(app)
      .post('/operator/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(login.status).toBe(404);
    expect((await request(app).get('/operator/auth/me')).status).toBe(404);
  });
});

describe('operator sign-in', () => {
  it('signs in, knows who it is, and signs out', async () => {
    const { res, cookie } = await signIn();
    expect(res.body.operator.email).toBe(EMAIL);
    const setCookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);

    const me = await request(app).get('/operator/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.operator.email).toBe(EMAIL);
    expect(me.body.operator.last_login_at).toBeTruthy();

    expect((await request(app).post('/operator/auth/logout').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).get('/operator/auth/me').set('Cookie', cookie)).status).toBe(401);

    const events = await operatorLoginEvents();
    expect(events.map((e) => e.event)).toEqual(['login_success', 'logout']);
  });

  it('gives the same answer for a wrong password and an unknown email, and logs why', async () => {
    const wrong = await request(app)
      .post('/operator/auth/login')
      .send({ email: EMAIL, password: 'not-the-password' });
    const unknown = await request(app)
      .post('/operator/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);

    const events = await operatorLoginEvents();
    expect(events.map((e) => e.reason)).toEqual(['bad_password', 'unknown_email']);
    expect(events.every((e) => e.scope === 'operator')).toBe(true);
  });

  it('refuses a disabled operator', async () => {
    await pool.query(`UPDATE operators SET disabled_at = now()`);
    const res = await request(app)
      .post('/operator/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('stops after five failures, the right password included', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post('/operator/auth/login')
        .send({ email: EMAIL, password: `wrong-${i}` });
    }
    const res = await request(app)
      .post('/operator/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(429);
  });

  it('refuses a token whose session has ended or expired', async () => {
    const { cookie } = await signIn();
    await pool.query(`UPDATE operator_sessions SET expires_at = now() - interval '1 minute'`);
    expect((await request(app).get('/operator/auth/me').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('operator and company sign-ins never cross', () => {
  it('refuses a company owner token on the operator surface', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const headers = await authHeaderFor(owner);
    const token = headers.Authorization.slice('Bearer '.length);

    expect((await request(app).get('/operator/auth/me').set(headers)).status).toBe(401);
    expect(
      (await request(app).get('/operator/auth/me').set('Cookie', `${OPERATOR_COOKIE}=${token}`)).status
    ).toBe(401);
  });

  it('refuses an operator token on company routes', async () => {
    const { cookie } = await signIn();
    const token = cookie.slice(`${OPERATOR_COOKIE}=`.length);

    const asBearer = await request(app).get('/leads').set('Authorization', `Bearer ${token}`);
    const asCookie = await request(app).get('/leads').set('Cookie', `access_token=${token}`);
    expect(asBearer.status).toBe(401);
    expect(asCookie.status).toBe(401);
  });

  it('refuses an operator-audience token even when signed with the company secret', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const { Authorization } = await authHeaderFor(owner);
    const claims = jwt.decode(Authorization.slice(7)) as Record<string, unknown>;
    const forged = jwt.sign({ ...claims, aud: 'operator' }, process.env.JWT_SECRET!);
    const res = await request(app).get('/leads').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });
});

describe('the network gate', () => {
  it('without Cloudflare Access configured, only lets loopback through', async () => {
    const res = await request(app)
      .post('/operator/auth/login')
      .set('X-Forwarded-For', '203.0.113.9')
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(404);
  });

  describe('with Cloudflare Access configured', () => {
    beforeEach(() => {
      setEnv({ OPERATOR_CF_ACCESS_TEAM_DOMAIN: TEAM, OPERATOR_CF_ACCESS_AUD: AUD });
      setCfAccessKeySourceForTests(async () => new Map([[KID, publicKey]]));
    });

    const login = (assertion?: string) => {
      const req = request(app).post('/operator/auth/login');
      if (assertion) req.set('Cf-Access-Jwt-Assertion', assertion);
      return req.send({ email: EMAIL, password: PASSWORD });
    };

    it('refuses a request with no assertion, even from loopback, and logs it', async () => {
      expect((await login()).status).toBe(404);
      const events = await operatorLoginEvents();
      expect(events).toEqual([
        expect.objectContaining({ event: 'login_failed', reason: 'access_denied' }),
      ]);
    });

    it('accepts a valid assertion in the header or the Access cookie', async () => {
      expect((await login(accessAssertion())).status).toBe(200);
      const viaCookie = await request(app)
        .post('/operator/auth/login')
        .set('Cookie', `CF_Authorization=${accessAssertion()}`)
        .send({ email: EMAIL, password: PASSWORD });
      expect(viaCookie.status).toBe(200);
    });

    it('refuses another application, another team, an expired assertion, or a foreign key', async () => {
      const { privateKey: otherKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      expect((await login(accessAssertion({ aud: 'some-other-app' }))).status).toBe(404);
      expect((await login(accessAssertion({ iss: 'https://evil.cloudflareaccess.com' }))).status).toBe(404);
      expect((await login(accessAssertion({ expiresIn: -10 }))).status).toBe(404);
      expect((await login(accessAssertion({ key: otherKey }))).status).toBe(404);
    });

    it('refuses an HS256 token made with a guessable secret', async () => {
      const forged = jwt.sign({ email: EMAIL }, 'guess', {
        keyid: KID,
        audience: AUD,
        issuer: `https://${TEAM}`,
      });
      expect((await login(forged)).status).toBe(404);
    });
  });
});

describe('operator:create', () => {
  it('reads an email and --reset', () => {
    expect(parseArgs(['Me@Example.com', '--reset'])).toEqual({
      email: 'me@example.com',
      reset: true,
      clearTotp: false,
      help: false,
    });
    expect(parseArgs(['me@example.com', '--reset', '--clear-totp']).clearTotp).toBe(true);
    expect(() => parseArgs(['me@example.com', '--clear-totp'])).toThrow(/goes with --reset/);
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
  });

  it('refuses a second account with the same email unless --reset', async () => {
    await expect(
      upsertOperator(pool, { email: EMAIL, password: 'another-long-password' })
    ).rejects.toThrow(/already an operator/);
  });

  it('refuses a short password', async () => {
    await expect(
      upsertOperator(pool, { email: 'new@example.com', password: 'short' })
    ).rejects.toThrow(/at least 12/);
  });

  it('--reset sets a new password and ends every session', async () => {
    const { cookie } = await signIn();
    await upsertOperator(pool, { email: EMAIL, password: 'the-new-password-1', reset: true });
    expect((await request(app).get('/operator/auth/me').set('Cookie', cookie)).status).toBe(401);
    const res = await request(app)
      .post('/operator/auth/login')
      .send({ email: EMAIL, password: 'the-new-password-1' });
    expect(res.status).toBe(200);
  });
});

describe('production boot rules for the operator', () => {
  const BASE = {
    NODE_ENV: 'production',
    APP_BASE_URL: 'https://crm.example.com',
    FRONTEND_URL: 'https://crm.example.com',
    JWT_SECRET: 'a'.repeat(64),
    TRUST_PROXY: 'loopback',
    REGISTRATION_MODE: 'closed',
  };

  it('is fine with the operator surface off', () => {
    expect(productionConfigProblems(BASE)).toEqual([]);
  });

  it('is fine with a separate strong secret and Cloudflare Access', () => {
    expect(
      productionConfigProblems({
        ...BASE,
        OPERATOR_JWT_SECRET: 'b'.repeat(64),
        OPERATOR_CF_ACCESS_TEAM_DOMAIN: TEAM,
        OPERATOR_CF_ACCESS_AUD: AUD,
      })
    ).toEqual([]);
  });

  it('refuses a short secret, a reused secret, or no Cloudflare Access', () => {
    const problems = productionConfigProblems({ ...BASE, OPERATOR_JWT_SECRET: BASE.JWT_SECRET }).join('\n');
    expect(problems).toMatch(/must differ from JWT_SECRET/);
    expect(problems).toMatch(/needs Cloudflare Access/);
    expect(
      productionConfigProblems({
        ...BASE,
        OPERATOR_JWT_SECRET: 'short',
        OPERATOR_CF_ACCESS_TEAM_DOMAIN: TEAM,
        OPERATOR_CF_ACCESS_AUD: AUD,
      }).join('\n')
    ).toMatch(/OPERATOR_JWT_SECRET must be at least 32 bytes/);
  });
});
