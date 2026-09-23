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
} from './helpers/auth';
import { resetIntakeRateLimit } from '../src/lib/intakeRateLimit';

jest.setTimeout(30000);

async function authedOwner(overrides: {
  company_id: string;
  first_name: string;
  last_name: string;
  email?: string;
}) {
  const user = await createTestUser({
    role: 'owner',
    company_id: overrides.company_id,
    first_name: overrides.first_name,
    last_name: overrides.last_name,
    email: overrides.email,
  });
  return { user, headers: authHeaderFor(user) };
}

async function createLead(
  headers: Record<string, string>,
  body: { first_name: string; last_name: string }
) {
  const res = await request(app).post('/leads').set(headers).send({
    first_name: body.first_name,
    last_name: body.last_name,
    source: 'Referral',
    status: 'New',
  });
  expect(res.status).toBe(201);
  return res.body.lead;
}

describe('Phase 20 company isolation', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
    resetIntakeRateLimit();
  });

  afterAll(async () => {
    await resetDb();
  });

  it('keeps owner A from reading owner B leads, users, assignees, files, search, and intake', async () => {
    const companyA = await pool.query(
      `SELECT id FROM companies WHERE slug = 'rooftop'`
    );
    const companyB = await createTestCompany({
      name: 'Northside Roofing',
      slug: 'northside-iso',
    });

    const ownerA = await authedOwner({
      company_id: companyA.rows[0].id,
      first_name: 'Ava',
      last_name: 'Ashwood',
      email: 'ava-iso@example.com',
    });
    const ownerB = await authedOwner({
      company_id: companyB.id,
      first_name: 'Blake',
      last_name: 'Bravard',
      email: 'blake-iso@example.com',
    });
    const agentB = await createTestUser({
      role: 'agent',
      company_id: companyB.id,
      first_name: 'Casey',
      last_name: 'Cobalt',
      email: 'casey-iso@example.com',
    });

    const leadA = await createLead(ownerA.headers, {
      first_name: 'AvaLead',
      last_name: 'Alpha',
    });
    const leadB = await createLead(ownerB.headers, {
      first_name: 'BlakeLead',
      last_name: 'Bravo',
    });

    const teamLeads = await request(app)
      .get('/leads?view=all')
      .set(ownerA.headers);
    expect(teamLeads.status).toBe(200);
    const teamLeadIds = (teamLeads.body.leads as Array<{ id: number }>).map(
      (row) => row.id
    );
    expect(teamLeadIds).toContain(leadA.id);
    expect(teamLeadIds).not.toContain(leadB.id);

    const crossLead = await request(app)
      .get(`/leads/${leadB.id}`)
      .set(ownerA.headers);
    expect(crossLead.status).toBe(404);

    const usersA = await request(app).get('/users').set(ownerA.headers);
    expect(usersA.status).toBe(200);
    const userIds = (usersA.body.users as Array<{ id: string }>).map(
      (row) => row.id
    );
    expect(userIds).toContain(ownerA.user.id);
    expect(userIds).not.toContain(ownerB.user.id);
    expect(userIds).not.toContain(agentB.id);

    const assignB = await request(app)
      .patch(`/leads/${leadA.id}`)
      .set(ownerA.headers)
      .send({ assigned_to: agentB.id });
    expect(assignB.status).toBe(404);

    const genB = await request(app)
      .post('/intake/generate')
      .set(ownerB.headers);
    expect(genB.status).toBe(201);
    const submitB = await request(app)
      .post(`/public/intake/${genB.body.token}`)
      .send({
        first_name: 'Intake',
        last_name: 'Visitor',
        email: 'intake-visitor@example.com',
        message: 'Need a quote.',
      });
    expect(submitB.status).toBe(201);

    const intakeLead = await pool.query(
      `SELECT id, company_id FROM leads WHERE email = $1`,
      ['intake-visitor@example.com']
    );
    expect(intakeLead.rowCount).toBe(1);
    expect(intakeLead.rows[0].company_id).toBe(companyB.id);

    const afterIntake = await request(app)
      .get('/leads?view=all')
      .set(ownerA.headers);
    const afterIds = (afterIntake.body.leads as Array<{ id: number }>).map(
      (row) => row.id
    );
    expect(afterIds).not.toContain(intakeLead.rows[0].id);

    const uploadA = await request(app)
      .post('/files')
      .set(ownerA.headers)
      .field('lead_id', String(leadA.id))
      .attach('file', Buffer.from('company-a-secret'), 'secret.txt');
    expect(uploadA.status).toBe(201);
    const storageKey = String(uploadA.body.file.storage_key);
    expect(storageKey).toContain('/');

    const fileAsB = await request(app)
      .get(`/uploads/${storageKey}`)
      .set(ownerB.headers);
    expect(fileAsB.status).toBe(404);

    const fileAsA = await request(app)
      .get(`/uploads/${storageKey}`)
      .set(ownerA.headers);
    expect(fileAsA.status).toBe(200);
    expect(fileAsA.text).toBe('company-a-secret');

    const searchOwn = await request(app)
      .get('/search')
      .query({ q: 'Ashwood', types: 'users' })
      .set(ownerA.headers);
    expect(searchOwn.status).toBe(200);
    expect(
      ((searchOwn.body.users as Array<{ id: string }>) ?? []).map(
        (row) => row.id
      )
    ).toContain(ownerA.user.id);

    const searchB = await request(app)
      .get('/search')
      .query({ q: 'Bravard', types: 'users' })
      .set(ownerA.headers);
    expect(searchB.status).toBe(200);
    const foundUsers = (searchB.body.users as Array<{ id: string }>) ?? [];
    expect(foundUsers.map((row) => row.id)).not.toContain(ownerB.user.id);
    expect(foundUsers.map((row) => row.id)).not.toContain(agentB.id);
  });
});
