/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser } from './helpers/auth';

describe('Notes integration', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  async function createLead(headers: Record<string, string>) {
    const res = await request(app).post('/leads').set(headers).send({
      first_name: 'Taylor',
      last_name: 'Stone',
      email: 'taylor@example.com',
      status: 'New',
    });
    expect(res.status).toBe(201);
    return res.body.lead;
  }

  async function createJob(headers: Record<string, string>, leadId: number) {
    const res = await request(app).post('/jobs').set(headers).send({
      lead_id: leadId,
      title: 'Roof replacement',
      status: 'New',
    });
    expect(res.status).toBe(201);
    return res.body.job;
  }

  it('creates and lists lead notes', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    const created = await request(app).post('/notes').set(headers).send({
      entity_type: 'lead',
      entity_id: lead.id,
      body: 'Called customer, requested Friday follow-up.',
    });

    expect(created.status).toBe(201);
    expect(created.body.ok).toBe(true);
    expect(created.body.note.entity_type).toBe('lead');
    expect(created.body.note.entity_id).toBe(lead.id);

    const listed = await request(app)
      .get('/notes')
      .query({ entity_type: 'lead', entity_id: String(lead.id) })
      .set(headers);

    expect(listed.status).toBe(200);
    expect(listed.body.ok).toBe(true);
    expect(listed.body.notes).toHaveLength(1);
    expect(listed.body.notes[0].body).toContain('Friday follow-up');
    expect(listed.body.notes[0].type).toBe('note');
    expect(listed.body.notes[0].direction).toBe('internal');
    expect(listed.body.notes[0].follow_up_task).toBeNull();
  });

  it('defaults type and direction when only body is sent', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    const created = await request(app).post('/notes').set(headers).send({
      entity_type: 'lead',
      entity_id: lead.id,
      body: 'Quick internal note.',
    });

    expect(created.status).toBe(201);
    expect(created.body.note.type).toBe('note');
    expect(created.body.note.direction).toBe('internal');
    expect(created.body.note.follow_up_task_id).toBeNull();
  });

  it('stores call outbound and creates a follow-up task', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const followUp = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

    const created = await request(app).post('/notes').set(headers).send({
      entity_type: 'lead',
      entity_id: lead.id,
      body: 'Left voicemail, will try Friday.',
      type: 'call',
      direction: 'outbound',
      follow_up_date: followUp,
    });

    expect(created.status).toBe(201);
    expect(created.body.note.type).toBe('call');
    expect(created.body.note.direction).toBe('outbound');
    expect(created.body.note.follow_up_task).toEqual(
      expect.objectContaining({
        title: expect.stringContaining('Follow up: call with Taylor Stone'),
        status: 'Pending',
      })
    );

    const tasks = await request(app)
      .get('/tasks')
      .query({ leadId: String(lead.id) })
      .set(headers);

    expect(tasks.status).toBe(200);
    expect(tasks.body.tasks).toHaveLength(1);
    expect(tasks.body.tasks[0].status).toBe('Pending');
    expect(tasks.body.tasks[0].id).toBe(created.body.note.follow_up_task.id);
  });

  it('does not create a task when follow-up is omitted', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);

    const created = await request(app).post('/notes').set(headers).send({
      entity_type: 'lead',
      entity_id: lead.id,
      body: 'No follow-up needed.',
      type: 'email',
      direction: 'inbound',
    });

    expect(created.status).toBe(201);
    expect(created.body.note.follow_up_task).toBeNull();

    const tasks = await request(app)
      .get('/tasks')
      .query({ leadId: String(lead.id) })
      .set(headers);

    expect(tasks.status).toBe(200);
    expect(tasks.body.tasks).toHaveLength(0);
  });

  it('records COMMUNICATION_LOGGED on job notes but not lead notes', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const leadNote = await request(app).post('/notes').set(headers).send({
      entity_type: 'lead',
      entity_id: lead.id,
      body: 'Lead-only conversation.',
      type: 'call',
      direction: 'outbound',
    });
    expect(leadNote.status).toBe(201);

    const jobNote = await request(app).post('/notes').set(headers).send({
      entity_type: 'job',
      entity_id: job.id,
      body: 'Emailed the estimate.',
      type: 'email',
      direction: 'outbound',
    });
    expect(jobNote.status).toBe(201);

    const activity = await request(app)
      .get(`/jobs/${job.id}/activity`)
      .set(headers);
    expect(activity.status).toBe(200);
    const types = (activity.body.activity || []).map((row: { type: string }) => row.type);
    expect(types).toContain('COMMUNICATION_LOGGED');
    expect(types.filter((type: string) => type === 'COMMUNICATION_LOGGED')).toHaveLength(
      1
    );
  });

  it('stores lead qualification fields', async () => {
    const { headers } = await createAuthedUser('agent');
    const created = await request(app).post('/leads').set(headers).send({
      first_name: 'Taylor',
      last_name: 'Stone',
      source: 'Website',
      service_type: 'Repair',
      preferred_contact_method: 'Call',
      urgency: 'Urgent',
    });
    expect(created.status).toBe(201);
    expect(created.body.lead.service_type).toBe('Repair');
    expect(created.body.lead.preferred_contact_method).toBe('Call');
    expect(created.body.lead.urgency).toBe('Urgent');

    const patched = await request(app)
      .patch(`/leads/${created.body.lead.id}`)
      .set(headers)
      .send({
        service_type: 'Replacement',
        urgency: 'Normal',
      });
    expect(patched.status).toBe(200);
    expect(patched.body.lead.service_type).toBe('Replacement');
    expect(patched.body.lead.urgency).toBe('Normal');
    expect(patched.body.lead.preferred_contact_method).toBe('Call');
  });

  it('creates and deletes job notes', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const created = await request(app).post('/notes').set(headers).send({
      entity_type: 'job',
      entity_id: job.id,
      body: 'Waiting on supplier confirmation.',
    });

    expect(created.status).toBe(201);
    const noteId = created.body.note.id;

    const deleted = await request(app).delete(`/notes/${noteId}`).set(headers);
    expect(deleted.status).toBe(200);
    expect(deleted.body.ok).toBe(true);

    const listed = await request(app)
      .get('/notes')
      .query({ entity_type: 'job', entity_id: String(job.id) })
      .set(headers);

    expect(listed.status).toBe(200);
    expect(listed.body.notes).toHaveLength(0);
  });
});
