import fs from 'fs/promises';
import path from 'path';
import { pool } from '../db';
import { uploadsRoot } from '../lib/uploadsDir';
import { allowedMoves, COMPANY_STATUSES, HOLDABLE, isCompanyStatus, type CompanyStatus } from '../lib/lifecycle';

/**
 * Every query the operator surface makes (PLAN_operator.md §5–6).
 *
 * The rule here is "counts, never content". These queries may read the
 * companies table, people's names, emails, roles and statuses (for seats and
 * the billing contact), sign-in times, and the operator's own tables. A
 * company's work (leads, contacts, jobs, estimates, invoices, notes, tasks,
 * files) appears only inside COUNT(*). test/operator.companies.test.ts reads
 * this file and fails if that ever changes.
 */

export { COMPANY_STATUSES };
export type { CompanyStatus };

const ACCOUNT_COLUMNS = `
  c.id, c.name, c.slug, c.status, c.status_changed_at, c.next_status_at,
  c.status_reason, c.plan, c.trial_ends_at, c.billing_email, c.approved_at,
  c.created_at`;

const SEATS_AND_OWNER = `
  seats.active AS seats_active,
  seats.invited AS seats_invited,
  seats.disabled AS seats_disabled,
  seats.last_sign_in_at,
  owner.id AS owner_id,
  owner.first_name AS owner_first_name,
  owner.last_name AS owner_last_name,
  owner.email AS owner_email,
  owner.email_verified_at AS owner_email_verified_at`;

const SEATS_AND_OWNER_JOINS = `
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE u.status = 'active')::int AS active,
      COUNT(*) FILTER (WHERE u.status = 'invited')::int AS invited,
      COUNT(*) FILTER (WHERE u.status = 'disabled')::int AS disabled,
      MAX(u.last_login_at) AS last_sign_in_at
    FROM users u WHERE u.company_id = c.id
  ) seats ON true
  LEFT JOIN LATERAL (
    SELECT u.id, u.first_name, u.last_name, u.email, u.email_verified_at
    FROM users u
    WHERE u.company_id = c.id AND u.role = 'owner'
    ORDER BY (u.status = 'active') DESC, u.created_at
    LIMIT 1
  ) owner ON true`;

type Row = Record<string, any>;

function shapeCompany(row: Row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    status_changed_at: row.status_changed_at,
    next_status_at: row.next_status_at,
    status_reason: row.status_reason,
    plan: row.plan,
    trial_ends_at: row.trial_ends_at,
    billing_email: row.billing_email,
    approved_at: row.approved_at,
    created_at: row.created_at,
    seats: {
      active: row.seats_active ?? 0,
      invited: row.seats_invited ?? 0,
      disabled: row.seats_disabled ?? 0,
    },
    last_sign_in_at: row.last_sign_in_at,
    owner: row.owner_id
      ? {
          name: [row.owner_first_name, row.owner_last_name].filter(Boolean).join(' ').trim() || null,
          email: row.owner_email,
          email_verified: Boolean(row.owner_email_verified_at),
        }
      : null,
  };
}

export type OperatorCompany = ReturnType<typeof shapeCompany> & { storage_bytes: number | null };

// ─── Storage, measured from the company's own uploads folder ──────────────

const STORAGE_TTL_MS = 10 * 60 * 1000;
const storageCache = new Map<string, { at: number; bytes: number | null }>();

async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await folderBytes(full);
    else if (entry.isFile()) total += (await fs.stat(full)).size;
  }
  return total;
}

/** Bytes under uploads/<companyId>/, cached ten minutes. Null when unreadable. */
export async function companyStorageBytes(companyId: string): Promise<number | null> {
  const cached = storageCache.get(companyId);
  if (cached && Date.now() - cached.at < STORAGE_TTL_MS) return cached.bytes;
  let bytes: number | null;
  try {
    bytes = await folderBytes(path.join(uploadsRoot(), companyId));
  } catch {
    bytes = null;
  }
  storageCache.set(companyId, { at: Date.now(), bytes });
  return bytes;
}

