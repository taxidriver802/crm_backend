import { pool } from '../db';

export const PERFORMANCE_WINDOWS = [30, 90, 365] as const;
export type PerformanceWindow = (typeof PERFORMANCE_WINDOWS)[number];

export const MIN_DECISION_SAMPLE = 10;

export const PERFORMANCE_ATTRIBUTION =
  'Outcomes use the assignee at that moment once assignment history exists. Until then, they stay with the current assignee.';

const JOB_STATUSES = [
  'New',
  'Contacted',
  'Appointment Scheduled',
  'Proposal Sent',
  'Closed Won',
  'Closed Lost',
];

const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Closed', 'Inactive'];

type CountRow = { user_id: string | null; count?: unknown };

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function gatedRate(numerator: number, sample: number): number | null {
  if (sample < MIN_DECISION_SAMPLE) return null;
  return numerator / sample;
}

function windowSql(column: string) {
  return `
    ${column} >= NOW() - ($2::int * INTERVAL '1 day')
    AND (
      ($3::int = 0 AND ${column} <= NOW())
      OR ($3::int <> 0 AND ${column} < NOW() - ($3::int * INTERVAL '1 day'))
    )
  `;
}

function mapByUser<T>(
  rows: Array<{ user_id: string | null }>,
  pick: (row: { user_id: string | null }) => T
) {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (!row.user_id) continue;
    map.set(String(row.user_id), pick(row));
  }
  return map;
}

function displayName(row: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}) {
  const name = `${row.first_name || ''} ${row.last_name || ''}`.trim();
  return name || row.email || 'User';
}

type TransitionRow = {
  user_id: string | null;
  from_status: string | null;
  to_status: string | null;
  days: unknown;
  same_day: boolean;
};

function summarizeTransitions(rows: TransitionRow[], order: string[]) {
  const dwell = new Map<string, Map<string, number[]>>();
  const reversals = new Map<string, { reversals: number; sample: number }>();

  for (const row of rows) {
    if (!row.user_id) continue;
    const id = String(row.user_id);
    const from = row.from_status || '';
    const to = row.to_status || '';
    const fromOrd = order.indexOf(from);
    const toOrd = order.indexOf(to);
    const reversal = fromOrd >= 0 && toOrd >= 0 && toOrd < fromOrd;
    if (reversal && row.same_day) continue;

    const rev = reversals.get(id) ?? { reversals: 0, sample: 0 };
    rev.sample += 1;
    if (reversal) rev.reversals += 1;
    reversals.set(id, rev);

    const days = Number(row.days);
    if (!from || !Number.isFinite(days) || days < 0) continue;
    const byStatus = dwell.get(id) ?? new Map<string, number[]>();
    const bucket = byStatus.get(from) ?? [];
    bucket.push(days);
    byStatus.set(from, bucket);
    dwell.set(id, byStatus);
  }

  const timing = new Map<
    string,
    { status: string; medianDays: number; sample: number }[]
  >();
  for (const [id, byStatus] of dwell) {
    const list = [...byStatus.entries()]
      .map(([status, values]) => ({
        status,
        medianDays: median(values) ?? 0,
        sample: values.length,
      }))
      .sort((left, right) => order.indexOf(left.status) - order.indexOf(right.status));
    timing.set(id, list);
  }

  return { timing, reversals };
}

type PeriodBundle = {
  leads: Map<string, { leads: number; converted: number }>;
  decisions: Map<string, { won: number; lost: number }>;
  wonRevenue: Map<string, number>;
  collected: Map<string, number>;
  estimates: Map<string, { approved: number; rejected: number }>;
  firstResponse: Map<string, { medianHours: number | null; sample: number }>;
  proposalLag: Map<string, { medianDays: number | null; sample: number }>;
  daysToProposal: Map<string, { medianDays: number | null; sample: number }>;
  proposalToDecision: Map<string, { medianDays: number | null; sample: number }>;
  stageTiming: Map<string, { status: string; medianDays: number; sample: number }[]>;
  leadStageTiming: Map<string, { status: string; medianDays: number; sample: number }[]>;
  reversals: Map<string, { reversals: number; sample: number }>;
  closeQuality: Map<string, { poor: number; eligible: number }>;
  inactiveLeads: Map<string, number>;
};

