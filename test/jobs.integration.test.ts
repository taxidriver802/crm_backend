/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser } from './helpers/auth';

describe('Jobs integration', () => {
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

  it('creates a job and records JOB_CREATED activity', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    const jobRes = await request(app).post('/jobs').set(headers).send({
      lead_id: lead.id,
      title: 'Roof inspection for Sarah',
      description: 'Initial workspace',
      address: '123 Main St',
      status: 'New',
    });

    expect(jobRes.status).toBe(201);
    expect(jobRes.body.ok).toBe(true);

    const jobId = jobRes.body.job.id;

    const activityRes = await request(app)
      .get(`/jobs/${jobId}/activity`)
      .set(headers);

    expect(activityRes.status).toBe(200);
    expect(activityRes.body.ok).toBe(true);
    expect(activityRes.body.activity).toHaveLength(1);
    expect(activityRes.body.activity[0].type).toBe('JOB_CREATED');
    expect(activityRes.body.activity[0].entity_type).toBe('job');
    expect(activityRes.body.activity[0].entity_id).toBe(jobId);
  });

  it('changing job status records JOB_STATUS_CHANGED activity', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    const jobRes = await request(app).post('/jobs').set(headers).send({
      lead_id: lead.id,
      title: 'Roof inspection for Sarah',
      status: 'New',
      address: '123 Main St',
    });

    const jobId = jobRes.body.job.id;

    const patchRes = await request(app)
      .patch(`/jobs/${jobId}`)
      .set(headers)
      .send({ status: 'Contacted' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.ok).toBe(true);
    expect(patchRes.body.job.status).toBe('Contacted');

    const activityRes = await request(app)
      .get(`/jobs/${jobId}/activity`)
      .set(headers);

    const statusActivity = activityRes.body.activity.find(
      (a: any) => a.type === 'JOB_STATUS_CHANGED'
    );

    expect(statusActivity).toBeTruthy();
    expect(statusActivity.title).toBe('Status changed');
    expect(statusActivity.message).toBe('New → Contacted');
    expect(
      new Date(patchRes.body.job.status_changed_at).getTime()
    ).toBeGreaterThan(new Date(jobRes.body.job.status_changed_at).getTime() - 1);
  });

  it('does not move status_changed_at on title-only updates', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const jobRes = await request(app).post('/jobs').set(headers).send({
      lead_id: lead.id,
      title: 'Roof inspection for Sarah',
      status: 'New',
      address: '123 Main St',
    });
    const jobId = jobRes.body.job.id;

    await pool.query(
      `UPDATE jobs SET status_changed_at = NOW() - INTERVAL '2 days' WHERE id = $1`,
      [jobId]
    );

    const beforeRes = await request(app).get(`/jobs/${jobId}`).set(headers);
    const before = new Date(beforeRes.body.job.status_changed_at).getTime();

    const titlePatch = await request(app)
      .patch(`/jobs/${jobId}`)
      .set(headers)
      .send({ title: 'Updated title' });

    expect(titlePatch.status).toBe(200);
    expect(new Date(titlePatch.body.job.status_changed_at).getTime()).toBe(before);
    expect(titlePatch.body.job.days_in_status).toBeGreaterThanOrEqual(2);
  });

  it('computes job health from overdue tasks, sent estimates, and closed status', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    const greenJob = await request(app).post('/jobs').set(headers).send({
      lead_id: lead.id,
      title: 'Healthy job',
      status: 'New',
    });
    expect(greenJob.body.job.health.level).toBe('green');
    expect(greenJob.body.job.days_in_status).toBe(0);

    const yellowJob = await request(app).post('/jobs').set(headers).send({
      lead_id: lead.id,
      title: 'Waiting on estimate',
      status: 'New',
    });
    const estimate = await request(app).post('/estimates').set(headers).send({
      job_id: yellowJob.body.job.id,
      title: 'Quote',
    });
    await request(app)
      .patch(`/estimates/${estimate.body.estimate.id}`)
      .set(headers)
      .send({ status: 'Sent' });
    const yellowGet = await request(app)
      .get(`/jobs/${yellowJob.body.job.id}`)
      .set(headers);
    expect(yellowGet.body.job.health.level).toBe('yellow');
    expect(yellowGet.body.job.health.reasons).toContain(
      'Estimate awaiting response'
    );

    const redJob = await request(app).post('/jobs').set(headers).send({
      lead_id: lead.id,
      title: 'Overdue job',
      status: 'New',
    });
    await request(app).post('/tasks').set(headers).send({
      job_id: redJob.body.job.id,
      title: 'Late task',
      due_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });
    const redGet = await request(app)
      .get(`/jobs/${redJob.body.job.id}`)
      .set(headers);
    expect(redGet.body.job.health.level).toBe('red');
    expect(redGet.body.job.health.reasons).toContain('Overdue tasks');

    const closedJob = await request(app).post('/jobs').set(headers).send({
      lead_id: lead.id,
      title: 'Closed job',
      status: 'New',
    });
    await request(app).post('/tasks').set(headers).send({
      job_id: closedJob.body.job.id,
      title: 'Still overdue',
      due_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });
    const closedPatch = await request(app)
      .patch(`/jobs/${closedJob.body.job.id}`)
      .set(headers)
      .send({ status: 'Closed Won' });
    expect(closedPatch.body.job.health.level).toBe('none');
  });

  it('filters jobs by leadId', async () => {
    const { headers } = await createAuthedUser('agent');
    const leadA = await createLead(headers);
    const leadBRes = await request(app).post('/leads').set(headers).send({
      first_name: 'Mike',
      last_name: 'Chen',
      source: 'Website',
      status: 'New',
    });
    expect(leadBRes.status).toBe(201);
    const leadB = leadBRes.body.lead;

    const jobA = await request(app).post('/jobs').set(headers).send({
      lead_id: leadA.id,
      title: 'Lead A job',
      status: 'New',
    });
    const jobB = await request(app).post('/jobs').set(headers).send({
      lead_id: leadB.id,
      title: 'Lead B job',
      status: 'New',
    });
    expect(jobA.status).toBe(201);
    expect(jobB.status).toBe(201);

    const filtered = await request(app)
      .get('/jobs')
      .query({ leadId: String(leadA.id) })
      .set(headers);

    expect(filtered.status).toBe(200);
    expect(filtered.body.ok).toBe(true);
    expect(filtered.body.jobs).toHaveLength(1);
    expect(filtered.body.jobs[0].id).toBe(jobA.body.job.id);
    expect(filtered.body.jobs[0].lead_id).toBe(leadA.id);

    const filteredSnake = await request(app)
      .get('/jobs')
      .query({ lead_id: String(leadB.id) })
      .set(headers);

    expect(filteredSnake.status).toBe(200);
    expect(filteredSnake.body.jobs).toHaveLength(1);
    expect(filteredSnake.body.jobs[0].id).toBe(jobB.body.job.id);
  });

  it('returns job tasks from /jobs/:id/tasks', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    const jobRes = await request(app).post('/jobs').set(headers).send({
      lead_id: lead.id,
      title: 'Roof inspection for Sarah',
      status: 'New',
      address: '123 Main St',
    });

    const jobId = jobRes.body.job.id;

    await request(app).post('/tasks').set(headers).send({
      job_id: jobId,
      title: 'Inspect roof',
      status: 'Pending',
    });

    const tasksRes = await request(app)
      .get(`/jobs/${jobId}/tasks`)
      .set(headers);

    expect(tasksRes.status).toBe(200);
    expect(tasksRes.body.ok).toBe(true);
    expect(tasksRes.body.tasks).toHaveLength(1);
    expect(tasksRes.body.tasks[0].job_id).toBe(jobId);
  });

  it('deletes a job and returns 404 afterward', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    const jobRes = await request(app).post('/jobs').set(headers).send({
      lead_id: lead.id,
      title: 'Roof inspection for Sarah',
      status: 'New',
      address: '123 Main St',
    });

    const jobId = jobRes.body.job.id;

    const deleteRes = await request(app).delete(`/jobs/${jobId}`).set(headers);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);
    expect(deleteRes.body.deletedId).toBe(jobId);

    const getAfterDelete = await request(app)
      .get(`/jobs/${jobId}`)
      .set(headers);

    expect(getAfterDelete.status).toBe(404);
  });
});
