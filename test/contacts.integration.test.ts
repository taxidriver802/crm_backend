/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import {
  authHeaderFor,
  createTestCompany,
  createTestUser,
  DEFAULT_COMPANY_ID,
  type TestUserRole,
} from './helpers/auth';

jest.setTimeout(30000);

type Member = { id: string; headers: Record<string, string> };

async function member(
  role: TestUserRole,
  names: { first_name?: string; last_name?: string; company_id?: string } = {}
): Promise<Member> {
  const user = await createTestUser({ role, ...names });
  return { id: user.id, headers: await authHeaderFor(user) };
}

async function newContact(as: Member, body: Record<string, unknown>) {
  const res = await request(app).post('/contacts').set(as.headers).send(body);
  expect(res.status).toBe(201);
  return res.body.contact;
}

async function newLead(as: Member, body: Record<string, unknown>) {
  const res = await request(app).post('/leads').set(as.headers).send({ status: 'New', ...body });
  expect(res.status).toBe(201);
  return res.body.lead;
}

async function newJob(as: Member, body: Record<string, unknown>) {
  const res = await request(app).post('/jobs').set(as.headers).send(body);
  expect(res.status).toBe(201);
  return res.body.job;
}

async function contactCount() {
  return (await pool.query(`SELECT COUNT(*)::int AS n FROM contacts`)).rows[0].n as number;
}

async function otherCompanyOwner() {
  const company = await createTestCompany();
  return member('owner', { company_id: company.id });
}

