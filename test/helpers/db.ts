import fs from 'fs';
import path from 'path';
import { pool } from '../../src/db';
import { uploadsRoot } from '../../src/lib/uploadsDir';
const { startingRowsSql } = require('../../scripts/lib/migrations');

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

  // The built-in company and its estimate templates, as a new database has them.
  await pool.query(startingRowsSql());

  // Only ever the per-run temporary directory from test/setupEnv.ts, never
  // the app's own uploads.
  const uploadsDir = uploadsRoot();
  if (uploadsDir === path.resolve(process.cwd(), 'uploads')) {
    throw new Error('resetDb refuses to empty the app uploads directory; set UPLOADS_DIR');
  }

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
}