export function clearStorageCacheForTests() {
  storageCache.clear();
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export type ListOptions = { status?: CompanyStatus; q?: string };

export async function listCompanies(options: ListOptions = {}): Promise<OperatorCompany[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (options.status) {
    params.push(options.status);
    where.push(`c.status = $${params.length}`);
  }
  const q = options.q?.trim();
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    where.push(`(c.name ILIKE $${params.length} OR c.slug ILIKE $${params.length})`);
  }
  const { rows } = await pool.query(
    `SELECT ${ACCOUNT_COLUMNS}, ${SEATS_AND_OWNER}
     FROM companies c
     ${SEATS_AND_OWNER_JOINS}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY c.created_at DESC`,
    params
  );
  return Promise.all(
    rows.map(async (row: Row) => ({
      ...shapeCompany(row),
      storage_bytes: await companyStorageBytes(row.id),
    }))
  );
}

export async function getCompany(companyId: string) {
  const { rows } = await pool.query(
    `SELECT ${ACCOUNT_COLUMNS}, c.operator_notes, c.held_from_status, ${SEATS_AND_OWNER}
     FROM companies c
     ${SEATS_AND_OWNER_JOINS}
     WHERE c.id = $1`,
    [companyId]
  );
  const row = rows[0];
  if (!row) return null;

  // How much work the company keeps here. Counts only.
  const counts = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM leads WHERE company_id = $1)::int AS leads,
       (SELECT COUNT(*) FROM jobs WHERE company_id = $1)::int AS jobs,
       (SELECT COUNT(*) FROM estimates WHERE company_id = $1)::int AS estimates,
       (SELECT COUNT(*) FROM invoices WHERE company_id = $1)::int AS invoices,
       (SELECT COUNT(*) FROM files WHERE company_id = $1)::int AS files`,
    [companyId]
  );

  const events = await pool.query(
    `SELECT e.id, e.event, e.from_status, e.to_status, e.detail, e.created_at,
            o.email AS operator_email
     FROM operator_events e
     LEFT JOIN operators o ON o.id = e.operator_id
     WHERE e.company_id = $1
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT 100`,
    [companyId]
  );

  return {
    ...shapeCompany(row),
    storage_bytes: await companyStorageBytes(companyId),
    operator_notes: row.operator_notes,
    held_from_status: row.held_from_status,
    counts: counts.rows[0],
    events: events.rows,
    // What the operator can do from here (src/lib/lifecycle.ts).
    moves: isCompanyStatus(row.status) ? allowedMoves(row.status) : [],
    can_hold: HOLDABLE.includes(row.status),
  };
}

export async function overview() {
  const byStatus = await pool.query(
    `SELECT status, COUNT(*)::int AS count FROM companies GROUP BY status`
  );
  const totals: Record<string, number> = Object.fromEntries(
    COMPANY_STATUSES.map((s) => [s, 0])
  );
  for (const row of byStatus.rows) totals[row.status] = row.count;

  const recent = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS signups_7d,
       COUNT(*)::int AS companies
     FROM companies`
  );
  const people = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active_people FROM users`
  );

  const pending = await listCompanies({ status: 'pending' });
  const { rows: timers } = await pool.query(
    `SELECT c.id, c.name, c.slug, c.status, c.next_status_at
     FROM companies c
     WHERE c.next_status_at IS NOT NULL AND c.next_status_at < now() + interval '7 days'
     ORDER BY c.next_status_at`
  );

  return {
    totals,
    companies: recent.rows[0].companies,
    signups_7d: recent.rows[0].signups_7d,
    active_people: people.rows[0].active_people,
    pending: pending.sort((a, b) => {
      // Verified owners first, then oldest first.
      const va = a.owner?.email_verified ? 0 : 1;
      const vb = b.owner?.email_verified ? 0 : 1;
      return va - vb || +new Date(a.created_at) - +new Date(b.created_at);
    }),
    timers_7d: timers,
  };
}
