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
