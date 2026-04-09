/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
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
