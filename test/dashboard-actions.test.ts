/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { resetDb } from './helpers/db';
import { ensureSchema } from './helpers/setup';
import { createAuthedUser } from './helpers/auth';
import { buildStartHere, START_HERE_LIMIT } from '../src/lib/startHere';
import type { ActionItem } from '../src/lib/startHere';

function item(
  kind: ActionItem['kind'],
  id: number,
  title = `${kind} ${id}`
): ActionItem {
  return {
    kind,
    id,
    title,
    subtitle: null,
    href: `/${kind}s/${id}`,
    reason: 'test',
    at: null,
  };
}

describe('buildStartHere', () => {
  it('ranks overdue tasks above stale leads and caps at 8', () => {
    const startHere = buildStartHere({
      overdueFollowUps: [item('task', 1)],
      overdueInvoices: [],
      invoicesDueSoon: [],
      blockedJobs: [],
      estimatesAwaiting: [],
      staleLeads: [item('lead', 9)],
      dueToday: [item('task', 2)],
    });

    expect(startHere[0].kind).toBe('task');
    expect(startHere[0].id).toBe(1);
    expect(startHere.map((row) => `${row.kind}:${row.id}`)).toContain('lead:9');
  });

  it('de-dupes kind+id and caps at START_HERE_LIMIT', () => {
    const overdueFollowUps = Array.from({ length: 12 }, (_, i) =>
      item('task', i + 1)
    );
    overdueFollowUps.push(item('task', 1, 'duplicate'));

    const startHere = buildStartHere({
      overdueFollowUps,
      overdueInvoices: [],
      invoicesDueSoon: [],
      blockedJobs: [],
      estimatesAwaiting: [],
      staleLeads: [],
      dueToday: [],
    });

    expect(startHere).toHaveLength(START_HERE_LIMIT);
    expect(startHere.filter((row) => row.kind === 'task' && row.id === 1)).toHaveLength(
      1
    );
  });
});