async function loadPeriod(
  companyId: string,
  startDays: number,
  endDays: number
): Promise<PeriodBundle> {
  const params = [companyId, startDays, endDays];
  const leadWindow = windowSql('l.created_at');
  const decisionWindow = windowSql('j.status_changed_at');
  const paidWindow = windowSql('i.paid_at');
  const responseWindow = windowSql('e.client_responded_at');
  const proposalWindow = windowSql('proposed_at');
  const sendWindow = windowSql('sent_at');
  const inactiveWindow = windowSql('l.status_changed_at');
  const transitionWindow = windowSql('created_at');
  const leadEventWindow = windowSql('changed_at');

  const [
    leadsResult,
    decisionsResult,
    wonRevenueResult,
    collectedResult,
    estimatesResult,
    firstResponseResult,
    proposalLagResult,
    daysToProposalResult,
    proposalToDecisionResult,
    jobTransitionsResult,
    leadTransitionsResult,
    closeQualityResult,
    inactiveResult,
  ] = await Promise.all([
    pool.query(
      `
      SELECT user_id,
        COUNT(*)::int AS leads,
        COUNT(*) FILTER (WHERE has_job)::int AS converted
      FROM (
        SELECT
          crm_assignee_at_outcome(l.company_id, 'lead', l.id, l.created_at, l.assigned_to) AS user_id,
          EXISTS (
            SELECT 1 FROM jobs j
            WHERE j.lead_id = l.id AND j.company_id = l.company_id
          ) AS has_job
        FROM leads l
        WHERE l.company_id = $1 AND ${leadWindow}
      ) s
      GROUP BY user_id
      `,
      params
    ),
    pool.query(
      `
      SELECT user_id,
        COUNT(*) FILTER (WHERE status = 'Closed Won')::int AS won,
        COUNT(*) FILTER (WHERE status = 'Closed Lost')::int AS lost
      FROM (
        SELECT
          crm_assignee_at_outcome(j.company_id, 'job', j.id, j.status_changed_at, j.assigned_to) AS user_id,
          j.status
        FROM jobs j
        WHERE j.company_id = $1
          AND j.status IN ('Closed Won', 'Closed Lost')
          AND ${decisionWindow}
      ) s
      GROUP BY user_id
      `,
      params
    ),
    pool.query(
      `
      SELECT user_id, COALESCE(SUM(grand_total), 0)::float AS amount
      FROM (
        SELECT
          crm_assignee_at_outcome(j.company_id, 'job', j.id, j.status_changed_at, j.assigned_to) AS user_id,
          e.grand_total
        FROM jobs j
        JOIN estimates e
          ON e.job_id = j.id
         AND e.company_id = j.company_id
         AND e.status = 'Approved'
        WHERE j.company_id = $1
          AND j.status = 'Closed Won'
          AND ${decisionWindow}
      ) s
      GROUP BY user_id
      `,
      params
    ),
    pool.query(
      `
      SELECT user_id, COALESCE(SUM(grand_total), 0)::float AS amount
      FROM (
        SELECT
          crm_assignee_at_outcome(j.company_id, 'job', j.id, i.paid_at, j.assigned_to) AS user_id,
          i.grand_total
        FROM invoices i
        JOIN jobs j ON j.id = i.job_id AND j.company_id = i.company_id
        WHERE i.company_id = $1
          AND i.paid_at IS NOT NULL
          AND ${paidWindow}
      ) s
      GROUP BY user_id
      `,
      params
    ),
    pool.query(
      `
      SELECT user_id,
        COUNT(*) FILTER (WHERE status = 'Approved')::int AS approved,
        COUNT(*) FILTER (WHERE status = 'Rejected')::int AS rejected
      FROM (
        SELECT
          crm_assignee_at_outcome(j.company_id, 'job', j.id, e.client_responded_at, j.assigned_to) AS user_id,
          e.status
        FROM estimates e
        JOIN jobs j ON j.id = e.job_id AND j.company_id = e.company_id
        WHERE e.company_id = $1
          AND e.status IN ('Approved', 'Rejected')
          AND e.client_responded_at IS NOT NULL
          AND ${responseWindow}
      ) s
      GROUP BY user_id
      `,
      params
    ),
    pool.query(
      `
      SELECT user_id,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS median_hours,
        COUNT(*)::int AS sample
      FROM (
        SELECT
          crm_assignee_at_outcome(l.company_id, 'lead', l.id, l.created_at, l.assigned_to) AS user_id,
          EXTRACT(EPOCH FROM (fn.first_at - l.created_at)) / 3600.0 AS hours
        FROM leads l
        JOIN (
          SELECT entity_id, MIN(created_at) AS first_at
          FROM notes
          WHERE company_id = $1
            AND entity_type = 'lead'
            AND direction = 'outbound'
            AND type IN ('call', 'text', 'email', 'in_person')
          GROUP BY entity_id
        ) fn ON fn.entity_id = l.id AND fn.first_at >= l.created_at
        WHERE l.company_id = $1 AND ${leadWindow}
      ) s
      GROUP BY user_id
      `,
      params
    ),
    pool.query(
      `
      WITH first_send AS (
        SELECT
          e.job_id,
          MIN(
            CASE
              WHEN e.sent_at IS NOT NULL THEN e.sent_at
              WHEN e.status <> 'Draft' THEN e.created_at
              ELSE NULL
            END
          ) AS sent_at
        FROM estimates e
        WHERE e.company_id = $1
        GROUP BY e.job_id
      )
      SELECT user_id,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS median_days,
        COUNT(*)::int AS sample
      FROM (
        SELECT
          crm_assignee_at_outcome(j.company_id, 'job', j.id, fs.sent_at, j.assigned_to) AS user_id,
          EXTRACT(EPOCH FROM (fs.sent_at - j.created_at)) / 86400.0 AS days,
          fs.sent_at
        FROM first_send fs
        JOIN jobs j ON j.id = fs.job_id AND j.company_id = $1
        WHERE fs.sent_at IS NOT NULL
          AND fs.sent_at >= j.created_at
      ) s
      WHERE ${sendWindow}
      GROUP BY user_id
      `,
      params
    ),
    pool.query(
      `
      WITH first_proposal AS (
        SELECT DISTINCT ON (a.job_id)
          a.job_id,
          a.created_at AS proposed_at
        FROM job_activity a
        JOIN jobs j ON j.id = a.job_id AND j.company_id = $1
        WHERE a.type = 'JOB_STATUS_CHANGED'
          AND a.metadata->>'toStatus' = 'Proposal Sent'
        ORDER BY a.job_id, a.created_at ASC, a.id ASC
      )
      SELECT user_id,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS median_days,
        COUNT(*)::int AS sample
      FROM (
        SELECT
          crm_assignee_at_outcome(j.company_id, 'job', j.id, fp.proposed_at, j.assigned_to) AS user_id,
          EXTRACT(EPOCH FROM (fp.proposed_at - j.created_at)) / 86400.0 AS days,
          fp.proposed_at
        FROM first_proposal fp
        JOIN jobs j ON j.id = fp.job_id
        WHERE j.company_id = $1
          AND fp.proposed_at >= j.created_at
      ) proposed
      WHERE ${proposalWindow}
      GROUP BY user_id
      `,
      params
    ),
    pool.query(
      `
      WITH first_proposal AS (
        SELECT DISTINCT ON (a.job_id)
          a.job_id,
          a.created_at AS proposed_at
        FROM job_activity a
        JOIN jobs j ON j.id = a.job_id AND j.company_id = $1
        WHERE a.type = 'JOB_STATUS_CHANGED'
          AND a.metadata->>'toStatus' = 'Proposal Sent'
        ORDER BY a.job_id, a.created_at ASC, a.id ASC
      )
      SELECT user_id,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS median_days,
        COUNT(*)::int AS sample
      FROM (
        SELECT
          crm_assignee_at_outcome(j.company_id, 'job', j.id, j.status_changed_at, j.assigned_to) AS user_id,
          EXTRACT(EPOCH FROM (j.status_changed_at - fp.proposed_at)) / 86400.0 AS days
        FROM jobs j
        JOIN first_proposal fp ON fp.job_id = j.id
        WHERE j.company_id = $1
          AND j.status IN ('Closed Won', 'Closed Lost')
          AND j.status_changed_at >= fp.proposed_at
          AND ${decisionWindow}
      ) s
      GROUP BY user_id
      `,
      params
    ),
    pool.query(
      `
      WITH ordered AS (
        SELECT
          a.job_id,
          a.created_at,
          a.metadata->>'fromStatus' AS from_status,
          a.metadata->>'toStatus' AS to_status,
          LAG(a.created_at) OVER (PARTITION BY a.job_id ORDER BY a.created_at, a.id) AS prev_at,
          j.created_at AS job_created,
          j.company_id,
          j.assigned_to
        FROM job_activity a
        JOIN jobs j ON j.id = a.job_id AND j.company_id = $1
        WHERE a.type = 'JOB_STATUS_CHANGED'
      )
      SELECT
        crm_assignee_at_outcome(company_id, 'job', job_id, created_at, assigned_to) AS user_id,
        from_status,
        to_status,
        EXTRACT(EPOCH FROM (created_at - COALESCE(prev_at, job_created))) / 86400.0 AS days,
        (created_at::date = COALESCE(prev_at, job_created)::date) AS same_day
      FROM ordered
      WHERE ${transitionWindow}
      `,
      params
    ),
    pool.query(
      `
      WITH ordered AS (
        SELECT
          e.lead_id,
          e.changed_at,
          e.from_status,
          e.to_status,
          LAG(e.changed_at) OVER (PARTITION BY e.lead_id ORDER BY e.changed_at, e.id) AS prev_at,
          l.created_at AS lead_created,
          l.company_id,
          l.assigned_to
        FROM lead_status_events e
        JOIN leads l ON l.id = e.lead_id AND l.company_id = e.company_id
        WHERE e.company_id = $1
      )
      SELECT
        crm_assignee_at_outcome(company_id, 'lead', lead_id, changed_at, assigned_to) AS user_id,
        from_status,
        to_status,
        EXTRACT(EPOCH FROM (changed_at - COALESCE(prev_at, lead_created))) / 86400.0 AS days,
        (changed_at::date = COALESCE(prev_at, lead_created)::date) AS same_day
      FROM ordered
      WHERE ${leadEventWindow}
      `,
      params
    ),
    pool.query(
      `
      SELECT user_id,
        COUNT(*)::int AS eligible,
        COUNT(*) FILTER (WHERE poor)::int AS poor
      FROM (
        SELECT
          crm_assignee_at_outcome(j.company_id, 'job', j.id, j.status_changed_at, j.assigned_to) AS user_id,
          (
            NOT EXISTS (
              SELECT 1 FROM invoices i
              WHERE i.job_id = j.id AND i.company_id = j.company_id
            )
            OR EXISTS (
              SELECT 1 FROM invoices i
              WHERE i.job_id = j.id
                AND i.company_id = j.company_id
                AND i.status <> 'Paid'
                AND i.due_date IS NOT NULL
                AND i.due_date < NOW()
            )
          ) AS poor
        FROM jobs j
        WHERE j.company_id = $1
          AND j.status = 'Closed Won'
          AND j.status_changed_at < NOW() - INTERVAL '14 days'
          AND ${decisionWindow}
      ) s
      GROUP BY user_id
      `,
      params
    ),
    pool.query(
      `
      SELECT user_id, COUNT(*)::int AS count
      FROM (
        SELECT
          crm_assignee_at_outcome(l.company_id, 'lead', l.id, l.status_changed_at, l.assigned_to) AS user_id
        FROM leads l
        WHERE l.company_id = $1
          AND l.status = 'Inactive'
          AND ${inactiveWindow}
      ) s
      GROUP BY user_id
      `,
      params
    ),
  ]);

  const jobTransitions = summarizeTransitions(
    jobTransitionsResult.rows as TransitionRow[],
    JOB_STATUSES
  );
  const leadTransitions = summarizeTransitions(
    leadTransitionsResult.rows as TransitionRow[],
    LEAD_STATUSES
  );

  return {
    leads: mapByUser(leadsResult.rows, (row) => ({
      leads: num((row as { leads: unknown }).leads),
      converted: num((row as { converted: unknown }).converted),
    })),
    decisions: mapByUser(decisionsResult.rows, (row) => ({
      won: num((row as { won: unknown }).won),
      lost: num((row as { lost: unknown }).lost),
    })),
    wonRevenue: mapByUser(wonRevenueResult.rows, (row) =>
      num((row as { amount: unknown }).amount)
    ),
    collected: mapByUser(collectedResult.rows, (row) =>
      num((row as { amount: unknown }).amount)
    ),
    estimates: mapByUser(estimatesResult.rows, (row) => ({
      approved: num((row as { approved: unknown }).approved),
      rejected: num((row as { rejected: unknown }).rejected),
    })),
    firstResponse: mapByUser(firstResponseResult.rows, (row) => ({
      medianHours:
        (row as { median_hours: unknown }).median_hours == null
          ? null
          : num((row as { median_hours: unknown }).median_hours),
      sample: num((row as { sample: unknown }).sample),
    })),
    proposalLag: mapByUser(proposalLagResult.rows, (row) => ({
      medianDays:
        (row as { median_days: unknown }).median_days == null
          ? null
          : num((row as { median_days: unknown }).median_days),
      sample: num((row as { sample: unknown }).sample),
    })),
    daysToProposal: mapByUser(daysToProposalResult.rows, (row) => ({
      medianDays:
        (row as { median_days: unknown }).median_days == null
          ? null
          : num((row as { median_days: unknown }).median_days),
      sample: num((row as { sample: unknown }).sample),
    })),
    proposalToDecision: mapByUser(proposalToDecisionResult.rows, (row) => ({
      medianDays:
        (row as { median_days: unknown }).median_days == null
          ? null
          : num((row as { median_days: unknown }).median_days),
      sample: num((row as { sample: unknown }).sample),
    })),
    stageTiming: jobTransitions.timing,
    leadStageTiming: leadTransitions.timing,
    reversals: jobTransitions.reversals,
    closeQuality: mapByUser(closeQualityResult.rows, (row) => ({
      poor: num((row as { poor: unknown }).poor),
      eligible: num((row as { eligible: unknown }).eligible),
    })),
    inactiveLeads: mapByUser(inactiveResult.rows as CountRow[], (row) =>
      num((row as CountRow).count)
    ),
  };
}

