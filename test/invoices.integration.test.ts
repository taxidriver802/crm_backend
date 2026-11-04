import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { resetDb } from './helpers/db';
import { ensureSchema } from './helpers/setup';

jest.setTimeout(30000);

let cookie: string;
let jobId: number;
let estimateId: number;

async function register() {
  const res = await request(app)
    .post('/auth/register')
    .send({
      first_name: 'Inv',
      last_name: 'Tester',
      email: `inv-${Date.now()}@test.com`,
      password: 'Testpass1!',
      company_name: 'Invoice Test Co',
    });
  return res.headers['set-cookie']?.[0] ?? '';
}

async function createJob() {
  const lead = await request(app)
    .post('/leads')
    .set('Cookie', cookie)
    .send({ first_name: 'Jane', last_name: 'Doe' });
  const leadId = lead.body.lead.id;

  const job = await request(app)
    .post('/jobs')
    .set('Cookie', cookie)
    .send({ title: 'Roofing Job', lead_id: leadId });
  return job.body.job.id;
}

async function createApprovedEstimate() {
  const est = await request(app)
    .post('/estimates')
    .set('Cookie', cookie)
    .send({ job_id: jobId, title: 'Roof Estimate' });
  const eid = est.body.estimate.id;

  await request(app)
    .post(`/estimates/${eid}/line-items`)
    .set('Cookie', cookie)
    .send({ name: 'Shingles', quantity: 10, unit_price: 50 });

  await request(app)
    .patch(`/estimates/${eid}`)
    .set('Cookie', cookie)
    .send({ status: 'Approved' });

  return eid;
}

beforeAll(async () => {
  await ensureSchema();
  await resetDb();
  cookie = await register();
  jobId = await createJob();
  estimateId = await createApprovedEstimate();
});

afterAll(async () => {
  try {
    await pool.end();
  } catch {
    /* already closed */
  }
});

describe('Invoices API', () => {
  let invoiceId: number;

  it('POST /invoices/from-estimate/:id creates invoice from estimate', async () => {
    const res = await request(app)
      .post(`/invoices/from-estimate/${estimateId}`)
      .set('Cookie', cookie)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.invoice.estimate_id).toBe(estimateId);
    expect(res.body.invoice.invoice_number).toMatch(/^INV-/);
    expect(res.body.invoice.line_items.length).toBeGreaterThan(0);
    expect(res.body.invoice.grand_total).toBeGreaterThan(0);
    invoiceId = res.body.invoice.id;
  });

  it('GET /invoices/:id returns the invoice', async () => {
    const res = await request(app)
      .get(`/invoices/${invoiceId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.invoice.id).toBe(invoiceId);
    expect(res.body.invoice.line_items.length).toBeGreaterThan(0);
  });

  it('GET /invoices/job/:jobId lists invoices', async () => {
    const res = await request(app)
      .get(`/invoices/job/${jobId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.invoices.length).toBeGreaterThanOrEqual(1);
  });

  it('PATCH /invoices/:id updates status', async () => {
    const res = await request(app)
      .patch(`/invoices/${invoiceId}`)
      .set('Cookie', cookie)
      .send({ status: 'Sent' });

    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('Sent');
  });

  it('PATCH /invoices/:id marks as Paid and sets paid_at', async () => {
    const res = await request(app)
      .patch(`/invoices/${invoiceId}`)
      .set('Cookie', cookie)
      .send({ status: 'Paid' });

    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('Paid');
    expect(res.body.invoice.paid_at).toBeTruthy();
    // Marking paid records the balance as a payment so the ledger agrees.
    expect(res.body.invoice.payments).toHaveLength(1);
    expect(res.body.invoice.amount_paid).toBe(res.body.invoice.grand_total);
    expect(res.body.invoice.balance_due).toBe(0);
  });

  let manualInvoiceId: number;

  it('POST /invoices creates a blank invoice', async () => {
    const res = await request(app)
      .post('/invoices')
      .set('Cookie', cookie)
      .send({ job_id: jobId, notes: 'Manual invoice' });

    expect(res.status).toBe(201);
    expect(res.body.invoice.invoice_number).toMatch(/^INV-/);
    expect(res.body.invoice.notes).toBe('Manual invoice');
    manualInvoiceId = res.body.invoice.id;
  });

  it('POST /invoices/:id/line-items adds a line item', async () => {
    const res = await request(app)
      .post(`/invoices/${manualInvoiceId}/line-items`)
      .set('Cookie', cookie)
      .send({ name: 'Labor', quantity: 8, unit_price: 75 });

    expect(res.status).toBe(201);
    const items = res.body.invoice.line_items;
    const labor = items.find((i: any) => i.name === 'Labor');
    expect(labor).toBeTruthy();
    expect(labor.line_total).toBe(600);
  });

  it('POST /invoices/:id/line-items is refused once payments exist', async () => {
    const res = await request(app)
      .post(`/invoices/${invoiceId}/line-items`)
      .set('Cookie', cookie)
      .send({ name: 'Labor', quantity: 8, unit_price: 75 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/locked/i);
  });

  it('GET /invoices/:id/pdf returns a PDF', async () => {
    const res = await request(app)
      .get(`/invoices/${invoiceId}/pdf`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('POST /invoices/:id/share returns a share link', async () => {
    const res = await request(app)
      .post(`/invoices/${invoiceId}/share`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.share_url).toContain('/public/invoice/');
    expect(res.body.share_expires_at).toBeTruthy();

    // The link the client receives resolves (it used to 404).
    const token = res.body.share_url.split('/public/invoice/')[1];
    const pub = await request(app).get(`/public/invoices/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.invoice.balance_due).toBe(0);
    expect(pub.body.invoice.payments[0]).not.toHaveProperty('notes');
  });

  it('DELETE /invoices/:id deletes the invoice', async () => {
    const create = await request(app)
      .post('/invoices')
      .set('Cookie', cookie)
      .send({ job_id: jobId });

    const newId = create.body.invoice.id;
    const res = await request(app)
      .delete(`/invoices/${newId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.deletedId).toBe(newId);

    const get = await request(app)
      .get(`/invoices/${newId}`)
      .set('Cookie', cookie);
    expect(get.status).toBe(404);
  });

  it('POST /invoices/from-estimate fails for non-approved estimate', async () => {
    const est = await request(app)
      .post('/estimates')
      .set('Cookie', cookie)
      .send({ job_id: jobId, title: 'Draft Est' });
    const draftId = est.body.estimate.id;

    const res = await request(app)
      .post(`/invoices/from-estimate/${draftId}`)
      .set('Cookie', cookie)
      .send({});

    expect(res.status).toBe(404);
  });
});
