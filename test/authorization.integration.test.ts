import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { resetDb } from './helpers/db';
import { ensureSchema } from './helpers/setup';

jest.setTimeout(30000);

let ownerCookie: string;
let agentCookie: string;
let jobId: number;

beforeAll(async () => {
  await ensureSchema();
  await resetDb();

  const ownerRes = await request(app)
    .post('/auth/register')
    .send({
      first_name: 'Owner',
      last_name: 'User',
      email: `owner-${Date.now()}@test.com`,
      password: 'Testpass1!',
    });
  ownerCookie = ownerRes.headers['set-cookie']?.[0] ?? '';

  const agentEmail = `agent-${Date.now()}@test.com`;
  const inviteRes = await request(app)
    .post('/users/invite')
    .set('Cookie', ownerCookie)
    .send({
      email: agentEmail,
      first_name: 'Agent',
      last_name: 'User',
      role: 'agent',
    });

  const inviteUrl = inviteRes.body?.invite_url || '';
  const inviteToken = inviteUrl.split('token=')[1] || '';
  if (inviteToken) {
    const agentRegRes = await request(app)
      .post('/auth/accept-invite')
      .send({ token: inviteToken, password: 'Testpass1!' });
    agentCookie = agentRegRes.headers['set-cookie']?.[0] ?? '';
  }

  if (!agentCookie) {
    const agentDirectRes = await request(app)
      .post('/auth/register')
      .send({
        first_name: 'Agent',
        last_name: 'User',
        email: `agent-direct-${Date.now()}@test.com`,
        password: 'Testpass1!',
      });
    agentCookie = agentDirectRes.headers['set-cookie']?.[0] ?? '';
  }

  const lead = await request(app)
    .post('/leads')
    .set('Cookie', ownerCookie)
    .send({ first_name: 'Auth', last_name: 'Test' });
  const job = await request(app)
    .post('/jobs')
    .set('Cookie', ownerCookie)
    .send({ title: 'Auth Job', lead_id: lead.body.lead.id });
  jobId = job.body.job.id;
});

afterAll(async () => {
  try {
    await pool.end();
  } catch {
    /* already closed */
  }
});

describe('Role-based access', () => {
  it('agents cannot access automation rules', async () => {
    const res = await request(app)
      .get('/automation/rules')
      .set('Cookie', agentCookie);
    expect(res.status).toBe(403);
  });

  it('agents cannot create automation rules', async () => {
    const res = await request(app)
      .post('/automation/rules')
      .set('Cookie', agentCookie)
      .send({
        name: 'test',
        trigger_event: 'JOB_STATUS_CHANGED',
        action_type: 'SEND_NOTIFICATION',
      });
    expect(res.status).toBe(403);
  });

  it('agents cannot generate portal tokens', async () => {
    const res = await request(app)
      .post(`/portal/generate/${jobId}`)
      .set('Cookie', agentCookie);
    expect(res.status).toBe(403);
  });

  it('agents cannot revoke portal tokens', async () => {
    const res = await request(app)
      .delete(`/portal/revoke/${jobId}`)
      .set('Cookie', agentCookie);
    expect(res.status).toBe(403);
  });

  it('owners can access automation rules', async () => {
    const res = await request(app)
      .get('/automation/rules')
      .set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
  });

  it('owners can generate portal tokens', async () => {
    const res = await request(app)
      .post(`/portal/generate/${jobId}`)
      .set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
  });

  it('unauthenticated requests to protected routes return 401', async () => {
    const routes = [
      { method: 'get', path: '/invoices/1' },
      { method: 'get', path: '/automation/rules' },
      { method: 'post', path: `/portal/generate/${jobId}` },
      { method: 'get', path: '/integrations/quickbooks/status' },
    ];

    for (const r of routes) {
      const res = await (request(app) as any)[r.method](r.path);
      expect(res.status).toBe(401);
    }
  });
});

describe('Idempotency', () => {
  it('creating invoice from estimate twice returns the same invoice', async () => {
    const est = await request(app)
      .post('/estimates')
      .set('Cookie', ownerCookie)
      .send({ job_id: jobId, title: 'Idem Est' });
    const eid = est.body.estimate.id;

    await request(app)
      .post(`/estimates/${eid}/line-items`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Item', quantity: 1, unit_price: 100 });

    await request(app)
      .patch(`/estimates/${eid}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'Approved' });

    const first = await request(app)
      .post(`/invoices/from-estimate/${eid}`)
      .set('Cookie', ownerCookie);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/invoices/from-estimate/${eid}`)
      .set('Cookie', ownerCookie);

    expect(second.body.invoice.id).toBe(first.body.invoice.id);
  });
});
