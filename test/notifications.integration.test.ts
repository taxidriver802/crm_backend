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

  async function completeTask(headers: Record<string, string>, leadId: number, title: string) {
    const taskRes = await request(app).post('/tasks').set(headers).send({
      lead_id: leadId,
      title,
      due_date: new Date().toISOString(),
      status: 'Pending',
    });
    expect(taskRes.status).toBe(201);
    const done = await request(app)
      .patch(`/tasks/${taskRes.body.task.id}`)
      .set(headers)
      .send({ status: 'Completed' });
    expect(done.status).toBe(200);
  }

  it('lists notifications and returns unread count', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    await completeTask(headers, lead.id, 'Call Sarah');
    await completeTask(headers, lead.id, 'Send photos');

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

    await completeTask(headers, lead.id, 'Call Sarah');

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

    await completeTask(headers, lead.id, 'Call Sarah');
    await completeTask(headers, lead.id, 'Send photos');

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

    await completeTask(headers, lead.id, 'Call Sarah');

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

  it('paginates the saved notification history', async () => {
    const { user, headers } = await createAuthedUser('agent');

    for (let index = 0; index < 12; index += 1) {
      await pool.query(
        `
          INSERT INTO notifications (
            user_id, company_id, type, title, message, created_at
          )
          VALUES (
            $1, $2, 'TASK_ASSIGNED', $3, $4,
            CURRENT_TIMESTAMP - ($5::text || ' minutes')::interval
          )
        `,
        [
          user.id,
          user.company_id,
          `Notice ${index + 1}`,
          `Message ${index + 1}`,
          String(index),
        ]
      );
    }

    const first = await request(app)
      .get('/notifications?limit=5&offset=0')
      .set(headers);

    expect(first.status).toBe(200);
    expect(first.body.notifications).toHaveLength(5);
    expect(first.body.total).toBe(12);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.notifications[0].title).toBe('Notice 1');

    const second = await request(app)
      .get('/notifications?limit=5&offset=5')
      .set(headers);

    expect(second.status).toBe(200);
    expect(second.body.notifications).toHaveLength(5);
    expect(second.body.hasMore).toBe(true);

    const seen = new Set([
      ...first.body.notifications.map((row: { id: number }) => row.id),
      ...second.body.notifications.map((row: { id: number }) => row.id),
    ]);
    expect(seen.size).toBe(10);

    const unread = await request(app)
      .get('/notifications?limit=5&offset=0&unreadOnly=true')
      .set(headers);

    expect(unread.status).toBe(200);
    expect(unread.body.total).toBe(12);
    expect(unread.body.notifications.every((row: { read_at: string | null }) => !row.read_at)).toBe(
      true
    );
  });
});
