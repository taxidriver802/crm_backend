/// <reference types="jest" />
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { uploadsRoot } from '../src/lib/uploadsDir';
import { app } from '../src/app';
import { pool } from '../src/db';
import { companyMonogram } from '../src/lib/monogram';
import { companyLogoPath, isBuiltinLogoKey } from '../src/lib/companyLogo';
import { buildInviteEmail } from '../src/lib/invite-email';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { authHeaderFor, createTestUser } from './helpers/auth';

jest.setTimeout(30000);

// One table for both copies of the rules: crm_qa/scripts/brand-check.ts runs
// the frontend's monogram over the same file.
const MONOGRAM_CASES: Array<[string, string]> = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'monogram-cases.json'), 'utf8')
);

describe('Joist brand: company monogram', () => {
  it.each(MONOGRAM_CASES)('%j resolves to %j', (name, expected) => {
    expect(companyMonogram(name)).toBe(expected);
  });
});

describe('Joist brand: Rooftop Realty keeps its own logo', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
  });

  it('the built-in company row points at its committed logo, which is served', async () => {
    const row = await pool.query(
      `SELECT logo_storage_key, mark_id FROM companies WHERE slug = 'rooftop'`
    );
    expect(row.rows[0].logo_storage_key).toBe('builtin/rooftop-realty.png');
    expect(fs.existsSync(companyLogoPath(row.rows[0].logo_storage_key))).toBe(true);

    const branding = await request(app).get('/public/companies/rooftop');
    expect(branding.body.company.logo_url).toBe('/public/companies/rooftop/logo');

    const logo = await request(app).get('/public/companies/rooftop/logo');
    expect(logo.status).toBe(200);
    expect(logo.headers['content-type']).toMatch(/image\/png/);
  });

  it('a new company has no logo and the default mark', async () => {
    const register = await request(app).post('/auth/register').send({
      first_name: 'Nia',
      last_name: 'Owner',
      email: 'nologo@example.com',
      password: 'Testpass1!',
      company_name: 'Northside Gutters LLC',
    });
    expect(register.status).toBe(201);
    expect(register.body.company.logo_url).toBeNull();
    expect(register.body.company.mark_id).toBe('product');

    const logo = await request(app).get(
      `/public/companies/${register.body.company.slug}/logo`
    );
    expect(logo.status).toBe(404);
  });

  it('clearing or replacing the built-in logo changes the row, not the committed file', async () => {
    const builtin = companyLogoPath('builtin/rooftop-realty.png');
    const before = fs.readFileSync(builtin);

    // createTestUser joins the built-in company (Rooftop Realty) by default.
    const user = await createTestUser({ role: 'owner' });
    const headers = authHeaderFor(user);

    const tmp = path.join(uploadsRoot(), 'brand-replace.png');
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, Buffer.from('89504e470d0a1a0a', 'hex'));
    const replaced = await request(app)
      .post('/company/logo')
      .set(headers)
      .attach('file', tmp, { filename: 'new.png', contentType: 'image/png' });
    expect(replaced.status).toBe(201);
    fs.unlinkSync(tmp);

    const key = (
      await pool.query(`SELECT logo_storage_key FROM companies WHERE slug = 'rooftop'`)
    ).rows[0].logo_storage_key;
    expect(isBuiltinLogoKey(key)).toBe(false);
    expect(fs.readFileSync(builtin).equals(before)).toBe(true);

    await pool.query(
      `UPDATE companies SET logo_storage_key = 'builtin/rooftop-realty.png' WHERE slug = 'rooftop'`
    );
    const cleared = await request(app)
      .patch('/company')
      .set(headers)
      .send({ clear_logo: true });
    expect(cleared.status).toBe(200);
    expect(cleared.body.company.logo_url).toBeNull();
    expect(fs.readFileSync(builtin).equals(before)).toBe(true);
  });

  it('a built-in key cannot reach outside its folder', () => {
    expect(() => companyLogoPath('builtin/../../src/app.ts')).toThrow();
    expect(() => companyLogoPath('builtin/')).toThrow();
  });

  it('the migration gives a database built before it the same logo', async () => {
    await pool.query(
      `UPDATE companies SET logo_storage_key = NULL, updated_at = created_at WHERE slug = 'rooftop'`
    );
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'sql', 'migrations', '0001_rooftop_realty_logo.sql'),
      'utf8'
    );
    await pool.query(sql);
    const after = await pool.query(
      `SELECT logo_storage_key FROM companies WHERE slug = 'rooftop'`
    );
    expect(after.rows[0].logo_storage_key).toBe('builtin/rooftop-realty.png');

    // An owner who removed the logo after the baseline keeps that choice.
    await pool.query(
      `UPDATE companies SET logo_storage_key = NULL, updated_at = now() + interval '1 minute' WHERE slug = 'rooftop'`
    );
    await pool.query(sql);
    const kept = await pool.query(
      `SELECT logo_storage_key FROM companies WHERE slug = 'rooftop'`
    );
    expect(kept.rows[0].logo_storage_key).toBeNull();
  });
});

describe('Joist brand: email attribution', () => {
  it('the invite email carries one muted Powered by Joist line and the company leads', () => {
    const message = buildInviteEmail({
      firstName: 'Alex',
      inviteUrl: 'https://app.example.com/accept-invite?token=abc',
      companyName: 'The Gutter Guys LLC',
      role: 'agent',
      markId: 'product',
    });
    expect(message.html.match(/Powered by Joist/g)).toHaveLength(1);
    expect(message.text).toContain('Powered by Joist');
    expect(message.html).toContain('>\n        GG\n');
    expect(message.html.indexOf('The Gutter Guys LLC')).toBeLessThan(
      message.html.indexOf('Powered by Joist')
    );
  });
});
