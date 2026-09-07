import { pool } from '../db';
import { buildStartHere, type ActionItem } from '../lib/startHere';
import { getTaskSummary } from './tasks.service';

export const STALE_LEAD_DAYS = 7;
export const INVOICE_DUE_SOON_DAYS = 3;
export const QUEUE_LIMIT = 10;

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function leadName(row: {
  first_name?: string | null;
  last_name?: string | null;
  id?: number;
}) {
  const name = `${row.first_name || ''} ${row.last_name || ''}`.trim();
  return name || (row.id != null ? `Lead #${row.id}` : 'Lead');
}

function taskSubtitle(task: any): string | null {
  if (task?.job?.title) return task.job.title;
  if (task?.lead_first_name || task?.lead_last_name) {
    return `${task.lead_first_name || ''} ${task.lead_last_name || ''}`.trim() || null;
  }
  if (task?.lead?.name) return task.lead.name;
  if (task?.job_id) return `Job #${task.job_id}`;
  if (task?.lead_id) return `Lead #${task.lead_id}`;
  return null;
}

function mapTaskAction(task: any, reason: string): ActionItem {
  return {
    kind: 'task',
    id: task.id,
    title: task.title,
    subtitle: taskSubtitle(task),
    href: `/tasks/${task.id}`,
    reason,
    at: isoOrNull(task.due_date),
  };
}

