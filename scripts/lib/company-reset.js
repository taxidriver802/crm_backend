/**
 * Empties one company's business records, and proves nobody else's changed.
 *
 * Unlike the walkthrough seed's --reset (a TRUNCATE that empties tables for
 * every company), every statement here is a DELETE … WHERE company_id = one
 * company. People, sign-ins, account history, preferences and the intake
 * link stay. The fingerprint lets a caller check, before it commits, that
 * every row outside the company is exactly as it was.
 */

/** Children before parents, so nothing waits on a cascade. */
const COMPANY_RECORD_TABLES = [
  'notifications',
  'product_events',
  'saved_views',
  'automation_rules',
  'portal_tokens',
  'job_activity',
  'job_measurements',
  'files',
  'notes',
  'invoice_payments',
  'invoice_line_items',
  'invoices',
  'estimate_line_items',
  'estimates',
  'estimate_template_line_items',
  'estimate_templates',
  'tasks',
  'lead_status_events',
  'assignment_events',
  'supplier_webhook_events',
  'supplier_orders',
  'supplier_accounts',
  'supplier_connections',
  'jobs',
  'leads',
  'company_invoice_counters',
];

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function companyScopedTables(client) {
  const { rows } = await client.query(
    `SELECT table_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'company_id'
     ORDER BY table_name`
  );
  return rows.map((row) => row.table_name);
}

/** Refuses on a schema that lacks a table the reset expects. */
async function assertResetTables(client) {
  const scoped = new Set(await companyScopedTables(client));
  const missing = COMPANY_RECORD_TABLES.filter((name) => !scoped.has(name));
  if (missing.length) {
    throw new Error(
      `This database is missing ${missing.join(', ')} (or their company_id). Run npm run db:migrate, then rerun.`
    );
  }
}

/**
 * Deletes the company's records, table by table. Returns how many rows each
 * table lost. `db` must name its company with $company (see company-scope.js).
 */
async function clearCompanyRecords(db) {
  const removed = {};
  for (const table of COMPANY_RECORD_TABLES) {
    const result = await db.query(
      `DELETE FROM public.${quoteIdent(table)} WHERE company_id = $company`
    );
    if (result.rowCount) removed[table] = result.rowCount;
  }
  return removed;
}

/**
 * A count and a content hash of every row outside the company, in every
 * table that has company_id, plus the other companies themselves. Two equal
 * fingerprints mean no other company's row was added, removed or changed.
 * Read inside one REPEATABLE READ transaction, so other companies' own
 * writes during the seed don't show up as differences.
 */
async function otherCompaniesFingerprint(client, companyId) {
  const fingerprint = {};
  const tables = [...(await companyScopedTables(client)), 'companies'];
  for (const table of tables) {
    const column = table === 'companies' ? 'id' : 'company_id';
    const { rows } = await client.query(
      `SELECT count(*)::bigint AS rows,
              coalesce(sum(hashtext(t::text)::bigint), 0)::text AS hash
       FROM public.${quoteIdent(table)} t
       WHERE t.${column} IS DISTINCT FROM $1`,
      [companyId]
    );
    fingerprint[table] = `${rows[0].rows}:${rows[0].hash}`;
  }
  return fingerprint;
}

/** Throws, naming the tables, if anything outside the company changed. */
function assertFingerprintUnchanged(before, after) {
  const changed = Object.keys({ ...before, ...after }).filter(
    (table) => before[table] !== after[table]
  );
  if (changed.length) {
    throw new Error(
      `Rows outside the demo company changed in ${changed.join(', ')}. Nothing was saved.`
    );
  }
}

module.exports = {
  COMPANY_RECORD_TABLES,
  assertResetTables,
  clearCompanyRecords,
  otherCompaniesFingerprint,
  assertFingerprintUnchanged,
};
