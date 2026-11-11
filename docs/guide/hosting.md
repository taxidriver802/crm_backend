# Hosting Joist

One host serves Joist to contractor companies over HTTPS: Postgres, the
backend, the frontend, and a TLS reverse proxy. This is the production start
path from `docs/EXPERIMENT_SAAS.md` (step 1: prospects 1 and 2).

> **Status.** Written with the code it describes, and checked locally:
> boot refusals, rate limits, headers, the build commands, and a backup
> restored from its off-machine copy (step 2). It has not yet been walked
> end to end on a real host. The home-server Docker setup in
> `hosted-demo-seed.md` is disabled for now.

## Shape

```
browser ──HTTPS──▶ TLS proxy (Caddy, nginx, …)  :443
                     │ sets X-Forwarded-For / -Proto
                     ▼
                   frontend  next start  127.0.0.1:3000
                     │ /api/* rewrite (passes headers through, adds none)
                     ▼
                   backend   node dist/server.js  127.0.0.1:4000
                     ▼
                   Postgres
```

- **One origin.** The browser only ever talks to `https://<your host>`.
  `/api/*` reaches the backend through the frontend's rewrite, so the
  session cookie stays first-party (`SameSite=Lax`, `Secure`, `HttpOnly`).
  Cross-site cookies (`AUTH_COOKIE_CROSS_SITE=true`) are refused in
  production.
- **Loopback only.** The frontend and backend listen on `127.0.0.1`. Only
  the TLS proxy is reachable from outside.
- **Client addresses.** The backend trusts `X-Forwarded-For` only from
  loopback (`TRUST_PROXY=loopback`, the default). The TLS proxy must set or
  append the client's address. Next's rewrite passes that header through
  unchanged and adds none of its own. Rate limits key on the result, so a
  header a client writes itself cannot reset them.
- **One backend process.** Rate-limit counters live in memory and the two
  reminder sweeps run in-process, so run exactly one backend process.
- **Data outside the code.** Uploads (job photos, documents, logos) live in
  `UPLOADS_DIR`, for example `/var/lib/joist/uploads`, not inside the
  checkout, so a redeploy can't touch them. The database and that directory
  are the two things a backup must hold.

## What you need

- Node.js 20.9 or newer (Next 16).
- PostgreSQL 16 or newer, and its client tools (`pg_dump`, `pg_restore`,
  `psql`) on the app host at the server's major version or newer.
- `tar` and `rsync`, plus somewhere off this machine to keep backups: a
  second machine reachable over ssh, or mounted storage.
- A DNS name for the host, and a TLS proxy that can get a certificate for it.
- Checkouts of `crm_backend` and `crm_frontend` side by side.

## 1. Database

```sql
CREATE ROLE joist LOGIN PASSWORD '<generate one>';
CREATE DATABASE joist OWNER joist;
-- "Due today" and overdue follow the database clock until companies carry
-- their own zone (EXPERIMENT_SAAS.md prospect 11). Use the first company's.
ALTER DATABASE joist SET timezone TO 'America/Chicago';
```

When the database is on another machine, add `?sslmode=require` to
`DATABASE_URL`.

## 2. Backend

```bash
# data directories, outside the checkout, readable only by the app user
sudo install -d -o joist -g joist -m 700 /var/lib/joist/uploads /var/backups/joist

cd crm_backend
npm ci
cp .env.production.example .env      # then fill in every value
npm run build
npm run db:migrate                    # baseline on an empty database, then sql/migrations/
```

A new database has no company until the first one registers (section 5).

Required in `.env`:

- **`NODE_ENV`**: `production`.
- **`HOST`**: `127.0.0.1`.
- **`PORT`**: `4000`.
- **`DATABASE_URL`**
- **`JWT_SECRET`**: generate it with `openssl rand -hex 32`.
- **`APP_BASE_URL`** and **`FRONTEND_URL`**: both are the
  `https://<your host>` address people use.
- **`TRUST_PROXY`**: `loopback`.
- **`UPLOADS_DIR`**: `/var/lib/joist/uploads`, owned by the `joist` user.
- **`BACKUP_DIR`** and **`BACKUP_REMOTE`**: see Backups below.

The backend refuses to start under `NODE_ENV=production`, and lists every
reason, when:

- `APP_BASE_URL` or `FRONTEND_URL` is missing or is not `https://`;
- `JWT_SECRET` is shorter than 32 bytes;
- any `QB_*` or `ABC_*` variable is set. QuickBooks and ABC Supply use one
  account for every company on the host, so they stay off until they work
  per company;
