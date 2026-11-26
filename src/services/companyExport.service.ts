import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { pool } from '../db';
import { uploadsRoot } from '../lib/uploadsDir';
import { staffAccess } from '../lib/lifecycle';
import { isMailConfigured, sendMail } from '../lib/mailer';
import { ZipWriter } from '../lib/zip';

/**
 * A company's export (PLAN_operator.md §3, step 5): every record the company
 * keeps here, as JSON and CSV, plus its uploaded files, in one zip.
 *
 * - The owner starts one directly while the company has staff access
 *   (once a day), or asks for a final one while it is pending deletion,
 *   which the operator approves.
 * - The archive is built in the background and downloaded by the owner,
 *   signed in, for 72 hours. Nobody else can download it, the operator
 *   included: the operator's code never imports this file.
 */

export const EXPORT_HOURS = 72;
export const SELF_SERVE_PER_DAY = 1;

/** The tables an export carries, each filtered by company_id. */
export const EXPORTED_TABLES = [
  'users',
  'user_preferences',
  'account_events',
  'contacts',
  'contact_methods',
  'leads',
  'lead_status_events',
  'assignment_events',
  'jobs',
  'job_contacts',
  'job_activity',
  'job_measurements',
  'estimates',
  'estimate_line_items',
  'estimate_templates',
  'estimate_template_line_items',
  'invoices',
  'invoice_line_items',
  'invoice_payments',
  'company_invoice_counters',
  'notes',
  'tasks',
  'files',
  'notifications',
  'saved_views',
  'automation_rules',
  'supplier_accounts',
  'supplier_orders',
] as const;

/**
 * Company tables left out, and why. test/companyExport.test.ts fails if a
 * table with a company_id is in neither list.
 */
export const SKIPPED_TABLES: Record<string, string> = {
  user_sessions: 'sign-in sessions: secrets, and no use outside Joist',
  password_resets: 'reset links: secrets',
  email_verifications: 'confirmation links: secrets',
  portal_tokens: 'client link secrets',
  intake_tokens: 'client link secrets',
  supplier_connections: 'encrypted supplier credentials',
  supplier_webhook_events: 'raw supplier traffic',
  product_events: 'Joist’s own product analytics',
  login_events: 'Joist’s security log',
  company_exports: 'the exports themselves',
  operator_events: 'the operator’s account history',
  company_tombstones: 'kept by Joist after deletion',
  company_notices: 'which account emails Joist has sent',
};

/** Columns never written to an archive: secrets and token hashes. */
const DROPPED_COLUMN = /(_hash$|^encrypted_|_secret$)/;

export class ExportError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = 'ExportError';
    this.status = status;
  }
}

export function exportsRoot(): string {
  const configured = process.env.EXPORTS_DIR?.trim();
  return path.resolve(configured || path.join(process.cwd(), 'exports'));
}

export function archivePath(exportId: string) {
  return path.join(exportsRoot(), `${exportId}.zip`);
}

async function recordEvent(companyId: string, event: string, detail: Record<string, unknown>) {
  await pool.query(
    `INSERT INTO operator_events (operator_id, company_id, company_slug, event, detail)
     SELECT NULL, id, slug, $2, $3 FROM companies WHERE id = $1`,
    [companyId, event, JSON.stringify(detail)]
  );
}

// ─── What the owner sees ───────────────────────────────────────────────────

const EXPORT_COLUMNS = `id, kind, status, created_at, approved_at, built_at, expires_at,
  byte_size, downloaded_at, download_count`;

function shape(row: any) {
  const live = (row.status === 'built' || row.status === 'downloaded') &&
    row.expires_at && new Date(row.expires_at) > new Date();
  return { ...row, byte_size: row.byte_size == null ? null : Number(row.byte_size), can_download: Boolean(live) };
}

export async function listExports(companyId: string) {
  const { rows } = await pool.query(
    `SELECT ${EXPORT_COLUMNS} FROM company_exports WHERE company_id = $1
     ORDER BY created_at DESC LIMIT 20`,
    [companyId]
  );
  return rows.map(shape);
}

type Owner = { userId: string; role: string; companyId: string };

async function companyStatus(companyId: string): Promise<string> {
  const { rows } = await pool.query(`SELECT status FROM companies WHERE id = $1`, [companyId]);
  return rows[0]?.status ?? '';
}

function requireOwner(user: Owner) {
  if (user.role !== 'owner') throw new ExportError('Only the company’s owner can export its data.', 403);
}

