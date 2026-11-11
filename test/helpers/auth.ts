import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../../src/db';

export type TestUserRole = 'owner' | 'admin' | 'agent';

export type TestUser = {
  id: string;
  email: string;
  role: TestUserRole;
  first_name: string;
  last_name: string;
  company_id: string;
};

export const DEFAULT_COMPANY_ID = 'c0000000-0000-4000-8000-000000000001';
export const DEFAULT_COMPANY_SLUG = 'rooftop';

function ensureJwtSecret() {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret';
  }

  return process.env.JWT_SECRET;
}

export async function createTestUser(
  overrides: Partial<{
    first_name: string;
    last_name: string;
    email: string;
    role: TestUserRole;
    status: 'invited' | 'active' | 'disabled';
    company_id: string;
  }> = {}
): Promise<TestUser> {
  const first_name = overrides.first_name ?? 'Test';
  const last_name = overrides.last_name ?? 'User';
  const email =
    overrides.email ??
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const role = overrides.role ?? 'agent';
  const status = overrides.status ?? 'active';
  const company_id = overrides.company_id ?? DEFAULT_COMPANY_ID;

  const { rows } = await pool.query(
    `
      INSERT INTO users (first_name, last_name, email, role, status, company_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, email, role, first_name, last_name, company_id
    `,
    [first_name, last_name, email, role, status, company_id]
  );

  return rows[0];
}

/**
 * Signs a test request in: a real user_sessions row, and a token naming it,
 * as a sign-in would make (requireAuth refuses a token without a live
 * session).
 */
export async function authHeaderFor(
  user: Pick<TestUser, 'id' | 'email' | 'role' | 'company_id'>
) {
  const secret = ensureJwtSecret();
  const sid = crypto.randomUUID();

  await pool.query(
    `INSERT INTO user_sessions (id, user_id, company_id, expires_at)
     VALUES ($1, $2, $3, now() + interval '7 days')`,
    [sid, user.id, user.company_id]
  );

  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      companyId: user.company_id,
      sid,
    },
    secret
  );

  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function createAuthedUser(
  role: TestUserRole = 'agent'
): Promise<{ user: TestUser; headers: Record<string, string> }> {
  const user = await createTestUser({ role });
  return {
    user,
    headers: await authHeaderFor(user),
  };
}

export async function createTestCompany(
  overrides: Partial<{ name: string; slug: string; palette_id: string }> = {}
) {
  const name = overrides.name ?? 'Other Company';
  const slug =
    overrides.slug ?? `co-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const palette_id = overrides.palette_id ?? 'azure';
  const { rows } = await pool.query(
    `
      INSERT INTO companies (name, slug, palette_id)
      VALUES ($1, $2, $3)
      RETURNING id, name, slug, palette_id
    `,
    [name, slug, palette_id]
  );
  return rows[0] as {
    id: string;
    name: string;
    slug: string;
    palette_id: string;
  };
}
