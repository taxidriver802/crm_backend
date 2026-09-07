import fs from 'fs';
import path from 'path';
import { pool } from '../../src/db';

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
      users
    RESTART IDENTITY CASCADE;
  `);

  const uploadsDir = path.join(process.cwd(), 'uploads');

  if (fs.existsSync(uploadsDir)) {
    for (const name of fs.readdirSync(uploadsDir)) {
      const filePath = path.join(uploadsDir, name);
      try {
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
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
}
