/// <reference types="jest" />
/**
 * Money writes that survive a double submit (EXPERIMENT_SAAS.md prospect 6),
 * and invoice numbers each company counts for itself (prospect 3).
 *
 * The races are made deterministic where they can be: a test transaction
 * holds the row the app locks, the requests are sent, the test waits until
 * Postgres shows them blocked on that row, then lets go. Without the app's
 * own locks the requests would not block there at all, and the wait fails.
 */
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import {
  authHeaderFor,
  createTestCompany,
  createTestUser,
} from './helpers/auth';
import { startTestServer, waitForLockWaiters } from './helpers/server';

jest.setTimeout(60000);

type Headers = Record<string, string>;
let server: Awaited<ReturnType<typeof startTestServer>>;
const api = () => server.api();

async function owner(companyId?: string) {
  const user = await createTestUser({
    role: 'owner',
    ...(companyId ? { company_id: companyId } : {}),
  });
  return { user, headers: authHeaderFor(user) as Headers };
}

async function jobFor(headers: Headers, status?: string) {
  const lead = await api()
    .post('/leads')
    .set(headers)
    .send({ first_name: 'Rita', last_name: 'Homeowner', status: 'New' });
  expect(lead.status).toBe(201);
  const job = await api()
    .post('/jobs')
    .set(headers)
    .send({
      lead_id: lead.body.lead.id,
      title: 'Re-roof',
      address: '12 Elm St',
      ...(status ? { status } : {}),
    });
  expect(job.status).toBe(201);
  return job.body.job as { id: number; status: string };
}