type Snapshot = {
  tasks: Map<
    string,
    { tasksOpen: number; tasksOverdue: number; withDue: number; noDue: number }
  >;
  leadsOpen: Map<string, number>;
  jobsOpen: Map<string, number>;
  stages: Map<string, { status: string; count: number }[]>;
  staleLeads: Map<string, number>;
  staleJobs: Map<string, number>;
  invoiceAging: Map<string, { count: number; amount: number }>;
  openStageTiming: Map<string, { status: string; medianDays: number; sample: number }[]>;
};

async function loadSnapshot(companyId: string): Promise<Snapshot> {
  const [
    tasksResult,
    leadsResult,
    jobsResult,
    stagesResult,
    staleLeadsResult,
    staleJobsResult,
    agingResult,
    openTimingResult,
  ] = await Promise.all([
    pool.query(
      `
      SELECT assigned_to AS user_id,
        COUNT(*) FILTER (WHERE status <> 'Completed')::int AS tasks_open,
        COUNT(*) FILTER (
          WHERE status <> 'Completed'
            AND due_date IS NOT NULL
            AND COALESCE(end_at, due_date) < NOW()
        )::int AS tasks_overdue,
        COUNT(*) FILTER (
          WHERE status <> 'Completed' AND due_date IS NOT NULL
        )::int AS with_due,
        COUNT(*) FILTER (
          WHERE status <> 'Completed' AND due_date IS NULL
        )::int AS no_due
      FROM tasks
      WHERE company_id = $1 AND assigned_to IS NOT NULL
      GROUP BY assigned_to
      `,
      [companyId]
    ),
    pool.query(
      `
      SELECT assigned_to AS user_id, COUNT(*)::int AS count
      FROM leads
      WHERE company_id = $1
        AND assigned_to IS NOT NULL
        AND status NOT IN ('Closed', 'Inactive')
      GROUP BY assigned_to
      `,
      [companyId]
    ),
    pool.query(
      `
      SELECT assigned_to AS user_id, COUNT(*)::int AS count
      FROM jobs
      WHERE company_id = $1
        AND assigned_to IS NOT NULL
        AND status NOT IN ('Closed Won', 'Closed Lost')
      GROUP BY assigned_to
      `,
      [companyId]
    ),
    pool.query(
      `
      SELECT assigned_to AS user_id, status, COUNT(*)::int AS count
      FROM jobs
      WHERE company_id = $1 AND assigned_to IS NOT NULL
      GROUP BY assigned_to, status
      `,
      [companyId]
    ),
    pool.query(
      `
      SELECT l.assigned_to AS user_id, COUNT(*)::int AS count
      FROM leads l
      WHERE l.company_id = $1
        AND l.assigned_to IS NOT NULL
        AND l.status NOT IN ('Closed', 'Inactive')
        AND l.status_changed_at < NOW() - INTERVAL '14 days'
        AND NOT EXISTS (
          SELECT 1 FROM notes n
          WHERE n.company_id = l.company_id
            AND n.entity_type = 'lead'
            AND n.entity_id = l.id
            AND n.direction = 'outbound'
            AND n.created_at >= NOW() - INTERVAL '14 days'
        )
      GROUP BY l.assigned_to
      `,
      [companyId]
    ),
    pool.query(
      `
      SELECT j.assigned_to AS user_id, COUNT(*)::int AS count
      FROM jobs j
      WHERE j.company_id = $1
        AND j.assigned_to IS NOT NULL
        AND j.status NOT IN ('Closed Won', 'Closed Lost')
        AND j.status_changed_at < NOW() - INTERVAL '14 days'
        AND NOT EXISTS (
          SELECT 1 FROM notes n
          WHERE n.company_id = j.company_id
            AND n.entity_type = 'job'
            AND n.entity_id = j.id
            AND n.direction = 'outbound'
            AND n.created_at >= NOW() - INTERVAL '14 days'
        )
      GROUP BY j.assigned_to
      `,
      [companyId]
    ),
    pool.query(
      `
      SELECT j.assigned_to AS user_id,
        COUNT(*)::int AS count,
        COALESCE(SUM(i.grand_total), 0)::float AS amount
      FROM invoices i
      JOIN jobs j ON j.id = i.job_id AND j.company_id = i.company_id
      WHERE i.company_id = $1
        AND j.assigned_to IS NOT NULL
        AND j.status NOT IN ('Closed Won', 'Closed Lost')
        AND i.status IN ('Sent', 'Overdue')
        AND i.due_date IS NOT NULL
        AND i.due_date < NOW()
      GROUP BY j.assigned_to
      `,
      [companyId]
    ),
    pool.query(
      `
      SELECT assigned_to AS user_id,
        status,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (NOW() - status_changed_at)) / 86400.0
        ) AS median_days,
        COUNT(*)::int AS sample
      FROM jobs
      WHERE company_id = $1
        AND assigned_to IS NOT NULL
        AND status NOT IN ('Closed Won', 'Closed Lost')
      GROUP BY assigned_to, status
      `,
      [companyId]
    ),
  ]);

  const stages = new Map<string, { status: string; count: number }[]>();
  for (const row of stagesResult.rows) {
    if (!row.user_id) continue;
    const id = String(row.user_id);
    const list = stages.get(id) ?? [];
    list.push({ status: row.status, count: num(row.count) });
    stages.set(id, list);
  }
  for (const [id, list] of stages) {
    list.sort(
      (left, right) => JOB_STATUSES.indexOf(left.status) - JOB_STATUSES.indexOf(right.status)
    );
    stages.set(
      id,
      list.filter((row) => row.count > 0)
    );
  }

  const openStageTiming = new Map<
    string,
    { status: string; medianDays: number; sample: number }[]
  >();
  for (const row of openTimingResult.rows) {
    if (!row.user_id) continue;
    const id = String(row.user_id);
    const list = openStageTiming.get(id) ?? [];
    list.push({
      status: row.status,
      medianDays: num(row.median_days),
      sample: num(row.sample),
    });
    openStageTiming.set(id, list);
  }
  for (const [id, list] of openStageTiming) {
    list.sort(
      (left, right) => JOB_STATUSES.indexOf(left.status) - JOB_STATUSES.indexOf(right.status)
    );
    openStageTiming.set(id, list);
  }

  return {
    tasks: mapByUser(tasksResult.rows, (row) => ({
      tasksOpen: num((row as { tasks_open: unknown }).tasks_open),
      tasksOverdue: num((row as { tasks_overdue: unknown }).tasks_overdue),
      withDue: num((row as { with_due: unknown }).with_due),
      noDue: num((row as { no_due: unknown }).no_due),
    })),
    leadsOpen: mapByUser(leadsResult.rows as CountRow[], (row) => num(row.count)),
    jobsOpen: mapByUser(jobsResult.rows as CountRow[], (row) => num(row.count)),
    stages,
    staleLeads: mapByUser(staleLeadsResult.rows as CountRow[], (row) => num(row.count)),
    staleJobs: mapByUser(staleJobsResult.rows as CountRow[], (row) => num(row.count)),
    invoiceAging: mapByUser(agingResult.rows, (row) => ({
      count: num((row as { count: unknown }).count),
      amount: num((row as { amount: unknown }).amount),
    })),
    openStageTiming,
  };
}

