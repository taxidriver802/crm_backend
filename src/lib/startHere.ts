export const START_HERE_LIMIT = 8;

export type ActionKind = 'task' | 'lead' | 'job' | 'estimate' | 'invoice';

export type ActionItem = {
  kind: ActionKind;
  id: number;
  title: string;
  subtitle: string | null;
  href: string;
  reason: string;
  at: string | null;
};

export type StartHereInput = {
  overdueFollowUps: ActionItem[];
  overdueInvoices: ActionItem[];
  invoicesDueSoon: ActionItem[];
  blockedJobs: ActionItem[];
  estimatesAwaiting: ActionItem[];
  staleLeads: ActionItem[];
  dueToday: ActionItem[];
};

export function buildStartHere(
  input: StartHereInput,
  limit = START_HERE_LIMIT
): ActionItem[] {
  const concatenated = [
    ...(input.overdueFollowUps || []),
    ...(input.overdueInvoices || []),
    ...(input.invoicesDueSoon || []),
    ...(input.blockedJobs || []),
    ...(input.estimatesAwaiting || []),
    ...(input.staleLeads || []),
    ...(input.dueToday || []),
  ];

  const seen = new Set<string>();
  const out: ActionItem[] = [];

  for (const item of concatenated) {
    if (!item || item.id == null || !item.kind) continue;
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }

  return out;
}
