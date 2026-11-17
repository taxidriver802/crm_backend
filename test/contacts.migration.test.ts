/// <reference types="jest" />
/**
 * Migration 0004_contacts (crm_frontend/docs/research/contacts-plan.md,
 * step 1): the match keys, the contact tables, and one contact copied from
 * each lead without changing any id or existing value.
 *
 * The suite's database already has 0004 (ensureSchema). Leads and jobs made
 * here have no contact yet, because the app doesn't set one until step 2, so
 * re-running the migration's text over them is exactly the backfill an
 * upgraded database gets. Each re-run happens in a transaction that is
 * rolled back.
 */
import fs from 'fs';
import path from 'path';
import type { PoolClient } from 'pg';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import {
  createTestCompany,
  createTestUser,
  DEFAULT_COMPANY_ID,
} from './helpers/auth';

jest.setTimeout(60000);

const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'migrations', '0004_contacts.sql'),
  'utf8'
);

type Db = { query: PoolClient['query'] };

/** Runs the migration's text (`times` times) in a transaction that is rolled back. */
async function inRolledBackMigration<T>(
  check: (client: PoolClient) => Promise<T>,
  { setup, times = 1 }: { setup?: (client: PoolClient) => Promise<void>; times?: number } = {}
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (setup) await setup(client);
    for (let i = 0; i < times; i += 1) await client.query(MIGRATION);
    return await check(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function insertLead(
  db: Db,
  values: {
    user_id: string;
    company_id?: string;
    first_name?: string;
    last_name?: string;
    phone?: string | null;
    email?: string | null;
    source?: string | null;
    preferred_contact_method?: string | null;
    assigned_to?: string | null;
    created_at?: string;
  }
) {
  const { rows } = await db.query(
    `INSERT INTO leads (user_id, company_id, first_name, last_name, phone, email, source,
                        preferred_contact_method, assigned_to, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'New',
             COALESCE($10::timestamptz, now()), COALESCE($10::timestamptz, now()))
     RETURNING *`,
    [
      values.user_id,
      values.company_id ?? DEFAULT_COMPANY_ID,
      values.first_name ?? 'Helen',
      values.last_name ?? 'Brooks',
      values.phone ?? null,
      values.email ?? null,
      values.source ?? null,
      values.preferred_contact_method ?? null,
      values.assigned_to ?? null,
      values.created_at ?? null,
    ]
  );
  return rows[0];
}

async function insertJob(
  db: Db,
  values: {
    user_id: string;
    lead_id: number | null;
    address?: string | null;
    company_id?: string;
    created_at?: string;
  }
) {
  const { rows } = await db.query(
    `INSERT INTO jobs (user_id, company_id, lead_id, title, status, address, created_at, updated_at)
     VALUES ($1, $2, $3, 'Roof replacement', 'New', $4,
             COALESCE($5::timestamptz, now()), COALESCE($5::timestamptz, now()))
     RETURNING *`,
    [
      values.user_id,
      values.company_id ?? DEFAULT_COMPANY_ID,
      values.lead_id,
      values.address ?? null,
      values.created_at ?? null,
    ]
  );
  return rows[0];
}

describe('migration 0004_contacts', () => {
  let owner: { id: string };

  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
    owner = await createTestUser({ role: 'owner', company_id: DEFAULT_COMPANY_ID });
  });

  afterAll(async () => {
    await resetDb();
  });

  describe('match keys', () => {
    async function key(fn: string, value: string | null) {
      const { rows } = await pool.query(`SELECT public.${fn}($1) AS key`, [value]);
      return rows[0].key as string | null;
    }

    it('gives the examples in the plan’s section 7.1', async () => {
      expect(await key('crm_phone_key', '(612) 555-0147')).toBe('6125550147');
      expect(await key('crm_email_key', 'Helen.Brooks@Example.com')).toBe(
        'helen.brooks@example.com'
      );
      expect(await key('crm_address_key', '7 Juniper Court, Plymouth, MN 55447')).toBe(
        '7 juniper ct 55447'
      );
    });

    it('gives one phone key however the number is typed', async () => {
      for (const typed of [
        '(612) 555-0147',
        '612.555.0147',
        '+1 612-555-0147',
        '16125550147',
        '612-555-0147 x22',
        '612 555 0147 ext. 9',
      ]) {
        expect(await key('crm_phone_key', typed)).toBe('6125550147');
      }
      expect(await key('crm_phone_key', 'n/a')).toBeNull();
      expect(await key('crm_phone_key', '')).toBeNull();
      expect(await key('crm_phone_key', null)).toBeNull();
    });

    it('gives one address key however the address is typed', async () => {
      const same = async (key_: string, ...typed: string[]) => {
        for (const t of typed) expect(await key('crm_address_key', t)).toBe(key_);
      };
      await same(
        '7 juniper ct 55447',
        '7 Juniper Ct, Plymouth, MN 55447',
        '7 juniper ct. plymouth mn 55447-1234',
        '7 Juniper Ct 55447'
      );
      // The city is dropped when there is a ZIP, so Saint Paul = St. Paul.
      await same(
        '88 larkspur ln 55105',
        '88 Larkspur Ln, Saint Paul, MN 55105',
        '88 Larkspur Lane, St. Paul, MN 55105'
      );
      await same(
        '12 elm st # 4 55401',
        '12 Elm St, Apt 4, Minneapolis, MN 55401',
        '12 Elm Street #4, Minneapolis, MN 55401',
        '12 Elm St Unit 4 Minneapolis MN 55401'
      );
      await same(
        '500 main st ne 55413',
        '500 Main St NE, Minneapolis, MN 55413',
        '500 Main Street Northeast Minneapolis 55413'
      );
      // No ZIP: house number, street and city; the state is dropped.
      await same('3 test way minneapolis', '3 Test Way, Minneapolis, MN', '3 Test Way Minneapolis MN');
      // A five-digit house number is not taken for a ZIP.
      await same('12345 county rd 6', '12345 County Road 6');
      expect(await key('crm_address_key', '  ')).toBeNull();
      expect(await key('crm_address_key', ',,,')).toBeNull();
    });

    it('fills the key columns from what is typed', async () => {
      const lead = await insertLead(pool, { user_id: owner.id });
      const { rows } = await pool.query(
        `INSERT INTO contacts (company_id, first_name, phone, email, address)
         VALUES ($1, 'Helen', '(763) 555-0128', ' Helen@Example.com', '7 Juniper Court, Plymouth, MN 55447')
         RETURNING phone_key, email_key, address_key, kind`,
        [DEFAULT_COMPANY_ID]
      );
      expect(rows[0]).toEqual({
        phone_key: '7635550128',
        email_key: 'helen@example.com',
        address_key: '7 juniper ct 55447',
        kind: 'homeowner',
      });
      const job = await insertJob(pool, {
        user_id: owner.id,
        lead_id: lead.id,
        address: '7 Juniper Ct, Plymouth, MN 55447',
      });
      expect(job.address_key).toBe('7 juniper ct 55447');
    });
  });

  describe('backfill', () => {
    it('copies one contact from each lead, and links the lead and its jobs to it', async () => {
      const rep = await createTestUser({ role: 'agent', company_id: DEFAULT_COMPANY_ID });
      const lead = await insertLead(pool, {
        user_id: owner.id,
        assigned_to: rep.id,
        first_name: ' Helen ',
        last_name: 'Brooks',
        phone: '(763) 555-0128',
        email: 'Helen@Example.com',
        source: 'Website',
        preferred_contact_method: 'text',
        created_at: '2025-04-01T12:00:00Z',
      });
      const older = await insertJob(pool, {
        user_id: owner.id,
        lead_id: lead.id,
        address: '7 Juniper Ct, Plymouth, MN 55447',
        created_at: '2025-05-01T12:00:00Z',
      });
      const newer = await insertJob(pool, {
        user_id: owner.id,
        lead_id: lead.id,
        address: '7 Juniper Court, Plymouth, MN 55447',
        created_at: '2026-06-01T12:00:00Z',
      });

      const result = await inRolledBackMigration(async (client) => ({
        contacts: (await client.query(`SELECT * FROM contacts`)).rows,
        lead: (await client.query(`SELECT contact_id FROM leads WHERE id = $1`, [lead.id])).rows[0],
        jobs: (
          await client.query(`SELECT id, contact_id FROM jobs ORDER BY id`)
        ).rows,
      }));

      expect(result.contacts).toHaveLength(1);
      const contact = result.contacts[0];
      expect(contact).toMatchObject({
        company_id: DEFAULT_COMPANY_ID,
        user_id: owner.id,
        assigned_to: rep.id,
        kind: 'homeowner',
        first_name: 'Helen',
        last_name: 'Brooks',
        display_name: null,
        phone: '(763) 555-0128',
        phone_key: '7635550128',
        email: 'Helen@Example.com',
        email_key: 'helen@example.com',
        // The lead's newest job address.
        address: '7 Juniper Court, Plymouth, MN 55447',
        address_key: '7 juniper ct 55447',
        preferred_contact_method: 'text',
        source: 'Website',
        legacy_lead_id: lead.id,
        merged_into_id: null,
        archived_at: null,
      });
      expect(new Date(contact.created_at).toISOString()).toBe('2025-04-01T12:00:00.000Z');
      expect(result.lead.contact_id).toBe(contact.id);
      expect(result.jobs).toEqual([
        { id: older.id, contact_id: contact.id },
        { id: newer.id, contact_id: contact.id },
      ]);
    });

    it('runs twice without copying anything twice', async () => {
      for (const first of ['Helen', 'Marcus', 'Priya']) {
        const lead = await insertLead(pool, { user_id: owner.id, first_name: first });
        await insertJob(pool, { user_id: owner.id, lead_id: lead.id, address: '1 Main St, Town, MN 55401' });
      }
      const counts = async (client: PoolClient) =>
        (
          await client.query(`
            SELECT (SELECT count(*)::int FROM contacts) AS contacts,
                   (SELECT count(*)::int FROM leads WHERE contact_id IS NULL) AS leads_without,
                   (SELECT count(*)::int FROM jobs WHERE contact_id IS NULL) AS jobs_without`)
        ).rows[0];
      expect(await inRolledBackMigration(counts, { times: 1 })).toEqual({
        contacts: 3,
        leads_without: 0,
        jobs_without: 0,
      });
      expect(await inRolledBackMigration(counts, { times: 2 })).toEqual({
        contacts: 3,
        leads_without: 0,
        jobs_without: 0,
      });
    });

    it('changes no lead or job value besides contact_id', async () => {
      const lead = await insertLead(pool, {
        user_id: owner.id,
        phone: '612-555-0147',
        email: 'a@b.co',
        source: 'Referral',
      });
      await insertJob(pool, { user_id: owner.id, lead_id: lead.id, address: '9 Quill Lane, Duluth, MN' });
      const leadsBefore = (await pool.query(`SELECT * FROM leads ORDER BY id`)).rows;
      const jobsBefore = (await pool.query(`SELECT * FROM jobs ORDER BY id`)).rows;
      const after = await inRolledBackMigration(async (client) => ({
        leads: (await client.query(`SELECT * FROM leads ORDER BY id`)).rows,
        jobs: (await client.query(`SELECT * FROM jobs ORDER BY id`)).rows,
      }));
      const without = (rows: any[]) => rows.map(({ contact_id, ...rest }) => rest);
      expect(without(after.leads)).toEqual(without(leadsBefore));
      expect(without(after.jobs)).toEqual(without(jobsBefore));
    });

    it('merges nothing: two leads with the same phone become two contacts', async () => {
      await insertLead(pool, { user_id: owner.id, phone: '(612) 555-0147' });
      await insertLead(pool, { user_id: owner.id, phone: '612.555.0147' });
      const rows = await inRolledBackMigration(
        async (client) =>
          (await client.query(`SELECT phone_key FROM contacts ORDER BY id`)).rows
      );
      expect(rows).toEqual([{ phone_key: '6125550147' }, { phone_key: '6125550147' }]);
    });

    it('names a lead with no name "Lead #N"', async () => {
      const lead = await insertLead(pool, { user_id: owner.id, first_name: '', last_name: ' ' });
      const contact = await inRolledBackMigration(
        async (client) =>
          (await client.query(`SELECT first_name, last_name, display_name FROM contacts`)).rows[0]
      );
      expect(contact).toEqual({
        first_name: null,
        last_name: null,
        display_name: `Lead #${lead.id}`,
      });
    });

    it('gives a job whose lead was deleted a placeholder contact', async () => {
      const lead = await insertLead(pool, { user_id: owner.id });
      const job = await insertJob(pool, { user_id: owner.id, lead_id: lead.id, address: '12 Elm St' });
      await pool.query(`DELETE FROM leads WHERE id = $1`, [lead.id]);
      const result = await inRolledBackMigration(async (client) => ({
        contacts: (
          await client.query(`SELECT id, display_name, address, legacy_lead_id FROM contacts`)
        ).rows,
        job: (await client.query(`SELECT contact_id FROM jobs WHERE id = $1`, [job.id])).rows[0],
      }));
      expect(result.contacts).toEqual([
        {
          id: result.job.contact_id,
          display_name: `Client of job #${job.id}`,
          address: '12 Elm St',
          legacy_lead_id: null,
        },
      ]);
    });

    it('keeps each contact in its lead’s company', async () => {
      const other = await createTestCompany();
      const otherOwner = await createTestUser({ role: 'owner', company_id: other.id });
      await insertLead(pool, { user_id: owner.id });
      const theirs = await insertLead(pool, { user_id: otherOwner.id, company_id: other.id });
      await insertJob(pool, { user_id: otherOwner.id, company_id: other.id, lead_id: theirs.id });
      const rows = await inRolledBackMigration(
        async (client) =>
          (
            await client.query(`
              SELECT c.company_id = l.company_id AS lead_same,
                     NOT EXISTS (SELECT 1 FROM jobs j WHERE j.contact_id = c.id AND j.company_id <> c.company_id) AS jobs_same
              FROM contacts c JOIN leads l ON l.contact_id = c.id`)
          ).rows
      );
      expect(rows).toEqual([
        { lead_same: true, jobs_same: true },
        { lead_same: true, jobs_same: true },
      ]);
    });
  });

  describe('rules', () => {
    async function contactFor(companyId = DEFAULT_COMPANY_ID) {
      const { rows } = await pool.query(
        `INSERT INTO contacts (company_id, first_name) VALUES ($1, 'Helen') RETURNING id`,
        [companyId]
      );
      return rows[0].id as number;
    }

    it('refuses a lead or job that names another company’s contact', async () => {
      const other = await createTestCompany();
      const theirs = await contactFor(other.id);
      const lead = await insertLead(pool, { user_id: owner.id });
      const job = await insertJob(pool, { user_id: owner.id, lead_id: lead.id });
      await expect(
        pool.query(`UPDATE leads SET contact_id = $1 WHERE id = $2`, [theirs, lead.id])
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        pool.query(`UPDATE jobs SET contact_id = $1 WHERE id = $2`, [theirs, job.id])
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('won’t delete a contact that still has leads or jobs', async () => {
      const contact = await contactFor();
      const lead = await insertLead(pool, { user_id: owner.id });
      await pool.query(`UPDATE leads SET contact_id = $1 WHERE id = $2`, [contact, lead.id]);
      await expect(pool.query(`DELETE FROM contacts WHERE id = $1`, [contact])).rejects.toMatchObject(
        { code: '23503' }
      );
    });

    it('keeps a job’s contact when its lead is deleted', async () => {
      const contact = await contactFor();
      const lead = await insertLead(pool, { user_id: owner.id });
      await pool.query(`UPDATE leads SET contact_id = $1 WHERE id = $2`, [contact, lead.id]);
      const job = await insertJob(pool, { user_id: owner.id, lead_id: lead.id });
      await pool.query(`UPDATE jobs SET contact_id = $1 WHERE id = $2`, [contact, job.id]);
      await pool.query(`DELETE FROM leads WHERE id = $1`, [lead.id]);
      const { rows } = await pool.query(`SELECT lead_id, contact_id FROM jobs WHERE id = $1`, [job.id]);
      expect(rows[0]).toEqual({ lead_id: null, contact_id: contact });
    });

    it('lets a task belong to a contact, and to exactly one owner', async () => {
      const contact = await contactFor();
      const lead = await insertLead(pool, { user_id: owner.id });
      const task = (sql: string, params: unknown[]) =>
        pool.query(
          `INSERT INTO tasks (user_id, company_id, title, ${sql}) VALUES ($1, $2, 'Call Helen in March', ${params
            .map((_, i) => `$${i + 3}`)
            .join(', ')})`,
          [owner.id, DEFAULT_COMPANY_ID, ...params]
        );
      await expect(task('contact_id', [contact])).resolves.toMatchObject({ rowCount: 1 });
      await expect(task('contact_id, lead_id', [contact, lead.id])).rejects.toMatchObject({
        code: '23514',
      });
    });

    it('lets a note be on a contact and a saved view be of contacts', async () => {
      const contact = await contactFor();
      await expect(
        pool.query(
          `INSERT INTO notes (user_id, company_id, entity_type, entity_id, body, type)
           VALUES ($1, $2, 'contact', $3, 'Warranty question about the 2024 roof', 'call')`,
          [owner.id, DEFAULT_COMPANY_ID, contact]
        )
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        pool.query(
          `INSERT INTO saved_views (user_id, company_id, entity_type, name)
           VALUES ($1, $2, 'contacts', 'Partners')`,
          [owner.id, DEFAULT_COMPANY_ID]
        )
      ).resolves.toMatchObject({ rowCount: 1 });
    });

    it('accepts only the fixed kinds, and needs some name', async () => {
      await expect(
        pool.query(`INSERT INTO contacts (company_id, kind, company_name) VALUES ($1, 'adjuster', 'State Farm')`, [
          DEFAULT_COMPANY_ID,
        ])
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        pool.query(`INSERT INTO contacts (company_id, kind, first_name) VALUES ($1, 'wizard', 'Dan')`, [
          DEFAULT_COMPANY_ID,
        ])
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        pool.query(`INSERT INTO contacts (company_id, first_name, display_name) VALUES ($1, ' ', '')`, [
          DEFAULT_COMPANY_ID,
        ])
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('links people to a job with a role, and keys their extra phones and emails', async () => {
      const client = await contactFor();
      const adjuster = await contactFor();
      const lead = await insertLead(pool, { user_id: owner.id });
      const job = await insertJob(pool, { user_id: owner.id, lead_id: lead.id });
      await pool.query(
        `INSERT INTO job_contacts (company_id, job_id, contact_id, role) VALUES ($1, $2, $3, 'adjuster')`,
        [DEFAULT_COMPANY_ID, job.id, adjuster]
      );
      const { rows } = await pool.query(
        `INSERT INTO contact_methods (company_id, contact_id, kind, value, label, person_name)
         VALUES ($1, $2, 'phone', '(612) 555-0199', 'mobile', 'Mark'),
                ($1, $2, 'email', ' Mark@Example.com', NULL, 'Mark')
         RETURNING value_key`,
        [DEFAULT_COMPANY_ID, client]
      );
      expect(rows.map((r) => r.value_key)).toEqual(['6125550199', 'mark@example.com']);
      await expect(
        pool.query(
          `INSERT INTO job_contacts (company_id, job_id, contact_id, role) VALUES ($1, $2, $3, 'wizard')`,
          [DEFAULT_COMPANY_ID, job.id, client]
        )
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
