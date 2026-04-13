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

  it('GET /tasks/summary includes overdue_on_jobs count', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const past = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    await request(app).post('/tasks').set(headers).send({
      job_id: job.id,
      title: 'Overdue on job',
      due_date: past,
      status: 'Pending',
    });

    await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'Overdue on lead only',
      due_date: past,
      status: 'Pending',
    });

    const sum = await request(app).get('/tasks/summary').set(headers);

    expect(sum.status).toBe(200);
    expect(sum.body.counts.overdue_on_jobs).toBe(1);
    expect(sum.body.counts.overdue).toBe(2);
  });

  it('GET /tasks?duePreset=overdue returns only overdue incomplete tasks', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'Late',
      due_date: past,
      status: 'Pending',
    });

    await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'Future',
      due_date: future,
      status: 'Pending',
    });

    const res = await request(app)
      .get('/tasks')
      .query({ duePreset: 'overdue' })
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].title).toBe('Late');
  });

  it('GET /tasks accepts due=today and range=7 aliases', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    const today = new Date();
    today.setUTCHours(15, 0, 0, 0);

    await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'Due today task',
      due_date: today.toISOString(),
      status: 'Pending',
    });

    const aliasToday = await request(app)
      .get('/tasks')
      .query({ due: 'today' })
      .set(headers);

    expect(aliasToday.status).toBe(200);
    expect(aliasToday.body.tasks.length).toBeGreaterThanOrEqual(1);
    expect(
      aliasToday.body.tasks.some(
        (t: { title: string }) => t.title === 'Due today task'
      )
    ).toBe(true);

    const in7 = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'Within seven days',
      due_date: in7,
      status: 'Pending',
    });

    const aliasRange = await request(app)
      .get('/tasks')
      .query({ range: '7' })
      .set(headers);

    expect(aliasRange.status).toBe(200);
    expect(
      aliasRange.body.tasks.some(
        (t: { title: string }) => t.title === 'Within seven days'
      )
    ).toBe(true);
  });

  it('GET /tasks?duePreset=overdue&linkedTo=job limits to job-linked overdue', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await request(app).post('/tasks').set(headers).send({
      job_id: job.id,
      title: 'Job overdue',
      due_date: past,
      status: 'Pending',
    });

    await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'Lead overdue',
      due_date: past,
      status: 'Pending',
    });

    const res = await request(app)
      .get('/tasks')
      .query({ duePreset: 'overdue', linkedTo: 'job' })
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].title).toBe('Job overdue');
  });

  it('GET /tasks supports dateFrom/dateTo range filtering', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    const inMay = new Date('2026-05-15T12:00:00.000Z').toISOString();
    const inJune = new Date('2026-06-10T12:00:00.000Z').toISOString();

    await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'May task',
      due_date: inMay,
      status: 'Pending',
    });

    await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'June task',
      due_date: inJune,
      status: 'Pending',
    });

    const res = await request(app)
      .get('/tasks')
      .query({
        dateFrom: '2026-05-01T00:00:00.000Z',
        dateTo: '2026-05-31T23:59:59.999Z',
      })
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].title).toBe('May task');
  });

  it('owner can view team tasks with view=all', async () => {
    const owner = await createAuthedUser('owner');
    const agent = await createAuthedUser('agent');

    const lead = await createLead(agent.headers);
    await request(app).post('/tasks').set(agent.headers).send({
      lead_id: lead.id,
      title: 'Agent owned task',
      status: 'Pending',
    });

    const ownerMine = await request(app).get('/tasks').set(owner.headers);
    expect(ownerMine.status).toBe(200);
    expect(ownerMine.body.tasks).toHaveLength(0);

    const ownerTeam = await request(app)
      .get('/tasks')
      .query({ view: 'all' })
      .set(owner.headers);
    expect(ownerTeam.status).toBe(200);
    expect(
      ownerTeam.body.tasks.some(
        (task: { title: string }) => task.title === 'Agent owned task'
      )
    ).toBe(true);
  });

  it('agent cannot assign task to other user', async () => {
    const agent = await createAuthedUser('agent');
    const teammate = await createAuthedUser('agent');
    const lead = await createLead(agent.headers);

    const taskRes = await request(app).post('/tasks').set(agent.headers).send({
      lead_id: lead.id,
      title: 'Assignment protected task',
      status: 'Pending',
    });

    const patchRes = await request(app)
      .patch(`/tasks/${taskRes.body.task.id}`)
      .set(agent.headers)
      .send({ assigned_to: teammate.user.id });

    expect(patchRes.status).toBe(403);
  });
});
