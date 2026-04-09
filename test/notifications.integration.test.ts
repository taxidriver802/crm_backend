/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser } from './helpers/auth';

describe('Notifications integration', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  async function createLead(headers: Record<string, string>) {
    const res = await request(app).post('/leads').set(headers).send({
      first_name: 'Sarah',
      last_name: 'Johnson',
      source: 'Referral',
      status: 'New',
    });

    return res.body.lead;
  }

  it('lists notifications and returns unread count', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    const taskRes = await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'Call Sarah',
      due_date: new Date().toISOString(),
      status: 'Pending',
    });

    await request(app)
      .patch(`/tasks/${taskRes.body.task.id}`)
      .set(headers)
      .send({ status: 'Completed' });

    const listRes = await request(app).get('/notifications').set(headers);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.notifications)).toBe(true);
    expect(listRes.body.notifications.length).toBeGreaterThanOrEqual(2);

    const countRes = await request(app)
      .get('/notifications/unread-count')
      .set(headers);

    expect(countRes.status).toBe(200);
    expect(countRes.body.count).toBeGreaterThanOrEqual(2);
  });

  it('marks a notification as read and reduces unread count', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'Call Sarah',
      due_date: new Date().toISOString(),
      status: 'Pending',
    });

    const listRes = await request(app).get('/notifications').set(headers);
    const notificationId = listRes.body.notifications[0].id;

    const readRes = await request(app)
      .patch(`/notifications/${notificationId}/read`)
      .set(headers);

    expect(readRes.status).toBe(200);
    expect(readRes.body.notification.id).toBe(notificationId);
    expect(readRes.body.notification.read_at).toBeTruthy();

    const countRes = await request(app)
      .get('/notifications/unread-count')
      .set(headers);

    expect(countRes.status).toBe(200);
    expect(countRes.body.count).toBe(0);
  });

  it('marks all as read and deletes all read notifications', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    const taskRes = await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'Call Sarah',
      due_date: new Date().toISOString(),
      status: 'Pending',
    });

    await request(app)
      .patch(`/tasks/${taskRes.body.task.id}`)
      .set(headers)
      .send({ status: 'Completed' });

    const readAllRes = await request(app)
      .patch('/notifications/read-all')
      .set(headers);

    expect(readAllRes.status).toBe(200);
    expect(readAllRes.body.updated).toBeGreaterThanOrEqual(2);

    const deleteReadRes = await request(app)
      .delete('/notifications/read')
      .set(headers);

    expect(deleteReadRes.status).toBe(200);
    expect(deleteReadRes.body.deleted).toBeGreaterThanOrEqual(2);

    const listRes = await request(app).get('/notifications').set(headers);
    expect(listRes.body.notifications).toHaveLength(0);
  });

  it('deletes a single notification', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'Call Sarah',
      status: 'Pending',
    });

    const listRes = await request(app).get('/notifications').set(headers);
    const notificationId = listRes.body.notifications[0].id;

    const deleteRes = await request(app)
      .delete(`/notifications/${notificationId}`)
      .set(headers);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.deletedId).toBe(notificationId);

    const after = await pool.query(
      `SELECT id FROM notifications WHERE id = $1`,
      [notificationId]
    );

    expect(after.rows).toHaveLength(0);
  });
});
