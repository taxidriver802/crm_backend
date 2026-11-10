# CRM — Backend

REST API for the CRM. Express + PostgreSQL, consumed by the Next.js app in
`crm_frontend`. Product docs in `docs/` are the git-tracked source of truth
for planning notes and manual walkthroughs.

## Stack

- **Node.js**, **Express 5**, **TypeScript**
- **PostgreSQL 16** via `pg` (`Pool`) — raw SQL, no ORM
- **Zod** request validation
- **JWT** in an httpOnly cookie (`access_token`); `Authorization: Bearer` also accepted
- Helmet, CORS with credentials, cookie-parser, Morgan, Multer, nodemailer, pdf-lib

## Related repositories

This folder is `crm_backend`. Sibling checkouts expected next to it:

| Repo | Role |
| --- | --- |
| `crm_frontend` | Next.js UI (`localhost:3000`) |
| `crm_qa` | Playwright harness; applies this repo’s `sql/` to a `crm_qa` database |

## Architecture

Request path: `src/routes/*.routes.ts` → `src/services/*.service.ts` → SQL on
`src/db.ts`. Zod schemas live in `src/validators/`. `asyncHandler` forwards
rejections to `src/middleware/error.ts`.

```
src/
  app.ts            Express app, route mounts, background jobs
  server.ts         Loads `.env` or `.env.test`, listens
  db.ts             pg Pool
  config/env.ts     Required/optional env
  routes/           HTTP adapters
  services/         Business logic + queries
  validators/       Zod
  middleware/       auth, requireRole, error
  lib/              cookies, mailer, uploads, PDFs, print theme
  jobs/             Interval workers
  integrations/abc  ABC Supply client
sql/                schema.sql baseline, migrations/, archive/
scripts/            migrate.js (+ lib/migrations.js), seeds, help-articles
test/               Jest + Supertest integration tests
docs/               Product docs (source of truth)
```

## Auth and roles

Roles: `owner`, `admin`, `agent`.

- `POST /auth/register` creates a **company and its owner** together. The
  frontend's `/register` screen calls it; sign-in is per company (slug +
  email + password).
- Later users are invited (`POST /users/invite`) and activate at `/accept-invite`.
- `requireAuth` sits on almost every router. Owner/admin gates use
  `requireOwnerOrAdmin` or `requireRole`.
- Cookie: `access_token`, httpOnly, `SameSite=Lax`, and `Secure` when
  `NODE_ENV=production`. `AUTH_COOKIE_CROSS_SITE=true` (Secure +
  `SameSite=None`) is for a development setup where the UI and API are on
  different sites; production refuses it.
- Sign-in, registration, invites and the client's token pages are rate
  limited (`src/lib/rateLimit.ts`; the table is in
  [`docs/guide/hosting.md`](docs/guide/hosting.md)).

`view=all` on list/dashboard endpoints is honored for owner/admin only.
Agents see their own assigned work.

## Data model

Users own records (`user_id`). Assignment is a separate `assigned_to`.

```
users
  └── leads          contact / opportunity (can exist without a job)
        └── jobs     work hub
              ├── tasks, files, notes, activity, measurements
              ├── estimates → estimate_line_items
              │                 └── invoices (optional estimate_id)
              └── portal_tokens
        └── tasks, files, notes   (lead-owned, before a job exists)

tasks belong to exactly one of lead_id or job_id
  kind: task | appointment
```

Job lifecycle (phase 23): `New → Contacted → Appointment Scheduled →
Proposal Sent` (selling) → `Sold → Work Scheduled → In Progress`
(production) → `Work Complete` (billing) → `Closed`, with `Lost` off-path.
`src/lib/jobLifecycle.ts` owns the vocabulary, transitions, close gate and
next step. Invoices carry a payments ledger (`invoice_payments`); invoice
status is derived from payments and due date. See `docs/EXPERIMENT.md`.

Also: `estimate_templates`, `saved_views` (leads / jobs / tasks),
`notifications`, `intake_tokens`, `automation_rules`, `product_events`, and
ABC `supplier_*` tables.

## Schema and migrations

No Prisma/Knex. The schema is plain SQL in `sql/`:

- `sql/schema.sql` is the **baseline**: the whole schema as of phase 24 in one
  file, plus the rows a new database starts with (the built-in company and
  five estimate templates). It was generated with `pg_dump` from a database
  built by the old patch chain and checked to match it exactly.
- `sql/migrations/` holds every change since, one numbered file each
  (`0001_short_name.sql`). See [`sql/migrations/README.md`](sql/migrations/README.md).
- `sql/archive/` keeps the old `schema.sql` and phase patches. Nothing runs
  them except the upgrade of a database that was built from them.

`npm run db:migrate` brings the database in `DATABASE_URL` up to date:

- an empty database gets the baseline;
- a database built from the old patches is brought up to the baseline once;
- then every migration not yet in the `schema_migrations` table runs, in name
  order, each in its own transaction.

