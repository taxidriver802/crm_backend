/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser } from './helpers/auth';

jest.setTimeout(30000);

describe('Reports integration', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns report endpoints for authenticated user', async () => {
    const { headers } = await createAuthedUser('agent');

    const leadRes = await request(app).post('/leads').set(headers).send({
      first_name: 'Riley',
      last_name: 'Jones',
      status: 'New',
    });

    await request(app).post('/jobs').set(headers).send({
      lead_id: leadRes.body.lead.id,
      title: 'Roof update',
      status: 'Contacted',
    });

    const leadFunnel = await request(app)
      .get('/reports/lead-funnel')
      .set(headers);
    const estimateOutcomes = await request(app)
      .get('/reports/estimate-outcomes')
      .set(headers);
    const jobPipeline = await request(app)
      .get('/reports/job-pipeline')
      .set(headers);
    const trends = await request(app)
      .get('/reports/trends')
      .query({ period: 'monthly' })
      .set(headers);

    expect(leadFunnel.status).toBe(200);
    expect(leadFunnel.body.ok).toBe(true);
    expect(Array.isArray(leadFunnel.body.data)).toBe(true);

    expect(estimateOutcomes.status).toBe(200);
    expect(estimateOutcomes.body.ok).toBe(true);
    expect(Array.isArray(estimateOutcomes.body.byStatus)).toBe(true);
    expect(typeof estimateOutcomes.body.approvedRevenue).toBe('number');

    expect(jobPipeline.status).toBe(200);
    expect(jobPipeline.body.ok).toBe(true);
    expect(Array.isArray(jobPipeline.body.data)).toBe(true);

    expect(trends.status).toBe(200);
    expect(trends.body.ok).toBe(true);
    expect(Array.isArray(trends.body.leads)).toBe(true);
    expect(Array.isArray(trends.body.estimates)).toBe(true);
  });

  it('hides team performance from agents and rejects an unknown window', async () => {
    const agent = await createAuthedUser('agent');
    const owner = await createAuthedUser('owner');

    const forbidden = await request(app)
      .get('/reports/team')
      .set(agent.headers);
    expect(forbidden.status).toBe(403);

    const badWindow = await request(app)
      .get('/reports/team')
      .query({ window: 7 })
      .set(owner.headers);
    expect(badWindow.status).toBe(400);

    const missing = await request(app)
      .get('/reports/team/00000000-0000-4000-8000-000000000099')
      .set(owner.headers);
    expect(missing.status).toBe(404);
  });

  it('attributes a won job to the assignee at close, not a later reassignment', async () => {
    const owner = await createAuthedUser('owner');
    const closer = await createAuthedUser('agent');
    const later = await createAuthedUser('agent');

    const lead = await request(app).post('/leads').set(owner.headers).send({
      first_name: 'Pat',
      last_name: 'Client',
      status: 'New',
      assigned_to: closer.user.id,
    });
    expect(lead.status).toBe(201);

    const job = await request(app).post('/jobs').set(owner.headers).send({
      lead_id: lead.body.lead.id,
      title: 'Roof replacement',
      status: 'New',
      assigned_to: closer.user.id,
    });
    expect(job.status).toBe(201);

    const won = await request(app)
      .patch(`/jobs/${job.body.job.id}`)
      .set(owner.headers)
      .send({ status: 'Closed Won' });
    expect(won.status).toBe(200);

    const reassigned = await request(app)
      .patch(`/jobs/${job.body.job.id}`)
      .set(owner.headers)
      .send({ assigned_to: later.user.id });
    expect(reassigned.status).toBe(200);

    const team = await request(app)
      .get('/reports/team')
      .query({ window: 90 })
      .set(owner.headers);
    expect(team.status).toBe(200);
    expect(team.body.attribution).toEqual(expect.any(String));

    const closerRow = team.body.users.find(
      (row: { userId: string }) => row.userId === closer.user.id
    );
    const laterRow = team.body.users.find(
      (row: { userId: string }) => row.userId === later.user.id
    );
    expect(closerRow.winRate).toMatchObject({ won: 1, lost: 0, sample: 1, rate: null });
    expect(laterRow.winRate).toMatchObject({ won: 0, lost: 0, sample: 0, rate: null });

    const person = await request(app)
      .get(`/reports/team/${closer.user.id}`)
      .query({ window: 30 })
      .set(owner.headers);
    expect(person.status).toBe(200);
    expect(person.body.user.winRate.won).toBe(1);
    expect(person.body.user.leadToJob).toMatchObject({ converted: 1, sample: 1, rate: null });
    expect(person.body.user.exits.closedLostJobs).toBe(0);
    expect(person.body.user.book.jobsOpen).toBe(0);
    expect(Array.isArray(person.body.user.stageDropOff)).toBe(true);

    const events = await pool.query(
      `SELECT user_id FROM assignment_events WHERE entity_type = 'job' AND entity_id = $1 ORDER BY assigned_at ASC, id ASC`,
      [job.body.job.id]
    );
    expect(events.rows.map((row) => row.user_id)).toEqual([
      closer.user.id,
      later.user.id,
    ]);
  });

  it('records lead status changes, task completion, and estimate send time', async () => {
    const owner = await createAuthedUser('owner');
    const agent = await createAuthedUser('agent');

    const lead = await request(app).post('/leads').set(owner.headers).send({
      first_name: 'Casey',
      last_name: 'Ng',
      status: 'New',
      assigned_to: agent.user.id,
    });
    const leadId = lead.body.lead.id;

    const moved = await request(app)
      .patch(`/leads/${leadId}`)
      .set(owner.headers)
      .send({ status: 'Contacted' });
    expect(moved.status).toBe(200);

    const statusEvents = await pool.query(
      `SELECT from_status, to_status FROM lead_status_events WHERE lead_id = $1`,
      [leadId]
    );
    expect(statusEvents.rows).toEqual([
      { from_status: 'New', to_status: 'Contacted' },
    ]);

    const job = await request(app).post('/jobs').set(owner.headers).send({
      lead_id: leadId,
      title: 'Inspection',
      assigned_to: agent.user.id,
    });

    const task = await request(app).post('/tasks').set(owner.headers).send({
      job_id: job.body.job.id,
      title: 'Follow up',
      due_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      status: 'Pending',
      assigned_to: agent.user.id,
    });
    expect(task.status).toBe(201);

    const completed = await request(app)
      .patch(`/tasks/${task.body.task.id}`)
      .set(owner.headers)
      .send({ status: 'Completed' });
    expect(completed.status).toBe(200);

    const completedRow = await pool.query(
      `SELECT completed_at FROM tasks WHERE id = $1`,
      [task.body.task.id]
    );
    expect(completedRow.rows[0].completed_at).toBeTruthy();

    const reopened = await request(app)
      .patch(`/tasks/${task.body.task.id}`)
      .set(owner.headers)
      .send({ status: 'Pending' });
    expect(reopened.status).toBe(200);
    const reopenedRow = await pool.query(
      `SELECT completed_at, status FROM tasks WHERE id = $1`,
      [task.body.task.id]
    );
    expect(reopenedRow.rows[0].status).toBe('Pending');
    expect(reopenedRow.rows[0].completed_at).toBeNull();

    const estimate = await request(app).post('/estimates').set(owner.headers).send({
      job_id: job.body.job.id,
      title: 'Proposal',
    });
    const sent = await request(app)
      .patch(`/estimates/${estimate.body.estimate.id}`)
      .set(owner.headers)
      .send({ status: 'Sent' });
    expect(sent.status).toBe(200);
    expect(sent.body.estimate.sent_at).toBeTruthy();

    const team = await request(app)
      .get('/reports/team')
      .set(owner.headers);
    const agentRow = team.body.users.find(
      (row: { userId: string }) => row.userId === agent.user.id
    );
    expect(agentRow.overdue).toMatchObject({
      overdue: 1,
      withDueDate: 1,
      noDueDate: 0,
      rate: 1,
    });

    const person = await request(app)
      .get(`/reports/team/${agent.user.id}`)
      .set(owner.headers);
    expect(person.body.user.leadStageTiming).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'New', sample: 1 }),
      ])
    );
  });
});
