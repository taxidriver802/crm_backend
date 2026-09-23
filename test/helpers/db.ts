import fs from 'fs';
import path from 'path';
import { pool } from '../../src/db';
import { DEFAULT_COMPANY_ID } from './auth';

export async function resetDb() {
  await pool.query(`
    TRUNCATE TABLE
      job_activity,
      notes,
      notifications,
      saved_views,
      product_events,
      portal_tokens,
      intake_tokens,
      automation_rules,
      invoice_line_items,
      invoices,
      estimate_line_items,
      estimates,
      estimate_template_line_items,
      estimate_templates,
      files,
      tasks,
      jobs,
      leads,
      supplier_webhook_events,
      supplier_orders,
      supplier_accounts,
      supplier_connections,
      users,
      companies
    RESTART IDENTITY CASCADE;
  `);

  await pool.query(
    `
    INSERT INTO companies (id, name, slug, palette_id)
    VALUES ($1, 'Rooftop Realty', 'rooftop', 'rooftop')
    ON CONFLICT (id) DO NOTHING
    `,
    [DEFAULT_COMPANY_ID]
  );

  const uploadsDir = path.join(process.cwd(), 'uploads');

  if (fs.existsSync(uploadsDir)) {
    for (const name of fs.readdirSync(uploadsDir)) {
      const filePath = path.join(uploadsDir, name);
      try {
        fs.rmSync(filePath, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures for test temp files
      }
    }
  }

  const seedPath = path.join(
    process.cwd(),
    'sql',
    'patch_phase17_quotes_photos.sql'
  );
  if (fs.existsSync(seedPath)) {
    await pool.query(fs.readFileSync(seedPath, 'utf8'));
  }

  const companiesPatchPath = path.join(
    process.cwd(),
    'sql',
    'patch_phase20_companies.sql'
  );
  if (fs.existsSync(companiesPatchPath)) {
    await pool.query(fs.readFileSync(companiesPatchPath, 'utf8'));
  }

  const brandingPatchPath = path.join(
    process.cwd(),
    'sql',
    'patch_phase21_company_branding.sql'
  );
  if (fs.existsSync(brandingPatchPath)) {
    await pool.query(fs.readFileSync(brandingPatchPath, 'utf8'));
  }
}
