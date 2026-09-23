/// <reference types="jest" />
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import {
  createTestCompany,
} from './helpers/auth';

jest.setTimeout(30000);

describe('Phase 20 auth / company register', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
  });

  it('register creates a company and owner, not an uninvited agent', async () => {
    const res = await request(app).post('/auth/register').send({
      first_name: 'Pat',
      last_name: 'Owner',
      email: 'pat-owner@example.com',
      password: 'Testpass1!',
      company_name: 'Northside Roofing',
      slug: 'northside-auth',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('owner');
    expect(res.body.user.email).toBe('pat-owner@example.com');
    expect(res.body.company.name).toBe('Northside Roofing');
    expect(res.body.company.slug).toBe('northside-auth');
    expect(res.body.company.palette_id).toBe('rooftop');

    const second = await request(app).post('/auth/register').send({
      first_name: 'Quinn',
      last_name: 'Other',
      email: 'quinn-owner@example.com',
      password: 'Testpass1!',
      company_name: 'Eastside Roofing',
    });

    expect(second.status).toBe(201);
    expect(second.body.user.role).toBe('owner');
    expect(second.body.company.slug).toBe('eastside-roofing');
    expect(second.body.company.id).not.toBe(res.body.company.id);

    const me = await request(app)
      .get('/auth/me')
      .set('Cookie', res.headers['set-cookie']?.[0] ?? '');
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('owner');
    expect(me.body.company.slug).toBe('northside-auth');
  });

  it('rejects a caller-supplied slug that is already taken', async () => {
    const res = await request(app).post('/auth/register').send({
      first_name: 'Pat',
      last_name: 'Owner',
      email: 'slug-taken@example.com',
      password: 'Testpass1!',
      company_name: 'Taken Co',
      slug: 'rooftop',
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Company slug already in use');
  });

  it('GET /public/companies/:slug returns branding without a company id', async () => {
    const found = await request(app).get('/public/companies/rooftop');
    expect(found.status).toBe(200);
    expect(found.body.ok).toBe(true);
    expect(found.body.company).toEqual({
      name: 'Rooftop Realty',
      slug: 'rooftop',
      palette_id: 'rooftop',
      mark_id: 'product',
      logo_url: null,
    });
    expect(found.body.company.id).toBeUndefined();

    const folded = await request(app).get('/public/companies/Rooftop');
    expect(folded.status).toBe(200);
    expect(folded.body.company.slug).toBe('rooftop');

    const missing = await request(app).get('/public/companies/no-such-company');
    expect(missing.status).toBe(404);
    expect(missing.body.ok).toBe(false);
  });

  it('login with a company slug succeeds and JWT company is loaded from the user row', async () => {
    const register = await request(app).post('/auth/register').send({
      first_name: 'Pat',
      last_name: 'Owner',
      email: 'login-one@example.com',
      password: 'Testpass1!',
      company_name: 'Login One Co',
    });
    expect(register.status).toBe(201);

    const missingSlug = await request(app).post('/auth/login').send({
      email: 'login-one@example.com',
      password: 'Testpass1!',
    });
    expect(missingSlug.status).toBe(400);

    const login = await request(app).post('/auth/login').send({
      email: 'login-one@example.com',
      password: 'Testpass1!',
      company_slug: register.body.company.slug,
    });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('login-one@example.com');
    expect(login.body.company.id).toBe(register.body.company.id);
    expect(login.body.company.slug).toBe(register.body.company.slug);
  });

  it('login slug selects the membership when the same email exists in two companies', async () => {
    const password_hash = await bcrypt.hash('Testpass1!', 10);
    const other = await createTestCompany({ slug: 'other-login' });
    const shared = 'shared-login@example.com';

    await pool.query(
      `
      INSERT INTO users (first_name, last_name, email, password_hash, role, status, company_id)
      SELECT 'Ava', 'Ashwood', $1, $2, 'owner', 'active', id
      FROM companies WHERE slug = 'rooftop'
      `,
      [shared, password_hash]
    );
    await pool.query(
      `
      INSERT INTO users (first_name, last_name, email, password_hash, role, status, company_id)
      VALUES ('Blake', 'Bravard', $1, $2, 'owner', 'active', $3)
      `,
      [shared, password_hash, other.id]
    );

    const rooftopLogin = await request(app).post('/auth/login').send({
      email: shared,
      password: 'Testpass1!',
      company_slug: 'rooftop',
    });
    expect(rooftopLogin.status).toBe(200);
    expect(rooftopLogin.body.user.first_name).toBe('Ava');
    expect(rooftopLogin.body.company.slug).toBe('rooftop');

    const otherLogin = await request(app).post('/auth/login').send({
      email: shared,
      password: 'Testpass1!',
      company_slug: 'other-login',
    });
    expect(otherLogin.status).toBe(200);
    expect(otherLogin.body.user.first_name).toBe('Blake');
    expect(otherLogin.body.company.slug).toBe('other-login');

    const wrongSlug = await request(app).post('/auth/login').send({
      email: shared,
      password: 'Testpass1!',
      company_slug: 'no-such-company',
    });
    expect(wrongSlug.status).toBe(401);
    expect(wrongSlug.body.error).toBe('Invalid credentials');
  });

  it('login 401s for a real slug that is not this email membership', async () => {
    const password_hash = await bcrypt.hash('Testpass1!', 10);
    const other = await createTestCompany({ slug: 'wrong-tag' });

    await pool.query(
      `
      INSERT INTO users (first_name, last_name, email, password_hash, role, status, company_id)
      SELECT 'Ava', 'Ashwood', $1, $2, 'owner', 'active', id
      FROM companies WHERE slug = 'rooftop'
      `,
      ['ava-only@example.com', password_hash]
    );
    await pool.query(
      `
      INSERT INTO users (first_name, last_name, email, password_hash, role, status, company_id)
      VALUES ('Blake', 'Bravard', $1, $2, 'owner', 'active', $3)
      `,
      ['blake-only@example.com', password_hash, other.id]
    );

    const mismatch = await request(app).post('/auth/login').send({
      email: 'ava-only@example.com',
      password: 'Testpass1!',
      company_slug: 'wrong-tag',
    });
    expect(mismatch.status).toBe(401);
    expect(mismatch.body.error).toBe('Invalid credentials');
  });

  it('invite validate returns company name and accept-invite stays in that company', async () => {
    const ownerRes = await request(app).post('/auth/register').send({
      first_name: 'Pat',
      last_name: 'Owner',
      email: 'invite-owner@example.com',
      password: 'Testpass1!',
      company_name: 'Invite Co',
      slug: 'invite-co',
    });
    expect(ownerRes.status).toBe(201);
    const cookie = ownerRes.headers['set-cookie']?.[0] ?? '';

    const invite = await request(app)
      .post('/users/invite')
      .set('Cookie', cookie)
      .send({
        email: 'agent-join@example.com',
        first_name: 'Alex',
        last_name: 'Agent',
        role: 'agent',
      });
    expect(invite.status).toBe(201);
    const token = String(invite.body.invite_url || '').split('token=')[1] || '';
    expect(token).toBeTruthy();

    const validate = await request(app).get('/users/invites/validate').query({
      token,
    });
    expect(validate.status).toBe(200);
    expect(validate.body.ok).toBe(true);
    expect(validate.body.company_name).toBe('Invite Co');
    expect(validate.body.company_slug).toBe('invite-co');

    const accept = await request(app).post('/auth/accept-invite').send({
      token,
      password: 'Testpass1!',
    });
    expect(accept.status).toBe(200);
    expect(accept.body.user.role).toBe('agent');
    expect(accept.body.company.id).toBe(ownerRes.body.company.id);

    const me = await request(app)
      .get('/auth/me')
      .set('Cookie', accept.headers['set-cookie']?.[0] ?? '');
    expect(me.status).toBe(200);
    expect(me.body.company.slug).toBe('invite-co');
    expect(me.body.user.role).toBe('agent');
  });
});
