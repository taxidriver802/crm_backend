import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { resetDb } from './helpers/db';
import { ensureSchema } from './helpers/setup';

jest.setTimeout(30000);

afterAll(async () => {
  try {
    await pool.end();
  } catch {
    /* already closed */
  }
});

describe('workspace preferences', () => {
  beforeAll(async () => {
    await ensureSchema();
    await resetDb();
  });

  it('saves density, desk, and job pane on the user', async () => {
    const registered = await request(app).post('/auth/register').send({
      first_name: 'Desk',
      last_name: 'Owner',
      email: `desk-${Date.now()}@test.com`,
      password: 'Testpass1!',
      company_name: 'Desk Co',
    });
    const cookie = registered.headers['set-cookie']?.[0] ?? '';

    const initial = await request(app).get('/auth/me').set('Cookie', cookie);
    expect(initial.status).toBe(200);
    expect(initial.body.user.ui_preferences).toEqual({
      density: 'comfortable',
      desk: 'queue',
      job_pane: 'work',
    });

    const saved = await request(app)
      .patch('/auth/preferences')
      .set('Cookie', cookie)
      .send({ density: 'compact', desk: 'money', job_pane: 'money' });
    expect(saved.status).toBe(200);
    expect(saved.body.ui_preferences.density).toBe('compact');

    const again = await request(app).get('/auth/me').set('Cookie', cookie);
    expect(again.body.user.ui_preferences).toEqual({
      density: 'compact',
      desk: 'money',
      job_pane: 'money',
    });

    const partial = await request(app)
      .patch('/auth/preferences')
      .set('Cookie', cookie)
      .send({ job_pane: 'site' });
    expect(partial.body.ui_preferences).toEqual({
      density: 'compact',
      desk: 'money',
      job_pane: 'site',
    });
  });

  it('rejects an unknown pane', async () => {
    const registered = await request(app).post('/auth/register').send({
      first_name: 'Bad',
      last_name: 'Pane',
      email: `pane-${Date.now()}@test.com`,
      password: 'Testpass1!',
      company_name: 'Pane Co',
    });
    const cookie = registered.headers['set-cookie']?.[0] ?? '';
    const res = await request(app)
      .patch('/auth/preferences')
      .set('Cookie', cookie)
      .send({ job_pane: 'kanban' });
    expect(res.status).toBe(400);
  });
});
