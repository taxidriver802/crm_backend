import { pool } from '../db';
import { createNotification } from '../lib/notifications';

export async function runInvoiceReminderJob() {
  const now = new Date();

  // Due-soon: invoices with status 'Sent' due within 3 days
  const dueSoon = await pool.query(
    `SELECT i.id, i.user_id, i.invoice_number, i.due_date, i.job_id
     FROM invoices i
     WHERE i.status = 'Sent'
       AND i.due_date IS NOT NULL
       AND i.due_date > NOW()
       AND i.due_date <= NOW() + INTERVAL '3 days'`
  );

  for (const inv of dueSoon.rows) {
    const dedupeKey = `invoice_due_soon_${inv.id}_${inv.due_date.toISOString().slice(0, 10)}`;
    await createNotification({
      userId: inv.user_id,
      type: 'INVOICE_STATUS_CHANGED',
      title: 'Invoice due soon',
      message: `${inv.invoice_number} is due ${new Date(inv.due_date).toLocaleDateString()}.`,
      entityType: 'invoice',
      entityId: inv.id,
      metadata: { jobId: inv.job_id, invoiceNumber: inv.invoice_number },
      dedupeKey,
    });
  }

  // Overdue: invoices with status 'Sent' past due date → auto-update to 'Overdue'
  const overdue = await pool.query(
    `UPDATE invoices
     SET status = 'Overdue', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'Sent'
       AND due_date IS NOT NULL
       AND due_date < NOW()
     RETURNING id, user_id, invoice_number, job_id`
  );

  for (const inv of overdue.rows) {
    await createNotification({
      userId: inv.user_id,
      type: 'INVOICE_STATUS_CHANGED',
      title: 'Invoice overdue',
      message: `${inv.invoice_number} is now overdue.`,
      entityType: 'invoice',
      entityId: inv.id,
      metadata: { jobId: inv.job_id, invoiceNumber: inv.invoice_number },
      dedupeKey: `invoice_overdue_${inv.id}`,
    });
  }

  return {
    due_soon_notified: dueSoon.rowCount ?? 0,
    marked_overdue: overdue.rowCount ?? 0,
  };
}
