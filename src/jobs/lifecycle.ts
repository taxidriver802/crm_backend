import { pool } from '../db';
import { REMINDER_DAYS, TIMER_MOVES, type CompanyStatus } from '../lib/lifecycle';
import { isMailConfigured } from '../lib/mailer';
import { notifyOperator } from '../lib/operatorNotify';
import { advanceDueCompany } from '../services/companyAccount.service';
import { sendTimerReminder } from '../services/accountNotices.service';

/**
 * The lifecycle job (PLAN_operator.md §6), hourly:
 *
 * 1. Moves each company whose timer has run out: trial → suspended,
 *    past_due → suspended, suspended → pending_deletion. Each move sends
 *    the new state's email.
 * 2. Flags a pending_deletion company whose 30 days are up as "ready to
 *    delete", once, and pings the operator. It never deletes.
 * 3. Sends the reminders before a timer runs out (REMINDER_DAYS), each once
 *    per timer. A run that comes late sends only the nearest one.
 *
 * LIFECYCLE_DRY_RUN=true logs what it would do and changes nothing.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type LifecycleRun = {
  dryRun: boolean;
  moved: { company_id: string; slug: string; from: string; to: string }[];
  ready_to_delete: { company_id: string; slug: string }[];
  reminders: { company_id: string; slug: string; status: string; days_left: number }[];
};

type Options = { now?: Date; dryRun?: boolean };

export function lifecycleDryRun(env = process.env) {
  return (env.LIFECYCLE_DRY_RUN ?? '').trim().toLowerCase() === 'true';
}

export async function runLifecycleJob({ now = new Date(), dryRun = lifecycleDryRun() }: Options = {}) {
  const run: LifecycleRun = { dryRun, moved: [], ready_to_delete: [], reminders: [] };

  // 1. Moves.
  const movable = Object.keys(TIMER_MOVES);
  const { rows: due } = await pool.query(
    `SELECT id, slug, status FROM companies
     WHERE status = ANY($1) AND next_status_at IS NOT NULL AND next_status_at <= $2
     ORDER BY next_status_at`,
    [movable, now]
  );
  for (const company of due) {
    const to = TIMER_MOVES[company.status as CompanyStatus]!;
    if (dryRun) {
      run.moved.push({ company_id: company.id, slug: company.slug, from: company.status, to });
      continue;
    }
    const moved = await advanceDueCompany(company.id, now);
    if (moved) run.moved.push({ company_id: company.id, slug: company.slug, from: moved.from, to: moved.to });
  }

  // 2. Ready to delete.
  const { rows: expired } = await pool.query(
    `SELECT c.id, c.name, c.slug, c.next_status_at
     FROM companies c
     WHERE c.status = 'pending_deletion' AND c.next_status_at IS NOT NULL AND c.next_status_at <= $1
       AND NOT EXISTS (
         SELECT 1 FROM company_notices n
         WHERE n.company_id = c.id AND n.notice = 'ready_to_delete' AND n.due_at = c.next_status_at
       )`,
    [now]
  );
  for (const company of expired) {
    if (!dryRun) {
      const claimed = await pool.query(
        `INSERT INTO company_notices (company_id, notice, due_at) VALUES ($1, 'ready_to_delete', $2)
         ON CONFLICT DO NOTHING RETURNING id`,
        [company.id, company.next_status_at]
      );
      if (!claimed.rows.length) continue;
      await pool.query(
        `INSERT INTO operator_events (operator_id, company_id, company_slug, event, from_status, to_status, detail)
         VALUES (NULL, $1, $2, 'ready_to_delete', NULL, NULL, '{}')`,
        [company.id, company.slug]
      );
      const operatorUrl = (process.env.OPERATOR_URL ?? '').trim().replace(/\/+$/, '');
      await notifyOperator({
        title: 'Company ready to delete',
        message: `${company.name} (${company.slug}) has reached its deletion date. Delete it, or restore it.`,
        url: operatorUrl ? `${operatorUrl}/operator/companies/${company.id}` : undefined,
      });
    }
    run.ready_to_delete.push({ company_id: company.id, slug: company.slug });
  }

  // 3. Reminders. Without mail nothing is claimed, so they go once mail is on.
  if (isMailConfigured()) {
    const statuses = Object.keys(REMINDER_DAYS);
    const longest = Math.max(...Object.values(REMINDER_DAYS).flatMap((d) => d ?? []));
    const { rows: upcoming } = await pool.query(
      `SELECT id, slug, status, next_status_at FROM companies
       WHERE status = ANY($1) AND next_status_at > $2
         AND next_status_at <= $2::timestamptz + make_interval(days => $3)`,
      [statuses, now, longest]
    );
    for (const company of upcoming) {
      const dueAt = new Date(company.next_status_at);
      const left = dueAt.getTime() - now.getTime();
      const thresholds = (REMINDER_DAYS[company.status as CompanyStatus] ?? []).filter(
        (days) => left <= days * DAY_MS
      );
      if (!thresholds.length) continue;
      const nearest = Math.min(...thresholds);
      const key = (days: number) => `${company.status}_${days}d`;

      const { rows: sent } = await pool.query(
        `SELECT 1 FROM company_notices WHERE company_id = $1 AND notice = $2 AND due_at = $3`,
        [company.id, key(nearest), dueAt]
      );
      if (sent.length) continue;
      const daysLeft = Math.max(1, Math.ceil(left / DAY_MS));
      if (dryRun) {
        run.reminders.push({ company_id: company.id, slug: company.slug, status: company.status, days_left: daysLeft });
        continue;
      }
      // Claim the nearest and every earlier one, so a late run sends one email.
      for (const days of thresholds) {
        await pool.query(
          `INSERT INTO company_notices (company_id, notice, due_at) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [company.id, key(days), dueAt]
        );
      }
      const delivered = await sendTimerReminder(company.id, company.status, daysLeft, dueAt);
      if (!delivered) {
        // Let the next run try again.
        await pool.query(
          `DELETE FROM company_notices WHERE company_id = $1 AND notice = $2 AND due_at = $3`,
          [company.id, key(nearest), dueAt]
        );
        continue;
      }
      await pool.query(
        `INSERT INTO operator_events (operator_id, company_id, company_slug, event, from_status, to_status, detail)
         VALUES (NULL, $1, $2, 'reminder_sent', NULL, NULL, $3)`,
        [company.id, company.slug, JSON.stringify({ status: company.status, days_left: daysLeft })]
      );
      run.reminders.push({ company_id: company.id, slug: company.slug, status: company.status, days_left: daysLeft });
    }
  }

  if (run.moved.length || run.ready_to_delete.length || run.reminders.length || dryRun) {
    console.info(
      JSON.stringify({
        level: 'info',
        event: dryRun ? 'lifecycle_dry_run' : 'lifecycle_run',
        moved: run.moved,
        ready_to_delete: run.ready_to_delete.map((c) => c.slug),
        reminders: run.reminders.map((r) => `${r.slug}:${r.status}:${r.days_left}d`),
      })
    );
  }
  return run;
}
