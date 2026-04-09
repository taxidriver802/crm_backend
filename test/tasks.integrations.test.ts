/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser } from './helpers/auth';

describe('Tasks integration', () => {
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
      email: 'sarah@example.com',
      phone: '555-111-2222',
      source: 'Referral',
      status: 'New',
      notes: 'Interested in roof inspection',
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    return res.body.lead;
  }

  async function createJob(headers: Record<string, string>, leadId: number) {
    const res = await request(app).post('/jobs').set(headers).send({
      lead_id: leadId,
      title: 'Roof inspection for Sarah',
      description: 'Initial workspace',
      status: 'New',
      address: '123 Main St',
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    return res.body.job;
  }

  it('creates a lead task and stores a TASK_ASSIGNED notification with lead context', async () => {
    const { user, headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    const createTask = await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'Call Sarah',
      description: 'Confirm appointment',
      due_date: new Date().toISOString(),
      status: 'Pending',
    });

    expect(createTask.status).toBe(201);
    expect(createTask.body.ok).toBe(true);
    expect(createTask.body.task.lead_id).toBe(lead.id);
    expect(createTask.body.task.job_id).toBeNull();

    const { rows } = await pool.query(
      `
        SELECT type, title, message, entity_type, entity_id, metadata
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
      `,
      [user.id]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('TASK_ASSIGNED');
    expect(rows[0].entity_type).toBe('lead');
    expect(rows[0].entity_id).toBe(lead.id);
    expect(rows[0].title).toBe('New task assigned');
    expect(rows[0].message).toContain('Call Sarah');
  });

  it('creates a job task and writes TASK_CREATED activity plus job-context notification', async () => {
    const { user, headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const createTask = await request(app).post('/tasks').set(headers).send({
      job_id: job.id,
      title: 'Inspect roof',
      description: 'Bring ladder',
      due_date: new Date().toISOString(),
      status: 'Pending',
    });

    expect(createTask.status).toBe(201);
    expect(createTask.body.ok).toBe(true);
    expect(createTask.body.task.job_id).toBe(job.id);

    const activityRes = await request(app)
      .get(`/jobs/${job.id}/activity`)
      .set(headers);

    expect(activityRes.status).toBe(200);
    expect(activityRes.body.ok).toBe(true);
    expect(
      activityRes.body.activity.some((a: any) => a.type === 'TASK_CREATED')
    ).toBe(true);

    const { rows } = await pool.query(
      `
        SELECT type, entity_type, entity_id, message
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
      `,
      [user.id]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('TASK_ASSIGNED');
    expect(rows[0].entity_type).toBe('job');
    expect(rows[0].entity_id).toBe(job.id);
    expect(rows[0].message).toContain('Inspect roof');
  });

  it('completing a job task creates TASK_COMPLETED notification and activity', async () => {
    const { user, headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const taskRes = await request(app).post('/tasks').set(headers).send({
      job_id: job.id,
      title: 'Gather measurements',
      due_date: new Date().toISOString(),
      status: 'Pending',
    });

    const taskId = taskRes.body.task.id;

    const completeRes = await request(app)
      .patch(`/tasks/${taskId}`)
      .set(headers)
      .send({ status: 'Completed' });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.ok).toBe(true);
    expect(completeRes.body.task.status).toBe('Completed');

    const notificationRows = await pool.query(
      `
        SELECT type, entity_type, entity_id, message
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
      `,
      [user.id]
    );

    const completionNotification = notificationRows.rows.find(
      (row) => row.type === 'TASK_COMPLETED'
    );

    expect(completionNotification).toBeTruthy();
    expect(completionNotification.entity_type).toBe('job');
    expect(completionNotification.entity_id).toBe(job.id);
    expect(completionNotification.message).toContain('Gather measurements');

    const activityRes = await request(app)
      .get(`/jobs/${job.id}/activity`)
      .set(headers);

    const completedActivity = activityRes.body.activity.find(
      (a: any) => a.type === 'TASK_COMPLETED'
    );

    expect(completedActivity).toBeTruthy();
    expect(completedActivity.title).toBe('Task completed');
  });

  it('filters tasks by linkedTo correctly', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'Lead task',
    });

    await request(app).post('/tasks').set(headers).send({
      job_id: job.id,
      title: 'Job task',
    });

    const leadTasks = await request(app)
      .get('/tasks')
      .query({ linkedTo: 'lead' })
      .set(headers);

    const jobTasks = await request(app)
      .get('/tasks')
      .query({ linkedTo: 'job' })
      .set(headers);

    expect(leadTasks.status).toBe(200);
    expect(jobTasks.status).toBe(200);

    expect(leadTasks.body.tasks).toHaveLength(1);
    expect(leadTasks.body.tasks[0].lead_id).toBe(lead.id);
    expect(leadTasks.body.tasks[0].job_id).toBeNull();

    expect(jobTasks.body.tasks).toHaveLength(1);
    expect(jobTasks.body.tasks[0].job_id).toBe(job.id);
    expect(jobTasks.body.tasks[0].lead_id).toBeNull();
  });
});