/** The owner exports now (trial, active, past due, suspended). */
export async function requestSelfServe(user: Owner) {
  requireOwner(user);
  const status = await companyStatus(user.companyId);
  if (staffAccess(status) === 'none') {
    throw new ExportError('This company can’t export right now.', 403);
  }
  const recent = await pool.query(
    `SELECT COUNT(*)::int AS n FROM company_exports
     WHERE company_id = $1 AND kind = 'self_serve' AND status <> 'failed'
       AND created_at > now() - interval '1 day'`,
    [user.companyId]
  );
  if (recent.rows[0].n >= SELF_SERVE_PER_DAY) {
    throw new ExportError('One export a day. Try again tomorrow.', 429);
  }
  const { rows } = await pool.query(
    `INSERT INTO company_exports (company_id, requested_by, kind, status, approved_at)
     VALUES ($1, $2, 'self_serve', 'approved', now())
     RETURNING ${EXPORT_COLUMNS}`,
    [user.companyId, user.userId]
  );
  await recordEvent(user.companyId, 'export_requested', { export_id: rows[0].id, kind: 'self_serve' });
  scheduleExportBuilds();
  return shape(rows[0]);
}

/** While pending deletion: the owner asks for a final export, which the operator approves. */
export async function requestFinal(user: Owner, password: unknown) {
  requireOwner(user);
  if ((await companyStatus(user.companyId)) !== 'pending_deletion') {
    throw new ExportError('A final export is only for a company that is closing.', 403);
  }
  const { rows: people } = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [user.userId]);
  const hash = people[0]?.password_hash;
  if (typeof password !== 'string' || !hash || !(await bcrypt.compare(password, hash))) {
    throw new ExportError('That password isn’t right.', 400);
  }
  const open = await pool.query(
    `SELECT 1 FROM company_exports
     WHERE company_id = $1 AND kind = 'final' AND status IN ('requested', 'approved', 'building')`,
    [user.companyId]
  );
  if (open.rowCount) throw new ExportError('A final export is already on its way.');
  const { rows } = await pool.query(
    `INSERT INTO company_exports (company_id, requested_by, kind, status)
     VALUES ($1, $2, 'final', 'requested')
     RETURNING ${EXPORT_COLUMNS}`,
    [user.companyId, user.userId]
  );
  await recordEvent(user.companyId, 'export_requested', { export_id: rows[0].id, kind: 'final' });
  return shape(rows[0]);
}

/** The archive's path, for the owner only, while it is live. Logs the download. */
export async function openDownload(user: Owner, exportId: string) {
  requireOwner(user);
  const { rows } = await pool.query(
    `SELECT ${EXPORT_COLUMNS} FROM company_exports WHERE id = $1 AND company_id = $2`,
    [exportId, user.companyId]
  );
  const row = rows[0];
  if (!row) throw new ExportError('Export not found', 404);
  if (!shape(row).can_download) throw new ExportError('This export is no longer available.', 410);
  const file = archivePath(row.id);
  if (!fs.existsSync(file)) throw new ExportError('This export is no longer available.', 410);
  await pool.query(
    `UPDATE company_exports SET status = 'downloaded', downloaded_at = COALESCE(downloaded_at, now()),
       download_count = download_count + 1, updated_at = now()
     WHERE id = $1`,
    [row.id]
  );
  await recordEvent(user.companyId, 'export_downloaded', { export_id: row.id, kind: row.kind });
  return { file, filename: `joist-export-${new Date(row.created_at).toISOString().slice(0, 10)}.zip` };
}

// ─── Building ──────────────────────────────────────────────────────────────

function csvCell(value: unknown): string {
  if (value == null) return '';
  const text =
    value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: Record<string, unknown>[], columns: string[]) {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

function* walk(dir: string, base = dir): Generator<{ abs: string; rel: string }> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs, base);
    else if (entry.isFile()) yield { abs, rel: path.relative(base, abs).split(path.sep).join('/') };
  }
}

const README = (name: string, when: string) => `Joist export: ${name}
Made ${when}.

data/<table>.json  every record, as JSON
data/<table>.csv   the same records, for a spreadsheet
files/             the files your team uploaded, by their storage key
                   (data/files.json maps each one to its record)

Passwords, sign-in links and client link secrets are not included.
`;

