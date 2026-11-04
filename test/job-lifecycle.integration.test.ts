/// <reference types="jest" />
/**
 * Phase 23: the job carries the work from first contact to paid and closed.
 *
 * Covers the lifecycle (selling → production → billing → closed), the money
 * ledger (deposit, final less deposit, partial payment, balance, overdue),
 * the gates that keep the ledger honest, and the surfaces that read them
 * (dashboard queues, portal, public invoice, collections report).
 */
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { resetDb } from './helpers/db';
import { ensureSchema } from './helpers/setup';
import { createAuthedUser } from './helpers/auth';
import {
  computeNextStep,
  closeBlockers,
  EMPTY_MONEY,
  phaseOf,
} from '../src/lib/jobLifecycle';
import { computeJobHealth } from '../src/lib/jobHealth';
import { markOverdueInvoices } from '../src/services/invoices.service';

jest.setTimeout(30000);

type Headers = Record<string, string>;

function tokenFrom(url: string, segment: string) {
  const m = String(url).match(new RegExp(`/public/${segment}/([^/?#]+)`));
  return m?.[1] ?? '';
}

async function createLead(headers: Headers) {
  const res = await request(app)
    .post('/leads')
    .set(headers)
    .send({ first_name: 'Rita', last_name: 'Homeowner', status: 'New' });
  expect(res.status).toBe(201);
  return res.body.lead;
}

async function createJob(headers: Headers, leadId: number, title = 'Re-roof') {
  const res = await request(app)
    .post('/jobs')
    .set(headers)
    .send({ lead_id: leadId, title, address: '12 Elm St' });
  expect(res.status).toBe(201);
  return res.body.job;
}

async function createEstimate(
  headers: Headers,
  jobId: number,
  lines: { name: string; quantity: number; unit_price: number }[],
  title = 'Roof replacement'
) {
  const est = await request(app)
    .post('/estimates')
    .set(headers)
    .send({ job_id: jobId, title });
  expect(est.status).toBe(201);
  for (const line of lines) {
    const res = await request(app)
      .post(`/estimates/${est.body.estimate.id}/line-items`)
      .set(headers)
      .send(line);
    expect(res.status).toBe(201);
  }
  return est.body.estimate.id as number;
}

async function getJob(headers: Headers, id: number) {
  const res = await request(app).get(`/jobs/${id}`).set(headers);
  expect(res.status).toBe(200);
  return res.body.job;
}

describe('job lifecycle — pure rules', () => {
  it('maps statuses to phases', () => {
    expect(phaseOf('Proposal Sent')).toBe('selling');
    expect(phaseOf('Sold')).toBe('production');
    expect(phaseOf('In Progress')).toBe('production');
    expect(phaseOf('Work Complete')).toBe('billing');
    expect(phaseOf('Closed')).toBe('closed');
    expect(phaseOf('Lost')).toBe('lost');
  });

  it('names the next step for a sold job without a deposit', () => {
    const step = computeNextStep({
      status: 'Sold',
      money: { ...EMPTY_MONEY, contract_total: 10000 },
      estimateCount: 1,
      draftEstimateCount: 0,
      sentAwaitingCount: 0,
      nextAppointmentAt: null,
    });
    expect(step.action).toBe('request_deposit');
  });

  it('blocks closing while money is owed or drafted', () => {
    expect(closeBlockers(EMPTY_MONEY)).toEqual([]);
    const blockers = closeBlockers({
      ...EMPTY_MONEY,
      outstanding_total: 250,
      open_invoice_count: 1,
      draft_invoice_count: 1,
    });
    expect(blockers).toHaveLength(2);
  });

  it('flags work complete but unbilled', () => {
    const health = computeJobHealth({
      status: 'Work Complete',
      statusChangedAt: new Date(),
      money: { ...EMPTY_MONEY, contract_total: 5000, unbilled_total: 5000 },
    });
    expect(health.level).toBe('yellow');
    expect(health.reasons).toContain('Work complete, not invoiced');
  });
});

