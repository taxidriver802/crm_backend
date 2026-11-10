import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { resetDb } from './helpers/db';
import { ensureSchema } from './helpers/setup';

jest.setTimeout(30000);

let cookie: string;
let jobId: number;
let contractId: number;

async function register() {
  const res = await request(app)
    .post('/auth/register')
    .send({
      first_name: 'Cash',
      last_name: 'Ledger',
      email: `cash-${Date.now()}@test.com`,
      password: 'Testpass1!',
      company_name: 'Ledger Test Co',
    });
  return res.headers['set-cookie']?.[0] ?? '';
}

beforeAll(async () => {
  await ensureSchema();
  await resetDb();
  cookie = await register();

  const lead = await request(app)
    .post('/leads')
    .set('Cookie', cookie)
    .send({ first_name: 'Ada', last_name: 'Client' });
  const job = await request(app)
    .post('/jobs')
    .set('Cookie', cookie)
    .send({ title: 'Main roof', lead_id: lead.body.lead.id });
  jobId = job.body.job.id;
});

afterAll(async () => {
  try {
    await pool.end();
  } catch {
    /* already closed */
  }
});

async function addLine(estimateId: number, name: string, unitPrice: number) {
  const res = await request(app)
    .post(`/estimates/${estimateId}/line-items`)
    .set('Cookie', cookie)
    .send({ name, quantity: 1, unit_price: unitPrice });
  expect(res.status).toBe(201);
  return res.body.estimate;
}