/** Writes the archive for one export. Returns its size in bytes. */
export async function buildArchive(exportId: string, companyId: string): Promise<number> {
  fs.mkdirSync(exportsRoot(), { recursive: true });
  const target = archivePath(exportId);
  const partial = `${target}.partial`;
  const zip = new ZipWriter(partial);
  try {
    const { rows: companies } = await pool.query(
      `SELECT id, name, slug, palette_id, mark_id, created_at FROM companies WHERE id = $1`,
      [companyId]
    );
    const company = companies[0];
    if (!company) throw new Error('company not found');
    const when = new Date().toISOString();
    zip.add('README.txt', README(company.name, when));
    zip.add('data/company.json', JSON.stringify(company, null, 2));

    for (const table of EXPORTED_TABLES) {
      const { rows, fields } = await pool.query(`SELECT * FROM ${table} WHERE company_id = $1`, [companyId]);
      const columns = fields.map((f) => f.name).filter((c) => !DROPPED_COLUMN.test(c));
      const kept = rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c]])));
      zip.add(`data/${table}.json`, JSON.stringify(kept, null, 2));
      zip.add(`data/${table}.csv`, toCsv(kept, columns));
    }

    for (const { abs, rel } of walk(path.join(uploadsRoot(), companyId))) {
      zip.add(`files/${companyId}/${rel}`, fs.readFileSync(abs), fs.statSync(abs).mtime);
    }

    const size = zip.finish();
    fs.renameSync(partial, target);
    return size;
  } catch (error) {
    zip.abort();
    fs.rmSync(partial, { force: true });
    throw error;
  }
}

async function tellOwner(companyId: string) {
  if (!isMailConfigured()) return;
  const { rows } = await pool.query(
    `SELECT u.email, c.name FROM users u JOIN companies c ON c.id = u.company_id
     WHERE u.company_id = $1 AND u.role = 'owner' AND u.status = 'active'
     ORDER BY u.created_at LIMIT 1`,
    [companyId]
  );
  const owner = rows[0];
  if (!owner) return;
  const text = `Your export of ${owner.name} is ready. Sign in to Joist to download it within ${EXPORT_HOURS} hours.`;
  await sendMail({ to: owner.email, subject: 'Your Joist export is ready', text, html: `<p>${text}</p>`, fromName: 'Joist' });
}

let running = false;

/**
 * Builds every approved export, one at a time. Safe to call often: a second
 * call while one is running returns at once.
 */
export async function runExportBuilds() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const { rows } = await pool.query(
        `UPDATE company_exports SET status = 'building', updated_at = now()
         WHERE id = (
           SELECT id FROM company_exports WHERE status = 'approved'
           ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
         )
         RETURNING id, company_id, kind`
      );
      const job = rows[0];
      if (!job) break;
      try {
        const size = await buildArchive(job.id, job.company_id);
        await pool.query(
          `UPDATE company_exports SET status = 'built', built_at = now(), byte_size = $2,
             expires_at = now() + make_interval(hours => $3), updated_at = now()
           WHERE id = $1`,
          [job.id, size, EXPORT_HOURS]
        );
        await recordEvent(job.company_id, 'export_built', { export_id: job.id, kind: job.kind, byte_size: size });
        await tellOwner(job.company_id).catch((error) => console.error('[exports] email failed', error));
      } catch (error) {
        console.error('[exports] build failed', job.id, error);
        await pool.query(`UPDATE company_exports SET status = 'failed', updated_at = now() WHERE id = $1`, [job.id]);
        await recordEvent(job.company_id, 'export_failed', { export_id: job.id, kind: job.kind });
      }
    }
  } finally {
    running = false;
  }
}

/** Starts the builder soon, outside the request. Tests call runExportBuilds themselves. */
export function scheduleExportBuilds() {
  if (process.env.NODE_ENV === 'test') return;
  setImmediate(() => {
    runExportBuilds().catch((error) => console.error('[exports] builder', error));
  });
}

/** Removes archives past their 72 hours, and puts back builds a restart cut off. */
export async function sweepExports() {
  const { rows } = await pool.query(
    `UPDATE company_exports SET status = 'expired', updated_at = now()
     WHERE status IN ('built', 'downloaded') AND expires_at <= now()
     RETURNING id`
  );
  for (const row of rows) fs.rmSync(archivePath(row.id), { force: true });
  return rows.length;
}

/** At boot: a build that was running when the process stopped starts again. */
export async function resumeInterruptedBuilds() {
  await pool.query(`UPDATE company_exports SET status = 'approved' WHERE status = 'building'`);
  scheduleExportBuilds();
}