- `AUTH_COOKIE_CROSS_SITE=true` or `TRUST_PROXY=true` is set.

Mail is optional. With `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` set, invites, Resend, reset links
and Forgot password send email. Without them:

- an invite, a Resend or a reset link made on the Users page is handed back
  to the owner or admin to copy and send;
- Forgot password tells the person this Joist can't send email yet and to
  ask an owner or admin for a link;
- an owner who is locked out gets a link from the operator, on the host:

```bash
npm run user:reset-link -- --company <slug> --email <email>
```

It prints a link that lasts an hour and works once, built on
`APP_BASE_URL`. The account history records that the operator made it.

Run it under a process manager with the timezone set. For example, with
systemd (`/etc/systemd/system/joist-api.service`):

```ini
[Service]
WorkingDirectory=/srv/joist/crm_backend
Environment=TZ=America/Chicago
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
User=joist
```

## 3. Frontend

```bash
cd crm_frontend
npm ci
cp .env.production.example .env.production.local   # before building
npm run build
npm start -- -H 127.0.0.1 -p 3000
```

Set both values before building. `NEXT_PUBLIC_API_BASE_URL=/api` is inlined
into the browser bundle, and the `/api` rewrite target
(`API_INTERNAL_BASE_URL=http://127.0.0.1:4000`) is fixed at build time.

A systemd unit for it looks like the backend's, with
`ExecStart=/usr/bin/npm start -- -H 127.0.0.1 -p 3000` in
`/srv/joist/crm_frontend`.