describe('Contacts API', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it('makes a contact for a new lead and lists it as an open lead', async () => {
    const owner = await member('owner');
    const lead = await newLead(owner, {
      first_name: 'Helen',
      last_name: 'Park',
      phone: '(612) 555-0101',
      email: 'helen@example.com',
    });

    expect(lead.contact).toMatchObject({ name: 'Helen Park', kind: 'homeowner', group: 'client' });
    expect(lead.name).toBe('Helen Park');
    expect(await contactCount()).toBe(1);

    const list = await request(app).get('/contacts').set(owner.headers);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.contacts[0]).toMatchObject({
      id: lead.contact.id,
      name: 'Helen Park',
      phone: '(612) 555-0101',
      status: 'lead',
      lead_count: 1,
      job_count: 0,
    });

    const open = await request(app).get('/contacts').query({ tab: 'open_leads' }).set(owner.headers);
    expect(open.body.contacts.map((c: { id: number }) => c.id)).toEqual([lead.contact.id]);
    const customers = await request(app).get('/contacts').query({ tab: 'customers' }).set(owner.headers);
    expect(customers.body.total).toBe(0);

    for (const q of ['helen', '0101', '612-555']) {
      const found = await request(app).get('/contacts').query({ q }).set(owner.headers);
      expect(found.body.total).toBe(1);
    }
    const none = await request(app).get('/contacts').query({ q: 'nobody' }).set(owner.headers);
    expect(none.body.total).toBe(0);
  });

  it('reuses an existing contact for new work and reads the name from it', async () => {
    const owner = await member('owner');
    const contact = await newContact(owner, {
      first_name: 'Omar',
      last_name: 'Diaz',
      phone: '612-555-0102',
      address: '7 Juniper Court, Plymouth, MN 55447',
    });
    expect(contact.status).toBeNull();

    const lead = await newLead(owner, { contact_id: contact.id, service_type: 'Gutters' });
    expect(lead.contact.id).toBe(contact.id);
    expect(lead.first_name).toBe('Omar');
    expect(lead.name).toBe('Omar Diaz');
    expect(await contactCount()).toBe(1);

    // A job takes the lead's contact, and the contact's address when none is typed.
    const job = await newJob(owner, { lead_id: lead.id, title: 'Gutter guards' });
    expect(job.contact_id).toBe(contact.id);
    expect(job.address).toBe('7 Juniper Court, Plymouth, MN 55447');
    const typed = await newJob(owner, { lead_id: lead.id, title: 'Shed roof', address: '9 Oak Ln' });
    expect(typed.address).toBe('9 Oak Ln');

    const byContact = await request(app).get('/jobs').query({ contactId: contact.id, view: 'all' }).set(owner.headers);
    expect(byContact.status).toBe(200);
    expect(byContact.body.jobs.map((j: { id: number }) => j.id).sort()).toEqual([job.id, typed.id].sort());

    const nameless = await request(app).post('/leads').set(owner.headers).send({ status: 'New' });
    expect(nameless.status).toBe(400);
  });

  it('changes the contact when a lead’s person is edited, and every paper follows', async () => {
    const owner = await member('owner');
    const lead = await newLead(owner, { first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com' });
    const job = await newJob(owner, { lead_id: lead.id, title: 'Roof' });

    const edited = await request(app).patch(`/leads/${lead.id}`).set(owner.headers).send({ first_name: 'Annie' });
    expect(edited.status).toBe(200);
    expect(edited.body.lead.name).toBe('Annie Lee');
    expect(edited.body.lead.submitted.first_name).toBe('Ann');

    const contact = await request(app).get(`/contacts/${lead.contact.id}`).set(owner.headers);
    expect(contact.body.contact.first_name).toBe('Annie');

    const reread = await request(app).get(`/jobs/${job.id}`).set(owner.headers);
    expect(reread.body.job.lead.name).toBe('Annie Lee');
    expect(reread.body.job.contact.name).toBe('Annie Lee');

    const estimate = await pool.query(
      `INSERT INTO estimates (user_id, job_id, title, status, company_id)
       VALUES ($1, $2, 'Roof', 'Draft', $3) RETURNING id`,
      [owner.id, job.id, DEFAULT_COMPANY_ID]
    );
    const shown = await request(app).get(`/estimates/${estimate.rows[0].id}`).set(owner.headers);
    expect(shown.body.estimate.job.lead_name).toBe('Annie Lee');

    const token = await request(app).post(`/portal/generate/${job.id}`).set(owner.headers);
    expect(token.status).toBe(200);
    const portal = await request(app).get(`/public/portal/${token.body.token}`);
    expect(portal.body.portal.job.lead_name).toBe('Annie Lee');
    expect(portal.body.portal.job.lead_email).toBe('ann@example.com');
  });

  it('shows an agent every contact but only their own leads, jobs and money on it', async () => {
    const owner = await member('owner');
    const avery = await member('agent', { first_name: 'Avery', last_name: 'Sloan' });
    const jason = await member('agent', { first_name: 'Jason', last_name: 'Cox' });

    const lead = await newLead(owner, {
      first_name: 'Helen',
      last_name: 'Park',
      phone: '612-555-0101',
      assigned_to: jason.id,
    });
    const job = await newJob(owner, { lead_id: lead.id, title: 'Roof', assigned_to: jason.id });
    await pool.query(`UPDATE jobs SET status = 'Sold' WHERE id = $1`, [job.id]);
    const estimate = await pool.query(
      `INSERT INTO estimates (user_id, job_id, title, status, grand_total, company_id)
       VALUES ($1, $2, 'Roof', 'Approved', 10000, $3) RETURNING id`,
      [owner.id, job.id, DEFAULT_COMPANY_ID]
    );
    await pool.query(
      `INSERT INTO invoices (user_id, job_id, estimate_id, invoice_number, status, kind,
                             grand_total, amount_paid, company_id)
       VALUES ($1, $2, $3, 'INV-0001', 'Sent', 'final', 4000, 1000, $4)`,
      [owner.id, job.id, estimate.rows[0].id, DEFAULT_COMPANY_ID]
    );
    const contactId = lead.contact.id;

    const asAvery = await request(app).get('/contacts').set(avery.headers);
    expect(asAvery.body.contacts[0]).toMatchObject({
      id: contactId,
      name: 'Helen Park',
      phone: '612-555-0101',
      status: 'customer',
      lifetime_value: 0,
      owed: 0,
    });
    const asOwner = await request(app).get('/contacts').set(owner.headers);
    expect(asOwner.body.contacts[0]).toMatchObject({ lifetime_value: 10000, owed: 3000 });

    const averyPage = await request(app).get(`/contacts/${contactId}`).set(avery.headers);
    expect(averyPage.status).toBe(200);
    expect(averyPage.body.leads).toEqual([]);
    expect(averyPage.body.jobs).toEqual([]);
    expect(averyPage.body.properties).toEqual([]);
    expect(averyPage.body.other_work).toEqual([
      { rep: { id: jason.id, name: 'Jason Cox' }, leads: 1, jobs: 1 },
    ]);

    const jasonPage = await request(app).get(`/contacts/${contactId}`).set(jason.headers);
    expect(jasonPage.body.other_work).toEqual([]);
    expect(jasonPage.body.jobs).toHaveLength(1);
    expect(jasonPage.body.jobs[0]).toMatchObject({ id: job.id, contract_total: 10000, owed: 3000 });

    const averyHistory = await request(app).get(`/contacts/${contactId}/history`).set(avery.headers);
    expect(averyHistory.body.entries).toEqual([]);
    const jasonHistory = await request(app).get(`/contacts/${contactId}/history`).set(jason.headers);
    expect(jasonHistory.body.entries.map((e: { title: string }) => e.title)).toContain('Lead created');

    // Notes on the contact are for everyone; notes on Jason's lead are not.
    const note = await request(app)
      .post('/notes')
      .set(avery.headers)
      .send({ entity_type: 'contact', entity_id: contactId, body: 'Asked about gutters' });
    expect(note.status).toBe(201);
    const theirs = await request(app)
      .get('/notes')
      .query({ entity_type: 'lead', entity_id: lead.id })
      .set(avery.headers);
    expect(theirs.status).toBe(404);
    const jasonNotes = await request(app)
      .get('/notes')
      .query({ entity_type: 'contact', entity_id: contactId })
      .set(jason.headers);
    expect(jasonNotes.body.notes.map((n: { body: string }) => n.body)).toEqual(['Asked about gutters']);
  });

  it('keeps contacts inside their company', async () => {
    const owner = await member('owner');
    const outsider = await otherCompanyOwner();
    const contact = await newContact(owner, { first_name: 'Helen' });
    const theirs = await newContact(outsider, {
      first_name: 'Elsewhere',
      email: 'elsewhere@example.com',
    });

    expect((await request(app).get(`/contacts/${contact.id}`).set(outsider.headers)).status).toBe(404);
    const list = await request(app).get('/contacts').set(outsider.headers);
    expect(list.body.contacts.map((c: { id: number }) => c.id)).toEqual([theirs.id]);

    const lead = await request(app).post('/leads').set(owner.headers).send({ contact_id: theirs.id });
    expect(lead.status).toBe(404);
    const task = await request(app)
      .post('/tasks')
      .set(owner.headers)
      .send({ contact_id: theirs.id, title: 'Call' });
    expect(task.status).toBe(404);
    const note = await request(app)
      .post('/notes')
      .set(owner.headers)
      .send({ entity_type: 'contact', entity_id: theirs.id, body: 'Hi' });
    expect(note.status).toBe(404);
    const matches = await request(app)
      .get('/contacts/matches')
      .query({ email: 'elsewhere@example.com' })
      .set(owner.headers);
    expect(matches.body.matches).toEqual([]);
    const ownMatches = await request(app)
      .get('/contacts/matches')
      .query({ email: 'elsewhere@example.com' })
      .set(outsider.headers);
    expect(ownMatches.body.matches.map((m: { id: number }) => m.id)).toEqual([theirs.id]);
  });

  it('checks names, kinds and who may reassign a contact', async () => {
    const owner = await member('owner');
    const avery = await member('agent');
    const jason = await member('agent');

    expect((await request(app).post('/contacts').set(owner.headers).send({})).status).toBe(400);
    expect(
      (await request(app).post('/contacts').set(owner.headers).send({ first_name: 'X', kind: 'plumber' })).status
    ).toBe(400);

    const adjuster = await newContact(owner, { company_name: 'Acme Adjusters', kind: 'adjuster' });
    expect(adjuster).toMatchObject({ name: 'Acme Adjusters', group: 'partner', status: null });
    const partners = await request(app).get('/contacts').query({ tab: 'partners' }).set(owner.headers);
    expect(partners.body.contacts.map((c: { id: number }) => c.id)).toEqual([adjuster.id]);

    const givenAway = await request(app)
      .post('/contacts')
      .set(avery.headers)
      .send({ first_name: 'Pat', assigned_to: jason.id });
    expect(givenAway.status).toBe(403);

    const jasons = await newContact(owner, { first_name: 'Rita', assigned_to: jason.id });
    const taken = await request(app).patch(`/contacts/${jasons.id}`).set(avery.headers).send({ assigned_to: avery.id });
    expect(taken.status).toBe(403);
    const renamed = await request(app).patch(`/contacts/${jasons.id}`).set(avery.headers).send({ last_name: 'Moreno' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.contact.name).toBe('Rita Moreno');
    const moved = await request(app).patch(`/contacts/${jasons.id}`).set(owner.headers).send({ assigned_to: avery.id });
    expect(moved.status).toBe(200);
    expect(moved.body.contact.assigned_to).toBe(avery.id);

    const nobodys = await newContact(owner, { first_name: 'Sam' });
    const claimed = await request(app).patch(`/contacts/${nobodys.id}`).set(avery.headers).send({ assigned_to: avery.id });
    expect(claimed.status).toBe(200);

    const blanked = await request(app)
      .patch(`/contacts/${nobodys.id}`)
      .set(owner.headers)
      .send({ first_name: '' });
    expect(blanked.status).toBe(400);
    expect(blanked.body.error).toBe('A contact needs a name or a company name');

    await pool.query(`UPDATE contacts SET merged_into_id = $1 WHERE id = $2`, [jasons.id, nobodys.id]);
    const stale = await request(app).patch(`/contacts/${nobodys.id}`).set(owner.headers).send({ last_name: 'Ng' });
    expect(stale.status).toBe(409);
    expect(stale.body.merged_into_id).toBe(jasons.id);
    const onMerged = await request(app).post('/leads').set(owner.headers).send({ contact_id: nobodys.id });
    expect(onMerged.status).toBe(409);
  });

  it('warns about possible duplicates by phone, email and address', async () => {
    const owner = await member('owner');
    const helen = await newContact(owner, {
      first_name: 'Helen',
      phone: '(612) 555-0101',
      email: 'helen@example.com',
      address: '7 Juniper Court, Plymouth, MN 55447',
    });

    const match = async (query: Record<string, string | number>) =>
      (await request(app).get('/contacts/matches').query(query).set(owner.headers)).body.matches;

    expect(await match({ phone: '612.555.0101' })).toEqual([
      expect.objectContaining({ id: helen.id, name: 'Helen', same: ['phone'] }),
    ]);
    expect((await match({ email: 'HELEN@Example.com' }))[0].same).toEqual(['email']);
    expect((await match({ address: '7 Juniper Ct, Plymouth MN 55447-1234' }))[0].same).toEqual(['address']);
    expect(
      (await match({ phone: '6125550101', email: 'helen@example.com', address: '7 juniper court 55447' }))[0].same
    ).toEqual(['phone', 'email', 'address']);
    expect(await match({ phone: '612.555.0101', exclude: helen.id })).toEqual([]);
    expect(await match({ phone: '612.555.0199' })).toEqual([]);
  });

  it('pages the history newest first without skipping entries that share a time', async () => {
    const owner = await member('owner');
    const contact = await newContact(owner, { first_name: 'Helen' });
    for (const [type, body] of [
      ['note', 'one'],
      ['call', 'two'],
      ['note', 'three'],
      ['call', 'four'],
      ['note', 'five'],
    ]) {
      const res = await request(app)
        .post('/notes')
        .set(owner.headers)
        .send({ entity_type: 'contact', entity_id: contact.id, type, body });
      expect(res.status).toBe(201);
    }
    // Two pairs written in the same microsecond.
    await pool.query(
      `UPDATE notes SET created_at = '2026-11-01T10:00:00.123456Z' WHERE body IN ('one', 'two')`
    );
    await pool.query(
      `UPDATE notes SET created_at = '2026-11-02T10:00:00.123456Z' WHERE body IN ('three', 'four')`
    );

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const res: request.Response = await request(app)
        .get(`/contacts/${contact.id}/history`)
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .set(owner.headers);
      expect(res.status).toBe(200);
      seen.push(...res.body.entries.map((e: { body: string }) => e.body));
      cursor = res.body.next_cursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(['five', 'four', 'three', 'two', 'one']);

    const calls = await request(app)
      .get(`/contacts/${contact.id}/history`)
      .query({ kind: 'calls' })
      .set(owner.headers);
    expect(calls.body.entries.map((e: { body: string }) => e.body)).toEqual(['four', 'two']);

    const bad = await request(app)
      .get(`/contacts/${contact.id}/history`)
      .query({ cursor: 'yesterday' })
      .set(owner.headers);
    expect(bad.status).toBe(400);
  });

  it('puts tasks and follow-ups on a contact', async () => {
    const owner = await member('owner');
    const avery = await member('agent');
    const contact = await newContact(owner, { first_name: 'Helen', last_name: 'Park' });
    const due = new Date(Date.now() + 3 * 86400000).toISOString();

    const created = await request(app)
      .post('/tasks')
      .set(avery.headers)
      .send({ contact_id: contact.id, title: 'Call about gutters', due_date: due });
    expect(created.status).toBe(201);
    expect(created.body.task).toMatchObject({
      contact_id: contact.id,
      contact: { id: contact.id, name: 'Helen Park' },
      lead_id: null,
      job_id: null,
    });

    const listed = await request(app).get('/tasks').query({ contactId: contact.id }).set(avery.headers);
    expect(listed.body.tasks.map((t: { id: number }) => t.id)).toEqual([created.body.task.id]);

    const page = await request(app).get(`/contacts/${contact.id}`).set(avery.headers);
    expect(page.body.up_next).toEqual([
      expect.objectContaining({
        id: created.body.task.id,
        on: { type: 'contact', id: contact.id, label: 'Helen Park' },
      }),
    ]);

    const lead = await newLead(owner, { contact_id: contact.id });
    const both = await request(app)
      .post('/tasks')
      .set(owner.headers)
      .send({ contact_id: contact.id, lead_id: lead.id, title: 'Two owners' });
    expect(both.status).toBe(400);
    const neither = await request(app).post('/tasks').set(owner.headers).send({ title: 'No owner' });
    expect(neither.status).toBe(400);

    const moved = await request(app)
      .patch(`/tasks/${created.body.task.id}`)
      .set(avery.headers)
      .send({ contact_id: null });
    expect(moved.status).toBe(400);

    const note = await request(app).post('/notes').set(avery.headers).send({
      entity_type: 'contact',
      entity_id: contact.id,
      type: 'call',
      direction: 'outbound',
      body: 'Left a voicemail',
      follow_up_date: due,
    });
    expect(note.status).toBe(201);
    expect(note.body.note.follow_up_task.title).toBe('Follow up: call with Helen Park');
    const followUp = await pool.query(`SELECT contact_id, lead_id, job_id FROM tasks WHERE id = $1`, [
      note.body.note.follow_up_task.id,
    ]);
    expect(followUp.rows[0]).toEqual({ contact_id: contact.id, lead_id: null, job_id: null });
  });
});
