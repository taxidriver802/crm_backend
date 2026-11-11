import { pool } from '../db';

/**
 * Account history (migration 0003): what happened to a person's account and
 * who did it. actor_id is empty when it was the person themselves or the
 * operator's command. No IP addresses or user agents are kept.
 */

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<any> };

export type AccountEventName =
  | 'signed_in'
  | 'sign_in_failed'
  | 'signed_out'
  | 'signed_out_elsewhere'
  | 'password_changed'
  | 'reset_requested'
  | 'reset_link_issued'
  | 'password_reset'
  | 'role_changed'
  | 'status_changed'
  | 'invite_sent'
  | 'invite_resent'
  | 'invite_revoked'
  | 'invite_accepted';

export async function recordAccountEvent(
  event: {
    companyId: string;
    userId: string;
    actorId?: string | null;
    event: AccountEventName;
    detail?: Record<string, unknown>;
  },
  db: Queryable = pool
) {
  await db.query(
    `INSERT INTO account_events (company_id, user_id, actor_id, event, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      event.companyId,
      event.userId,
      event.actorId ?? null,
      event.event,
      JSON.stringify(event.detail ?? {}),
    ]
  );
}

/** The newest events for one person in this company, with who did each. */
export async function listAccountEvents(
  companyId: string,
  userId: string,
  limit = 20
) {
  const { rows } = await pool.query(
    `SELECT e.id, e.event, e.detail, e.created_at, e.actor_id,
            NULLIF(TRIM(CONCAT_WS(' ', a.first_name, a.last_name)), '') AS actor_name
     FROM account_events e
     LEFT JOIN users a ON a.id = e.actor_id AND a.company_id = e.company_id
     WHERE e.company_id = $1 AND e.user_id = $2
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $3`,
    [companyId, userId, limit]
  );
  return rows.map((row) => ({ ...row, id: Number(row.id) }));
}
