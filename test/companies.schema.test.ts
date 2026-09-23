/// <reference types="jest" />
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import {
  createTestUser,
  DEFAULT_COMPANY_ID,
  DEFAULT_COMPANY_SLUG,
} from './helpers/auth';

describe('Phase 20 companies schema', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
  });

  it('seeds a default company used by new users', async () => {
    const company = await pool.query(
      `SELECT id, name, slug, palette_id FROM companies WHERE slug = $1`,
      [DEFAULT_COMPANY_SLUG]
    );
    expect(company.rowCount).toBe(1);
    expect(company.rows[0].id).toBe(DEFAULT_COMPANY_ID);
    expect(company.rows[0].palette_id).toBe('rooftop');

    const user = await createTestUser({ role: 'owner' });
    expect(user.company_id).toBe(DEFAULT_COMPANY_ID);
  });

  it('allows the same email in two companies and rejects duplicates in one', async () => {
    const other = await pool.query(
      `
      INSERT INTO companies (name, slug, palette_id)
      VALUES ('Other Roofing', 'other-roofing', 'azure')
      RETURNING id
      `
    );
    const otherId = other.rows[0].id as string;
    const email = 'shared@example.com';

    await createTestUser({ email, role: 'owner', company_id: DEFAULT_COMPANY_ID });
    await createTestUser({ email, role: 'owner', company_id: otherId });

    await expect(
      createTestUser({ email, role: 'agent', company_id: DEFAULT_COMPANY_ID })
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('scopes estimate template names per company', async () => {
    const other = await pool.query(
      `
      INSERT INTO companies (name, slug, palette_id)
      VALUES ('Northside', 'northside', 'slate')
      RETURNING id
      `
    );
    const otherId = other.rows[0].id as string;
    const name = 'Phase 20 Template';

    await pool.query(
      `INSERT INTO estimate_templates (name, company_id) VALUES ($1, $2)`,
      [name, DEFAULT_COMPANY_ID]
    );
    await pool.query(
      `INSERT INTO estimate_templates (name, company_id) VALUES ($1, $2)`,
      [name, otherId]
    );

    await expect(
      pool.query(
        `INSERT INTO estimate_templates (name, company_id) VALUES ($1, $2)`,
        [name, DEFAULT_COMPANY_ID]
      )
    ).rejects.toMatchObject({ code: '23505' });
  });
});
