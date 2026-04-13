import { pool } from '../db';

export type ProductEventName =
  | 'lead_created'
  | 'lead_moved_kanban'
  | 'task_completed'
  | 'estimate_approved'
  | 'estimate_rejected'
  | 'invoice_created'
  | 'invoice_marked_paid'
  | 'portal_link_generated'
  | 'portal_viewed'
  | 'automation_rule_triggered'
  | 'quickbooks_sync_success'
  | 'quickbooks_sync_failed';

export async function trackEvent(
  eventName: ProductEventName,
  options: {
    userId?: string | null;
    entityType?: string | null;
    entityId?: number | null;
    metadata?: Record<string, unknown> | null;
  } = {}
) {
  try {
    await pool.query(
      `INSERT INTO product_events (user_id, event_name, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        options.userId ?? null,
        eventName,
        options.entityType ?? null,
        options.entityId ?? null,
        options.metadata ? JSON.stringify(options.metadata) : null,
      ]
    );
  } catch (err) {
    console.error('[productEvents] failed to track:', eventName, err);
  }
}

export async function getEventCounts(days = 30) {
  const result = await pool.query(
    `SELECT event_name, COUNT(*)::int AS count
     FROM product_events
     WHERE created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY event_name
     ORDER BY count DESC`,
    [days]
  );
  return result.rows;
}

export async function getEventTimeline(eventName: string, days = 30) {
  const result = await pool.query(
    `SELECT DATE(created_at) AS day, COUNT(*)::int AS count
     FROM product_events
     WHERE event_name = $1 AND created_at >= NOW() - ($2 || ' days')::interval
     GROUP BY DATE(created_at)
     ORDER BY day`,
    [eventName, days]
  );
  return result.rows;
}

export async function getConversionFunnel(days = 30) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM product_events WHERE event_name = 'lead_created' AND created_at >= NOW() - ($1 || ' days')::interval) AS leads_created,
       (SELECT COUNT(*)::int FROM product_events WHERE event_name = 'estimate_approved' AND created_at >= NOW() - ($1 || ' days')::interval) AS estimates_approved,
       (SELECT COUNT(*)::int FROM product_events WHERE event_name = 'invoice_created' AND created_at >= NOW() - ($1 || ' days')::interval) AS invoices_created,
       (SELECT COUNT(*)::int FROM product_events WHERE event_name = 'invoice_marked_paid' AND created_at >= NOW() - ($1 || ' days')::interval) AS invoices_paid`,
    [days]
  );
  return result.rows[0];
}

export async function getAutomationStats(days = 30) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM product_events WHERE event_name = 'automation_rule_triggered' AND created_at >= NOW() - ($1 || ' days')::interval) AS triggered,
       (SELECT COUNT(*)::int FROM product_events WHERE event_name = 'quickbooks_sync_success' AND created_at >= NOW() - ($1 || ' days')::interval) AS qb_success,
       (SELECT COUNT(*)::int FROM product_events WHERE event_name = 'quickbooks_sync_failed' AND created_at >= NOW() - ($1 || ' days')::interval) AS qb_failed,
       (SELECT COUNT(*)::int FROM product_events WHERE event_name = 'portal_viewed' AND created_at >= NOW() - ($1 || ' days')::interval) AS portal_views`,
    [days]
  );
  return result.rows[0];
}
