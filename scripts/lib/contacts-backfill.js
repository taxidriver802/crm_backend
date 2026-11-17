/**
 * Gives one company's leads and jobs their contacts, the way migration 0004
 * did for the data that existed when it ran. The seeds insert leads and jobs
 * with plain SQL, so they call this once both are in:
 *
 *   - each lead without a contact gets one made from it (name, phone, email,
 *     preferred contact method, source, rep, dates; the address is the
 *     lead's newest job address; no name at all becomes "Lead #N");
 *   - each job without a contact takes its lead's;
 *   - a job with no lead gets a placeholder, "Client of job #N".
 *
 * Re-running is harmless: rows that already have a contact are left alone.
 * The app itself does the same per lead (contacts.service ensureLeadContact).
 */

async function linkLeadContacts(client, companyId) {
  if (!companyId) throw new Error('linkLeadContacts needs a company id.');

  const made = await client.query(
    `
    INSERT INTO contacts (
      company_id, user_id, assigned_to, kind,
      first_name, last_name, display_name,
      phone, email, address,
      preferred_contact_method, source, legacy_lead_id,
      created_at, updated_at
    )
    SELECT
      l.company_id, l.user_id, l.assigned_to, 'homeowner',
      NULLIF(btrim(l.first_name), ''),
      NULLIF(btrim(l.last_name), ''),
      CASE
        WHEN COALESCE(btrim(l.first_name), '') = '' AND COALESCE(btrim(l.last_name), '') = ''
          THEN 'Lead #' || l.id
      END,
      NULLIF(btrim(l.phone), ''),
      NULLIF(btrim(l.email), ''),
      (
        SELECT j.address
        FROM jobs j
        WHERE j.lead_id = l.id
          AND j.company_id = l.company_id
          AND COALESCE(btrim(j.address), '') <> ''
        ORDER BY j.created_at DESC, j.id DESC
        LIMIT 1
      ),
      l.preferred_contact_method,
      l.source,
      l.id,
      l.created_at,
      l.updated_at
    FROM leads l
    WHERE l.company_id = $1
      AND l.contact_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.legacy_lead_id = l.id)
    ORDER BY l.id
    `,
    [companyId]
  );

  await client.query(
    `
    UPDATE leads l
    SET contact_id = c.id
    FROM contacts c
    WHERE c.legacy_lead_id = l.id
      AND c.company_id = l.company_id
      AND l.company_id = $1
      AND l.contact_id IS NULL
    `,
    [companyId]
  );

  await client.query(
    `
    UPDATE jobs j
    SET contact_id = l.contact_id
    FROM leads l
    WHERE j.lead_id = l.id
      AND l.company_id = j.company_id
      AND j.company_id = $1
      AND l.contact_id IS NOT NULL
      AND j.contact_id IS NULL
    `,
    [companyId]
  );

  const orphans = await client.query(
    `SELECT id, user_id, assigned_to, address, created_at
     FROM jobs
     WHERE company_id = $1 AND contact_id IS NULL
     ORDER BY id`,
    [companyId]
  );
  for (const job of orphans.rows) {
    const inserted = await client.query(
      `INSERT INTO contacts (
         company_id, user_id, assigned_to, kind, display_name, address, created_at
       ) VALUES ($1, $2, $3, 'homeowner', $4, NULLIF(btrim($5), ''), $6)
       RETURNING id`,
      [
        companyId,
        job.user_id,
        job.assigned_to,
        `Client of job #${job.id}`,
        job.address ?? '',
        job.created_at,
      ]
    );
    await client.query(`UPDATE jobs SET contact_id = $1 WHERE id = $2`, [
      inserted.rows[0].id,
      job.id,
    ]);
  }

  return { contacts: made.rowCount + orphans.rowCount, placeholders: orphans.rowCount };
}

module.exports = { linkLeadContacts };
