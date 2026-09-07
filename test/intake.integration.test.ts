/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser } from './helpers/auth';
import { resetIntakeRateLimit } from '../src/lib/intakeRateLimit';

describe('Public intake integration', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
    resetIntakeRateLimit();
  });

  it('lets owner generate a link and public submit creates lead, note, and notification', async () => {
    const { user, headers } = await createAuthedUser('owner');

    const gen = await request(app).post('/intake/generate').set(headers);
    expect(gen.status).toBe(201);
    expect(gen.body.token).toBeTruthy();
    expect(gen.body.public_url).toContain('/public/intake/');

    const token = gen.body.token;
    const submit = await request(app)
      .post(`/public/intake/${token}`)
      .send({
        first_name: 'Marcus',
        last_name: 'Nelson',
        email: 'marcus@example.com',
        phone: '555-0100',
        service_type: 'Replacement',
        preferred_contact_method: 'Call',
        message: 'Need a full roof replacement quote.',
      });

    expect(submit.status).toBe(201);
    expect(submit.body.ok).toBe(true);

    const leads = await pool.query(
      `SELECT * FROM leads WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
      [user.id]
    );
    expect(leads.rows[0].first_name).toBe('Marcus');
    expect(leads.rows[0].source).toBe('Website');
    expect(leads.rows[0].status).toBe('New');
    expect(leads.rows[0].service_type).toBe('Replacement');

    const notes = await pool.query(
      `SELECT * FROM notes WHERE entity_type = 'lead' AND entity_id = $1`,
      [leads.rows[0].id]
    );
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0].direction).toBe('inbound');
    expect(notes.rows[0].body).toContain('full roof replacement');

    const notifs = await pool.query(
      `SELECT * FROM notifications WHERE user_id = $1 AND type = 'LEAD_CREATED'`,
      [user.id]
    );
    expect(notifs.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('honeypot submissions succeed without writing a lead', async () => {
    const { headers } = await createAuthedUser('owner');
    const gen = await request(app).post('/intake/generate').set(headers);
    const token = gen.body.token;

    const submit = await request(app)
      .post(`/public/intake/${token}`)
      .send({
        first_name: 'Bot',
        last_name: 'Spam',
        email: 'bot@example.com',
        company_website: 'http://spam.example',
      });

    expect(submit.status).toBe(201);
    expect(submit.body.ignored).toBe(true);

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM leads`);
    expect(rows[0].n).toBe(0);
  });

  it('returns 404 for unknown token and 400 when contact is missing', async () => {
    const { headers } = await createAuthedUser('owner');
    const gen = await request(app).post('/intake/generate').set(headers);

    const bad = await request(app)
      .post('/public/intake/not-a-real-token')
      .send({
        first_name: 'A',
        last_name: 'B',
        email: 'a@example.com',
      });
    expect(bad.status).toBe(404);

    const missing = await request(app)
      .post(`/public/intake/${gen.body.token}`)
      .send({
        first_name: 'A',
        last_name: 'B',
      });
    expect(missing.status).toBe(400);
  });

  it('forbids agents from generating intake links', async () => {
    const { headers } = await createAuthedUser('agent');
    const res = await request(app).post('/intake/generate').set(headers);
    expect(res.status).toBe(403);
  });

  it('rate limits repeated public posts from the same IP', async () => {
    const { headers } = await createAuthedUser('owner');
    const gen = await request(app).post('/intake/generate').set(headers);
    const token = gen.body.token;

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post(`/public/intake/${token}`)
        .send({
          first_name: 'Rate',
          last_name: `User${i}`,
          email: `rate${i}@example.com`,
        });
      expect(res.status).toBe(201);
    }

    const blocked = await request(app)
      .post(`/public/intake/${token}`)
      .send({
        first_name: 'Rate',
        last_name: 'Blocked',
        email: 'blocked@example.com',
      });
    expect(blocked.status).toBe(429);
  });

  it('regenerate invalidates the previous token', async () => {
    const { headers } = await createAuthedUser('owner');
    const first = await request(app).post('/intake/generate').set(headers);
    const oldToken = first.body.token;

    const second = await request(app).post('/intake/regenerate').set(headers);
    expect(second.status).toBe(200);
    expect(second.body.token).not.toBe(oldToken);

    const oldSubmit = await request(app)
      .post(`/public/intake/${oldToken}`)
      .send({
        first_name: 'Old',
        last_name: 'Link',
        email: 'old@example.com',
      });
    expect(oldSubmit.status).toBe(404);

    const newSubmit = await request(app)
      .post(`/public/intake/${second.body.token}`)
      .send({
        first_name: 'New',
        last_name: 'Link',
        email: 'new@example.com',
      });
    expect(newSubmit.status).toBe(201);
  });
});
