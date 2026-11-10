/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import {
  authHeaderFor,
  createAuthedUser,
  createTestCompany,
  createTestUser,
} from './helpers/auth';

jest.setTimeout(60000);

// Supertest connects from loopback, which `trust proxy` trusts, so an
// X-Forwarded-For header here stands in for what the TLS proxy would send.
// Counters are cleared before every test (test/setupAfterEnv.ts).

const PASSWORD = 'Testpass1!';
const SLUG = 'lockout-co';
const EMAIL = 'owner@lockout.example';

async function registerOwner() {
  const res = await request(app)
    .post('/auth/register')
    .set('X-Forwarded-For', '203.0.113.200')
    .send({
      first_name: 'Ana',
      last_name: 'Owner',
      email: EMAIL,
      password: PASSWORD,
      company_name: 'Lockout Co',
      slug: SLUG,
    });
  expect(res.status).toBe(201);
}

function login(from: string, password: string, email = EMAIL) {
  return request(app)
    .post('/auth/login')
    .set('X-Forwarded-For', from)
    .send({ email, password, company_slug: SLUG });
}

function expectTooMany(res: request.Response) {
  expect(res.status).toBe(429);
  expect(res.body.ok).toBe(false);
  expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
}

describe('Rate limits on the public surface', () => {
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await resetDb();
  });

  describe('Sign-in', () => {
    it('locks an account after 10 failures, from any address, and lets it in again after the window', async () => {
      await registerOwner();

      // Spread the guesses over many addresses: the account limit still holds.
      for (let i = 0; i < 10; i += 1) {
        const res = await login(`198.51.100.${i + 1}`, 'wrong-password');
        expect(res.status).toBe(401);
      }

      expectTooMany(await login('198.51.100.50', 'wrong-password'));
      // While the lock holds, the right password is refused too.
      expectTooMany(await login('198.51.100.51', PASSWORD));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('"limit":"login-account"'));

      const later = Date.now() + 16 * 60 * 1000;
      jest.spyOn(Date, 'now').mockReturnValue(later);
      const res = await login('198.51.100.52', PASSWORD);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('forgets the failures once the right password is used', async () => {
      await registerOwner();

      for (let round = 0; round < 2; round += 1) {
        for (let i = 0; i < 9; i += 1) {
          expect((await login('198.51.100.7', 'wrong-password')).status).toBe(401);
        }
        expect((await login('198.51.100.7', PASSWORD)).status).toBe(200);
      }
    });

    it('stops one address after 50 failures across accounts, and only that address', async () => {
      await registerOwner();

      for (let i = 0; i < 50; i += 1) {
        const res = await login('192.0.2.9', 'wrong-password', `nobody${i}@lockout.example`);
        expect(res.status).toBe(401);
      }

      expectTooMany(await login('192.0.2.9', 'wrong-password', 'another@lockout.example'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('"limit":"login-ip"'));

      const elsewhere = await login('192.0.2.10', PASSWORD);
      expect(elsewhere.status).toBe(200);
    });

    it('does not count successful sign-ins', async () => {
      await registerOwner();

      for (let i = 0; i < 15; i += 1) {
        expect((await login('198.51.100.8', PASSWORD)).status).toBe(200);
      }
    });
  });

  describe('Register and invites', () => {
    it('allows 10 company sign-ups an hour from one address', async () => {
      // Every attempt counts, valid or not.
      for (let i = 0; i < 10; i += 1) {
        const res = await request(app)
          .post('/auth/register')
          .set('X-Forwarded-For', '203.0.113.1')
          .send({});
        expect(res.status).toBe(400);
      }

      expectTooMany(
        await request(app).post('/auth/register').set('X-Forwarded-For', '203.0.113.1').send({})
      );

      const elsewhere = await request(app)
        .post('/auth/register')
        .set('X-Forwarded-For', '203.0.113.2')
        .send({
          first_name: 'Bo',
          last_name: 'Owner',
          email: 'bo@other.example',
          password: PASSWORD,
          company_name: 'Other Roofing',
        });
      expect(elsewhere.status).toBe(201);
    });

    it('allows 20 invite acceptances and 60 invite checks per 15 minutes from one address', async () => {
      for (let i = 0; i < 20; i += 1) {
        const res = await request(app)
          .post('/auth/accept-invite')
          .set('X-Forwarded-For', '203.0.113.3')
          .send({ token: `guess-${i}`, password: PASSWORD });
        expect(res.status).toBe(400);
      }
      expectTooMany(
        await request(app)
          .post('/auth/accept-invite')
          .set('X-Forwarded-For', '203.0.113.3')
          .send({ token: 'guess-final', password: PASSWORD })
      );

      for (let i = 0; i < 60; i += 1) {
        const res = await request(app)
          .get('/users/invites/validate')
          .set('X-Forwarded-For', '203.0.113.4')
          .query({ token: `guess-${i}` });
        expect(res.status).not.toBe(429);
      }
      expectTooMany(
        await request(app)
          .get('/users/invites/validate')
          .set('X-Forwarded-For', '203.0.113.4')
          .query({ token: 'guess-final' })
      );
    });
  });

  describe('Client pages', () => {
    it('allows 300 page reads per 15 minutes from one address', async () => {
      for (let i = 0; i < 300; i += 1) {
        const res = await request(app)
          .get(`/public/portal/not-a-token-${i}`)
          .set('X-Forwarded-For', '198.18.0.1');
        expect(res.status).toBe(404);
      }

      expectTooMany(
        await request(app).get('/public/portal/not-a-token').set('X-Forwarded-For', '198.18.0.1')
      );
      expectTooMany(
        await request(app).get('/public/invoices/not-a-token').set('X-Forwarded-For', '198.18.0.1')
      );

      const elsewhere = await request(app)
        .get('/public/portal/not-a-token')
        .set('X-Forwarded-For', '198.18.0.2');
      expect(elsewhere.status).toBe(404);
    });

    it('allows 30 estimate answers per 15 minutes from one address, apart from reads', async () => {
      for (let i = 0; i < 30; i += 1) {
        const res = await request(app)
          .post(`/public/estimates/not-a-token-${i}/respond`)
          .set('X-Forwarded-For', '198.18.0.3')
          .send({ action: 'approve' });
        expect(res.status).not.toBe(429);
      }

      expectTooMany(
        await request(app)
          .post('/public/estimates/not-a-token/respond')
          .set('X-Forwarded-For', '198.18.0.3')
          .send({ action: 'approve' })
      );

      // Reading the estimate is a different, larger allowance.
      const read = await request(app)
        .get('/public/estimates/not-a-token')
        .set('X-Forwarded-For', '198.18.0.3');
      expect(read.status).not.toBe(429);
    });
  });

  describe('Intake form', () => {
    function submit(token: string, from: string, i: number) {
      return request(app)
        .post(`/public/intake/${token}`)
        .set('X-Forwarded-For', from)
        .send({ first_name: 'Rate', last_name: `Visitor${i}`, email: `visitor${i}@example.com` });
    }

    it('keys on the address the trusted proxy saw, not one the client wrote', async () => {
      const { headers } = await createAuthedUser('owner');
      const gen = await request(app).post('/intake/generate').set(headers);
      const token = gen.body.token;

      // The client prepends its own X-Forwarded-For; the proxy appends the
      // real address (9.9.9.9). Only the appended one is believed.
      for (let i = 0; i < 5; i += 1) {
        const res = await submit(token, `10.0.0.${i + 1}, 9.9.9.9`, i);
        expect(res.status).toBe(201);
      }
      const blocked = await submit(token, '10.0.0.99, 9.9.9.9', 99);
      expect(blocked.status).toBe(429);
    });

    it('caps one intake link at 30 an hour without touching another company', async () => {
      const { headers } = await createAuthedUser('owner');
      const token = (await request(app).post('/intake/generate').set(headers)).body.token;

      for (let i = 0; i < 30; i += 1) {
        const res = await submit(token, `100.64.0.${i + 1}`, i);
        expect(res.status).toBe(201);
      }
      expect((await submit(token, '100.64.1.1', 30)).status).toBe(429);

      const other = await createTestCompany({ name: 'Other Roofing', slug: 'other-roofing' });
      const otherOwner = await createTestUser({ role: 'owner', company_id: other.id });
      const otherToken = (
        await request(app).post('/intake/generate').set(authHeaderFor(otherOwner))
      ).body.token;
      expect((await submit(otherToken, '100.64.1.2', 31)).status).toBe(201);
    });
  });
});