describe('contract and payments', () => {
  it('rejects a deposit before anything is accepted', async () => {
    const res = await request(app)
      .post(`/jobs/${jobId}/payments`)
      .set('Cookie', cookie)
      .send({ amount: 10, method: 'cash' });
    expect(res.status).toBe(400);
  });

  it('rejects a credit on a proposal', async () => {
    const created = await request(app)
      .post('/estimates')
      .set('Cookie', cookie)
      .send({ job_id: jobId, title: 'Roof replacement' });
    contractId = created.body.estimate.id;

    const res = await request(app)
      .post(`/estimates/${contractId}/line-items`)
      .set('Cookie', cookie)
      .send({ name: 'Credit', quantity: 1, unit_price: -5 });
    expect(res.status).toBe(400);
  });

  it('turns client acceptance into the contract and keeps a payment ledger', async () => {
    const lined = await addLine(contractId, 'Roof replacement', 100);
    expect(lined.grand_total).toBe(100);

    const share = await request(app)
      .post(`/estimates/${contractId}/share`)
      .set('Cookie', cookie);
    expect(share.status).toBe(200);
    const token = String(share.body.share_url).split('/').pop();

    const accepted = await request(app)
      .post(`/public/estimates/${token}/respond`)
      .send({ decision: 'approve', note: 'Go ahead' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.estimate.status).toBe('Approved');
    expect(accepted.body.estimate.is_contract).toBe(true);

    const locked = await request(app)
      .post(`/estimates/${contractId}/line-items`)
      .set('Cookie', cookie)
      .send({ name: 'Extra', quantity: 1, unit_price: 5 });
    expect(locked.status).toBe(409);

    let money = await request(app)
      .get(`/jobs/${jobId}/money`)
      .set('Cookie', cookie);
    expect(money.status).toBe(200);
    expect(money.body.money.has_contract).toBe(true);
    expect(money.body.money.contract_total).toBe(100);
    expect(money.body.money.collected).toBe(0);
    expect(money.body.money.still_owed).toBe(100);

    const deposit = await request(app)
      .post(`/jobs/${jobId}/payments`)
      .set('Cookie', cookie)
      .send({ amount: 40, method: 'check', reference: '1042' });
    expect(deposit.status).toBe(201);
    expect(deposit.body.payment.invoice_id).toBeNull();
    expect(deposit.body.payment.amount).toBe(40);
    const depositId = deposit.body.payment.id;

    const added = await request(app)
      .post(`/jobs/${jobId}/change-orders`)
      .set('Cookie', cookie)
      .send({ title: 'Skylight' });
    expect(added.status).toBe(201);
    expect(added.body.estimate.kind).toBe('change_order');
    const additionId = added.body.estimate.id;
    const priced = await addLine(additionId, 'Skylight', 25);
    expect(priced.grand_total).toBe(25);

    const approvedAdd = await request(app)
      .patch(`/estimates/${additionId}`)
      .set('Cookie', cookie)
      .send({ status: 'Approved' });
    expect(approvedAdd.status).toBe(200);
    expect(approvedAdd.body.estimate.kind).toBe('change_order');

    const credit = await request(app)
      .post(`/jobs/${jobId}/change-orders`)
      .set('Cookie', cookie)
      .send({ title: 'Remove gutters' });
    const creditId = credit.body.estimate.id;
    const credited = await addLine(creditId, 'Gutters removed', -10);
    expect(credited.grand_total).toBe(-10);
    const approvedCredit = await request(app)
      .patch(`/estimates/${creditId}`)
      .set('Cookie', cookie)
      .send({ status: 'Approved' });
    expect(approvedCredit.status).toBe(200);

    const reopen = await request(app)
      .patch(`/estimates/${contractId}`)
      .set('Cookie', cookie)
      .send({ status: 'Draft' });
    expect(reopen.status).toBe(409);

    money = await request(app).get(`/jobs/${jobId}/money`).set('Cookie', cookie);
    expect(money.body.money.contract_total).toBe(115);
    expect(money.body.money.collected).toBe(40);
    expect(money.body.money.still_owed).toBe(75);
    expect(money.body.money.change_orders).toHaveLength(2);

    const invoice = await request(app)
      .post(`/invoices/from-estimate/${contractId}`)
      .set('Cookie', cookie)
      .send({});
    expect(invoice.status).toBe(201);
    const invoiceId = invoice.body.invoice.id;
    expect(invoice.body.invoice.grand_total).toBe(100);

    const draftPay = await request(app)
      .post(`/jobs/${jobId}/payments`)
      .set('Cookie', cookie)
      .send({ amount: 5, method: 'cash', invoice_id: invoiceId });
    expect(draftPay.status).toBe(400);

    const sent = await request(app)
      .patch(`/invoices/${invoiceId}`)
      .set('Cookie', cookie)
      .send({ status: 'Sent' });
    expect(sent.status).toBe(200);

    const applied = await request(app)
      .post(`/jobs/${jobId}/payments/${depositId}/apply`)
      .set('Cookie', cookie)
      .send({ invoice_id: invoiceId });
    expect(applied.status).toBe(200);
    const partial = applied.body.money.invoices.find(
      (row: { id: number }) => row.id === invoiceId
    );
    expect(partial.status).toBe('Partial');
    expect(partial.amount_paid).toBe(40);
    expect(partial.balance_due).toBe(60);

    const paid = await request(app)
      .patch(`/invoices/${invoiceId}`)
      .set('Cookie', cookie)
      .send({ status: 'Paid' });
    expect(paid.status).toBe(200);
    expect(paid.body.invoice.status).toBe('Paid');
    expect(paid.body.invoice.amount_paid).toBe(100);
    expect(paid.body.invoice.paid_at).toBeTruthy();

    const skylightInvoice = await request(app)
      .post(`/invoices/from-estimate/${additionId}`)
      .set('Cookie', cookie)
      .send({});
    const skylightId = skylightInvoice.body.invoice.id;
    await request(app)
      .patch(`/invoices/${skylightId}`)
      .set('Cookie', cookie)
      .send({ status: 'Sent' });
    const secondDeposit = await request(app)
      .post(`/jobs/${jobId}/payments`)
      .set('Cookie', cookie)
      .send({ amount: 10, method: 'cash' });
    expect(secondDeposit.status).toBe(201);

    const settled = await request(app)
      .patch(`/invoices/${skylightId}`)
      .set('Cookie', cookie)
      .send({ status: 'Paid' });
    expect(settled.status).toBe(200);
    expect(settled.body.invoice.status).toBe('Paid');
    expect(settled.body.invoice.amount_paid).toBe(25);

    money = await request(app).get(`/jobs/${jobId}/money`).set('Cookie', cookie);
    // 40 deposit + 60 remainder on the contract invoice + 10 deposit + 15 remainder.
    expect(money.body.money.collected).toBe(125);
    expect(money.body.money.still_owed).toBe(-10);
    const ten = money.body.money.payments.find(
      (row: { amount: number }) => row.amount === 10
    );
    expect(ten.invoice_id).toBe(skylightId);
    expect(
      money.body.money.payments.some((row: { amount: number }) => row.amount === 15)
    ).toBe(true);

    const portalToken = await request(app)
      .post(`/portal/generate/${jobId}`)
      .set('Cookie', cookie);
    expect(portalToken.status).toBe(200);
    const portal = await request(app).get(
      `/public/portal/${portalToken.body.token}`
    );
    expect(portal.status).toBe(200);
    expect(portal.body.portal.money.contract_total).toBe(115);
    expect(portal.body.portal.money.collected).toBe(125);
    expect(portal.body.portal.money.still_owed).toBe(-10);
    expect(portal.body.portal.payments.some((row: { note?: string }) => row.note)).toBe(
      false
    );
    expect(
      portal.body.portal.estimates.some(
        (row: { kind: string }) => row.kind === 'change_order'
      )
    ).toBe(true);
  });
});
