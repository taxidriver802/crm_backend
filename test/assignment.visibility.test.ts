/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import {
  authHeaderFor,
  createAuthedUser,
  createTestCompany,
  createTestUser,
} from './helpers/auth';

describe('Assignment visibility', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it('puts assigned work on the assignee Mine list and leaves unassigned work with the creator', async () => {
    const owner = await createAuthedUser('owner');
    const agent = await createAuthedUser('agent');

    const assigned = await request(app).post('/leads').set(owner.headers).send({
      first_name: 'Assigned',
      last_name: 'Lead',
      status: 'New',
      assigned_to: agent.user.id,
    });
    expect(assigned.status).toBe(201);

    const unassigned = await request(app).post('/leads').set(owner.headers).send({
      first_name: 'Unassigned',
      last_name: 'Lead',
      status: 'New',
    });
    expect(unassigned.status).toBe(201);

    const agentOwn = await request(app).post('/leads').set(agent.headers).send({
      first_name: 'Agent',
      last_name: 'Created',
      status: 'New',
    });
    expect(agentOwn.status).toBe(201);

    const ownerMine = await request(app).get('/leads').set(owner.headers);
    const ownerMineIds = ownerMine.body.leads.map((row: { id: number }) => row.id);
    expect(ownerMineIds).toContain(unassigned.body.lead.id);
    expect(ownerMineIds).not.toContain(assigned.body.lead.id);
    expect(ownerMineIds).not.toContain(agentOwn.body.lead.id);

    const ownerTeam = await request(app)
      .get('/leads')
      .query({ view: 'all' })
      .set(owner.headers);
    const ownerTeamIds = ownerTeam.body.leads.map((row: { id: number }) => row.id);
    expect(ownerTeamIds).toEqual(
      expect.arrayContaining([
        assigned.body.lead.id,
        unassigned.body.lead.id,
        agentOwn.body.lead.id,
      ])
    );

    const agentMine = await request(app).get('/leads').set(agent.headers);
    const agentMineIds = agentMine.body.leads.map((row: { id: number }) => row.id);
    expect(agentMineIds).toContain(assigned.body.lead.id);
    expect(agentMineIds).toContain(agentOwn.body.lead.id);
    expect(agentMineIds).not.toContain(unassigned.body.lead.id);

    const agentAll = await request(app)
      .get('/leads')
      .query({ view: 'all' })
      .set(agent.headers);
    const agentAllIds = agentAll.body.leads.map((row: { id: number }) => row.id);
    expect(agentAllIds).not.toContain(unassigned.body.lead.id);

    const hidden = await request(app)
      .get(`/leads/${unassigned.body.lead.id}`)
      .set(agent.headers);
    expect(hidden.status).toBe(404);

    const visible = await request(app)
      .get(`/leads/${assigned.body.lead.id}`)
      .set(agent.headers);
    expect(visible.status).toBe(200);

    const ownerDash = await request(app).get('/dashboard').set(owner.headers);
    const agentDash = await request(app).get('/dashboard').set(agent.headers);
    expect(ownerDash.body.leads.total).toBe(1);
    expect(agentDash.body.leads.total).toBe(2);

    const job = await request(app).post('/jobs').set(owner.headers).send({
      lead_id: assigned.body.lead.id,
      title: 'Assigned job',
      status: 'New',
      assigned_to: agent.user.id,
    });
    expect(job.status).toBe(201);

    const task = await request(app).post('/tasks').set(owner.headers).send({
      job_id: job.body.job.id,
      title: 'Assigned task',
      status: 'Pending',
      assigned_to: agent.user.id,
    });
    expect(task.status).toBe(201);

    const agentJobs = await request(app).get('/jobs').set(agent.headers);
    expect(agentJobs.body.jobs.map((row: { id: number }) => row.id)).toContain(
      job.body.job.id
    );
    const ownerJobs = await request(app).get('/jobs').set(owner.headers);
    expect(ownerJobs.body.jobs.map((row: { id: number }) => row.id)).not.toContain(
      job.body.job.id
    );

    const agentTasks = await request(app).get('/tasks').set(agent.headers);
    expect(agentTasks.body.tasks.map((row: { id: number }) => row.id)).toContain(
      task.body.task.id
    );
    const ownerTasks = await request(app).get('/tasks').set(owner.headers);
    expect(ownerTasks.body.tasks.map((row: { id: number }) => row.id)).not.toContain(
      task.body.task.id
    );

    const note = await request(app).post('/notes').set(owner.headers).send({
      entity_type: 'lead',
      entity_id: assigned.body.lead.id,
      body: 'Owner wrote this',
      type: 'note',
    });
    expect(note.status).toBe(201);

    const agentNotes = await request(app)
      .get('/notes')
      .query({ entity_type: 'lead', entity_id: assigned.body.lead.id })
      .set(agent.headers);
    expect(agentNotes.status).toBe(200);
    expect(agentNotes.body.notes.map((row: { body: string }) => row.body)).toContain(
      'Owner wrote this'
    );

    const upload = await request(app)
      .post('/files')
      .set(owner.headers)
      .field('lead_id', String(assigned.body.lead.id))
      .attach('file', Buffer.from('assigned-file'), 'note.txt');
    expect(upload.status).toBe(201);

    const agentFiles = await request(app)
      .get('/files')
      .query({ lead_id: assigned.body.lead.id })
      .set(agent.headers);
    expect(agentFiles.status).toBe(200);
    expect(
      agentFiles.body.files.map((row: { original_name: string }) => row.original_name)
    ).toContain('note.txt');
  });

  it('keeps an assigned lead inside its company', async () => {
    const owner = await createAuthedUser('owner');
    const agent = await createAuthedUser('agent');
    const otherCompany = await createTestCompany({
      name: 'Other Roofing',
      slug: 'other-assign',
    });
    const outsider = await createTestUser({
      role: 'owner',
      company_id: otherCompany.id,
      email: 'outsider-assign@example.com',
    });
    const outsiderHeaders = authHeaderFor(outsider);

    const lead = await request(app).post('/leads').set(owner.headers).send({
      first_name: 'Stay',
      last_name: 'Here',
      status: 'New',
      assigned_to: agent.user.id,
    });
    expect(lead.status).toBe(201);

    const cross = await request(app)
      .get(`/leads/${lead.body.lead.id}`)
      .set(outsiderHeaders);
    expect(cross.status).toBe(404);

    const crossList = await request(app)
      .get('/leads')
      .query({ view: 'all' })
      .set(outsiderHeaders);
    expect(
      crossList.body.leads.map((row: { id: number }) => row.id)
    ).not.toContain(lead.body.lead.id);

    const stored = await pool.query(`SELECT company_id FROM leads WHERE id = $1`, [
      lead.body.lead.id,
    ]);
    expect(stored.rows[0].company_id).toBe(owner.user.company_id);
  });

  it('notifies the new assignee when a lead or job is reassigned', async () => {
    const owner = await createAuthedUser('owner');
    const agent = await createAuthedUser('agent');

    const lead = await request(app).post('/leads').set(owner.headers).send({
      first_name: 'Swap',
      last_name: 'Lead',
      status: 'New',
    });
    expect(lead.status).toBe(201);

    const before = await pool.query(
      `SELECT id FROM notifications WHERE user_id = $1 AND type = 'LEAD_ASSIGNED'`,
      [agent.user.id]
    );
    expect(before.rowCount).toBe(0);

    const reassigned = await request(app)
      .patch(`/leads/${lead.body.lead.id}`)
      .set(owner.headers)
      .send({ assigned_to: agent.user.id });
    expect(reassigned.status).toBe(200);

    const agentNotes = await request(app).get('/notifications').set(agent.headers);
    expect(agentNotes.status).toBe(200);
    const leadNote = agentNotes.body.notifications.find(
      (row: { type: string }) => row.type === 'LEAD_ASSIGNED'
    );
    expect(leadNote).toBeTruthy();
    expect(leadNote.entity_type).toBe('lead');
    expect(leadNote.entity_id).toBe(lead.body.lead.id);
    expect(leadNote.message).toContain('Swap Lead');

    const ownerNotes = await pool.query(
      `SELECT id FROM notifications WHERE user_id = $1 AND type = 'LEAD_ASSIGNED'`,
      [owner.user.id]
    );
    expect(ownerNotes.rowCount).toBe(0);

    const back = await request(app)
      .patch(`/leads/${lead.body.lead.id}`)
      .set(owner.headers)
      .send({ assigned_to: owner.user.id });
    expect(back.status).toBe(200);
    const stillQuiet = await pool.query(
      `SELECT id FROM notifications WHERE user_id = $1 AND type = 'LEAD_ASSIGNED'`,
      [owner.user.id]
    );
    expect(stillQuiet.rowCount).toBe(0);

    const job = await request(app).post('/jobs').set(owner.headers).send({
      lead_id: lead.body.lead.id,
      title: 'Swap job',
      status: 'New',
    });
    expect(job.status).toBe(201);

    const jobPatch = await request(app)
      .patch(`/jobs/${job.body.job.id}`)
      .set(owner.headers)
      .send({ assigned_to: agent.user.id });
    expect(jobPatch.status).toBe(200);

    const after = await request(app).get('/notifications').set(agent.headers);
    const jobNote = after.body.notifications.find(
      (row: { type: string }) => row.type === 'JOB_ASSIGNED'
    );
    expect(jobNote).toBeTruthy();
    expect(jobNote.entity_type).toBe('job');
    expect(jobNote.entity_id).toBe(job.body.job.id);
    expect(jobNote.message).toContain('Swap job');
  });
});
