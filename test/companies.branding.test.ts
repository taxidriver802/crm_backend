/// <reference types="jest" />
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../src/app';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser, createTestCompany, authHeaderFor, createTestUser } from './helpers/auth';

jest.setTimeout(30000);

describe('Phase 21 company branding', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
  });

  it('register stores an optional mark and owner can update branding', async () => {
    const register = await request(app).post('/auth/register').send({
      first_name: 'Pat',
      last_name: 'Owner',
      email: 'brand-owner@example.com',
      password: 'Testpass1!',
      company_name: 'Brand Co',
      slug: 'brand-co',
      mark_id: 'home',
      palette_id: 'azure',
    });
    expect(register.status).toBe(201);
    expect(register.body.company.mark_id).toBe('home');
    expect(register.body.company.palette_id).toBe('azure');
    expect(register.body.company.logo_url).toBeNull();

    const cookie = register.headers['set-cookie']?.[0] ?? '';
    const patched = await request(app)
      .patch('/company')
      .set('Cookie', cookie)
      .send({ name: 'Brand Co LLC', palette_id: 'emerald', mark_id: 'spark' });
    expect(patched.status).toBe(200);
    expect(patched.body.company.name).toBe('Brand Co LLC');
    expect(patched.body.company.palette_id).toBe('emerald');
    expect(patched.body.company.mark_id).toBe('spark');

    const publicGet = await request(app).get('/public/companies/brand-co');
    expect(publicGet.status).toBe(200);
    expect(publicGet.body.company).toMatchObject({
      name: 'Brand Co LLC',
      slug: 'brand-co',
      palette_id: 'emerald',
      mark_id: 'spark',
      logo_url: null,
    });
    expect(publicGet.body.company.id).toBeUndefined();
  });

  it('agents cannot change company branding', async () => {
    const { headers } = await createAuthedUser('agent');
    const res = await request(app)
      .patch('/company')
      .set(headers)
      .send({ palette_id: 'violet' });
    expect(res.status).toBe(403);
  });

  it('owner can upload a logo and the public logo route serves it', async () => {
    const register = await request(app).post('/auth/register').send({
      first_name: 'Pat',
      last_name: 'Owner',
      email: 'logo-owner@example.com',
      password: 'Testpass1!',
      company_name: 'Logo Co',
      slug: 'logo-co',
    });
    expect(register.status).toBe(201);
    const cookie = register.headers['set-cookie']?.[0] ?? '';

    const tmp = path.join(process.cwd(), 'uploads', 'logo-test.png');
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, Buffer.from('89504e470d0a1a0a', 'hex'));

    const upload = await request(app)
      .post('/company/logo')
      .set('Cookie', cookie)
      .attach('file', tmp, { filename: 'mark.png', contentType: 'image/png' });
    expect(upload.status).toBe(201);
    expect(upload.body.company.logo_url).toBe('/public/companies/logo-co/logo');

    const publicLogo = await request(app).get('/public/companies/logo-co/logo');
    expect(publicLogo.status).toBe(200);

    const other = await createTestCompany({ slug: 'other-logo' });
    const otherUser = await createTestUser({
      role: 'owner',
      company_id: other.id,
    });
    const otherHeaders = authHeaderFor(otherUser);
    const blocked = await request(app)
      .get('/public/companies/logo-co/logo')
      .set(otherHeaders);
    expect(blocked.status).toBe(200);

    fs.unlinkSync(tmp);
  });
});