describe('Dashboard actions', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createLead(
    headers: Record<string, string>,
    overrides: Record<string, unknown> = {}
  ) {
    const res = await request(app)
      .post('/leads')
      .set(headers)
      .send({
        first_name: 'Pat',
        last_name: 'Lead',
        status: 'New',
        ...overrides,
      });
    expect(res.status).toBe(201);
    return res.body.lead;
  }

  async function createJob(
    headers: Record<string, string>,
    leadId: number,
    overrides: Record<string, unknown> = {}
  ) {
    const res = await request(app)
      .post('/jobs')
      .set(headers)
      .send({
        lead_id: leadId,
        title: 'Roof job',
        status: 'New',
        address: '1 Main St',
        ...overrides,
      });
    expect(res.status).toBe(201);
    return res.body.job;
  }

  it('includes stale leads and excludes closed, inactive, and recent leads', async () => {
    const { headers } = await createAuthedUser('agent');
    const stale = await createLead(headers, { first_name: 'Stale' });
    const recent = await createLead(headers, { first_name: 'Recent' });
    const closed = await createLead(headers, {
      first_name: 'Closed',
      status: 'Closed',
    });
    const inactive = await createLead(headers, {
      first_name: 'Inactive',
      status: 'Inactive',
    });

    await pool.query(
      `UPDATE leads SET status_changed_at = NOW() - INTERVAL '8 days' WHERE id = ANY($1::int[])`,
      [[stale.id, closed.id, inactive.id]]
    );

    const dash = await request(app).get('/dashboard').set(headers);
    expect(dash.status).toBe(200);
    const ids = (dash.body.actions.staleLeads || []).map((row: ActionItem) => row.id);
    expect(ids).toContain(stale.id);
    expect(ids).not.toContain(recent.id);
    expect(ids).not.toContain(closed.id);
    expect(ids).not.toContain(inactive.id);
    const staleRow = (dash.body.actions.staleLeads || []).find(
      (row: ActionItem) => row.id === stale.id
    );
    expect(staleRow?.reason).toBe('No recent communication');
  });

  it('excludes a stale-by-status lead after a fresh note and includes a lead with only an old note', async () => {
    const { headers } = await createAuthedUser('agent');
    const staleWithFreshNote = await createLead(headers, {
      first_name: 'FreshNote',
    });
    const oldNoteOnly = await createLead(headers, { first_name: 'OldNote' });

    await pool.query(
      `UPDATE leads SET status_changed_at = NOW() - INTERVAL '8 days' WHERE id = $1`,
      [staleWithFreshNote.id]
    );

    const fresh = await request(app).post('/notes').set(headers).send({
      entity_type: 'lead',
      entity_id: staleWithFreshNote.id,
      body: 'Just spoke with them.',
    });
    expect(fresh.status).toBe(201);

    const old = await request(app).post('/notes').set(headers).send({
      entity_type: 'lead',
      entity_id: oldNoteOnly.id,
      body: 'Last talked weeks ago.',
    });
    expect(old.status).toBe(201);
    await pool.query(
      `UPDATE notes SET created_at = NOW() - INTERVAL '8 days' WHERE id = $1`,
      [old.body.note.id]
    );

    const dash = await request(app).get('/dashboard').set(headers);
    expect(dash.status).toBe(200);
    const ids = (dash.body.actions.staleLeads || []).map((row: ActionItem) => row.id);
    expect(ids).not.toContain(staleWithFreshNote.id);
    expect(ids).toContain(oldNoteOnly.id);
  });

  it('includes sent estimates awaiting response and excludes approved or responded', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const awaiting = await request(app).post('/estimates').set(headers).send({
      job_id: job.id,
      title: 'Awaiting estimate',
    });
    expect(awaiting.status).toBe(201);
    await request(app)
      .patch(`/estimates/${awaiting.body.estimate.id}`)
      .set(headers)
      .send({ status: 'Sent' });

    const approved = await request(app).post('/estimates').set(headers).send({
      job_id: job.id,
      title: 'Approved estimate',
    });
    await request(app)
      .patch(`/estimates/${approved.body.estimate.id}`)
      .set(headers)
      .send({ status: 'Approved' });

    const responded = await request(app).post('/estimates').set(headers).send({
      job_id: job.id,
      title: 'Responded estimate',
    });
    await request(app)
      .patch(`/estimates/${responded.body.estimate.id}`)
      .set(headers)
      .send({ status: 'Sent' });
    await pool.query(
      `UPDATE estimates SET client_responded_at = NOW() WHERE id = $1`,
      [responded.body.estimate.id]
    );

    const dash = await request(app).get('/dashboard').set(headers);
    expect(dash.status).toBe(200);
    const ids = (dash.body.actions.estimatesAwaiting || []).map(
      (row: ActionItem) => row.id
    );
    expect(ids).toContain(awaiting.body.estimate.id);
    expect(ids).not.toContain(approved.body.estimate.id);
    expect(ids).not.toContain(responded.body.estimate.id);
  });

  it('includes open jobs with overdue tasks and excludes completed-only or closed jobs', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const blocked = await createJob(headers, lead.id, { title: 'Blocked job' });
    const completedOnly = await createJob(headers, lead.id, {
      title: 'Completed tasks job',
    });
    const closed = await createJob(headers, lead.id, { title: 'Closed job' });

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await request(app).post('/tasks').set(headers).send({
      job_id: blocked.id,
      title: 'Overdue work',
      due_date: yesterday,
    });
    await request(app).post('/tasks').set(headers).send({
      job_id: completedOnly.id,
      title: 'Finished work',
      due_date: yesterday,
      status: 'Completed',
    });
    await request(app).post('/tasks').set(headers).send({
      job_id: closed.id,
      title: 'Old work',
      due_date: yesterday,
    });
    await request(app)
      .patch(`/jobs/${closed.id}`)
      .set(headers)
      .send({ status: 'Closed Won' });

    const dash = await request(app).get('/dashboard').set(headers);
    expect(dash.status).toBe(200);
    const ids = (dash.body.actions.blockedJobs || []).map((row: ActionItem) => row.id);
    expect(ids).toContain(blocked.id);
    expect(ids).not.toContain(completedOnly.id);
    expect(ids).not.toContain(closed.id);
  });

  it('includes invoices due within 3 days and excludes paid or far-future invoices', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const dueSoon = await request(app).post('/invoices').set(headers).send({
      job_id: job.id,
      status: 'Sent',
      due_date: tomorrow,
    });
    const paid = await request(app).post('/invoices').set(headers).send({
      job_id: job.id,
      status: 'Paid',
      due_date: yesterday,
    });
    const later = await request(app).post('/invoices').set(headers).send({
      job_id: job.id,
      status: 'Sent',
      due_date: inTenDays,
    });

    expect(dueSoon.status).toBe(201);
    expect(paid.status).toBe(201);
    expect(later.status).toBe(201);

    const dash = await request(app).get('/dashboard').set(headers);
    expect(dash.status).toBe(200);
    const ids = (dash.body.actions.invoicesDue || []).map((row: ActionItem) => row.id);
    expect(ids).toContain(dueSoon.body.invoice.id);
    expect(ids).not.toContain(paid.body.invoice.id);
    expect(ids).not.toContain(later.body.invoice.id);
  });

  it('puts overdue tasks ahead of stale leads in startHere', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers, { first_name: 'Stale' });
    await pool.query(
      `UPDATE leads SET status_changed_at = NOW() - INTERVAL '8 days' WHERE id = $1`,
      [lead.id]
    );

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const task = await request(app).post('/tasks').set(headers).send({
      lead_id: lead.id,
      title: 'Call the customer',
      due_date: yesterday,
    });
    expect(task.status).toBe(201);

    const dash = await request(app).get('/dashboard').set(headers);
    expect(dash.status).toBe(200);
    const startHere: ActionItem[] = dash.body.actions.startHere;
    expect(startHere[0].kind).toBe('task');
    expect(startHere[0].id).toBe(task.body.task.id);
    expect(startHere.some((row) => row.kind === 'lead' && row.id === lead.id)).toBe(
      true
    );
  });

  it('lets owners use view=all and ignores it for agents', async () => {
    const owner = await createAuthedUser('owner');
    const agent = await createAuthedUser('agent');

    await createLead(agent.headers, { first_name: 'Agent' });
    await createLead(owner.headers, { first_name: 'Owner' });

    const ownerMine = await request(app).get('/dashboard').set(owner.headers);
    const ownerAll = await request(app)
      .get('/dashboard?view=all')
      .set(owner.headers);
    const agentAll = await request(app)
      .get('/dashboard?view=all')
      .set(agent.headers);

    expect(ownerMine.body.leads.total).toBe(1);
    expect(ownerAll.body.leads.total).toBe(2);
    expect(agentAll.body.leads.total).toBe(1);
  });

  it('moves lead status_changed_at only when status changes', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    expect(lead.days_in_status).toBe(0);

    await pool.query(
      `UPDATE leads SET status_changed_at = NOW() - INTERVAL '2 days' WHERE id = $1`,
      [lead.id]
    );

    const beforeName = await request(app).get(`/leads/${lead.id}`).set(headers);
    const beforeTs = new Date(beforeName.body.lead.status_changed_at).getTime();
    expect(beforeName.body.lead.days_in_status).toBeGreaterThanOrEqual(2);

    const namePatch = await request(app)
      .patch(`/leads/${lead.id}`)
      .set(headers)
      .send({ first_name: 'Updated' });
    expect(namePatch.status).toBe(200);
    expect(new Date(namePatch.body.lead.status_changed_at).getTime()).toBe(beforeTs);
    expect(namePatch.body.lead.days_in_status).toBeGreaterThanOrEqual(2);

    const statusPatch = await request(app)
      .patch(`/leads/${lead.id}`)
      .set(headers)
      .send({ status: 'Contacted' });
    expect(statusPatch.status).toBe(200);
    const afterStatus = new Date(statusPatch.body.lead.status_changed_at).getTime();
    expect(afterStatus).toBeGreaterThan(beforeTs);
    expect(statusPatch.body.lead.days_in_status).toBe(0);
  });
});