Every page carries `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
`nosniff` and a `strict-origin-when-cross-origin` referrer policy. `/api/*`
keeps the backend's helmet headers.

## 4. TLS proxy

Caddy (it sets `X-Forwarded-For` and `X-Forwarded-Proto` itself):

```
joist.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

## 5. Check it

- `curl -s https://<host>/api/health` returns `"database":"ok"`. With the
  database stopped it returns 503 `"database":"unreachable"`.
- `curl -sI https://<host>/login` shows
  `content-security-policy: frame-ancestors 'none'; …`.
- Register a company at `/register`. In the browser's storage panel the
  `access_token` cookie is `Secure`, `HttpOnly` and `SameSite=Lax`.
- Invite a teammate. The copied link starts with `APP_BASE_URL`, whatever
  address the inviter's browser used.
- Sign out, then replay the old cookie: `curl -s -H 'Cookie:
  access_token=<old value>' https://<host>/api/auth/me` returns 401.

## 6. Backups

A backup **set** is three files with one UTC timestamp, written by
`npm run db:backup`:

- `joist-<stamp>.dump`: `pg_dump`, custom format;
- `joist-<stamp>-uploads.tar.gz`: everything in `UPLOADS_DIR`;
- `joist-<stamp>.json`: the manifest, written last. It holds both files'
  checksums and every table's row count, taken inside the same database
  snapshot as the dump.

The files are mode `0600` and hold every company's data, password hashes
included. Treat the backup directory and the off-host copy like the
database.

**Configure** (in `crm_backend/.env`):

- `BACKUP_DIR=/var/backups/joist`
- `BACKUP_REMOTE=backup@backup-host:/srv/joist-backups`: an rsync
  destination over ssh (give the `joist` user an ssh key that the backup host
  accepts) or a mounted path such as `/mnt/offsite/joist`. Without it, a
  production backup writes the set and then exits 2, because a copy on the
  same disk doesn't survive losing the disk.
- `BACKUP_KEEP_DAYS=14`, `BACKUP_KEEP_MIN=3`: local sets older than 14 days
  are removed, but the newest 3 always stay. The off-host copy is never
  pruned by Joist; set retention on the backup host.

**Schedule** nightly with a systemd timer
(`/etc/systemd/system/joist-backup.service` and `.timer`):

```ini
# joist-backup.service
[Service]
Type=oneshot
WorkingDirectory=/srv/joist/crm_backend
ExecStart=/usr/bin/npm run db:backup
User=joist

# joist-backup.timer
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

`systemctl enable --now joist-backup.timer`. Exit codes: `0` done, `1`
failed (no half-written set is left), `2` written but not copied off the
host. Alert on anything but `0`: `systemctl list-timers` and
`journalctl -u joist-backup` show the last run, and an `OnFailure=` unit
can mail you.

**Prove a backup restores** at least once a month, and after any change to
the host:

```bash
cd /srv/joist/crm_backend
# from the off-host copy, fetched back to this machine:
rsync -a backup@backup-host:/srv/joist-backups/ /tmp/joist-sets/
npm run db:restore-check -- --from /tmp/joist-sets
```

It checks the files against their checksums, replaces the scratch database
`joist_restore_check`, restores into it, unpacks the uploads into
`restore-check/joist_restore_check/uploads`, then compares every table's
row count with the manifest and checks that every file row and company
logo has its file. It prints one restored job photo to open. Open it. Then
run it again with `--drop`, or drop the scratch copy yourself.

It never writes to the live database or the live uploads directory: the
target must be named `*_restore_check`, and must not be the live database
or the one the backup came from. Creating a database needs a role allowed
to, so set `RESTORE_ADMIN_URL` (on the `postgres` database) when the app's
role has no `CREATEDB`, for example `postgresql://postgres@/postgres?host=/var/run/postgresql`
when run as the `postgres` user.

**Recover for real** (the database or the disk is lost):

1. Stop the frontend and the backend.
2. `npm run db:restore-check -- --from <the sets> --owner joist`, with
   `--set <stamp>` for a set other than the newest. Wait for `OK`.
   `--owner` makes the app role own the restored database and every table
   in it, so it can be swapped in as it is.
3. Swap it in, as the admin role:
   ```sql
   ALTER DATABASE joist RENAME TO joist_broken_20261110;  -- if it still exists
   ALTER DATABASE joist_restore_check RENAME TO joist;
   ALTER DATABASE joist SET timezone TO 'America/Chicago';
   ```
4. Move `restore-check/joist_restore_check/uploads` to `UPLOADS_DIR`
   (keep the old directory aside), and give it to the `joist` user.
5. `npm run db:migrate`, then start the backend and the frontend, and
   check `/api/health`.

Everything written after that set's timestamp is lost. This is a
whole-database restore: one company can't be restored on its own yet
(EXPERIMENT_SAAS.md prospect 10).

## Upgrading

1. Back up first: `npm run db:backup`, and check it reports the off-host
   copy.
2. In each repo: `git pull`, `npm ci`, `npm run build`.
3. Backend: `npm run db:migrate`.
4. Restart the backend, then the frontend.

A backend started before step 3 refuses to start and names the missing
migrations, so step 3 can't be skipped by accident.

Migration `0002_company_scoping` gives each company its own invoice
numbers (each carries on from its own highest `INV-` number) and allows one
live deposit and one live final invoice per estimate. If an estimate
already has two, it stops before changing anything and names them: void
the extra one in the app, then run `npm run db:migrate` again. It also
removes the built-in Rooftop Realty row if no user or record belongs to it.

Migration `0003_accounts` adds sessions, reset links and account history.
Sign-ins from before it have no session, so everyone signs in once more
after the upgrade. It changes no existing row.

## Limits on the public surface

All limits are counted per client address unless noted. A 429 carries
`Retry-After`.

| What | Limit |
|---|---|
| Sign-in, per company + email | 10 failed attempts per 15 min. While it holds, the right password is refused too |
| Sign-in, per client address | 50 failed attempts per 15 min |
| Register a company | 10 per hour |
| Accept an invite | 20 per 15 min |
| Check an invite link | 60 per 15 min |
| Forgot password | 10 per hour per address, and 3 per hour per company + email |
| Check a reset link | 60 per 15 min |
| Set a password from a reset link | 20 per 15 min |
| Change password, per person | 10 wrong current passwords per 15 min |
| Client pages: estimate, invoice, portal, intake (reads) | 300 per 15 min |
| Client answers on a shared estimate | 30 per 15 min |
| Intake form submissions | 5 per 15 min per address, and 30 per hour per intake link |

Logos are PNG, JPEG or WebP, checked by their bytes. A logo uploaded before
this change may still be an SVG; the public logo route serves it with
`sandbox` and `default-src 'none'`, so it can't run script.

## Do not, on a shared host

- **Don't set `QB_*` or `ABC_*`.** The boot refuses them.
- **Don't run `db:seed-walkthrough` on a host with customers.** It writes
  demo records into the company you name with `--company <slug>` (with one
  company, that one). Its `--reset` truncates tables for every company, so
  it refuses whenever another company has data in them.
- **Don't restore into the live database by hand.** Restore into
  `joist_restore_check` with `db:restore-check`, then swap it in (above).
- **Don't run more than one backend process.** See "One backend process"
  above.
