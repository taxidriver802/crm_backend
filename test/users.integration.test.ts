/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser } from './helpers/auth';

async function insertInvitedUser(email: string) {
  const { rows } = await pool.query(
    `
    INSERT INTO users (
      first_name,
      last_name,
      email,
      role,
      status,
      invite_token_hash,
      invite_expires_at,
      invited_at
    )
    VALUES ($1, $2, $3, 'agent', 'invited', $4, NOW() + interval '7 days', NOW())
    RETURNING id
    `,
    ['Invited', 'User', email, 'a'.repeat(64)]
  );
  return rows[0].id as string;
}

describe('Users invite actions', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it('POST /users/invite/:id/resend loads user by UUID and returns invite_url', async () => {
    const { headers } = await createAuthedUser('owner');
    const invitedId = await insertInvitedUser(`inv-${Date.now()}@example.com`);

    const res = await request(app)
      .post(`/users/invite/${invitedId}/resend`)
      .set(headers)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.invite_url).toMatch(/\/accept-invite\?token=/);
    expect(res.body.user.id).toBe(invitedId);
    expect(res.body.user.invite_token_hash).toBeTruthy();
  });

  it('POST /users/invite/:id/resend returns 404 when id is not an invited user', async () => {
    const { headers } = await createAuthedUser('owner');
    const { user: active } = await createAuthedUser('agent');

    const res = await request(app)
      .post(`/users/invite/${active.id}/resend`)
      .set(headers)
      .send();

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('POST /users/invite/:id/revoke clears invite and blocks validate', async () => {
    const { headers } = await createAuthedUser('owner');
    const invitedId = await insertInvitedUser(`rev-${Date.now()}@example.com`);

    const revoke = await request(app)
      .post(`/users/invite/${invitedId}/revoke`)
      .set(headers)
      .send();

    expect(revoke.status).toBe(200);
    expect(revoke.body.ok).toBe(true);

    const { rows } = await pool.query(
      `SELECT invite_revoked_at, invite_token_hash FROM users WHERE id = $1`,
      [invitedId]
    );
    expect(rows[0].invite_revoked_at).toBeTruthy();
    expect(rows[0].invite_token_hash).toBeNull();
  });

  it('POST /users/invite/:id/resend works after revoke (re-issues token)', async () => {
    const { headers } = await createAuthedUser('owner');
    const invitedId = await insertInvitedUser(
      `reissue-${Date.now()}@example.com`
    );

    await request(app)
      .post(`/users/invite/${invitedId}/revoke`)
      .set(headers)
      .send();

    const res = await request(app)
      .post(`/users/invite/${invitedId}/resend`)
      .set(headers)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.invite_url).toMatch(/\/accept-invite\?token=/);
  });
});
