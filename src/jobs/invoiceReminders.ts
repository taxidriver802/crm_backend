import { pool } from '../db';
import { createNotification } from '../lib/notifications';
import { markOverdueInvoices } from '../services/invoices.service';

export async function runInvoiceReminderJob() {
  // Due-soon: open invoices (sent or partially paid) due within 3 days.
  const dueSoon = await pool.query(
    `SELECT i.id, i.user_id, i.invoice_number, i.due_date, i.job_id,
            GREATEST(i.grand_total - i.amount_paid, 0) AS balance
     FROM invoices i
     WHERE i.status IN ('Sent', 'Partially Paid')
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
      message: `${inv.invoice_number} has $${Number(inv.balance).toFixed(2)} due ${new Date(inv.due_date).toLocaleDateString()}.`,
      entityType: 'invoice',
      entityId: inv.id,
      metadata: { jobId: inv.job_id, invoiceNumber: inv.invoice_number },
      dedupeKey,
    });
  }

  // Overdue: open invoices past due with a balance move to Overdue.
  const overdue = await markOverdueInvoices();

  for (const inv of overdue) {
    const balance = Math.max(0, Number(inv.grand_total) - Number(inv.amount_paid));
    await createNotification({
      userId: inv.user_id,
      type: 'INVOICE_STATUS_CHANGED',
      title: 'Invoice overdue',
      message: `${inv.invoice_number} is now overdue with $${balance.toFixed(2)} unpaid.`,
      entityType: 'invoice',
      entityId: inv.id,
      metadata: { jobId: inv.job_id, invoiceNumber: inv.invoice_number },
      dedupeKey: `invoice_overdue_${inv.id}`,
    });
  }

  return {
    due_soon_notified: dueSoon.rowCount ?? 0,
    marked_overdue: overdue.length,
  };
}