The backend tests (`test/helpers/setup.ts`) and the QA harness call the same
runner (`scripts/lib/migrations.js`), so adding a migration needs no list
updated anywhere. A migration that has run must never be edited: the runner
refuses a changed checksum.

## Run locally

**Postgres** (from this directory):

```bash
docker compose up -d
```

This starts Postgres 16 as `crm_dev` on `localhost:5432` (user/password `crm` /
`crm`).

**Env.** Copy the variable names in [Environment variables](#environment-variables)
into a gitignored `.env`. Minimum to boot: `DATABASE_URL` and `JWT_SECRET`.
Set `FRONTEND_URL` and `APP_BASE_URL` to `http://localhost:3000` (see the
port note there).

**Schema.**

```bash
npm run db:migrate
```

On an empty `crm_dev` this applies the baseline; run it again after pulling
new migrations. `npm test` migrates the test database the same way.

**Hosted database.** Back up first (`npm run db:backup`), deploy the
backend files, then run `npm run db:migrate` on the server with `DATABASE_URL` set to the hosted
database, and restart the backend after it succeeds. A hosted database built
from the old patches is brought up to the baseline the first time; after that
only new migrations run.

**API:**

```bash
npm install
npm run dev
```

Listens on **http://localhost:4000**. `GET /health` returns `{ ok: true,
database: "ok" }`, or 503 when the database cannot be reached.

**First company and owner:** a migrated database has no company. Start
`crm_frontend`, register one at http://localhost:3000/register, then sign in
at `/login`.

**Demo data** (optional): `npm run db:seed-walkthrough` — see
[`docs/guide/hosted-demo-seed.md`](docs/guide/hosted-demo-seed.md). It
writes into one company: the only one, or the one named with
`--company <slug>`. With several companies and no `--company` it stops and
lists them, and with none it asks you to register first. Its `--reset`
refuses when any other company has data.
`npm run db:seed-demo` loads an older local dump, `crm_dev_backup.sql`,
which is not in git; a fresh clone has none. It runs only on a database
with exactly one company.

Local ports: **UI 3000 / API 4000**. QA uses 3100 / 4100 so it never binds
these. `FRONTEND_URL` defaults to `http://localhost:3000`.

**Production:** [`docs/guide/hosting.md`](docs/guide/hosting.md) is the
runbook, and `.env.production.example` names every variable. With
`NODE_ENV=production` the backend refuses to start on unsafe config
(`src/config/production.ts`).

**Backups:** `npm run db:backup` writes a set (a `pg_dump` of the database
and an archive of the uploads, checksummed in a manifest) and copies it off
the machine; `npm run db:restore-check` restores a set into a scratch
database (`joist_restore_check`) and checks every row count and file. See
"Backups" in the hosting runbook. Both need the PostgreSQL client tools
(`pg_dump`, `pg_restore`) at the server's major version or newer.

## Environment variables

Named here only; keep values in `.env` (dev) or `.env.test` (Jest). Server
loads `.env.test` when `NODE_ENV=test`.

**Required to boot**

- `DATABASE_URL`
- `JWT_SECRET`

**App / HTTP**

- `PORT` — default `4000`
- `HOST` — interface to listen on; production uses `127.0.0.1`
- `NODE_ENV` — `production` turns on the boot checks and the `Secure` cookie
- `FRONTEND_URL` — CORS origin; default `http://localhost:3000`
- `APP_BASE_URL` — invite links. In production it is the only source (https
  required); in development the inviter's browser origin is used
- `CORS_ORIGINS` — extra comma-separated origins (a LAN address or tunnel in
  development)
- `TRUST_PROXY` — which hop may supply `X-Forwarded-For`; default `loopback`
- `UPLOADS_DIR` — where uploaded files live; default `uploads/` under the
  working directory. A host keeps it outside the checkout. Jest always uses
  a temporary directory
- `JWT_EXPIRES_IN` — default `7d`
- `AUTH_COOKIE_CROSS_SITE` — `true` for cross-site cookies (development only)

**Backups** — read by `db:backup` and `db:restore-check`, not by the API

- `BACKUP_DIR` — where sets are written; default `backups/` (gitignored)
- `BACKUP_REMOTE` — rsync destination for the off-host copy
  (`user@host:/path` over ssh, or a mounted path). Without it a production
  backup exits 2
- `BACKUP_KEEP_DAYS` (default `14`), `BACKUP_KEEP_MIN` (default `3`) — local
  retention; the newest `BACKUP_KEEP_MIN` sets are always kept
- `RESTORE_ADMIN_URL` — a role that may create and drop databases, on the
  `postgres` database; default: `DATABASE_URL`'s server and role