function shownDays(sample: number, days: number | null) {
  if (days == null || sample < MIN_DECISION_SAMPLE) return null;
  return days;
}

function buildUsers(
  people: Array<{ id: string; first_name: string; last_name: string; email: string }>,
  current: PeriodBundle,
  prior: PeriodBundle,
  snapshot: Snapshot
) {
  return people.map((person) => {
    const id = person.id;
    const leads = current.leads.get(id) ?? { leads: 0, converted: 0 };
    const priorLeads = prior.leads.get(id) ?? { leads: 0, converted: 0 };
    const decisions = current.decisions.get(id) ?? { won: 0, lost: 0 };
    const priorDecisions = prior.decisions.get(id) ?? { won: 0, lost: 0 };
    const decided = decisions.won + decisions.lost;
    const priorDecided = priorDecisions.won + priorDecisions.lost;
    const estimates = current.estimates.get(id) ?? { approved: 0, rejected: 0 };
    const priorEstimates = prior.estimates.get(id) ?? { approved: 0, rejected: 0 };
    const estimateSample = estimates.approved + estimates.rejected;
    const priorEstimateSample = priorEstimates.approved + priorEstimates.rejected;
    const tasks = snapshot.tasks.get(id) ?? {
      tasksOpen: 0,
      tasksOverdue: 0,
      withDue: 0,
      noDue: 0,
    };
    const toProposal = current.daysToProposal.get(id) ?? { medianDays: null, sample: 0 };
    const priorToProposal = prior.daysToProposal.get(id) ?? { medianDays: null, sample: 0 };
    const toDecision = current.proposalToDecision.get(id) ?? {
      medianDays: null,
      sample: 0,
    };
    const priorToDecision = prior.proposalToDecision.get(id) ?? {
      medianDays: null,
      sample: 0,
    };
    const firstResponse = current.firstResponse.get(id) ?? {
      medianHours: null,
      sample: 0,
    };
    const priorFirstResponse = prior.firstResponse.get(id) ?? {
      medianHours: null,
      sample: 0,
    };
    const proposalLag = current.proposalLag.get(id) ?? { medianDays: null, sample: 0 };
    const priorProposalLag = prior.proposalLag.get(id) ?? { medianDays: null, sample: 0 };
    const reversals = current.reversals.get(id) ?? { reversals: 0, sample: 0 };
    const priorReversals = prior.reversals.get(id) ?? { reversals: 0, sample: 0 };
    const closeQuality = current.closeQuality.get(id) ?? { poor: 0, eligible: 0 };
    const priorClose = prior.closeQuality.get(id) ?? { poor: 0, eligible: 0 };
    const overdueRate =
      tasks.withDue > 0 ? tasks.tasksOverdue / tasks.withDue : null;

    return {
      userId: id,
      name: displayName(person),
      winRate: {
        rate: gatedRate(decisions.won, decided),
        won: decisions.won,
        lost: decisions.lost,
        sample: decided,
        priorRate: gatedRate(priorDecisions.won, priorDecided),
        priorWon: priorDecisions.won,
        priorLost: priorDecisions.lost,
        priorSample: priorDecided,
      },
      overdue: {
        rate: overdueRate,
        overdue: tasks.tasksOverdue,
        withDueDate: tasks.withDue,
        noDueDate: tasks.noDue,
      },
      medianDaysToProposal: {
        days: shownDays(toProposal.sample, toProposal.medianDays),
        sample: toProposal.sample,
        priorDays: shownDays(priorToProposal.sample, priorToProposal.medianDays),
        priorSample: priorToProposal.sample,
      },
      wonRevenue: {
        amount: current.wonRevenue.get(id) ?? 0,
        priorAmount: prior.wonRevenue.get(id) ?? 0,
      },
      leadToJob: {
        rate: gatedRate(leads.converted, leads.leads),
        converted: leads.converted,
        sample: leads.leads,
        priorRate: gatedRate(priorLeads.converted, priorLeads.leads),
        priorConverted: priorLeads.converted,
        priorSample: priorLeads.leads,
      },
      collectedRevenue: {
        amount: current.collected.get(id) ?? 0,
        priorAmount: prior.collected.get(id) ?? 0,
      },
      estimateDecision: {
        rate: gatedRate(estimates.approved, estimateSample),
        approved: estimates.approved,
        rejected: estimates.rejected,
        sample: estimateSample,
        priorRate: gatedRate(priorEstimates.approved, priorEstimateSample),
        priorSample: priorEstimateSample,
      },
      stageDropOff: snapshot.stages.get(id) ?? [],
      stageTiming: current.stageTiming.get(id) ?? [],
      openStageTiming: snapshot.openStageTiming.get(id) ?? [],
      leadStageTiming: current.leadStageTiming.get(id) ?? [],
      medianProposalToDecision: {
        days: toDecision.medianDays,
        sample: toDecision.sample,
        priorDays: priorToDecision.medianDays,
        priorSample: priorToDecision.sample,
      },
      firstResponse: {
        medianHours: firstResponse.medianHours,
        sample: firstResponse.sample,
        priorMedianHours: priorFirstResponse.medianHours,
        priorSample: priorFirstResponse.sample,
      },
      proposalLag: {
        medianDays: proposalLag.medianDays,
        sample: proposalLag.sample,
        priorMedianDays: priorProposalLag.medianDays,
        priorSample: priorProposalLag.sample,
      },
      stale: {
        leads: snapshot.staleLeads.get(id) ?? 0,
        jobs: snapshot.staleJobs.get(id) ?? 0,
      },
      book: {
        leadsOpen: snapshot.leadsOpen.get(id) ?? 0,
        jobsOpen: snapshot.jobsOpen.get(id) ?? 0,
        tasksOpen: tasks.tasksOpen,
        tasksOverdue: tasks.tasksOverdue,
      },
      invoiceAging: snapshot.invoiceAging.get(id) ?? { count: 0, amount: 0 },
      exits: {
        inactiveLeads: current.inactiveLeads.get(id) ?? 0,
        closedLostJobs: decisions.lost,
      },
      reversals: {
        rate: gatedRate(reversals.reversals, reversals.sample),
        reversals: reversals.reversals,
        sample: reversals.sample,
        priorRate: gatedRate(priorReversals.reversals, priorReversals.sample),
        priorSample: priorReversals.sample,
      },
      closeQuality: {
        rate: gatedRate(closeQuality.poor, closeQuality.eligible),
        poor: closeQuality.poor,
        sample: closeQuality.eligible,
        priorRate: gatedRate(priorClose.poor, priorClose.eligible),
        priorSample: priorClose.eligible,
      },
    };
  });
}

