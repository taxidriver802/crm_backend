/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser } from './helpers/auth';

describe('Files integration', () => {
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

    expect(res.status).toBe(201);
    return res.body.lead;
  }

  async function createJob(headers: Record<string, string>, leadId: number) {
    const res = await request(app).post('/jobs').set(headers).send({
      lead_id: leadId,
      title: 'Roof inspection for Sarah',
      address: '123 Main St',
      status: 'New',
    });

    expect(res.status).toBe(201);
    return res.body.job;
  }

  it('uploads a lead file and creates a lead-context FILE_UPLOADED notification', async () => {
    const { user, headers } = await createAuthedUser('owner');
    const lead = await createLead(headers);

    const uploadRes = await request(app)
      .post('/files')
      .set(headers)
      .field('lead_id', String(lead.id))
      .attach('file', Buffer.from('lead file content'), 'lead-note.txt');

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.ok).toBe(true);
    expect(uploadRes.body.file.lead_id).toBe(lead.id);
    expect(uploadRes.body.file.job_id).toBeNull();

    const { rows } = await pool.query(
      `
        SELECT type, entity_type, entity_id, message
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
      `,
      [user.id]
    );

    expect(rows[0].type).toBe('FILE_UPLOADED');
    expect(rows[0].entity_type).toBe('lead');
    expect(rows[0].entity_id).toBe(lead.id);
    expect(rows[0].message).toContain('uploaded to a lead');
  });

  it('uploads a job file and creates both FILE_UPLOADED notification and job activity', async () => {
    const { user, headers } = await createAuthedUser('owner');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const uploadRes = await request(app)
      .post('/files')
      .set(headers)
      .field('job_id', String(job.id))
      .attach('file', Buffer.from('job file content'), 'roof-photo.jpg');

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.ok).toBe(true);
    expect(uploadRes.body.file.job_id).toBe(job.id);

    const notificationRows = await pool.query(
      `
        SELECT type, entity_type, entity_id
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
      `,
      [user.id]
    );

    expect(notificationRows.rows[0].type).toBe('FILE_UPLOADED');
    expect(notificationRows.rows[0].entity_type).toBe('job');
    expect(notificationRows.rows[0].entity_id).toBe(job.id);

    const activityRes = await request(app)
      .get(`/jobs/${job.id}/activity`)
      .set(headers);

    const fileActivity = activityRes.body.activity.find(
      (a: any) => a.type === 'FILE_UPLOADED'
    );

    expect(fileActivity).toBeTruthy();
    expect(fileActivity.title).toBe('File uploaded');
  });

  it('uploads a global file and stores a generic FILE_UPLOADED notification', async () => {
    const { user, headers } = await createAuthedUser('owner');

    const uploadRes = await request(app)
      .post('/files')
      .set(headers)
      .attach('file', Buffer.from('global file content'), 'general-doc.txt');

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.ok).toBe(true);
    expect(uploadRes.body.file.lead_id).toBeNull();
    expect(uploadRes.body.file.job_id).toBeNull();

    const { rows } = await pool.query(
      `
        SELECT type, entity_type, entity_id, message
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
      `,
      [user.id]
    );

    expect(rows[0].type).toBe('FILE_UPLOADED');
    expect(rows[0].entity_type).toBeNull();
    expect(rows[0].entity_id).toBeNull();
    expect(rows[0].message).toContain('uploaded to files');
  });

  it('blocks non-admin users from deleting files', async () => {
    const owner = await createAuthedUser('owner');
    const agent = await createAuthedUser('agent');
    const lead = await createLead(owner.headers);

    const uploadRes = await request(app)
      .post('/files')
      .set(owner.headers)
      .field('lead_id', String(lead.id))
      .attach('file', Buffer.from('lead file content'), 'lead-note.txt');

    const fileId = uploadRes.body.file.id;

    const deleteRes = await request(app)
      .delete(`/files/${fileId}`)
      .set(agent.headers);

    expect(deleteRes.status).toBe(403);
    expect(deleteRes.body.ok).toBe(false);
  });

  it('allows owner delete and records FILE_DELETED activity for job files', async () => {
    const { headers } = await createAuthedUser('owner');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const uploadRes = await request(app)
      .post('/files')
      .set(headers)
      .field('job_id', String(job.id))
      .attach('file', Buffer.from('job file content'), 'roof-photo.jpg');

    const fileId = uploadRes.body.file.id;

    const deleteRes = await request(app)
      .delete(`/files/${fileId}`)
      .set(headers);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);

    const activityRes = await request(app)
      .get(`/jobs/${job.id}/activity`)
      .set(headers);

    const deletedActivity = activityRes.body.activity.find(
      (a: any) => a.type === 'FILE_DELETED'
    );

    expect(deletedActivity).toBeTruthy();
    expect(deletedActivity.title).toBe('File deleted');
  });
});
