import jwt from 'jsonwebtoken';
import { pool } from '../../src/db';

export type TestUserRole = 'owner' | 'admin' | 'agent';

export type TestUser = {
  id: string;
  email: string;
  role: TestUserRole;
  first_name: string;
  last_name: string;
};

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
  }> = {}
): Promise<TestUser> {
  const first_name = overrides.first_name ?? 'Test';
  const last_name = overrides.last_name ?? 'User';
  const email =
    overrides.email ??
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const role = overrides.role ?? 'agent';
  const status = overrides.status ?? 'active';

  const { rows } = await pool.query(
    `
      INSERT INTO users (first_name, last_name, email, role, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, role, first_name, last_name
    `,
    [first_name, last_name, email, role, status]
  );

  return rows[0];
}

export function authHeaderFor(user: Pick<TestUser, 'id' | 'email' | 'role'>) {
  const secret = ensureJwtSecret();

  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
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
    headers: authHeaderFor(user),
  };
}
