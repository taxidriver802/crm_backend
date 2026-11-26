# Login history (`login_events`)

The operator's record of who signed in, or tried to, from which address
and device. It's there to tie activity to a person and a device when
something goes wrong. Added by migration `0005_login_events`.

## What it keeps

One row per event, written by the auth routes (`src/routes/auth.routes.ts`
through `src/lib/loginEvents.ts`):

| Event | When | Extra |
|---|---|---|
| `login_success` | A session starts | `method`: `password` (sign-in), `register` (a new company's owner), `invite` (accepting an invite), `reset` (setting a password from a reset link) |
| `login_failed` | `/auth/login` refuses | `reason`, below |
| `logout` | Sign out ends a live session | |
| `logout_elsewhere` | "Sign out everywhere else" | |
| `password_reset_requested` | Forgot password, unless rate-limited | `user_id` only when it matched an account |
| `password_reset` | A password is set from a reset link | |
| `password_changed` | A signed-in person changes their password | |

Failure reasons: `unknown_company`, `unknown_email`, `inactive` (an invited
or disabled account), `no_password`, `bad_password`, `rate_limited_account`,
`rate_limited_ip`. The reply is the same 401 whatever the reason. The
reason is for the operator only.

Each row also has:

- `company_id` and `user_id`, when they matched;
- the company slug and email as attempted, lower-cased;
- `session_id`, the `user_sessions` row a success started or a sign-out
  ended. Every event from one browser shares it;
- `ip` (`inet`);
- `user_agent`, cut to 512 characters.

It never stores a password, hash, token, reset link or cookie.

## Why it isn't the account history

`account_events` (migration 0003) is a company's own history, shown to
owners and admins on the Users page. It records no address or device, on
purpose, and it can only hold events for a real person in a real company.
This log is different in four ways:

- It belongs to the host, not a company. It records attempts that match
  nothing: an unknown slug, an unknown email. So `company_id` may be empty
  here, the one exception besides `supplier_webhook_events` in
  `test/companies.schema.test.ts`.
- It keeps the address and the device.
- It's pruned after 180 days, while account history is kept.
- No route serves it. It's read on the host only.

## Writing it never breaks a sign-in

The routes don't wait for the insert. A failed write logs
`{"event":"login_event_write_failed"}` and is dropped. The insert always
goes through the pool after any transaction commits. Inside a route's
transaction, a failed insert would abort the transaction, and a rollback
would lose the row.

The account-history writes in sign-in and sign-out that run outside a
transaction are also caught now (`account_event_write_failed`). Before
this, a failed insert there answered 500 after the session was already
made.

Rows can land slightly out of `id` order under load, because two
back-to-back writes may use different connections. Order by `created_at`
when it matters.

## The client address

`ip` is `req.ip` under `trust proxy` (`TRUST_PROXY`, default `loopback`).
It's the same value the rate limits use (`clientIp()` in
`src/lib/rateLimit.ts`).

On the home server the chain is: browser → Cloudflare →
`cloudflared` on loopback → frontend (Next.js) → `/api` rewrite → backend
on `127.0.0.1`.

1. **Cloudflare.** It appends the visitor's address to `X-Forwarded-For`,
   after anything the client wrote.
2. **The Next rewrite.** It passes that header through and adds nothing
   (Next's `proxy-request.js` doesn't set `xfwd`).
3. **The backend.** It walks the header from the right, past trusted
   loopback hops, and stops at the address Cloudflare added. An address a
   client forges sits further left and is ignored.

`CF-Connecting-IP` isn't read. It can only be trusted when the request
really came through Cloudflare, which the backend can't tell from
loopback. Using it would also split the log's address from the rate
limits' address.

If a sign-in ever resolves to `127.0.0.1` or `::1` in production, the
backend logs `{"event":"client_ip_loopback"}` once. That means the chain is
losing `X-Forwarded-For`, and every visitor shares one address, for the
per-address sign-in limit too. Fix the proxy rather than the code.

### Check it after deploying

1. From a phone on mobile data, open `https://<host>/cdn-cgi/trace` and note
   `ip=`. Then sign in on that phone.
2. On the host, look at the newest rows:

   ```bash
   psql "$DATABASE_URL" -c "SELECT created_at, event, reason, host(ip) AS ip, left(user_agent, 40) AS device FROM login_events ORDER BY created_at DESC LIMIT 5"
   ```

   `ip` must equal the trace's `ip=`. It must not be `127.0.0.1` or `::1`,
   and must not be a Cloudflare address (104.16.0.0/13, 172.64.0.0/13,
   162.158.0.0/15, 2606:4700::/32, …).
3. Check that a forged header doesn't take:

   ```bash
   curl -s -X POST https://<host>/api/auth/login -H 'Content-Type: application/json' -H 'X-Forwarded-For: 203.0.113.9' -d '{"company_slug":"probe-nonexistent","email":"probe@example.com","password":"x"}'
   ```

   The newest row is `login_failed` / `unknown_company`, with your own
   address, not `203.0.113.9`.
4. Check the log for the loopback warning. This should print nothing:

   ```bash
   journalctl -u joist-api --since "15 min ago" | grep client_ip_loopback
   ```

## Retention

The backend deletes rows older than `LOGIN_EVENTS_KEEP_DAYS` (default
180), in batches. It runs a minute after start and then daily
(`src/jobs/pruneLoginEvents.ts`), in the one backend process like the
reminder sweeps, so the host needs no timer. A run that removes rows logs
`{"event":"login_events_pruned"}`.

Pruned rows still exist in backup sets until those sets are pruned:
`BACKUP_KEEP_DAYS` locally, and whatever the off-host copy keeps.

## Reading it for alerts

Alerting (Pushover on repeated failures) runs on the host and only reads
this table. Give it its own read-only role rather than the app's. The
migration doesn't create one, because the app role can't create roles. Run
this as the Postgres superuser:

```sql
CREATE ROLE joist_monitor LOGIN PASSWORD '<openssl rand -hex 24>';
GRANT CONNECT ON DATABASE <joist database> TO joist_monitor;
GRANT USAGE ON SCHEMA public TO joist_monitor;
GRANT SELECT ON public.login_events TO joist_monitor;
```

Example queries. `idx_login_events_failed` covers both.

```sql
-- Addresses with many failures in the last 15 minutes.
SELECT host(ip) AS ip, count(*) AS failures,
       count(DISTINCT email_attempted) AS emails
FROM login_events
WHERE event = 'login_failed' AND created_at > now() - interval '15 minutes'
GROUP BY ip HAVING count(*) >= 10
ORDER BY failures DESC;

-- Accounts being guessed at, from any address.
SELECT company_slug, email_attempted, count(*) AS failures,
       count(DISTINCT ip) AS addresses
FROM login_events
WHERE event = 'login_failed' AND created_at > now() - interval '15 minutes'
GROUP BY company_slug, email_attempted HAVING count(*) >= 5
ORDER BY failures DESC;
```

Rate-limit counters live in memory and reset when the backend restarts.
This table doesn't, so it's the better source for alerts.

## Tests

`test/login-events.test.ts` covers:

- every event and reason;
- the address under a forged header;
- the user-agent cut, and that no secret is stored;
- that sign-in survives failed writes;
- pruning.

Jest refuses to start unless `DATABASE_URL` names a database ending in
`_test` (`test/setupEnv.ts`), because the suites empty every table.