describe('job lifecycle — API', () => {
  beforeAll(async () => {
    await ensureSchema();
    await resetDb();
  });

  afterAll(async () => {
    try {
      await pool.end();
    } catch {
      /* already closed */
    }
  });

  it('runs a job from estimate to paid and closed', async () => {
    const owner = await createAuthedUser('owner');
    const lead = await createLead(owner.headers);
    const job = await createJob(owner.headers, lead.id);
    expect(job.phase).toBe('selling');
    expect(job.next_step.action).toBe('schedule_visit');

    const estimateId = await createEstimate(owner.headers, job.id, [
      { name: 'Shingles', quantity: 40, unit_price: 125 },
      { name: 'Labor', quantity: 1, unit_price: 5000 },
    ]);

    // Sharing a draft sends it, and the job moves to Proposal Sent.
    const share = await request(app)
      .post(`/estimates/${estimateId}/share`)
      .set(owner.headers)
      .send({});
    expect(share.status).toBe(200);
    expect(share.body.estimate.status).toBe('Sent');
    expect((await getJob(owner.headers, job.id)).status).toBe('Proposal Sent');

    // The client approves; the job is sold without anyone touching it.
    const token = tokenFrom(share.body.share_url, 'estimate');
    const approve = await request(app)
      .post(`/public/estimates/${token}/respond`)
      .send({ decision: 'approve', note: 'Go ahead' });
    expect(approve.status).toBe(200);
    expect(approve.body.estimate.approved_at).toBeTruthy();

    let current = await getJob(owner.headers, job.id);
    expect(current.status).toBe('Sold');
    expect(current.sold_at).toBeTruthy();
    expect(current.money.contract_total).toBe(10000);
    expect(current.next_step.action).toBe('request_deposit');

    // A stale link cannot flip the answer.
    const again = await request(app)
      .post(`/public/estimates/${token}/respond`)
      .send({ decision: 'reject' });
    expect(again.status).toBe(409);

    // Approved scope is locked.
    const locked = await request(app)
      .post(`/estimates/${estimateId}/line-items`)
      .set(owner.headers)
      .send({ name: 'Extra', quantity: 1, unit_price: 100 });
    expect(locked.status).toBe(409);

    // Deposit: 30% of the contract.
    const deposit = await request(app)
      .post(`/invoices/from-estimate/${estimateId}`)
      .set(owner.headers)
      .send({ kind: 'deposit', deposit_percent: 30 });
    expect(deposit.status).toBe(201);
    expect(deposit.body.invoice.kind).toBe('deposit');
    expect(deposit.body.invoice.grand_total).toBe(3000);
    expect(deposit.body.invoice.status).toBe('Draft');
    const depositId = deposit.body.invoice.id;

    // Asking again returns the same deposit.
    const depositAgain = await request(app)
      .post(`/invoices/from-estimate/${estimateId}`)
      .set(owner.headers)
      .send({ kind: 'deposit', deposit_percent: 50 });
    expect(depositAgain.body.invoice.id).toBe(depositId);

    // Record the deposit payment (a draft that gets paid is sent).
    const depositPaid = await request(app)
      .post(`/invoices/${depositId}/payments`)
      .set(owner.headers)
      .send({ amount: 3000, method: 'check', reference: '1043' });
    expect(depositPaid.status).toBe(201);
    expect(depositPaid.body.invoice.status).toBe('Paid');
    expect(depositPaid.body.invoice.sent_at).toBeTruthy();

    current = await getJob(owner.headers, job.id);
    expect(current.money.collected_total).toBe(3000);
    expect(current.next_step.action).toBe('schedule_work');

    // Production.
    for (const status of ['Work Scheduled', 'In Progress', 'Work Complete']) {
      const moved = await request(app)
        .patch(`/jobs/${job.id}`)
        .set(owner.headers)
        .send({ status });
      expect(moved.status).toBe(200);
    }
    current = await getJob(owner.headers, job.id);
    expect(current.phase).toBe('billing');
    expect(current.work_completed_at).toBeTruthy();
    expect(current.money.unbilled_total).toBe(7000);
    expect(current.next_step.action).toBe('final_invoice');
    expect(current.health.reasons).toContain('Work complete, not invoiced');

    // Final invoice: full scope less the deposit.
    const final = await request(app)
      .post(`/invoices/from-estimate/${estimateId}`)
      .set(owner.headers)
      .send({ kind: 'final' });
    expect(final.status).toBe(201);
    expect(final.body.invoice.kind).toBe('final');
    expect(final.body.invoice.subtotal).toBe(10000);
    expect(final.body.invoice.prior_billed_total).toBe(3000);
    expect(final.body.invoice.grand_total).toBe(7000);
    const finalId = final.body.invoice.id;

    // No deposit once the final exists.
    const lateDeposit = await request(app)
      .post(`/invoices/from-estimate/${estimateId}`)
      .set(owner.headers)
      .send({ kind: 'deposit' });
    expect(lateDeposit.status).toBe(409);

    // Close is blocked while the final is a draft.
    const earlyClose = await request(app)
      .patch(`/jobs/${job.id}`)
      .set(owner.headers)
      .send({ status: 'Closed' });
    expect(earlyClose.status).toBe(409);
    expect(earlyClose.body.blockers.join(' ')).toMatch(/draft invoice/i);

    const sent = await request(app)
      .patch(`/invoices/${finalId}`)
      .set(owner.headers)
      .send({ status: 'Sent' });
    expect(sent.body.invoice.status).toBe('Sent');

    // Partial payment.
    const partial = await request(app)
      .post(`/invoices/${finalId}/payments`)
      .set(owner.headers)
      .send({ amount: 2000, method: 'card' });
    expect(partial.status).toBe(201);
    expect(partial.body.invoice.status).toBe('Partially Paid');
    expect(partial.body.invoice.balance_due).toBe(5000);
    expect(partial.body.job.status).toBe('Work Complete');

    // Overpayment is refused.
    const over = await request(app)
      .post(`/invoices/${finalId}/payments`)
      .set(owner.headers)
      .send({ amount: 6000 });
    expect(over.status).toBe(409);

    // Lines are locked once money is in; deleting is refused.
    const editPaid = await request(app)
      .post(`/invoices/${finalId}/line-items`)
      .set(owner.headers)
      .send({ name: 'Extra', quantity: 1, unit_price: 50 });
    expect(editPaid.status).toBe(409);
    const deletePaid = await request(app)
      .delete(`/invoices/${finalId}`)
      .set(owner.headers);
    expect(deletePaid.status).toBe(409);

    // Close still blocked by the balance.
    const blocked = await request(app)
      .patch(`/jobs/${job.id}`)
      .set(owner.headers)
      .send({ status: 'Closed' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.blockers.join(' ')).toMatch(/5000\.00 is still owed/);

    // Final payment settles the job and closes it.
    const rest = await request(app)
      .post(`/invoices/${finalId}/payments`)
      .set(owner.headers)
      .send({ amount: 5000, method: 'ach' });
    expect(rest.status).toBe(201);
    expect(rest.body.invoice.status).toBe('Paid');
    expect(rest.body.job.status).toBe('Closed');

    current = await getJob(owner.headers, job.id);
    expect(current.closed_at).toBeTruthy();
    expect(current.health.level).toBe('none');
    expect(current.money.collected_total).toBe(10000);
    expect(current.money.outstanding_total).toBe(0);

    const activity = await pool.query(
      `SELECT metadata FROM job_activity
       WHERE job_id = $1 AND type = 'JOB_STATUS_CHANGED'
       ORDER BY id ASC`,
      [job.id]
    );
    const moves = activity.rows.map((r) => `${r.metadata.toStatus}:${r.metadata.automatic}`);
    expect(moves).toEqual([
      'Proposal Sent:true',
      'Sold:true',
      'Work Scheduled:false',
      'In Progress:false',
      'Work Complete:false',
      'Closed:true',
    ]);

    // Removing a payment reopens the job: the ledger and the status agree.
    const paymentId = rest.body.invoice.payments.find(
      (p: { amount: number }) => p.amount === 5000
    ).id;
    const removed = await request(app)
      .delete(`/invoices/${finalId}/payments/${paymentId}`)
      .set(owner.headers);
    expect(removed.status).toBe(200);
    expect(removed.body.invoice.status).toBe('Partially Paid');
    expect(removed.body.job.status).toBe('Work Complete');
  });

  it('keeps ledger corrections and reopening with owners and admins', async () => {
    const owner = await createAuthedUser('owner');
    const agent = await createAuthedUser('agent');
    const lead = await createLead(agent.headers);
    const job = await createJob(agent.headers, lead.id, 'Gutter repair');

    const invoice = await request(app)
      .post('/invoices')
      .set(agent.headers)
      .send({ job_id: job.id, status: 'Sent' });
    await request(app)
      .post(`/invoices/${invoice.body.invoice.id}/line-items`)
      .set(agent.headers)
      .send({ name: 'Repair', quantity: 1, unit_price: 800 });

    // Field agents collect checks.
    const paid = await request(app)
      .post(`/invoices/${invoice.body.invoice.id}/payments`)
      .set(agent.headers)
      .send({ amount: 800, method: 'check' });
    expect(paid.status).toBe(201);

    // But only owners/admins correct the ledger.
    const agentDelete = await request(app)
      .delete(
        `/invoices/${invoice.body.invoice.id}/payments/${paid.body.invoice.payments[0].id}`
      )
      .set(agent.headers);
    expect(agentDelete.status).toBe(403);

    const closed = await request(app)
      .patch(`/jobs/${job.id}`)
      .set(agent.headers)
      .send({ status: 'Closed' });
    expect(closed.status).toBe(200);

    const agentReopen = await request(app)
      .patch(`/jobs/${job.id}`)
      .set(agent.headers)
      .send({ status: 'In Progress' });
    expect(agentReopen.status).toBe(409);

    const ownerReopen = await request(app)
      .patch(`/jobs/${job.id}?view=all`)
      .set(owner.headers)
      .send({ status: 'In Progress' });
    expect(ownerReopen.status).toBe(200);
    expect(ownerReopen.body.job.closed_at).toBeNull();
  });

  it('records why a job was lost and refuses to lose a job with money in', async () => {
    const owner = await createAuthedUser('owner');
    const lead = await createLead(owner.headers);
    const job = await createJob(owner.headers, lead.id, 'Siding bid');

    const lost = await request(app)
      .patch(`/jobs/${job.id}`)
      .set(owner.headers)
      .send({ status: 'Lost', lost_reason: 'Went with a cheaper bid' });
    expect(lost.status).toBe(200);
    expect(lost.body.job.lost_reason).toBe('Went with a cheaper bid');
    expect(lost.body.job.lost_at).toBeTruthy();

    const reopened = await request(app)
      .patch(`/jobs/${job.id}`)
      .set(owner.headers)
      .send({ status: 'Contacted' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.job.lost_reason).toBeNull();

    const invoice = await request(app)
      .post('/invoices')
      .set(owner.headers)
      .send({ job_id: job.id, status: 'Sent' });
    await request(app)
      .post(`/invoices/${invoice.body.invoice.id}/line-items`)
      .set(owner.headers)
      .send({ name: 'Design fee', quantity: 1, unit_price: 150 });
    await request(app)
      .post(`/invoices/${invoice.body.invoice.id}/payments`)
      .set(owner.headers)
      .send({ amount: 150 });

    const lostWithMoney = await request(app)
      .patch(`/jobs/${job.id}`)
      .set(owner.headers)
      .send({ status: 'Lost' });
    expect(lostWithMoney.status).toBe(409);
  });

  it('does not let two simultaneous payments overpay one invoice', async () => {
    const owner = await createAuthedUser('owner');
    const lead = await createLead(owner.headers);
    const job = await createJob(owner.headers, lead.id, 'Race job');
    const invoice = await request(app)
      .post('/invoices')
      .set(owner.headers)
      .send({ job_id: job.id, status: 'Sent' });
    await request(app)
      .post(`/invoices/${invoice.body.invoice.id}/line-items`)
      .set(owner.headers)
      .send({ name: 'Repair', quantity: 1, unit_price: 600 });

    const [first, second] = await Promise.all([
      request(app)
        .post(`/invoices/${invoice.body.invoice.id}/payments`)
        .set(owner.headers)
        .send({ amount: 600, method: 'check' }),
      request(app)
        .post(`/invoices/${invoice.body.invoice.id}/payments`)
        .set(owner.headers)
        .send({ amount: 600, method: 'card' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);

    const after = await request(app)
      .get(`/invoices/${invoice.body.invoice.id}`)
      .set(owner.headers);
    expect(after.body.invoice.amount_paid).toBe(600);
    expect(after.body.invoice.payments).toHaveLength(1);
  });

  it('rejects statuses outside the lifecycle', async () => {
    const owner = await createAuthedUser('owner');
    const lead = await createLead(owner.headers);
    const job = await createJob(owner.headers, lead.id);
    const res = await request(app)
      .patch(`/jobs/${job.id}`)
      .set(owner.headers)
      .send({ status: 'Closed Won' });
    expect(res.status).toBe(400);
  });

  it('change orders add to the contract without editing the approved scope', async () => {
    const owner = await createAuthedUser('owner');
    const lead = await createLead(owner.headers);
    const job = await createJob(owner.headers, lead.id, 'Deck re-roof');
    const estimateId = await createEstimate(owner.headers, job.id, [
      { name: 'Base scope', quantity: 1, unit_price: 4000 },
    ]);
    await request(app)
      .patch(`/estimates/${estimateId}`)
      .set(owner.headers)
      .send({ status: 'Approved' });
    expect((await getJob(owner.headers, job.id)).status).toBe('Sold');

    const co = await request(app)
      .post(`/estimates/${estimateId}/change-order`)
      .set(owner.headers)
      .send({});
    expect(co.status).toBe(201);
    expect(co.body.estimate.status).toBe('Draft');
    expect(co.body.estimate.change_order_of).toBe(estimateId);
    expect(co.body.estimate.title).toMatch(/^Change order/);

    await request(app)
      .post(`/estimates/${co.body.estimate.id}/line-items`)
      .set(owner.headers)
      .send({ name: 'Rotted decking', quantity: 4, unit_price: 125 });
    await request(app)
      .patch(`/estimates/${co.body.estimate.id}`)
      .set(owner.headers)
      .send({ status: 'Approved' });

    const current = await getJob(owner.headers, job.id);
    expect(current.money.contract_total).toBe(4500);
    expect(current.status).toBe('Sold');

    // Un-approving an invoiced estimate is refused.
    await request(app)
      .post(`/invoices/from-estimate/${estimateId}`)
      .set(owner.headers)
      .send({ kind: 'final' });
    const unapprove = await request(app)
      .patch(`/estimates/${estimateId}`)
      .set(owner.headers)
      .send({ status: 'Draft' });
    expect(unapprove.status).toBe(409);
  });

  it('surfaces the handoffs on the dashboard', async () => {
    const owner = await createAuthedUser('owner');
    const lead = await createLead(owner.headers);
    const sold = await createJob(owner.headers, lead.id, 'Sold, nothing booked');
    await request(app)
      .patch(`/jobs/${sold.id}`)
      .set(owner.headers)
      .send({ status: 'Sold' });

    const complete = await createJob(owner.headers, lead.id, 'Done, not billed');
    const estimateId = await createEstimate(owner.headers, complete.id, [
      { name: 'Work', quantity: 1, unit_price: 2500 },
    ]);
    await request(app)
      .patch(`/estimates/${estimateId}`)
      .set(owner.headers)
      .send({ status: 'Approved' });
    for (const status of ['Work Scheduled', 'In Progress', 'Work Complete']) {
      await request(app)
        .patch(`/jobs/${complete.id}`)
        .set(owner.headers)
        .send({ status });
    }

    const dash = await request(app).get('/dashboard').set(owner.headers);
    expect(dash.status).toBe(200);
    const soldIds = dash.body.actions.soldNotScheduled.map((r: { id: number }) => r.id);
    expect(soldIds).toContain(sold.id);
    const billIds = dash.body.actions.readyToBill.map((r: { id: number }) => r.id);
    expect(billIds).toContain(complete.id);
    expect(dash.body.money.unbilled_total).toBeGreaterThanOrEqual(2500);
    expect(dash.body.money.jobs_in_billing).toBeGreaterThanOrEqual(1);

    const production = await request(app)
      .get('/jobs')
      .query({ phase: 'production' })
      .set(owner.headers);
    const productionIds = production.body.jobs.map((j: { id: number }) => j.id);
    expect(productionIds).toContain(sold.id);
    expect(productionIds).not.toContain(complete.id);

    const summary = await request(app).get('/jobs/summary').set(owner.headers);
    const billing = summary.body.byPhase.find(
      (row: { phase: string }) => row.phase === 'billing'
    );
    expect(billing.count).toBeGreaterThanOrEqual(1);
  });

  it('shows the client what was sent, where the job is, and what is owed', async () => {
    const owner = await createAuthedUser('owner');
    const lead = await createLead(owner.headers);
    const job = await createJob(owner.headers, lead.id, 'Portal job');
    const approvedId = await createEstimate(
      owner.headers,
      job.id,
      [{ name: 'Scope', quantity: 1, unit_price: 6000 }],
      'Approved scope'
    );
    await createEstimate(
      owner.headers,
      job.id,
      [{ name: 'Upgrade', quantity: 1, unit_price: 900 }],
      'Internal draft option'
    );
    await request(app)
      .patch(`/estimates/${approvedId}`)
      .set(owner.headers)
      .send({ status: 'Approved' });
    const deposit = await request(app)
      .post(`/invoices/from-estimate/${approvedId}`)
      .set(owner.headers)
      .send({ kind: 'deposit', deposit_amount: 1500 });
    await request(app)
      .post(`/invoices/${deposit.body.invoice.id}/payments`)
      .set(owner.headers)
      .send({ amount: 500, method: 'card' });
    // A draft invoice that must not leak.
    await request(app)
      .post(`/invoices/from-estimate/${approvedId}`)
      .set(owner.headers)
      .send({ kind: 'final' });

    const gen = await request(app)
      .post(`/portal/generate/${job.id}`)
      .set(owner.headers);
    const portal = await request(app).get(`/public/portal/${gen.body.token}`);
    expect(portal.status).toBe(200);
    const data = portal.body.portal;

    expect(data.estimates.map((e: { title: string }) => e.title)).toEqual([
      'Approved scope',
    ]);
    expect(data.invoices).toHaveLength(1);
    expect(data.invoices[0].kind).toBe('deposit');
    expect(data.stage.label).toMatch(/Approved/);
    expect(data.stage.step).toBe(1);
    expect(data.money.balance_due).toBe(1000);
    expect(data.money.paid_total).toBe(500);
    expect(data.payments).toHaveLength(1);
    expect(data.timeline.map((t: { label: string }) => t.label)).toContain(
      'Payment received — $500.00'
    );

    const pdf = await request(app).get(
      `/public/portal/${gen.body.token}/invoices/${deposit.body.invoice.id}/pdf`
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('reports receivables aging and monthly collections', async () => {
    const owner = await createAuthedUser('owner');
    const lead = await createLead(owner.headers);
    const job = await createJob(owner.headers, lead.id, 'Aging job');
    const lastMonth = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const invoice = await request(app)
      .post('/invoices')
      .set(owner.headers)
      .send({ job_id: job.id, status: 'Sent', due_date: lastMonth });
    await request(app)
      .post(`/invoices/${invoice.body.invoice.id}/line-items`)
      .set(owner.headers)
      .send({ name: 'Inspection', quantity: 1, unit_price: 400 });
    const partial = await request(app)
      .post(`/invoices/${invoice.body.invoice.id}/payments`)
      .set(owner.headers)
      .send({ amount: 100 });
    // Past due with a balance is derived as Overdue on the spot.
    expect(partial.body.invoice.status).toBe('Overdue');

    // The sweep catches invoices that go past due while nobody touches them.
    const later = await request(app)
      .post('/invoices')
      .set(owner.headers)
      .send({
        job_id: job.id,
        status: 'Sent',
        due_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      });
    await request(app)
      .post(`/invoices/${later.body.invoice.id}/line-items`)
      .set(owner.headers)
      .send({ name: 'Report', quantity: 1, unit_price: 90 });
    await request(app)
      .post(`/invoices/${later.body.invoice.id}/payments`)
      .set(owner.headers)
      .send({ amount: 40 });
    await pool.query(
      `UPDATE invoices SET due_date = NOW() - INTERVAL '2 days' WHERE id = $1`,
      [later.body.invoice.id]
    );
    const swept = await markOverdueInvoices();
    expect(swept.map((r) => r.id)).toContain(later.body.invoice.id);

    const report = await request(app)
      .get('/reports/collections')
      .query({ view: 'all' })
      .set(owner.headers);
    expect(report.status).toBe(200);
    const bucket = report.body.aging.find(
      (b: { bucket: string }) => b.bucket === '31_60'
    );
    expect(bucket.amount).toBeGreaterThanOrEqual(300);
    expect(report.body.monthly).toHaveLength(12);
    const thisMonth = report.body.monthly[report.body.monthly.length - 1];
    expect(thisMonth.collected).toBeGreaterThanOrEqual(100);

    const job2 = await getJob(owner.headers, job.id);
    expect(job2.health.level).toBe('red');
    expect(job2.next_step.action).toBe('collect_payment');
  });
});
