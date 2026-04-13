/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser } from './helpers/auth';

describe('Estimates integration', () => {
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
    expect(res.body.ok).toBe(true);
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
    expect(res.body.ok).toBe(true);
    return res.body.job;
  }

  it('POST /estimates creates a draft estimate for a job', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const res = await request(app).post('/estimates').set(headers).send({
      job_id: job.id,
      title: 'Initial estimate',
      notes: 'First draft for customer',
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.estimate.title).toBe('Initial estimate');
    expect(res.body.estimate.status).toBe('Draft');
    expect(res.body.estimate.job_id).toBe(job.id);
    expect(res.body.estimate.subtotal).toBe(0);
    expect(res.body.estimate.tax_total).toBe(0);
    expect(res.body.estimate.discount_total).toBe(0);
    expect(res.body.estimate.grand_total).toBe(0);
    expect(Array.isArray(res.body.estimate.line_items)).toBe(true);
    expect(res.body.estimate.line_items).toHaveLength(0);

    const notifRes = await request(app)
      .get('/notifications?limit=20')
      .set(headers);
    expect(notifRes.status).toBe(200);
    expect(
      notifRes.body.notifications.some(
        (n: { type: string }) => n.type === 'ESTIMATE_CREATED'
      )
    ).toBe(true);
  });

  it('GET /estimates/job/:jobId returns estimates for that job only', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const jobA = await createJob(headers, lead.id);
    const jobB = await createJob(headers, lead.id);

    const estimateA = await request(app).post('/estimates').set(headers).send({
      job_id: jobA.id,
      title: 'Estimate A',
    });

    const estimateB = await request(app).post('/estimates').set(headers).send({
      job_id: jobB.id,
      title: 'Estimate B',
    });

    expect(estimateA.status).toBe(201);
    expect(estimateB.status).toBe(201);

    const res = await request(app)
      .get(`/estimates/job/${jobA.id}`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.estimates)).toBe(true);
    expect(res.body.estimates).toHaveLength(1);
    expect(res.body.estimates[0].job_id).toBe(jobA.id);
    expect(res.body.estimates[0].title).toBe('Estimate A');
  });

  it('POST /estimates/:id/line-items adds a line item and recalculates totals', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const estimateRes = await request(app)
      .post('/estimates')
      .set(headers)
      .send({
        job_id: job.id,
        title: 'Roof replacement estimate',
      });

    const estimateId = estimateRes.body.estimate.id;

    const res = await request(app)
      .post(`/estimates/${estimateId}/line-items`)
      .set(headers)
      .send({
        name: 'Shingles',
        description: 'Architectural shingles',
        quantity: 10,
        unit_price: 125.5,
        sort_order: 1,
        source: 'manual',
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.estimate.id).toBe(estimateId);
    expect(res.body.estimate.line_items).toHaveLength(1);

    const item = res.body.estimate.line_items[0];
    expect(item.name).toBe('Shingles');
    expect(item.quantity).toBe(10);
    expect(item.unit_price).toBe(125.5);
    expect(item.line_total).toBe(1255);

    expect(res.body.estimate.subtotal).toBe(1255);
    expect(res.body.estimate.tax_total).toBe(0);
    expect(res.body.estimate.discount_total).toBe(0);
    expect(res.body.estimate.grand_total).toBe(1255);
  });

  it('PATCH /estimates/:id/line-items/:lineItemId updates a line item and recalculates totals', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const estimateRes = await request(app)
      .post('/estimates')
      .set(headers)
      .send({
        job_id: job.id,
        title: 'Roof replacement estimate',
      });

    const estimateId = estimateRes.body.estimate.id;

    const addItemRes = await request(app)
      .post(`/estimates/${estimateId}/line-items`)
      .set(headers)
      .send({
        name: 'Labor',
        quantity: 2,
        unit_price: 300,
        sort_order: 1,
        source: 'manual',
      });

    const lineItemId = addItemRes.body.estimate.line_items[0].id;

    const patchRes = await request(app)
      .patch(`/estimates/${estimateId}/line-items/${lineItemId}`)
      .set(headers)
      .send({
        quantity: 3,
        unit_price: 325,
        description: 'Updated labor pricing',
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.ok).toBe(true);

    const updated = patchRes.body.estimate.line_items[0];
    expect(updated.quantity).toBe(3);
    expect(updated.unit_price).toBe(325);
    expect(updated.line_total).toBe(975);
    expect(updated.description).toBe('Updated labor pricing');

    expect(patchRes.body.estimate.subtotal).toBe(975);
    expect(patchRes.body.estimate.grand_total).toBe(975);
  });

  it('GET /estimates/:id returns estimate with line items', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const estimateRes = await request(app)
      .post('/estimates')
      .set(headers)
      .send({
        job_id: job.id,
        title: 'Detailed estimate',
      });

    const estimateId = estimateRes.body.estimate.id;

    await request(app)
      .post(`/estimates/${estimateId}/line-items`)
      .set(headers)
      .send({
        name: 'Underlayment',
        quantity: 5,
        unit_price: 40,
        sort_order: 1,
      });

    const res = await request(app).get(`/estimates/${estimateId}`).set(headers);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.estimate.id).toBe(estimateId);
    expect(res.body.estimate.job.id).toBe(job.id);
    expect(res.body.estimate.job.title).toBe(job.title);
    expect(res.body.estimate.line_items).toHaveLength(1);
    expect(res.body.estimate.subtotal).toBe(200);
    expect(res.body.estimate.grand_total).toBe(200);
  });

  it('returns 404 when creating an estimate for a job that does not belong to the user', async () => {
    const ownerA = await createAuthedUser('agent');
    const ownerB = await createAuthedUser('agent');

    const leadA = await createLead(ownerA.headers);
    const jobA = await createJob(ownerA.headers, leadA.id);

    const res = await request(app).post('/estimates').set(ownerB.headers).send({
      job_id: jobA.id,
      title: 'Unauthorized estimate',
    });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('returns 404 when updating a missing line item', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const estimateRes = await request(app)
      .post('/estimates')
      .set(headers)
      .send({
        job_id: job.id,
        title: 'Missing line item test',
      });

    const estimateId = estimateRes.body.estimate.id;

    const res = await request(app)
      .patch(`/estimates/${estimateId}/line-items/99999`)
      .set(headers)
      .send({
        quantity: 2,
      });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('PATCH /estimates/:id status change creates ESTIMATE_STATUS_CHANGED notification', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const estimateRes = await request(app)
      .post('/estimates')
      .set(headers)
      .send({
        job_id: job.id,
        title: 'Status notif test',
      });

    const estimateId = estimateRes.body.estimate.id;

    const patchRes = await request(app)
      .patch(`/estimates/${estimateId}`)
      .set(headers)
      .send({ status: 'Sent' });

    expect(patchRes.status).toBe(200);

    const notifRes = await request(app)
      .get('/notifications?limit=20')
      .set(headers);
    expect(notifRes.status).toBe(200);
    expect(
      notifRes.body.notifications.some(
        (n: { type: string }) => n.type === 'ESTIMATE_STATUS_CHANGED'
      )
    ).toBe(true);
  });

  it('DELETE /estimates/:id records ESTIMATE_DELETED job_activity', async () => {
    const { headers, user } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);

    const estimateRes = await request(app)
      .post('/estimates')
      .set(headers)
      .send({
        job_id: job.id,
        title: 'To delete',
      });

    const estimateId = estimateRes.body.estimate.id;

    const delRes = await request(app)
      .delete(`/estimates/${estimateId}`)
      .set(headers);
    expect(delRes.status).toBe(200);

    const { rows } = await pool.query(
      `
      SELECT type, job_id
      FROM job_activity
      WHERE user_id = $1 AND type = 'ESTIMATE_DELETED' AND entity_id = $2
      `,
      [user.id, estimateId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].job_id).toBe(job.id);
  });
});
