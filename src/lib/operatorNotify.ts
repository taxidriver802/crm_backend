import { sendMail, isMailConfigured } from './mailer';

/**
 * A ping to the operator (PLAN_operator.md §7), when an owner confirms their
 * email and the company joins the queue.
 *
 * Pushover when PUSHOVER_TOKEN and PUSHOVER_USER are set, else an email to
 * OPERATOR_EMAIL when mail is configured, else a log line. It carries the
 * company's name and slug and nothing the company wrote.
 * Never throws: a failed ping must not fail the request that caused it.
 */
export type OperatorPing = { title: string; message: string; url?: string };

let sent: OperatorPing[] | null = null;

/** Test helper: collect pings instead of sending them. */
export function captureOperatorPings() {
  sent = [];
  return sent;
}

export async function notifyOperator(ping: OperatorPing) {
  if (sent) {
    sent.push(ping);
    return;
  }
  if (process.env.NODE_ENV === 'test') return;
  try {
    const token = (process.env.PUSHOVER_TOKEN ?? '').trim();
    const user = (process.env.PUSHOVER_USER ?? '').trim();
    if (token && user) {
      const body = new URLSearchParams({ token, user, title: ping.title, message: ping.message });
      if (ping.url) body.set('url', ping.url);
      const res = await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Pushover answered ${res.status}`);
      return;
    }
    const to = (process.env.OPERATOR_EMAIL ?? '').trim();
    if (to && isMailConfigured()) {
      const text = [ping.message, ping.url ? `\n${ping.url}` : ''].join('');
      await sendMail({ to, subject: ping.title, text, html: `<p>${escape(ping.message)}</p>${ping.url ? `<p><a href="${escape(ping.url)}">${escape(ping.url)}</a></p>` : ''}`, fromName: 'Joist' });
      return;
    }
    console.info(JSON.stringify({ level: 'info', event: 'operator_ping', title: ping.title }));
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'operator_ping_failed',
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

function escape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
