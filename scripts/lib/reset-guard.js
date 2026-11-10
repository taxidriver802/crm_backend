/**
 * The walkthrough seed's --reset runs TRUNCATE … CASCADE: it empties those
 * tables (and every table that references them) for every company, not one.
 * This guard lets it run only when no other company has a row it would
 * delete. On a shared database it refuses, and names who would lose data.
 */

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** Every table TRUNCATE … CASCADE on `tables` would empty. */
async function truncateClosure(client, tables) {
  const { rows } = await client.query(
    `
    WITH RECURSIVE closure(oid) AS (
      SELECT c.oid
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
      UNION
      SELECT con.conrelid
      FROM pg_constraint con
      JOIN closure ON con.confrelid = closure.oid
      WHERE con.contype = 'f'
    )
    SELECT c.relname AS name
    FROM closure
    JOIN pg_class c ON c.oid = closure.oid
    ORDER BY 1
    `,
    [tables]
  );
  return rows.map((row) => row.name);
}

/**
 * The companies with at least one row in `tables`, and the tables whose rows
 * can't be attributed to a company (no company_id column) but aren't empty.
 */
async function whoHasRows(client, tables) {
  const { rows: scoped } = await client.query(
    `
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'company_id'
      AND table_name = ANY($1::text[])
    `,
    [tables]
  );
  const scopedNames = new Set(scoped.map((row) => row.table_name));

  const unattributed = [];
  for (const table of tables.filter((name) => !scopedNames.has(name))) {
    const { rowCount } = await client.query(
      `SELECT 1 FROM public.${quoteIdent(table)} LIMIT 1`
    );
    if (rowCount) unattributed.push(table);
  }

  if (!scopedNames.size) return { companies: [], unattributed };
  const union = [...scopedNames]
    .map((name) => `SELECT company_id FROM public.${quoteIdent(name)}`)
    .join(' UNION ');
  const { rows: companies } = await client.query(
    `SELECT id, name, slug FROM companies WHERE id IN (${union}) ORDER BY name`
  );
  return { companies, unattributed };
}

/**
 * Throws unless every row the reset would delete belongs to `companyId`.
 * Returns the tables it would empty.
 */
async function assertResetTouchesOnlyCompany(client, tables, companyId) {
  const closure = await truncateClosure(client, tables);
  const { companies, unattributed } = await whoHasRows(client, closure);
  const others = companies.filter((company) => company.id !== companyId);

  if (others.length) {
    const names = others.map((company) => `${company.name} (${company.slug})`).join(', ');
    throw new Error(
      `Refusing --reset: it empties ${closure.length} tables for every company, and ` +
        `${others.length === 1 ? '1 other company has' : `${others.length} other companies have`} ` +
        `data in them: ${names}. Seed without --reset, or reset a database that holds only this company.`
    );
  }
  if (unattributed.length) {
    throw new Error(
      `Refusing --reset: ${unattributed.join(', ')} hold rows that can't be traced to a company.`
    );
  }
  return closure;
}

module.exports = { truncateClosure, whoHasRows, assertResetTouchesOnlyCompany };
