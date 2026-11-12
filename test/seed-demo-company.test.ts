/// <reference types="jest" />
import path from 'path';
import { spawnSync } from 'child_process';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createTestCompany, createTestUser } from './helpers/auth';

const { buildDemoPlan } = require('../scripts/lib/demo-plan');
const { assertFingerprintUnchanged } = require('../scripts/lib/company-reset');
const { databaseName } = require('../scripts/lib/backup');

jest.setTimeout(120000);

const BACKEND_ROOT = path.resolve(__dirname, '..');

function runSeed(...args: string[]) {
  return spawnSync(
    process.execPath,
    [path.join('scripts', 'seed-demo-company.js'), ...args],
    {
      cwd: BACKEND_ROOT,
      encoding: 'utf8',
      env: { ...process.env, DEMO_TEAM_PASSWORD: '' },
    }
  );
}

/** Every row another company owns, in a stable order. */
async function snapshotOf(companyId: string) {
  const { rows: tables } = await pool.query(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'company_id' ORDER BY 1`
  );
  const out: Record<string, string> = {};
  for (const { table_name } of tables) {
    const { rows } = await pool.query(
      `SELECT coalesce(string_agg(t::text, '|' ORDER BY t::text), '') AS rows
       FROM public."${table_name}" t WHERE company_id = $1`,
      [companyId]
    );
    out[table_name] = rows[0].rows;
  }
  return out;
}

async function countFor(table: string, companyId: string) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM public."${table}" WHERE company_id = $1`,
    [companyId]
  );
  return rows[0].n as number;
}

describe('Demo company seed', () => {
  let demo: { id: string };
  let other: { id: string };

  beforeAll(async () => {
    await ensureSchema();
    // The seed is spawned against DATABASE_URL: only ever the test database.
    expect(databaseName(process.env.DATABASE_URL, 'DATABASE_URL')).toMatch(
      /_test$/
    );
  });

  beforeEach(async () => {
    await resetDb();
    demo = await createTestCompany({ name: 'Demo', slug: 'demo' });
    await createTestUser({
      role: 'owner',
      company_id: demo.id,
      email: 'demo.owner@example.com',
    });

    other = await createTestCompany({
      name: 'Gutter Guys',
      slug: 'gutter-guys',
    });
    const otherOwner = await createTestUser({
      role: 'owner',
      company_id: other.id,
    });
    const lead = await pool.query(
      `INSERT INTO leads (first_name, last_name, email, source, status, user_id, company_id)
       VALUES ('Lee', 'Customer', 'their-lead@example.com', 'Referral', 'New', $1, $2)
       RETURNING id`,
      [otherOwner.id, other.id]
    );
    await pool.query(
      `INSERT INTO tasks (title, status, lead_id, user_id, assigned_to, company_id)
       VALUES ('Call Lee', 'Pending', $1, $2, $2, $3)`,
      [lead.rows[0].id, otherOwner.id, other.id]
    );
  });

  afterAll(async () => {
    await resetDb();
  });

  it('fills the demo company and leaves every other company exactly as it was', async () => {
    const before = await snapshotOf(other.id);

    const result = runSeed();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Other companies: unchanged/);

    expect(await countFor('leads', demo.id)).toBeGreaterThan(150);
    expect(await countFor('jobs', demo.id)).toBeGreaterThan(80);
    expect(await countFor('invoice_payments', demo.id)).toBeGreaterThan(50);
    expect(await countFor('lead_status_events', demo.id)).toBeGreaterThan(150);
    expect(await snapshotOf(other.id)).toEqual(before);
  });

  it('replaces its own records on a second run and reuses the team', async () => {
    expect(runSeed().status).toBe(0);
    const leads = await countFor('leads', demo.id);
    const before = await snapshotOf(other.id);

    const second = runSeed();
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(/Replaced \d+ existing demo rows/);
    expect(await countFor('leads', demo.id)).toBe(leads);
    expect(await countFor('users', demo.id)).toBe(4);
    expect(await snapshotOf(other.id)).toEqual(before);

    // The app's next invoice number continues after the seeded ones.
    const { rows } = await pool.query(
      `SELECT c.last_number, (SELECT count(*)::int FROM invoices i WHERE i.company_id = c.company_id) AS invoices
       FROM company_invoice_counters c WHERE c.company_id = $1`,
      [demo.id]
    );
    expect(rows[0].last_number).toBe(rows[0].invoices);
  });

  it('saves nothing on a dry run', async () => {
    const result = runSeed('--dry-run');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/rolled back, nothing saved/);
    expect(await countFor('leads', demo.id)).toBe(0);
    expect(await countFor('users', demo.id)).toBe(1);
  });

  it('refuses any company that is not a demo company', async () => {
    const result = runSeed('--company', 'gutter-guys');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/only fills "demo" or "demo-…" companies/);
    expect(await countFor('leads', other.id)).toBe(1);
  });

  it('says what to do when the demo company is missing', async () => {
    const result = runSeed('--company', 'demo-east');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Register it on the site first/);
  });
});

