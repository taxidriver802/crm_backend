/// <reference types="jest" />
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createTestUser, DEFAULT_COMPANY_ID } from './helpers/auth';
const { migrate } = require('../scripts/lib/migrations');

jest.setTimeout(60000);

const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'migrations', '0002_company_scoping.sql'),
  'utf8'
);

// A new database is made and dropped, which the test role usually may not
// do. Run it with a role that can:
//   RESTORE_ADMIN_URL=postgresql://<superuser>@localhost:5432/postgres npm test -- companies.schema
const ADMIN_URL = process.env.RESTORE_ADMIN_URL || '';
const withAdmin = ADMIN_URL ? it : it.skip;

/** Runs the migration's text again inside a transaction that is rolled back. */
async function inRolledBackMigration<T>(
  setup: (client: import('pg').PoolClient) => Promise<void>,
  check: (client: import('pg').PoolClient) => Promise<T>
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setup(client);
    await client.query(MIGRATION);
    return await check(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function builtinExists(client: { query: typeof pool.query }) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM companies WHERE id = $1`,
    [DEFAULT_COMPANY_ID]
  );
  return rowCount === 1;
}

describe('companies schema', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
  });

  it('gives no company_id column a default, and requires every one', async () => {
    const { rows } = await pool.query(
      `SELECT table_name, column_default, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'company_id'
       ORDER BY table_name`
    );
    expect(rows.length).toBeGreaterThanOrEqual(23);
    // The one company_id that may be empty: a supplier's webhook is stored
    // before it is matched to a company (nothing writes this table yet).
    const mayBeEmpty = new Set(['supplier_webhook_events']);
    for (const row of rows) {
      expect({
        table: row.table_name,
        default: row.column_default,
        nullable: row.is_nullable,
      }).toEqual({
        table: row.table_name,
        default: null,
        nullable: mayBeEmpty.has(row.table_name) ? 'YES' : 'NO',
      });
    }
    const fn = await pool.query(
      `SELECT 1 FROM pg_proc WHERE proname = 'crm_default_company_id'`
    );
    expect(fn.rowCount).toBe(0);
    const seq = await pool.query(
      `SELECT 1 FROM pg_class WHERE relname = 'invoice_number_seq'`
    );
    expect(seq.rowCount).toBe(0);
  });

  it('fails loudly when an insert leaves out company_id', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const attempts: [string, string, unknown[]][] = [
      [
        'users',
        `INSERT INTO users (first_name, last_name, email, role, status)
         VALUES ('No', 'Company', 'nocompany@example.com', 'agent', 'active')`,
        [],
      ],
      [
        'leads',
        `INSERT INTO leads (user_id, first_name, last_name, status) VALUES ($1, 'No', 'Company', 'New')`,
        [owner.id],
      ],
      [
        'jobs',
        `INSERT INTO jobs (user_id, title, status) VALUES ($1, 'No company', 'New')`,
        [owner.id],
      ],
      [
        'supplier_connections',
        `INSERT INTO supplier_connections (user_id, provider, status) VALUES ($1, 'quickbooks', 'connected')`,
        [owner.id],
      ],
      [
        'product_events',
        `INSERT INTO product_events (user_id, event_name) VALUES ($1, 'lead_created')`,
        [owner.id],
      ],
    ];
    for (const [table, sql, params] of attempts) {
      const error = await pool.query(sql, params).then(
        () => null,
        (err) => err
      );
      expect({ table, code: error?.code, column: error?.column }).toEqual({
        table,
        code: '23502',
        column: 'company_id',
      });
    }
  });

  it('allows the same email in two companies and rejects duplicates in one', async () => {
    const other = await pool.query(
      `INSERT INTO companies (name, slug, palette_id)
       VALUES ('Other Roofing', 'other-roofing', 'azure')
       RETURNING id`
    );
    const otherId = other.rows[0].id as string;
    const email = 'shared@example.com';

    await createTestUser({
      email,
      role: 'owner',
      company_id: DEFAULT_COMPANY_ID,
    });
    await createTestUser({ email, role: 'owner', company_id: otherId });

    await expect(
      createTestUser({ email, role: 'agent', company_id: DEFAULT_COMPANY_ID })
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('scopes estimate template names per company', async () => {
    const other = await pool.query(
      `INSERT INTO companies (name, slug, palette_id)
       VALUES ('Northside', 'northside', 'slate')
       RETURNING id`
    );
    const otherId = other.rows[0].id as string;
    const name = 'Phase 20 Template';

    await pool.query(
      `INSERT INTO estimate_templates (name, company_id) VALUES ($1, $2)`,
      [name, DEFAULT_COMPANY_ID]
    );
    await pool.query(
      `INSERT INTO estimate_templates (name, company_id) VALUES ($1, $2)`,
      [name, otherId]
    );

    await expect(
      pool.query(
        `INSERT INTO estimate_templates (name, company_id) VALUES ($1, $2)`,
        [name, DEFAULT_COMPANY_ID]
      )
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('migration 0002_company_scoping', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
  });

  it('removes the built-in Rooftop Realty while nobody uses it', async () => {
    // resetDb leaves exactly what the baseline starts with: Rooftop and its templates.
    expect(await builtinExists(pool)).toBe(true);
    const after = await inRolledBackMigration(
      async () => {},
      async (client) => ({
        builtin: await builtinExists(client),
        templates: (
          await client.query(
            `SELECT count(*)::int AS n FROM estimate_templates`
          )
        ).rows[0].n,
        companies: (
          await client.query(`SELECT count(*)::int AS n FROM companies`)
        ).rows[0].n,
      })
    );
    expect(after).toEqual({ builtin: false, templates: 0, companies: 0 });
  });

  it('keeps Rooftop Realty, untouched, once anyone or anything belongs to it', async () => {
    await createTestUser({ role: 'owner', company_id: DEFAULT_COMPANY_ID });
    const before = (
      await pool.query(`SELECT * FROM companies WHERE id = $1`, [
        DEFAULT_COMPANY_ID,
      ])
    ).rows[0];
    const after = await inRolledBackMigration(
      async () => {},
      async (client) =>
        (
          await client.query(`SELECT * FROM companies WHERE id = $1`, [
            DEFAULT_COMPANY_ID,
          ])
        ).rows[0]
    );
    expect(after).toEqual(before);
  });

  it('starts each company’s counter at its own highest number and changes no number', async () => {
    const owner = await createTestUser({
      role: 'owner',
      company_id: DEFAULT_COMPANY_ID,
    });
    const { rows: jobs } = await pool.query(
      `INSERT INTO jobs (user_id, title, status, company_id) VALUES ($1, 'Old job', 'New', $2) RETURNING id`,
      [owner.id, DEFAULT_COMPANY_ID]
    );
    for (const number of ['INV-0007', 'INV-0012', 'INV-0003']) {
      await pool.query(
        `INSERT INTO invoices (user_id, job_id, invoice_number, status, kind, company_id)
         VALUES ($1, $2, $3, 'Sent', 'standard', $4)`,
        [owner.id, jobs[0].id, number, DEFAULT_COMPANY_ID]
      );
    }
    const result = await inRolledBackMigration(
      async (client) => {
        await client.query(`DELETE FROM company_invoice_counters`);
      },
      async (client) => ({
        counter: (
          await client.query(
            `SELECT last_number FROM company_invoice_counters WHERE company_id = $1`,
            [DEFAULT_COMPANY_ID]
          )
        ).rows[0]?.last_number,
        numbers: (
          await client.query(`SELECT invoice_number FROM invoices ORDER BY id`)
        ).rows.map((row) => row.invoice_number),
      })
    );
    expect(result).toEqual({
      counter: 12,
      numbers: ['INV-0007', 'INV-0012', 'INV-0003'],
    });
  });

  it('stops, naming them, when an estimate already has two live final invoices', async () => {
    const owner = await createTestUser({
      role: 'owner',
      company_id: DEFAULT_COMPANY_ID,
    });
    const error = await inRolledBackMigration(
      async (client) => {
        await client.query(
          `DROP INDEX idx_invoices_one_live_per_estimate_kind`
        );
        const job = await client.query(
          `INSERT INTO jobs (user_id, title, status, company_id) VALUES ($1, 'Twice', 'Sold', $2) RETURNING id`,
          [owner.id, DEFAULT_COMPANY_ID]
        );
        const est = await client.query(
          `INSERT INTO estimates (user_id, job_id, title, status, company_id)
           VALUES ($1, $2, 'Roof', 'Approved', $3) RETURNING id`,
          [owner.id, job.rows[0].id, DEFAULT_COMPANY_ID]
        );
        for (const number of ['INV-0101', 'INV-0102']) {
          await client.query(
            `INSERT INTO invoices (user_id, job_id, estimate_id, invoice_number, status, kind, company_id)
             VALUES ($1, $2, $3, $4, 'Sent', 'final', $5)`,
            [
              owner.id,
              job.rows[0].id,
              est.rows[0].id,
              number,
              DEFAULT_COMPANY_ID,
            ]
          );
        }
      },
      async () => null
    ).then(
      () => null,
      (err) => err
    );
    expect(error?.message).toMatch(
      /more than one live final invoice \(INV-0101, INV-0102\)/
    );
  });

  withAdmin(
    'leaves a brand-new database with no company until someone registers',
    async () => {
      const name = 'crm_test_fresh_company_check';
      const admin = new Client({ connectionString: ADMIN_URL });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
        await admin.query(`CREATE DATABASE ${name}`);
        const url = new URL(ADMIN_URL);
        url.pathname = `/${name}`;
        const fresh = new Client({ connectionString: url.toString() });
        await fresh.connect();
        try {
          await migrate(fresh);
          const companies = await fresh.query(
            `SELECT count(*)::int AS n FROM companies`
          );
          const templates = await fresh.query(
            `SELECT count(*)::int AS n FROM estimate_templates`
          );
          expect({
            companies: companies.rows[0].n,
            templates: templates.rows[0].n,
          }).toEqual({
            companies: 0,
            templates: 0,
          });
        } finally {
          await fresh.end();
        }
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
        await admin.end();
      }
    }
  );
});
