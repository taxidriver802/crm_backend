# Hosting Joist

One host serves Joist to contractor companies over HTTPS: Postgres, the
backend, the frontend, and a TLS reverse proxy. This is the production start
path from `docs/EXPERIMENT_SAAS.md` (step 1: prospects 1 and 2).

> **Status.** Written with the code it describes, and checked locally:
> boot refusals, rate limits, headers and the build commands. It has not
> yet been walked end to end on a real host. The home-server Docker setup in
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

## What you need

- Node.js 20.9 or newer (Next 16).
- PostgreSQL 16 or newer.
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
cd crm_backend
npm ci
cp .env.production.example .env      # then fill in every value
npm run build
npm run db:migrate                    # baseline on an empty database, then sql/migrations/
```

Required in `.env`:

- **`NODE_ENV`**: `production`.
- **`HOST`**: `127.0.0.1`.
- **`PORT`**: `4000`.
- **`DATABASE_URL`**
- **`JWT_SECRET`**: generate it with `openssl rand -hex 32`.
- **`APP_BASE_URL`** and **`FRONTEND_URL`**: both are the
  `https://<your host>` address people use.
- **`TRUST_PROXY`**: `loopback`.

The backend refuses to start under `NODE_ENV=production`, and lists every
reason, when:

- `APP_BASE_URL` or `FRONTEND_URL` is missing or is not `https://`;
- `JWT_SECRET` is shorter than 32 bytes;
- any `QB_*` or `ABC_*` variable is set. QuickBooks and ABC Supply use one
  account for every company on the host, so they stay off until they work
  per company;
- `AUTH_COOKIE_CROSS_SITE=true` or `TRUST_PROXY=true` is set.

Mail is optional. Without `SMTP_*`, an invite still creates a link the
inviter copies.

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

## Upgrading

1. Back up first. Until backups are automated (EXPERIMENT_SAAS.md step 2),
   take them by hand:
   - the database: `pg_dump -Fc joist > joist-$(date +%F).dump`
   - the files: an archive of `crm_backend/uploads/`
2. In each repo: `git pull`, `npm ci`, `npm run build`.
3. Backend: `npm run db:migrate`.
4. Restart the backend, then the frontend.

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
| Client pages: estimate, invoice, portal, intake (reads) | 300 per 15 min |
| Client answers on a shared estimate | 30 per 15 min |
| Intake form submissions | 5 per 15 min per address, and 30 per hour per intake link |

Logos are PNG, JPEG or WebP, checked by their bytes. A logo uploaded before
this change may still be an SVG; the public logo route serves it with
`sandbox` and `default-src 'none'`, so it can't run script.

## Do not, on a shared host

- **Don't set `QB_*` or `ABC_*`.** The boot refuses them.
- **Don't run `db:seed-walkthrough --reset`.** It truncates every company's
  data, not one company's. Step 2 fixes this.
- **Don't run more than one backend process.** See "One backend process"
  above.