/** An approved estimate for $1,000 on a new job. */
async function approvedEstimate(headers: Headers) {
  const job = await jobFor(headers);
  const est = await api()
    .post('/estimates')
    .set(headers)
    .send({ job_id: job.id, title: 'Roof' });
  expect(est.status).toBe(201);
  const line = await api()
    .post(`/estimates/${est.body.estimate.id}/line-items`)
    .set(headers)
    .send({ name: 'Shingles', quantity: 10, unit_price: 100 });
  expect(line.status).toBe(201);
  const share = await api()
    .post(`/estimates/${est.body.estimate.id}/share`)
    .set(headers)
    .send({});
  const token = String(share.body.share_url).match(
    /\/public\/estimate\/([^/?#]+)/
  )?.[1];
  const approve = await api()
    .post(`/public/estimates/${token}/respond`)
    .send({ decision: 'approve' });
  expect(approve.status).toBe(200);
  return { jobId: job.id, estimateId: est.body.estimate.id as number };
}

/**
 * A job in Work Complete with one $600 invoice paid in full. It got there
 * by being paid while In Progress, so nothing closed it automatically.
 */
async function settledWorkCompleteJob(headers: Headers) {
  const job = await jobFor(headers, 'In Progress');
  const invoice = await api()
    .post('/invoices')
    .set(headers)
    .send({ job_id: job.id, status: 'Sent' });
  expect(invoice.status).toBe(201);
  const invoiceId = invoice.body.invoice.id as number;
  await api()
    .post(`/invoices/${invoiceId}/line-items`)
    .set(headers)
    .send({ name: 'Repair', quantity: 1, unit_price: 600 })
    .expect(201);
  const paid = await api()
    .post(`/invoices/${invoiceId}/payments`)
    .set(headers)
    .send({ amount: 600, method: 'check' });
  expect(paid.status).toBe(201);
  await api()
    .patch(`/jobs/${job.id}`)
    .set(headers)
    .send({ status: 'Work Complete' })
    .expect(200);
  const current = await api().get(`/jobs/${job.id}`).set(headers);
  expect(current.body.job.status).toBe('Work Complete');
  expect(current.body.job.money.outstanding_total).toBe(0);
  return {
    jobId: job.id,
    invoiceId,
    paymentId: paid.body.invoice.payments[0].id as number,
  };
}

async function liveInvoices(estimateId: number, kind: string) {
  const { rows } = await pool.query(
    `SELECT id FROM invoices WHERE estimate_id = $1 AND kind = $2 AND status <> 'Void'`,
    [estimateId, kind]
  );
  return rows.map((row) => row.id);
}

/** A dedicated connection that holds a row lock until release(). */
async function holdLock(sql: string, params: unknown[]) {
  const client = await pool.connect();
  await client.query('BEGIN');
  const { rowCount } = await client.query(sql, params);
  expect(rowCount).toBe(1);
  return {
    client,
    async release(beforeCommit?: string, values: unknown[] = []) {
      if (beforeCommit) await client.query(beforeCommit, values);
      await client.query('COMMIT');
      client.release();
    },
  };
}

// Hooks inside a describe: setupAfterEnv's afterAll closes the pool, and a
// top-level afterAll would run after it.
describe('money writes', () => {
  beforeAll(async () => {
    server = await startTestServer();
    await ensureSchema();
    await resetDb();
  });

  afterAll(async () => {
    await server.close();
    await resetDb();
  });

  describe('a final or deposit invoice requested twice at once', () => {
    it.each(['final', 'deposit'])(
      'returns the same %s invoice to both requests (deterministic)',
      async (kind) => {
        const { headers } = await owner();
        const { estimateId } = await approvedEstimate(headers);

        // Hold the estimate: both requests reach the app's lock and wait there.
        const lock = await holdLock(
          `SELECT id FROM estimates WHERE id = $1 FOR UPDATE`,
          [estimateId]
        );
        const send = () =>
          api()
            .post(`/invoices/from-estimate/${estimateId}`)
            .set(headers)
            .send({ kind })
            .then((res) => res);
        const first = send();
        const second = send();
        await waitForLockWaiters(2);
        await lock.release();

        const [a, b] = await Promise.all([first, second]);
        expect([a.status, b.status]).toEqual([201, 201]);
        expect(a.body.invoice.id).toBe(b.body.invoice.id);
        expect(await liveInvoices(estimateId, kind)).toEqual([
          a.body.invoice.id,
        ]);
      }
    );

    it('returns one invoice to five simultaneous Final invoice clicks', async () => {
      const { headers } = await owner();
      const { estimateId } = await approvedEstimate(headers);
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          api()
            .post(`/invoices/from-estimate/${estimateId}`)
            .set(headers)
            .send({ kind: 'final' })
        )
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(results.map((r) => r.body.invoice.id)).size).toBe(1);
      expect(await liveInvoices(estimateId, 'final')).toHaveLength(1);
    });

    it('keeps a second live final out at the database, and allows one after a void', async () => {
      const { headers } = await owner();
      const { estimateId } = await approvedEstimate(headers);
      const first = await api()
        .post(`/invoices/from-estimate/${estimateId}`)
        .set(headers)
        .send({ kind: 'final' });
      expect(first.status).toBe(201);

      const copy = `INSERT INTO invoices (user_id, job_id, estimate_id, invoice_number, status, kind, company_id)
                    SELECT user_id, job_id, estimate_id, $2, 'Draft', 'final', company_id
                    FROM invoices WHERE id = $1`;
      await expect(
        pool.query(copy, [first.body.invoice.id, 'INV-9001'])
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'idx_invoices_one_live_per_estimate_kind',
      });

      await pool.query(
        `UPDATE invoices SET status = 'Void', voided_at = now() WHERE id = $1`,
        [first.body.invoice.id]
      );
      await expect(
        pool.query(copy, [first.body.invoice.id, 'INV-9002'])
      ).resolves.toMatchObject({
        rowCount: 1,
      });
    });
  });

  describe('closing a job while a payment is removed', () => {
    it('a close that waits behind a removal is refused, and the balance shows', async () => {
      const { headers } = await owner();
      const { jobId, invoiceId, paymentId } =
        await settledWorkCompleteJob(headers);

      // Hold the invoice: the removal takes the job, deletes the payment, then
      // waits here. The close then has to wait for the job.
      const lock = await holdLock(
        `SELECT id FROM invoices WHERE id = $1 FOR UPDATE`,
        [invoiceId]
      );
      const removal = api()
        .delete(`/invoices/${invoiceId}/payments/${paymentId}`)
        .set(headers)
        .then((res) => res);
      await waitForLockWaiters(1);
      const close = api()
        .patch(`/jobs/${jobId}`)
        .set(headers)
        .send({ status: 'Closed' })
        .then((res) => res);
      await waitForLockWaiters(2);
      await lock.release();

      const [removed, closed] = await Promise.all([removal, close]);
      expect(removed.status).toBe(200);
      expect(closed.status).toBe(409);

      const job = await api().get(`/jobs/${jobId}`).set(headers);
      expect(job.body.job.status).toBe('Work Complete');
      expect(job.body.job.money.outstanding_total).toBe(600);
    });

    it('a removal that waits behind a close reopens the job, and the balance shows', async () => {
      const { headers } = await owner();
      const { jobId, invoiceId, paymentId } =
        await settledWorkCompleteJob(headers);

      // A close in progress holds the job row (as transitionJobStatus does).
      const lock = await holdLock(
        `SELECT id FROM jobs WHERE id = $1 FOR UPDATE`,
        [jobId]
      );
      const removal = api()
        .delete(`/invoices/${invoiceId}/payments/${paymentId}`)
        .set(headers)
        .then((res) => res);
      await waitForLockWaiters(1);
      await lock.release(
        `UPDATE jobs SET status = 'Closed', status_changed_at = now(), closed_at = now() WHERE id = $1`,
        [jobId]
      );

      const removed = await removal;
      expect(removed.status).toBe(200);
      expect(removed.body.job.status).toBe('Work Complete');

      const job = await api().get(`/jobs/${jobId}`).set(headers);
      expect(job.body.job.status).toBe('Work Complete');
      expect(job.body.job.money.outstanding_total).toBe(600);
    });

    it('never leaves a job Closed with money owed, whichever request wins', async () => {
      const { headers } = await owner();
      for (let round = 0; round < 6; round += 1) {
        const { jobId, invoiceId, paymentId } =
          await settledWorkCompleteJob(headers);
        const [removed, closed] = await Promise.all([
          api()
            .delete(`/invoices/${invoiceId}/payments/${paymentId}`)
            .set(headers),
          api().patch(`/jobs/${jobId}`).set(headers).send({ status: 'Closed' }),
        ]);
        expect(removed.status).toBe(200);
        expect([200, 409]).toContain(closed.status);

        const job = await api().get(`/jobs/${jobId}`).set(headers);
        expect({
          round,
          status: job.body.job.status,
          owed: job.body.job.money.outstanding_total,
        }).toEqual({
          round,
          status: 'Work Complete',
          owed: 600,
        });
      }
    });
  });

  describe('invoice numbers per company', () => {
    async function invoiceNumber(headers: Headers, jobId: number) {
      const res = await api()
        .post('/invoices')
        .set(headers)
        .send({ job_id: jobId });
      expect(res.status).toBe(201);
      return res.body.invoice.invoice_number as string;
    }

    it('starts a newly registered company at INV-0001 and leaves the others counting on', async () => {
      await resetDb();
      const rooftop = await owner();
      const rooftopJob = await jobFor(rooftop.headers);
      expect(await invoiceNumber(rooftop.headers, rooftopJob.id)).toBe(
        'INV-0001'
      );
      expect(await invoiceNumber(rooftop.headers, rooftopJob.id)).toBe(
        'INV-0002'
      );

      const registered = await api().post('/auth/register').send({
        first_name: 'Nia',
        last_name: 'North',
        email: 'nia.north@example.com',
        password: 'Testpass1!',
        company_name: 'Northside Roofing',
      });
      expect(registered.status).toBe(201);
      const northside = {
        headers: authHeaderFor({
          id: registered.body.user.id,
          email: registered.body.user.email,
          role: 'owner',
          company_id: registered.body.company.id,
        }) as Headers,
      };
      const northJob = await jobFor(northside.headers);
      expect(await invoiceNumber(northside.headers, northJob.id)).toBe(
        'INV-0001'
      );
      expect(await invoiceNumber(rooftop.headers, rooftopJob.id)).toBe(
        'INV-0003'
      );
      expect(await invoiceNumber(northside.headers, northJob.id)).toBe(
        'INV-0002'
      );
    });

    it('gives simultaneous invoices distinct numbers in order', async () => {
      const company = await createTestCompany({
        name: 'Eastside',
        slug: 'eastside-numbers',
      });
      const east = await owner(company.id);
      const job = await jobFor(east.headers);
      const numbers = await Promise.all(
        Array.from({ length: 6 }, () => invoiceNumber(east.headers, job.id))
      );
      expect([...numbers].sort()).toEqual([
        'INV-0001',
        'INV-0002',
        'INV-0003',
        'INV-0004',
        'INV-0005',
        'INV-0006',
      ]);
    });

    it('carries on after an INV-number written directly (a seed or an import)', async () => {
      const company = await createTestCompany({
        name: 'Westside',
        slug: 'westside-numbers',
      });
      const west = await owner(company.id);
      const job = await jobFor(west.headers);
      expect(await invoiceNumber(west.headers, job.id)).toBe('INV-0001');
      await pool.query(
        `INSERT INTO invoices (user_id, job_id, invoice_number, status, kind, company_id)
         VALUES ($1, $2, 'INV-0040', 'Draft', 'standard', $3)`,
        [west.user.id, job.id, company.id]
      );
      expect(await invoiceNumber(west.headers, job.id)).toBe('INV-0041');
    });
  });
});
