/**
 * The seeds write into one named company. There is no default company: a row
 * without company_id fails, and these helpers make every seed write name its
 * company on purpose.
 */

/**
 * A query wrapper for seed writes. Each statement names its company with the
 * token $company (a VALUES entry, or company_id = $company in a WHERE), which
 * becomes the next numbered parameter. A write that does not name its
 * company is refused before it reaches the database.
 */
function companyScoped(pool, companyId) {
  if (!companyId) throw new Error('companyScoped needs a company id.');
  return {
    query(sql, params = []) {
      const names = sql.includes('$company');
      if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql) && !names) {
        throw new Error(
          `Seed write does not name its company: ${sql.trim().split('\n')[0]}`
        );
      }
      if (!names) return pool.query(sql, params);
      return pool.query(sql.split('$company').join(`$${params.length + 1}`), [
        ...params,
        companyId,
      ]);
    },
  };
}

/** The company to seed: the one with this slug, or the only company there is. */
async function pickCompany(pool, slug) {
  const { rows } = await pool.query(
    `SELECT id, name, slug FROM companies ORDER BY created_at, slug`
  );
  const slugs = rows.map((row) => row.slug).join(', ') || 'none';
  if (slug) {
    const company = rows.find((row) => row.slug === slug);
    if (!company)
      throw new Error(
        `No company with slug "${slug}". Companies here: ${slugs}.`
      );
    return company;
  }
  if (rows.length === 1) return rows[0];
  if (rows.length === 0) {
    throw new Error(
      'This database has no company yet. Register on the site first, then rerun this seed.'
    );
  }
  throw new Error(
    `This database has ${rows.length} companies (${slugs}). Name the one to seed with --company <slug>.`
  );
}

module.exports = { companyScoped, pickCompany };
