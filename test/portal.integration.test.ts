import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { resetDb } from './helpers/db';
import { ensureSchema } from './helpers/setup';

jest.setTimeout(30000);

let cookie: string;
let jobId: number;

async function register() {
  const res = await request(app)
    .post('/auth/register')
    .send({
      first_name: 'Portal',
      last_name: 'Tester',
      email: `portal-${Date.now()}@test.com`,
      password: 'Testpass1!',
    });
  return res.headers['set-cookie']?.[0] ?? '';
}

async function createJob() {
  const lead = await request(app)
    .post('/leads')
    .set('Cookie', cookie)
    .send({ first_name: 'Client', last_name: 'Smith' });
  const leadId = lead.body.lead.id;
  const job = await request(app)
    .post('/jobs')
    .set('Cookie', cookie)
    .send({ title: 'Portal Test Job', lead_id: leadId });
  return job.body.job.id;
}

beforeAll(async () => {
  await ensureSchema();
  await resetDb();
  cookie = await register();
  jobId = await createJob();
});

afterAll(async () => {
  try {
    await pool.end();
  } catch {
    /* already closed */
  }
});

describe('Customer Portal API', () => {
  let portalToken: string;

  it('POST /portal/generate/:jobId creates a portal token', async () => {
    const res = await request(app)
      .post(`/portal/generate/${jobId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.expires_at).toBeTruthy();
    portalToken = res.body.token;
  });

  it('GET /public/portal/:token returns portal data', async () => {
    const res = await request(app).get(`/public/portal/${portalToken}`);

    expect(res.status).toBe(200);
    expect(res.body.portal.job.title).toBe('Portal Test Job');
    expect(res.body.portal.job.lead_name).toBe('Client Smith');
    expect(Array.isArray(res.body.portal.estimates)).toBe(true);
    expect(Array.isArray(res.body.portal.invoices)).toBe(true);
    expect(Array.isArray(res.body.portal.files)).toBe(true);
    expect(Array.isArray(res.body.portal.timeline)).toBe(true);
  });

  it('omits client_visible=false files and returns caption and category for visible ones', async () => {
    const visible = await request(app)
      .post('/files')
      .set('Cookie', cookie)
      .field('job_id', String(jobId))
      .field('caption', 'Front elevation')
      .field('category', 'before')
      .attach('file', Buffer.from('visible-photo'), 'before.jpg');

    const hidden = await request(app)
      .post('/files')
      .set('Cookie', cookie)
      .field('job_id', String(jobId))
      .field('client_visible', 'false')
      .attach('file', Buffer.from('hidden-photo'), 'internal.jpg');

    expect(visible.status).toBe(201);
    expect(hidden.status).toBe(201);
    expect(visible.body.file.client_visible).toBe(true);

    const res = await request(app).get(`/public/portal/${portalToken}`);
    expect(res.status).toBe(200);

    const names = (res.body.portal.files || []).map(
      (f: { original_name: string }) => f.original_name
    );
    expect(names).toContain('before.jpg');
    expect(names).not.toContain('internal.jpg');

    const before = res.body.portal.files.find(
      (f: { original_name: string }) => f.original_name === 'before.jpg'
    );
    expect(before.caption).toBe('Front elevation');
    expect(before.category).toBe('before');
    expect(before.client_visible).toBeUndefined();
  });

  it('returns a curated timeline and omits internal communication activity', async () => {
    await request(app)
      .patch(`/jobs/${jobId}`)
      .set('Cookie', cookie)
      .send({ status: 'Contacted' });

    await request(app)
      .post('/notes')
      .set('Cookie', cookie)
      .send({
        entity_type: 'job',
        entity_id: jobId,
        body: 'Internal call notes should stay private',
        type: 'call',
        direction: 'outbound',
      });

    const res = await request(app).get(`/public/portal/${portalToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.portal.timeline)).toBe(true);

    const labels = (res.body.portal.timeline || []).map(
      (item: { label: string }) => item.label
    );
    expect(labels.some((label: string) => /status/i.test(label))).toBe(true);
    expect(
      labels.some((label: string) => /Internal call notes/i.test(label))
    ).toBe(false);

    const types = (res.body.portal.timeline || []).map(
      (item: { type: string }) => item.type
    );
    expect(types).not.toContain('COMMUNICATION_LOGGED');
  });

  it('GET /public/portal/invalid-token returns 404', async () => {
    const res = await request(app).get('/public/portal/bad-token-here');

    expect(res.status).toBe(404);
  });

  it('DELETE /portal/revoke/:jobId revokes the token', async () => {
    const res = await request(app)
      .delete(`/portal/revoke/${jobId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);

    const check = await request(app).get(`/public/portal/${portalToken}`);
    expect(check.status).toBe(404);
  });
});