describe('Demo plan', () => {
  const now = new Date('2026-11-12T15:00:00Z');
  const plan = buildDemoPlan({ now, timeZone: 'America/Chicago' });
  const nowMs = now.getTime();

  it('is the same for the same day', () => {
    const again = buildDemoPlan({ now, timeZone: 'America/Chicago' });
    expect(again.summary).toEqual(plan.summary);
    expect(again.leads.map((lead: any) => lead.email)).toEqual(
      plan.leads.map((lead: any) => lead.email)
    );
  });

  it('dates nothing that has already happened after now', () => {
    const past = [
      ...plan.leads.flatMap((lead: any) => [
        lead.created_at,
        lead.status_changed_at,
      ]),
      ...plan.leadStatusEvents.map((event: any) => event.changed_at),
      ...plan.jobs.flatMap((job: any) => [
        job.created_at,
        job.sold_at,
        job.closed_at,
        job.lost_at,
      ]),
      ...plan.invoices.flatMap((invoice: any) => [
        invoice.created_at,
        invoice.paid_at,
      ]),
      ...plan.invoices.flatMap((invoice: any) =>
        invoice.payments.map((p: any) => p.received_at)
      ),
      ...plan.notes.map((note: any) => note.created_at),
      ...plan.activity.map((activity: any) => activity.created_at),
      ...plan.tasks.flatMap((task: any) => [
        task.created_at,
        task.completed_at,
      ]),
    ].filter((value) => value != null);
    expect(past.length).toBeGreaterThan(1000);
    expect(Math.max(...past)).toBeLessThanOrEqual(nowMs);
  });

  it('keeps the money consistent', () => {
    for (const invoice of plan.invoices) {
      const paid = invoice.payments.reduce(
        (sum: number, p: any) => sum + p.amount,
        0
      );
      expect(Math.abs(paid - invoice.amount_paid)).toBeLessThan(0.01);
      if (invoice.status === 'Paid')
        expect(invoice.amount_paid).toBeCloseTo(invoice.grand_total, 2);
      if (invoice.status === 'Overdue')
        expect(invoice.due_date).toBeLessThan(nowMs);
    }
    const estimates = new Map(plan.estimates.map((e: any) => [e.key, e]));
    for (const invoice of plan.invoices.filter(
      (i: any) => i.kind === 'final'
    )) {
      const estimate: any = estimates.get(invoice.estimate);
      expect(invoice.grand_total + invoice.prior_billed_total).toBeCloseTo(
        estimate.grand_total,
        2
      );
    }
  });

  it('has the featured customers in the states a walkthrough expects', () => {
    const job = (last: string) =>
      plan.jobs.find((j: any) => j.title.startsWith(`${last} residence`));
    expect(job('Nelson').status).toBe('Appointment Scheduled');
    expect(job('Patel').status).toBe('Proposal Sent');
    expect(job('Lindqvist').status).toBe('In Progress');
    expect(job('Ruiz').status).toBe('Work Complete');
    expect(job('Andersen').status).toBe('Closed');
    expect(job('Hayes').status).toBe('Lost');
    const lead = (last: string) =>
      plan.leads.find((l: any) => l.last_name === last);
    expect(lead('Brooks').status).toBe('Contacted');
    expect(lead('Chen').status).toBe('New');
  });

  it('a fingerprint that moved stops the seed', () => {
    expect(() =>
      assertFingerprintUnchanged({ leads: '1:5' }, { leads: '1:5' })
    ).not.toThrow();
    expect(() =>
      assertFingerprintUnchanged({ leads: '1:5' }, { leads: '2:9' })
    ).toThrow(/changed in leads/);
  });
});
