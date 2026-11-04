import { daysInStatus } from './aging';
import { phaseOf, type JobMoney, EMPTY_MONEY } from './jobLifecycle';

export const JOB_HEALTH_STALL_DAYS = 7;

export type JobHealthLevel = 'none' | 'red' | 'yellow' | 'green';

export type JobHealth = {
  level: JobHealthLevel;
  reasons: string[];
};

/**
 * Health covers the whole lifecycle. Before phase 23 it returned 'none' for
 * any won job, so a job in production with overdue tasks or an overdue
 * invoice looked fine. Now only Closed and Lost are out of scope.
 */
export function computeJobHealth(input: {
  status?: string | null;
  statusChangedAt?: Date | string | null;
  overdueTaskCount?: number | null;
  overdueInvoiceCount?: number | null;
  sentAwaitingCount?: number | null;
  upcomingAppointmentCount?: number | null;
  money?: JobMoney | null;
}): JobHealth {
  const status = String(input.status || '');
  const phase = phaseOf(status);
  if (phase === 'closed' || phase === 'lost') {
    return { level: 'none', reasons: [] };
  }

  const money = input.money ?? EMPTY_MONEY;
  const overdueTasks = Number(input.overdueTaskCount) || 0;
  const overdueInvoices = Number(input.overdueInvoiceCount) || 0;
  const sentAwaiting = Number(input.sentAwaitingCount) || 0;
  const upcoming = Number(input.upcomingAppointmentCount) || 0;
  const days = daysInStatus(input.statusChangedAt);
  const stalled = days >= JOB_HEALTH_STALL_DAYS;

  const redReasons: string[] = [];
  if (overdueTasks > 0) redReasons.push('Overdue tasks');
  if (overdueInvoices > 0) redReasons.push('Overdue invoice');
  if (redReasons.length > 0) {
    return { level: 'red', reasons: redReasons };
  }

  const yellowReasons: string[] = [];
  if (phase === 'selling') {
    if (stalled) yellowReasons.push('7+ days in status');
    if (sentAwaiting > 0) yellowReasons.push('Estimate awaiting response');
  } else if (status === 'Sold') {
    if (upcoming === 0 && stalled) yellowReasons.push('Sold 7+ days, not scheduled');
  } else if (status === 'Work Scheduled') {
    if (upcoming === 0) yellowReasons.push('Scheduled date has passed');
  } else if (status === 'In Progress') {
    if (stalled) yellowReasons.push('In progress 7+ days');
  } else if (status === 'Work Complete') {
    if (money.unbilled_total > 0.004 || money.draft_invoice_count > 0) {
      yellowReasons.push('Work complete, not invoiced');
    } else if (money.outstanding_total > 0.004 && stalled) {
      yellowReasons.push('Balance unpaid 7+ days');
    }
  }
  if (yellowReasons.length > 0) {
    return { level: 'yellow', reasons: yellowReasons };
  }

  return { level: 'green', reasons: [] };
}
