/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { resetDb } from './helpers/db';
import { ensureSchema } from './helpers/setup';
import { createAuthedUser } from './helpers/auth';

describe('Auth + Dashboard smoke test', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates lead/task and dashboard responds for authenticated user', async () => {
    const { headers } = await createAuthedUser('agent');

    const leadRes = await request(app).post('/leads').set(headers).send({
      first_name: 'Test',
      last_name: 'Lead',
      source: 'Test',
      status: 'New',
    });

    expect([200, 201]).toContain(leadRes.status);
    expect(leadRes.body.ok).toBe(true);

    const leadId = leadRes.body.lead.id;

    const taskRes = await request(app).post('/tasks').set(headers).send({
      lead_id: leadId,
      title: 'Test Task',
      due_date: new Date().toISOString(),
    });

    expect([200, 201]).toContain(taskRes.status);
    expect(taskRes.body.ok).toBe(true);

    const dash = await request(app).get('/dashboard').set(headers);
    expect([200, 201]).toContain(dash.status);
    expect(dash.body.ok).toBe(true);
    expect(dash.body.jobs).toBeDefined();
    expect(typeof dash.body.jobs.total).toBe('number');
    expect(Array.isArray(dash.body.jobs.byStatus)).toBe(true);
    expect(dash.body.estimates).toBeDefined();
    expect(typeof dash.body.estimates.total).toBe('number');
    expect(Array.isArray(dash.body.estimates.byStatus)).toBe(true);
    expect(dash.body.tasks?.counts?.overdue_on_jobs).toBeDefined();
    expect(typeof dash.body.tasks.counts.overdue_on_jobs).toBe('number');
  });

  it('blocks dashboard when unauthenticated', async () => {
    const dash = await request(app).get('/dashboard');
    expect(dash.status).toBe(401);
  });
});