function teamMedians(users: ReturnType<typeof buildUsers>) {
  return {
    winRate: median(
      users
        .map((user) => user.winRate.rate)
        .filter((rate): rate is number => rate != null)
    ),
    overdueRate: median(
      users
        .filter((user) => user.overdue.withDueDate > 0)
        .map((user) => user.overdue.rate)
        .filter((rate): rate is number => rate != null)
    ),
    medianDaysToProposal: median(
      users
        .map((user) => user.medianDaysToProposal.days)
        .filter((days): days is number => days != null)
    ),
    wonRevenue: users.length
      ? median(users.map((user) => user.wonRevenue.amount))
      : null,
  };
}

function summarize(user: ReturnType<typeof buildUsers>[number]) {
  return {
    userId: user.userId,
    name: user.name,
    winRate: user.winRate,
    overdue: user.overdue,
    medianDaysToProposal: user.medianDaysToProposal,
    wonRevenue: user.wonRevenue,
  };
}

async function loadPerformance(companyId: string, windowDays: PerformanceWindow) {
  const [peopleResult, current, prior, snapshot] = await Promise.all([
    pool.query(
      `
      SELECT id, first_name, last_name, email
      FROM users
      WHERE company_id = $1 AND status = 'active'
      ORDER BY first_name ASC, last_name ASC, email ASC
      `,
      [companyId]
    ),
    loadPeriod(companyId, windowDays, 0),
    loadPeriod(companyId, windowDays * 2, windowDays),
    loadSnapshot(companyId),
  ]);

  const users = buildUsers(peopleResult.rows, current, prior, snapshot);
  return {
    windowDays,
    attribution: PERFORMANCE_ATTRIBUTION,
    medians: teamMedians(users),
    users,
  };
}

export function parsePerformanceWindow(value: unknown): PerformanceWindow | null {
  if (value == null || value === '') return 90;
  const parsed = Number(value);
  if (parsed === 30 || parsed === 90 || parsed === 365) return parsed;
  return null;
}

export async function getTeamPerformance(
  companyId: string,
  windowDays: PerformanceWindow
) {
  const loaded = await loadPerformance(companyId, windowDays);
  return {
    windowDays: loaded.windowDays,
    attribution: loaded.attribution,
    medians: loaded.medians,
    users: loaded.users.map(summarize),
  };
}

export async function getUserPerformance(
  companyId: string,
  userId: string,
  windowDays: PerformanceWindow
) {
  const loaded = await loadPerformance(companyId, windowDays);
  const user = loaded.users.find((row) => row.userId === userId);
  if (!user) return null;
  return {
    windowDays: loaded.windowDays,
    attribution: loaded.attribution,
    medians: loaded.medians,
    user,
  };
}