export async function getDashboardData(
  userId: string,
  options: { includeAll?: boolean } = {}
) {
  const includeAll = Boolean(options.includeAll);
  const scopeWhere = includeAll ? 'TRUE' : 'user_id = $1';
  const aliased = (alias: string) =>
    includeAll ? 'TRUE' : `${alias}.user_id = $1`;
  const scopeParams = includeAll ? [] : [userId];
  const ph = (extraIndex: number) => `$${includeAll ? extraIndex : extraIndex + 1}`;
  const extras = (...values: unknown[]) =>
    (includeAll ? values : [userId, ...values]) as any[];

  const [
    leadsTotalResult,
    leadsByStatusResult,
    taskSummary,
    jobsTotalResult,
    jobsByStatusResult,
    estimatesTotalResult,
    estimatesByStatusResult,
    staleLeadsResult,
    estimatesAwaitingResult,
    blockedJobsResult,
    invoicesDueResult,
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total FROM leads WHERE ${scopeWhere}`,
      scopeParams
    ),
    pool.query(
      `
        SELECT status, COUNT(*)::int AS count
        FROM leads
        WHERE ${scopeWhere}
        GROUP BY status
        ORDER BY
          CASE status
            WHEN 'New' THEN 1
            WHEN 'Contacted' THEN 2
            WHEN 'Qualified' THEN 3
            WHEN 'Closed' THEN 4
            WHEN 'Inactive' THEN 5
            ELSE 999
          END ASC,
          status ASC;
        `,
      scopeParams
    ),
    getTaskSummary(userId, { includeAll }),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM jobs WHERE ${scopeWhere}`,
      scopeParams
    ),
    pool.query(
      `
        SELECT status, COUNT(*)::int AS count
        FROM jobs
        WHERE ${scopeWhere}
        GROUP BY status
        ORDER BY
          CASE status
            WHEN 'New' THEN 1
            WHEN 'Contacted' THEN 2
            WHEN 'Appointment Scheduled' THEN 3
            WHEN 'Proposal Sent' THEN 4
            WHEN 'Closed Won' THEN 5
            WHEN 'Closed Lost' THEN 6
            ELSE 999
          END ASC,
          status ASC;
        `,
      scopeParams
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM estimates WHERE ${scopeWhere}`,
      scopeParams
    ),
    pool.query(
      `
        SELECT status, COUNT(*)::int AS count
        FROM estimates
        WHERE ${scopeWhere}
        GROUP BY status
        ORDER BY
          CASE status
            WHEN 'Draft' THEN 1
            WHEN 'Sent' THEN 2
            WHEN 'Approved' THEN 3
            WHEN 'Rejected' THEN 4
            ELSE 999
          END ASC,
          status ASC;
        `,
      scopeParams
    ),
    pool.query(
      `
        SELECT
          l.id,
          l.first_name,
          l.last_name,
          l.status,
          l.status_changed_at,
          COALESCE(ln.last_note_at, l.status_changed_at) AS last_comm_at
        FROM leads l
        LEFT JOIN (
          SELECT entity_id, MAX(created_at) AS last_note_at
          FROM notes
          WHERE entity_type = 'lead'
          GROUP BY entity_id
        ) ln ON ln.entity_id = l.id
        WHERE ${aliased('l')}
          AND l.status NOT IN ('Closed', 'Inactive')
          AND COALESCE(ln.last_note_at, l.status_changed_at) < NOW() - (${ph(1)}::int * INTERVAL '1 day')
        ORDER BY last_comm_at ASC
        LIMIT ${ph(2)}
      `,
      extras(STALE_LEAD_DAYS, QUEUE_LIMIT)
    ),
    pool.query(
      `
        SELECT
          e.id,
          e.title,
          e.status,
          e.updated_at,
          e.job_id,
          j.title AS job_title
        FROM estimates e
        INNER JOIN jobs j ON j.id = e.job_id
        WHERE ${aliased('e')}
          AND e.status = 'Sent'
          AND e.client_responded_at IS NULL
        ORDER BY e.updated_at ASC
        LIMIT ${ph(1)}
      `,
      extras(QUEUE_LIMIT)
    ),
    pool.query(
      `
        SELECT
          j.id,
          j.title,
          j.status,
          j.status_changed_at,
          COUNT(t.id)::int AS overdue_task_count,
          MIN(t.due_date) AS oldest_due
        FROM jobs j
        INNER JOIN tasks t
          ON t.job_id = j.id
         AND t.status <> 'Completed'
         AND t.due_date IS NOT NULL
         AND t.due_date < NOW()
        WHERE ${aliased('j')}
          AND j.status NOT IN ('Closed Won', 'Closed Lost')
        GROUP BY j.id
        ORDER BY MIN(t.due_date) ASC
        LIMIT ${ph(1)}
      `,
      extras(QUEUE_LIMIT)
    ),
    pool.query(
      `
        SELECT
          i.id,
          i.invoice_number,
          i.status,
          i.due_date,
          i.job_id,
          j.title AS job_title
        FROM invoices i
        INNER JOIN jobs j ON j.id = i.job_id
        WHERE ${aliased('i')}
          AND i.status IN ('Sent', 'Overdue')
          AND i.due_date IS NOT NULL
          AND i.due_date <= NOW() + (${ph(1)}::int * INTERVAL '1 day')
        ORDER BY i.due_date ASC
        LIMIT ${ph(2)}
      `,
      extras(INVOICE_DUE_SOON_DAYS, QUEUE_LIMIT)
    ),
  ]);

  const overdueFollowUps = (taskSummary.overdueTasks || []).map((task: any) =>
    mapTaskAction(task, 'Overdue follow-up')
  );
  const dueToday = (taskSummary.dueTodayTasks || []).map((task: any) =>
    mapTaskAction(task, 'Due today')
  );

  const staleLeads: ActionItem[] = staleLeadsResult.rows.map((row) => ({
    kind: 'lead' as const,
    id: row.id,
    title: leadName(row),
    subtitle: row.status || null,
    href: `/leads/${row.id}`,
    reason: 'No recent communication',
    at: isoOrNull(row.last_comm_at ?? row.status_changed_at),
  }));

  const estimatesAwaiting: ActionItem[] = estimatesAwaitingResult.rows.map(
    (row) => ({
      kind: 'estimate' as const,
      id: row.id,
      title: row.title,
      subtitle: row.job_title || (row.job_id != null ? `Job #${row.job_id}` : null),
      href: `/estimates/${row.id}`,
      reason: 'Awaiting client response',
      at: isoOrNull(row.updated_at),
    })
  );

  const blockedJobs: ActionItem[] = blockedJobsResult.rows.map((row) => ({
    kind: 'job' as const,
    id: row.id,
    title: row.title,
    subtitle: row.status || null,
    href: `/jobs/${row.id}`,
    reason:
      row.overdue_task_count > 1
        ? `${row.overdue_task_count} overdue tasks`
        : 'Overdue task',
    at: isoOrNull(row.oldest_due),
  }));

  const now = Date.now();
  const invoicesDue: ActionItem[] = invoicesDueResult.rows.map((row) => {
    const due = row.due_date ? new Date(row.due_date).getTime() : NaN;
    const overdue = !Number.isNaN(due) && due < now;
    return {
      kind: 'invoice' as const,
      id: row.id,
      title: row.invoice_number,
      subtitle: row.job_title || (row.job_id != null ? `Job #${row.job_id}` : null),
      href: `/invoices/${row.id}`,
      reason: overdue ? 'Invoice overdue' : 'Invoice due soon',
      at: isoOrNull(row.due_date),
    };
  });

  const overdueInvoices = invoicesDue.filter((item) => item.reason === 'Invoice overdue');
  const invoicesDueSoon = invoicesDue.filter((item) => item.reason === 'Invoice due soon');

  const startHere = buildStartHere({
    overdueFollowUps,
    overdueInvoices,
    invoicesDueSoon,
    blockedJobs,
    estimatesAwaiting,
    staleLeads,
    dueToday,
  });

  return {
    leads: {
      total: leadsTotalResult.rows[0].total,
      byStatus: leadsByStatusResult.rows,
    },
    jobs: {
      total: jobsTotalResult.rows[0].total,
      byStatus: jobsByStatusResult.rows,
    },
    estimates: {
      total: estimatesTotalResult.rows[0].total,
      byStatus: estimatesByStatusResult.rows,
    },
    tasks: taskSummary,
    actions: {
      startHere,
      overdueFollowUps,
      dueToday,
      staleLeads,
      estimatesAwaiting,
      blockedJobs,
      invoicesDue,
    },
  };
}