**SMTP (invites)** — nodemailer. Invite send fails until these are set.
(`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` are the ones that gate
“configured.”)

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`
- `MAIL_FROM`, `SMTP_TIMEOUT_MS`

**ABC Supply (optional)**

- `ABC_API_BASE_URL`, `ABC_CLIENT_ID`, `ABC_CLIENT_SECRET`
- `ABC_ACCESS_TOKEN`, `ABC_REFRESH_TOKEN`, `ABC_WEBHOOK_SECRET`, `ABC_ACCOUNT_ID`

**QuickBooks (optional)**

- `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_REDIRECT_URI`, `QB_API_BASE_URL`
- `ENCRYPTION_KEY` — token encryption at rest; required to connect (there
  is no built-in key)

QuickBooks and ABC Supply use one account for the whole install, so a
production boot refuses `QB_*` and `ABC_*`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | `ts-node-dev` on `src/server.ts` |
| `npm run build` / `npm start` | `tsc` then `node dist/server.js` |
| `npm test` | Jest, `NODE_ENV=test`, `--runInBand` |
| `npm run test:watch` / `test:debug` | Watch / open-handle detection |
| `npm run db:migrate` | Bring `DATABASE_URL` up to date (baseline, then `sql/migrations/`) |
| `npm run db:backup` | Back up the database and uploads as one set; copy it off the host; prune old sets |
| `npm run db:restore-check` | Restore a set into `joist_restore_check` and check it (`--drop` removes it after) |
| `npm run db:seed-walkthrough` | Narrative demo dataset |
| `npm run db:seed-demo` | Older backup-based seed |

## HTTP surface

No OpenAPI/Swagger or Postman collection. Routers are the spec. Mounted in
`src/app.ts`:

| Prefix | Purpose |
| --- | --- |
| `/auth` | Register, login, logout, `me`, accept invite |
| `/leads` | Lead CRUD + summary |
| `/jobs` | Job CRUD, tasks, measurements, health |
| `/tasks` | Task/appointment CRUD + summary |
| `/estimates` | Estimates + line items (job-scoped) |
| `/estimate-templates` | Copy-on-apply line packages |
| `/public/estimates` | Token-gated customer estimate |
| `/invoices` | Invoices + line items + PDF |
| `/notes` | Lead/job communication log |
| `/files` | Upload, list, visibility, delete |
| `/dashboard` | Actions, workload, activity |
| `/search` | Workspace search (command palette) |
| `/saved-views` | Per-user list presets |
| `/notifications` | In-app notification feed |
| `/users` | Invite, roles, disable (owner/admin) |
| `/reports` | Operational KPIs |
| `/product-metrics` | Product analytics (owner/admin) |
| `/automation` | Rules + templates + evaluate |
| `/portal` | Generate/revoke job portal tokens |
| `/public/portal` | Token-gated customer portal |
| `/intake` | Generate/regenerate website intake links |
| `/public/intake` | Public lead capture |
| `/integrations/abc` | ABC Supply status, pricing, orders |
| `/integrations/quickbooks` | QuickBooks OAuth + sync |
| `/uploads` | Static files from `uploads/` |
| `/health` | Liveness |

JSON shape: `{ ok: true, ... }` or `{ ok: false, error }`. Details live in
`src/routes/*.routes.ts`.

## Background jobs

When `NODE_ENV` is not `test`:

- Task due notifications every 5 minutes (`src/jobs/taskNotifications.ts`)
- Invoice reminders every 15 minutes (`src/jobs/invoiceReminders.ts`)

QA and Jest set `NODE_ENV=test` so seeded rows are not mutated mid-run.

## Errors and logging

- Morgan `dev` for requests
- `errorHandler` logs one JSON line (`route`, `user_id`, `error_name`,
  `error_message`; `stack` only outside production) and responds
  `{ ok: false, error }`. Status ≥ 500 is always `Internal Server Error`.
- Mailer warns at startup if SMTP is incomplete

No separate logger package.

## Tests

Jest + Supertest + a real Postgres database from `.env.test`.

```bash
npm test
```

Covered (integration): auth/dashboard smoke, authorization, automation,
dashboard actions, estimates (authenticated + public), estimate templates,
files, intake, invoices, jobs, notes, notifications, portal, reports, saved
views, tasks, users, the production boot check, rate limits, backups and
the seed's reset guard.

The backup round trip (`test/backup.test.ts`) creates and drops a database,
so it runs only when a role that may do that is named:

```bash
RESTORE_ADMIN_URL=postgresql://<superuser>@localhost:5432/postgres npm test -- backup
```

Not covered as dedicated suites: `/search`, `/product-metrics`, ABC, QuickBooks,
and a full leads CRUD file (leads are created as fixtures in other tests).

## Docs

[`docs/README.md`](docs/README.md) explains this folder. Manual QA checklists:

- [`docs/guide/dev-testing-guide.md`](docs/guide/dev-testing-guide.md)
- [`docs/guide/realtor_testing_guide.md`](docs/guide/realtor_testing_guide.md)
  (filename is historical; the walkthrough is a roofing intake)

Hosting runbook: [`docs/guide/hosting.md`](docs/guide/hosting.md).
Hosted demo seed: [`docs/guide/hosted-demo-seed.md`](docs/guide/hosted-demo-seed.md).
