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
sql/                schema.sql + ordered phase patches
scripts/            patch appliers + seed
test/               Jest + Supertest integration tests
docs/               Product docs (source of truth)
```

## Auth and roles

Roles: `owner`, `admin`, `agent`.

- First `POST /auth/register` becomes **owner**. There is no frontend register
  page — bootstrap with curl (below), then sign in at the UI.
- Later users are invited (`POST /users/invite`) and activate at `/accept-invite`.
- `requireAuth` sits on almost every router. Owner/admin gates use
  `requireOwnerOrAdmin` or `requireRole`.
- Cookie: `access_token`, httpOnly, `SameSite=Lax` locally. Set
  `AUTH_COOKIE_CROSS_SITE=true` only when the UI and API are on different sites
  (Secure + `SameSite=None`).

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

Also: `estimate_templates`, `saved_views` (leads / jobs / tasks),
`notifications`, `intake_tokens`, `automation_rules`, `product_events`, and
ABC `supplier_*` tables.

## Schema and patches

No Prisma/Knex. Canonical definition is `sql/schema.sql` plus phase patch
files. `schema.sql` is idempotent (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`)
and already contains later columns; tests and QA still apply **both** the
schema file and the patches, in this order:

1. `schema.sql`
2. `patch_notifications_constraints.sql`
3. `patch_phase9.sql`
4. `patch_phase10_notes.sql`
5. `patch_phase12_team_visibility.sql`
6. `patch_phase12_saved_views.sql`
7. `patch_phase12_invoicing.sql`
8. `patch_phase13_automation.sql`
9. `patch_phase13_portal.sql`
10. `patch_phase14_events.sql`
11. `patch_phase15_status_aging.sql`
12. `patch_phase16_communication.sql`
13. `patch_phase17_quotes_photos.sql`
14. `patch_phase18_acquisition_portal.sql`
15. `patch_phase19_appointments_workload.sql`

That list is hardcoded in `test/helpers/setup.ts` and duplicated in
`crm_qa/db/schema.ts` (QA fails if the `sql/` directory drifts). Do not sort
alphabetically — invoicing must precede automation.

`npm run db:patch-*` applies a single patch file to `DATABASE_URL`.

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

**Schema.** Apply `sql/schema.sql` then the patch files in the order above
(`psql "$DATABASE_URL" -f …`, or the matching `npm run db:patch-*` scripts).
A green `npm test` against `.env.test` also applies the full chain on the
test database.

**API:**

```bash
npm install
npm run dev
```

Listens on **http://localhost:4000** (`GET /health` should return `{ ok: true }`).

**First user** (owner) — the UI only has `/login`:

```bash
curl -X POST http://localhost:4000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"first_name":"Ada","last_name":"Owner","email":"ada@example.com","password":"changeme1"}'
```

Then start `crm_frontend` and sign in at http://localhost:3000/login.

**Demo data** (optional): `npm run db:seed-walkthrough` — see
[`docs/guide/hosted-demo-seed.md`](docs/guide/hosted-demo-seed.md).
`npm run db:seed-demo` loads an older backup dump.

Local ports: **UI 3000 / API 4000**. QA uses 3100 / 4100 so it never binds
these. `FRONTEND_URL` in `src/config/env.ts` falls back to `:3001` if unset —
that fallback is stale. Always set `FRONTEND_URL=http://localhost:3000` or
CORS will reject the Next app.

## Environment variables

Named here only; keep values in `.env` (dev) or `.env.test` (Jest). Server
loads `.env.test` when `NODE_ENV=test`.

**Required to boot**

- `DATABASE_URL`
- `JWT_SECRET`

**App / HTTP**

- `PORT` — default `4000`
- `NODE_ENV`
- `FRONTEND_URL` — CORS origin; use `http://localhost:3000`
- `APP_BASE_URL` — invite, portal, and estimate links; defaults to `:3000`
- `CORS_ORIGINS` — extra comma-separated origins
- `JWT_EXPIRES_IN` — default `7d`
- `AUTH_COOKIE_CROSS_SITE` — `true` for cross-site cookies

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
- `ENCRYPTION_KEY` — token encryption at rest

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | `ts-node-dev` on `src/server.ts` |
| `npm run build` / `npm start` | `tsc` then `node dist/server.js` |
| `npm test` | Jest, `NODE_ENV=test`, `--runInBand` |
| `npm run test:watch` / `test:debug` | Watch / open-handle detection |
| `npm run db:patch-*` | Apply one `sql/patch_*.sql` file |
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
views, tasks, users.

Not covered as dedicated suites: `/search`, `/product-metrics`, ABC, QuickBooks,
and a full leads CRUD file (leads are created as fixtures in other tests).

## Docs

[`docs/README.md`](docs/README.md) explains this folder. Manual QA checklists:

- [`docs/guide/dev-testing-guide.md`](docs/guide/dev-testing-guide.md)
- [`docs/guide/realtor_testing_guide.md`](docs/guide/realtor_testing_guide.md)
  (filename is historical; the walkthrough is a roofing intake)

Hosted demo seed: [`docs/guide/hosted-demo-seed.md`](docs/guide/hosted-demo-seed.md).
