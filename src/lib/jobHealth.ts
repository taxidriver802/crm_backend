import { daysInStatus } from './aging';

export const JOB_HEALTH_STALL_DAYS = 7;

export type JobHealthLevel = 'none' | 'red' | 'yellow' | 'green';

export type JobHealth = {
  level: JobHealthLevel;
  reasons: string[];
};

const CLOSED_STATUSES = new Set(['Closed Won', 'Closed Lost']);

export function computeJobHealth(input: {
  status?: string | null;
  statusChangedAt?: Date | string | null;
  overdueTaskCount?: number | null;
  overdueInvoiceCount?: number | null;
  sentAwaitingCount?: number | null;
}): JobHealth {
  if (CLOSED_STATUSES.has(String(input.status || ''))) {
    return { level: 'none', reasons: [] };
  }

  const overdueTasks = Number(input.overdueTaskCount) || 0;
  const overdueInvoices = Number(input.overdueInvoiceCount) || 0;
  const sentAwaiting = Number(input.sentAwaitingCount) || 0;
  const days = daysInStatus(input.statusChangedAt);

  const redReasons: string[] = [];
  if (overdueTasks > 0) redReasons.push('Overdue tasks');
  if (overdueInvoices > 0) redReasons.push('Overdue invoice');
  if (redReasons.length > 0) {
    return { level: 'red', reasons: redReasons };
  }

  const yellowReasons: string[] = [];
  if (days >= JOB_HEALTH_STALL_DAYS) yellowReasons.push('7+ days in status');
  if (sentAwaiting > 0) yellowReasons.push('Estimate awaiting response');
  if (yellowReasons.length > 0) {
    return { level: 'yellow', reasons: yellowReasons };
  }

  return { level: 'green', reasons: [] };
}
