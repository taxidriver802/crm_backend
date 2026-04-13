/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser } from './helpers/auth';

function parseTokenFromShareUrl(shareUrl: string) {
  const m = String(shareUrl).match(/\/public\/estimate\/([^/?#]+)/);
  return m?.[1] ?? '';
}

describe('Estimates public share, PDF, resend, measurements', () => {
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
      email: 'sarah@example.com',
      phone: '555-111-2222',
      source: 'Referral',
      status: 'New',
      notes: 'Interested in roof inspection',
    });
    expect(res.status).toBe(201);
    return res.body.lead;
  }

  async function createJob(headers: Record<string, string>, leadId: number) {
    const res = await request(app).post('/jobs').set(headers).send({
      lead_id: leadId,
      title: 'Roof inspection for Sarah',
      description: 'Initial job workspace',
      status: 'New',
      address: '123 Main St',
    });
    expect(res.status).toBe(201);
    return res.body.job;
  }

  it('GET /public/estimates/:token returns 404 for invalid token', async () => {
    const res = await request(app).get(
      '/public/estimates/notavalidtokenhexnotavalidtokenhex12'
    );
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('POST /public/estimates/:token/respond creates job_activity and notification for owner', async () => {
    const { headers, user } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const estRes = await request(app).post('/estimates').set(headers).send({
      job_id: job.id,
      title: 'Client response activity',
    });
    expect(estRes.status).toBe(201);
    const estimateId = estRes.body.estimate.id;

    const shareRes = await request(app)
      .post(`/estimates/${estimateId}/share`)
      .set(headers)
      .send({});
    expect(shareRes.status).toBe(200);
    const token = parseTokenFromShareUrl(shareRes.body.share_url);
    expect(token.length).toBeGreaterThan(20);

    const respondRes = await request(app)
      .post(`/public/estimates/${token}/respond`)
      .send({ decision: 'approve', note: 'Looks good' });
    expect(respondRes.status).toBe(200);

    const { rows: activities } = await pool.query(
      `
      SELECT id, job_id, type
      FROM job_activity
      WHERE user_id = $1 AND type = 'ESTIMATE_CLIENT_RESPONDED'
      `,
      [user.id]
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].job_id).toBe(job.id);

    const { rows: notifs } = await pool.query(
      `
      SELECT id, type
      FROM notifications
      WHERE user_id = $1 AND type = 'ESTIMATE_CLIENT_RESPONDED'
      `,
      [user.id]
    );
    expect(notifs).toHaveLength(1);
  });

  it('POST /estimates/:id/resend creates ESTIMATE_RESENT_TO_CLIENT job_activity', async () => {
    const { headers, user } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const estRes = await request(app).post('/estimates').set(headers).send({
      job_id: job.id,
      title: 'Resend activity',
    });
    expect(estRes.status).toBe(201);
    const estimateId = estRes.body.estimate.id;

    const shareRes = await request(app)
      .post(`/estimates/${estimateId}/share`)
      .set(headers)
      .send({});
    expect(shareRes.status).toBe(200);
    const token = parseTokenFromShareUrl(shareRes.body.share_url);

    await request(app)
      .post(`/public/estimates/${token}/respond`)
      .send({ decision: 'revision', note: 'Change scope' });
    expect(
      (
        await request(app)
          .post(`/estimates/${estimateId}/resend`)
          .set(headers)
          .send({})
      ).status
    ).toBe(200);

    const { rows } = await pool.query(
      `
      SELECT type FROM job_activity
      WHERE user_id = $1 AND type = 'ESTIMATE_RESENT_TO_CLIENT'
      `,
      [user.id]
    );
    expect(rows).toHaveLength(1);
  });

  it('POST /estimates/:id/share then GET public + PDF; respond revision; resend clears and sets Sent', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const estRes = await request(app).post('/estimates').set(headers).send({
      job_id: job.id,
      title: 'Shared estimate',
    });
    expect(estRes.status).toBe(201);
    const estimateId = estRes.body.estimate.id;

    await request(app)
      .post(`/estimates/${estimateId}/line-items`)
      .set(headers)
      .send({
        name: 'Item A',
        quantity: 1,
        unit_price: 100,
        source: 'manual',
      });

    const shareRes = await request(app)
      .post(`/estimates/${estimateId}/share`)
      .set(headers)
      .send({});
    expect(shareRes.status).toBe(200);
    expect(shareRes.body.ok).toBe(true);
    expect(shareRes.body.share_url).toBeTruthy();

    const token = parseTokenFromShareUrl(shareRes.body.share_url);
    expect(token.length).toBeGreaterThan(20);

    const pubGet = await request(app).get(`/public/estimates/${token}`);
    expect(pubGet.status).toBe(200);
    expect(pubGet.body.ok).toBe(true);
    expect(pubGet.body.estimate.title).toBe('Shared estimate');

    const pubPdf = await request(app).get(`/public/estimates/${token}/pdf`);
    expect(pubPdf.status).toBe(200);
    expect(String(pubPdf.headers['content-type'])).toContain('application/pdf');

    const authPdf = await request(app)
      .get(`/estimates/${estimateId}/pdf`)
      .set(headers);
    expect(authPdf.status).toBe(200);
    expect(String(authPdf.headers['content-type'])).toContain(
      'application/pdf'
    );

    const respondRes = await request(app)
      .post(`/public/estimates/${token}/respond`)
      .send({ decision: 'revision', note: 'Please add ridge vent line' });
    expect(respondRes.status).toBe(200);
    expect(respondRes.body.estimate.status).toBe('Draft');
    expect(respondRes.body.estimate.client_response_note).toBe(
      'Please add ridge vent line'
    );

    const detailAfter = await request(app)
      .get(`/estimates/${estimateId}`)
      .set(headers);
    expect(detailAfter.body.estimate.status).toBe('Draft');
    expect(detailAfter.body.estimate.client_responded_at).toBeTruthy();

    const resendRes = await request(app)
      .post(`/estimates/${estimateId}/resend`)
      .set(headers)
      .send({});
    expect(resendRes.status).toBe(200);
    expect(resendRes.body.estimate.status).toBe('Sent');
    expect(resendRes.body.estimate.client_responded_at).toBeNull();
    expect(resendRes.body.estimate.client_response_note).toBeNull();

    const newToken = parseTokenFromShareUrl(resendRes.body.share_url);
    expect(newToken).not.toBe(token);

    const oldLink = await request(app).get(`/public/estimates/${token}`);
    expect(oldLink.status).toBe(404);

    const newLink = await request(app).get(`/public/estimates/${newToken}`);
    expect(newLink.status).toBe(200);
  });

  it('POST /estimates/:id/resend returns 400 when there is no client response yet', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const estRes = await request(app).post('/estimates').set(headers).send({
      job_id: job.id,
      title: 'No response yet',
    });
    const estimateId = estRes.body.estimate.id;

    const res = await request(app)
      .post(`/estimates/${estimateId}/resend`)
      .set(headers)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('GET/POST /jobs/:id/measurements CRUD happy path', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const empty = await request(app)
      .get(`/jobs/${job.id}/measurements`)
      .set(headers);
    expect(empty.status).toBe(200);
    expect(empty.body.measurements).toEqual([]);

    const createRes = await request(app)
      .post(`/jobs/${job.id}/measurements`)
      .set(headers)
      .send({
        label: 'Main roof',
        value: 2400,
        unit: 'sq ft',
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.measurement.label).toBe('Main roof');
    expect(Number(createRes.body.measurement.value)).toBe(2400);

    const mid = createRes.body.measurement.id;

    const patchRes = await request(app)
      .patch(`/jobs/${job.id}/measurements/${mid}`)
      .set(headers)
      .send({ label: 'Main roof area', value: 2500 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.measurement.value).toBe(2500);

    const delRes = await request(app)
      .delete(`/jobs/${job.id}/measurements/${mid}`)
      .set(headers);
    expect(delRes.status).toBe(200);

    const after = await request(app)
      .get(`/jobs/${job.id}/measurements`)
      .set(headers);
    expect(after.body.measurements).toHaveLength(0);
  });
});
