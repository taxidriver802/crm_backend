# Experiment: SaaS plan — what makes Joist hostable (`experiment/CC_saas_plan`)

This pass plans. It changes no product behaviour: no schema, API, UI or
test changed in any repository. The branch holds this document, plus one
pointer file each in `crm_frontend` and `crm_qa`.

Short version: **Joist is already multi-tenant in its code, but it assumes a
trusted LAN.** A company can register itself, staff join by invite, and
every query is written against `company_id`. What's missing is what a
stranger's company needs on a public host:

- a start path, and configuration that refuses unsafe defaults
- limits on guessing a password
- proof that one company's rows can't drift into another's
- a way back in for someone who forgets their password
- a backup

Charging companies, database-enforced isolation and operator tooling come
after that.

---

## 1. Parent

Branch `experiment/CC_saas_plan`, cut from `experiment/CC_final` in each
repository. Worktrees were clean, and `experiment/CC_final` existed locally
in all three, before branching.

| Repo | `experiment/CC_final` (parent, local tip) | `origin/experiment/CC_final` | `main` |
|---|---|---|---|
| crm_backend | `f2356117bb32` | `09f5c5ca3101` (local is 1 ahead) | `2c83eb7e0c5a` |
| crm_frontend | `5b6b52918192` | `65bcb7cea20a` (local is 1 ahead) | `3ca07f78b71b` |
| crm_qa | `20e0f9940b48` | `20e0f9940b48` | `6fe1474a3cbb` |

- **Local-only parent commits.** In backend and frontend, the commit that
  is ahead of origin is the project-tree refresh. It stays in place, and
  `experiment/CC_final` was not pushed. Pushing the plan branch carries
  that commit as an ancestor; the `experiment/CC_final` ref on origin does
  not move.
- **Reference branches.** No branch other than `experiment/CC_saas_plan`
  was committed to, merged, rebased, reset, amended or force-pushed.

### Treated as settled

- **`docs/EXPERIMENT.md`.** The job lifecycle, and the ledger of what a
  client owes the contractor. Declined there: the household/property model,
  outbound email/SMS, concurrency and audit (as polish), online payment,
  and a production object.
- **`docs/EXPERIMENT_UI_UX.md`.** The Workbench.
- **`docs/EXPERIMENT_REVISE.md`.** Its deferred list: security and abuse,
  QuickBooks per user, and SaaS operations.
- **`docs/EXPERIMENT_HELP.md`.** The guide. Emailed invites were left out
  there.
- **`docs/EXPERIMENT_BRAND.md`.** Joist, and the two brand layers.
- **The schema pass.** Commit `50d6520` (one baseline plus numbered
  migrations) has no log of its own.
- **The short logs** in `crm_frontend` and `crm_qa`.

### Two corrections to the record

- **Invoice numbers are not per company.** `EXPERIMENT_REVISE.md` says
  "Numbers come from a per-company sequence". The code draws every
  company's numbers from one sequence, `invoice_number_seq`
  (`src/services/invoices.service.ts:385`). The unique index is per company
  (`idx_invoices_company_number`), so numbers never collide, but the
  counter is shared. This is in prospect 3.
- **There is a register screen.** Both READMEs say there isn't, but
  `crm_frontend/src/app/register/page.js` exists, and
  `crm_qa/tests/e2e/help-start-here.spec.ts` walks it. This is not a
  prospect; the next pass that touches those READMEs should fix the
  sentence.

## 2. Already true

The ranking keeps all of this in place.

### A company and its people

- **Adding a company is a product action.** `POST /auth/register`
  (`src/routes/auth.routes.ts:73`) creates the company and its owner in one
  transaction.
  - A taken generated slug retries inside a savepoint
    (`src/lib/companySlug.ts`).
  - A caller-supplied slug that's taken returns 409.
  - Covered by `test/companies.auth.test.ts`.
  - The `/register` screen exists, and `help-start-here.spec.ts` takes a
    newly registered company all the way to paid and closed.
- **Sign-in is per company.** `/auth/login` requires the company slug. The
  same email in two companies resolves by slug
  (`companies.auth.test.ts:151`). The branding endpoint returns no company
  id (`companies.auth.test.ts:102`).
- **The next person joins by invite.** `POST /users/invite`
  (`src/routes/users.routes.ts:30`):
  - the token is 32 random bytes, stored as a sha256 hash;
  - an invite expires, can be revoked, and is superseded by a new one;
  - `GET /users/invites/validate` reports why a link is dead;
  - `/accept-invite` sets the password and keeps the person in the
    inviting company (`companies.auth.test.ts:228`).
  - When mail fails, the response carries `invite_url` and the modal offers
    Copy link (`crm_frontend/src/components/modals/invite-user-modal.js`).
- **Roles.** `owner`, `admin` and `agent` are enforced on the server. There
  are last-owner guards on role change, disable and delete
  (`users.routes.ts:540`ff.).
- **A dead session dies quickly.** `requireAuth` (`src/middleware/auth.ts`)
  re-reads the user on every request, so disabling a user or changing a
  role takes effect on that person's next request. A stale cookie is
  cleared and the person is sent to sign in
  (`crm_qa/tests/e2e/auth.spec.ts:135`). Passwords are bcrypt (cost 10) and
  never returned.

### Tenancy as the code writes it

- **One scope helper everywhere.** `src/lib/tenant.ts`:
  - `requestScope` throws when the user has no company;
  - `applyTenantScope` and `applyOwnOrAssignedJob` always add `company_id`;
  - writes to child rows check the parent first (for example
    `estimateTemplates.service.ts`).
- **Inserts name their company.** Every `INSERT` under `src/` lists
  `company_id`, except the `companies` row itself and one exception
  (prospect 3). I scanned for this.
- **Files and defaults are isolated.**
  - Uploads go under `uploads/<company_id>/`, and `/uploads/*` serves a
    file only after a company match (`src/app.ts`).
  - Covered by `test/companies.isolation.test.ts`.
  - Workspace defaults are isolated (`test/preferences.integration.test.ts`).
- **The client's pages are scoped by their token.** The portal reads only
  the token's company and hides drafts and void paper
  (`src/services/portal.service.ts:55`ff.).

### Client links and the ledger

- **Public tokens are strong.** Each is 32 random bytes, stored as sha256.
  - Estimate links expire after 14 days; invoice and portal links after 30
    (`estimates.service.ts:1020`, `invoices.service.ts:1595`,
    `portal.service.ts:42`).
  - Reminting a link kills the old one.
  - An estimate link takes one answer.
  - Covered by `estimates-public.integration.test.ts` and
    `portal.integration.test.ts`.
- **The ledger is what a client owes the contractor.** It's the product,
  and nothing here changes it.
  - It covers deposit and final invoices, a status derived from the
    payments, and overpayments refused.
  - Recording a payment takes a row lock (`invoices.service.ts:1239`).
  - The simultaneous-payments test is in
    `job-lifecycle.integration.test.ts`.
  - What a company would pay Joist is a separate kind of money (prospects
    7 and 12), and it never writes to `invoice_payments`.

### Operating it

- **Schema lifecycle.** One baseline (`sql/schema.sql`) plus numbered,
  checksummed migrations (`scripts/lib/migrations.js`). Jest and QA run the
  same runner. `npm run db:migrate` is a single deploy step.
- **Web defaults are already set.**
  - `helmet()` runs on every API response.
  - CORS uses an allowlist with credentials.
  - Bodies are JSON only.
  - The session cookie is `SameSite=Lax` behind the frontend's same-origin
    `/api` rewrite (`crm_frontend/next.config.mjs`).
  - Together these cover CSRF for the deployment the READMEs describe.
- **Errors stay inside.** `src/middleware/error.ts` writes one JSON line
  per error and answers 500 with a generic message; stacks are hidden in
  production.
- **Uploads are capped** at 10 MB each (`src/lib/upload.ts`).
- **A brand never leaks.** A company's client never sees another company's
  brand (`crm_qa/tests/e2e/brand.spec.ts`).
- **QA never touches dev.** QA can't reach dev data: ports 3100/4100, the
  database-name guard in `crm_qa/db/admin.ts`, and `qa:verify-hygiene`.

## 3. Horizons

### Usable: one outside company on a hosted instance

**What the code can do today.** An owner registers at `/register` and
invites staff with a copied link. They run a job from first contact to
paid and closed, and their client uses the estimate, invoice and portal
links.

**What stops it.**

- **There is no host to put it on.** No repository holds a deploy artifact.
  The Docker setup on the home server that served the hosted demo lives
  outside the repos, and the owner says it is disabled for now
  (2026-11-10).
- **Configuration fails open.**
  - The cookie is never `Secure` in the same-site mode.
  - Invite links take their host from request headers.
  - There is a built-in encryption key for QuickBooks tokens.
  - A stale ngrok origin sits in the credentialed CORS list.
  - Integrations that use one install-wide account are open to every
    company's staff.
- **Nothing limits password guessing** on any sign-in or public route
  except intake.
- **Rooftop shares the database.** The outside company would share a
  database with Rooftop Realty, and any insert that leaves out
  `company_id` files its row under Rooftop.
- **No way back in.** A forgotten owner password means the operator writes
  a bcrypt hash into `users`. A forgotten staff password means disabling
  and re-inviting.
- **Invite mail is unreliable.** It goes out only when SMTP is configured,
  and **Resend** kills the emailed link without sending another.
- **No backups.** The documented demo-seed reset truncates every company's
  data.

### Industry: many companies on the same product

**What the code can do today.**

- **Self-serve companies.** Registration adds a company without a deploy.
- **Isolation by reading.** Scoping is consistent wherever I read it.

**What stops it.**

- **Isolation is barely proven.** One test checks six areas across two
  companies. The database enforces nothing about which company a row
  belongs to.
- **No account with Joist.** Nothing records what a company pays Joist,
  nothing lets the operator suspend a company, and registration can't be
  closed.
- **Restore is all or nothing.** A restore is the whole database, and
  there's no per-company export.
- **Logs can't be traced.** Logs are `morgan('dev')` plus console lines
  with no request or company id.
- **Jobs run twice when scaled.** Background sweeps run inside every API
  process.
- **One clock for everyone.** "Today" is the database's timezone, not the
  company's.

## 4. The rank

Each entry gives the horizon, the anchors, four readings (importance,
safety, work, gain), what it depends on, what done looks like, and what it
must not turn into.

### 1. A public host that fails closed — *usable*

**Anchors.**

- **No deploy artifact.** No Dockerfile, Procfile, process config or CI
  exists in any of the three repositories; I looked. The only container
  file is `crm_backend/docker-compose.yml`: a development Postgres with
  `crm`/`crm`.
- **Almost no required config.** `src/config/env.ts` requires only
  `DATABASE_URL` and `JWT_SECRET`, with no strength check. `FRONTEND_URL`
  falls back to `:3001`.
- **Cookie and CORS.**
  - `src/lib/authCookies.ts:20`: `secure: false` in the same-site mode the
    README recommends.
  - `src/app.ts:53`: a hardcoded ngrok origin in the credentialed CORS
    list.
- **Link hosts come from the request.** `src/utils/appBase.ts:2` builds
  invite links from `X-App-Base-Url`, then `X-Forwarded-Proto/Host`, then
  `Origin`, and only then `APP_BASE_URL`. The frontend sends
  `X-App-Base-Url` from `window.location.origin` (`invite-user-modal.js:66`).
- **A key from a public repo.** `src/services/quickbooks.service.ts:21,34`
  encrypts QuickBooks tokens with a literal fallback key when
  `ENCRYPTION_KEY` is unset. That key is in a public repository.
- **Integrations that cross companies.**
  - **ABC Supply.** `src/integrations/abc/abc.config.ts` uses one
    install-wide account from env. `src/routes/abc.routes.ts` guards it
    with `requireAuth` only, so any signed-in user of any company can
    price, order and read invoice history on it.
  - **QuickBooks callback.** The callback (`src/routes/quickbooks.routes.ts:39`)
    never checks the OAuth `state`; `buildAuthUrl`
    (`quickbooks.service.ts:87`) writes it, and nothing reads it. A crafted
    link can therefore bind a signed-in user's QuickBooks to someone
    else's company.
- **Health and the database.** `/health` (`src/app.ts`) never touches the
  database. `src/db.ts` builds the pool with no SSL or timeout settings.
- **"Today" follows the database clock.** "Due today" is
  `date_trunc('day', NOW())` in the database session's zone
  (`src/services/tasks.service.ts:379,511`). On a UTC host it rolls over at
  6 or 7 pm for a Central contractor.
- **A dev dump in a public repo.** `crm_backend/crm_dev_backup.sql` is
  tracked in the public repository; `.gitignore` names `users_backup.sql`,
  not this file. It contains a `users` table with two bcrypt hashes and
  personal email addresses. `npm run db:seed-demo` reads it.

**Importance.** It blocks the usable horizon outright: nothing can be
hosted without a start path, and the outside company's first week would
otherwise run on the defaults above.

**Safety.**

- **If it waits: takes an account, crosses companies.**
  - The session cookie can travel over plain HTTP.
  - An invite emailed to a stranger's staff points at whatever host the
    admin's browser used (a LAN address, an ngrok tunnel).
  - QuickBooks tokens are encrypted with a key anyone can read.
  - With `ABC_*` set, one company's agent orders on another's supplier
    account.
- **If built now: low risk.** Validation that runs outside
  `NODE_ENV=production` would stop development and QA from booting. Keep
  the dev defaults, and fail only in production.

**Work.** Medium.

- **Backend config.** `env.ts`, `authCookies.ts`, the CORS list,
  `appBase.ts` and the QuickBooks key.
- **A production start path.** For both apps: build, then
  `npm run db:migrate`, then start.
- **An example env file.** `.env.production.example`, naming every
  variable with no values.
- **The dev dump.** Remove `crm_dev_backup.sql` from the tree, and point
  `db:seed-demo` at a file kept outside it.
- **A production-mode boot test.**

**Gain.** High. Most items are a few lines each, and every other prospect
assumes a host.

**Depends on.** Nothing in code. The operator generates the real secrets
(`JWT_SECRET`, the database URL, `ENCRYPTION_KEY` if QuickBooks is ever
on). They are never committed.

**Done looks like:**

- **One runbook.** The operator goes from a clean checkout of the three
  repos to Joist answering over HTTPS on one host.
- **It refuses unsafe config.** With `NODE_ENV=production`, the backend
  refuses to start:
  - without `APP_BASE_URL`, `FRONTEND_URL` and a `JWT_SECRET` of at least
    32 bytes;
  - with `QB_*` or `ABC_*` set, until those integrations work per company
    (Parked).
- **Cookie and links.** The cookie is `Secure`. Invite links use
  `APP_BASE_URL`, whatever headers arrive.
- **Health.** `/health` fails when the database is down.
- **The clock.** The database and server timezone are set to the first
  company's zone, in the runbook.
- **The dump.** `crm_dev_backup.sql` is no longer in the tree.

**Must not become:** a Kubernetes or infrastructure-as-code program, a
hosting provider baked into code, a config framework, or a reason to turn
integrations on.

### 2. Abuse limits on the public surface — *usable*

**Anchors.**

- **Only intake is limited.** No limiter guards:
  - `POST /auth/login` (`auth.routes.ts:148`)
  - `/auth/register` (`:73`)
  - `/auth/accept-invite`
  - `GET /users/invites/validate`
  - the public estimate answer, or the public portal and invoice routes.

  The only limiter in the codebase is `src/lib/intakeRateLimit.ts`.
- **The intake limit crosses companies.** `intakeRateLimit.ts:6-9` allows 5
  per IP per 15 minutes, plus a **global 60 per hour shared by every
  company's intake form**.
- **The client IP can be forged.** The IP is the raw first
  `X-Forwarded-For` value (`src/routes/intake.routes.ts:100`), which any
  caller can set. `trust proxy` is never configured.
- **Registration is free and unlimited.** There's no verification and no
  cap; each call costs a bcrypt hash and a company row.
- **Logos can carry script.** The logo upload accepts `image/svg+xml` and
  GIF (`src/routes/company.routes.ts:16-20`), judged by the type the client
  declares. It serves the file publicly at `/public/companies/:slug/logo`
  on the app's own origin, through the `/api` rewrite.
- **Frontend pages send no security headers.** `next.config.mjs`
  `headers()` sets only the cache header for `/sw.js`, so staff pages can
  be framed.

**Importance.** It blocks the usable horizon: the outside owner's sign-in
sits on the public internet with unlimited guesses. The minimum password
is 8 characters, and there's no lockout.

**Safety.**

- **If it waits: takes an account, crosses companies.**
  - A guessed owner password hands over the whole company: its clients,
    their contact details, the ledger.
  - One flooded intake form returns 429 to every company's website form
    for an hour.
  - A forged `X-Forwarded-For` header resets the per-IP count.
- **If built now: low to medium risk.** A limit that's too tight locks out
  QA's serial sign-ins, or a crew behind one office router. Key the login
  limit on (slug, email) as well as IP, and let the QA environment raise
  it.

**Work.** Small to medium.

- **Backend limiter.** Middleware with in-memory counters; one process is
  enough at this horizon.
- **The real client IP.** `app.set('trust proxy', …)` set to prospect 1's
  topology, instead of reading the header raw.
- **Intake.** A per-token limit replaces the global cap.
- **Logos.** Raster only (PNG, JPEG, WebP), with the type sniffed from the
  bytes.
- **Frontend headers.** `frame-ancestors` and a basic CSP in
  `next.config.mjs`.
- **Tests.** Jest tests for each limit.

**Gain.** High for the size.

**Depends on.** 1. The proxy topology decides how the client IP is read.

**Done looks like:**

- **Login.** Ten wrong passwords for one owner return 429 with
  `Retry-After`. The right password still works after the window.
- **Intake.** A flood on one company's intake form leaves another
  company's form working, and a pasted `X-Forwarded-For` does not reset the
  count.
- **Logos.** An SVG logo upload is refused with a message saying why.
- **Framing.** A staff page refuses to render inside a frame.

**Must not become:** a WAF or CAPTCHA vendor integration, bot detection,
IP reputation lists, or a distributed rate-limit service.

### 3. Rows that can't land in another company, proven route by route — *usable*

It's usable rather than industry because the first outside company shares
the instance with Rooftop.

**Anchors.**

- **The default company.** `sql/schema.sql:66`: `crm_default_company_id()`
  returns Rooftop Realty's id. **23 `company_id` columns default to it**,
  covering users, jobs, invoices, payments and every other business table.
  An insert that forgets `company_id` doesn't fail; it files the row under
  Rooftop.
- **One insert already does.** `src/services/quickbooks.service.ts:142`
  writes `supplier_connections` without `company_id`, so every QuickBooks
  connection belongs to Rooftop.
- **A test asserts the default.** `test/companies.schema.test.ts:24`:
  "seeds a default company used by new users".
- **Every new database starts with Rooftop.** `sql/schema.sql:2699`: the
  baseline ships Rooftop Realty as a starting row, so every new database,
  on any host, begins with one customer's company inside it.
- **One counter for every company's invoices.**
  `src/services/invoices.service.ts:385`: one global `invoice_number_seq`.
  A new company's first invoice is numbered after everything Rooftop has
  issued. The gap between two of its invoices shows how many invoices other
  companies created in between.
- **Thin proof.** `test/companies.isolation.test.ts:60` is the only
  two-company route test. It covers leads, users, assignment, intake, files
  and search. `preferences.integration.test.ts` adds workspace defaults.
  No test creates two companies and checks the rest of the 27 route files:
  - jobs, estimates, invoices and payments, PDFs
  - notes, tasks, measurements
  - portal and share tokens
  - dashboard, reports, team performance
  - automation, saved views, notifications, product metrics, help.
- **One fail-open filter.** `src/services/productEvents.service.ts:51`
  (`$2::uuid IS NULL OR company_id = $2`) returns every company when called
  without one. It's safe today only because every caller passes
  `requestScope`.

**Importance.** It's the day-one hazard of putting a stranger beside
Rooftop on one instance. It's also the first sentence of the industry
horizon.

**Safety.**

- **If it waits: crosses companies.**
  - The next insert that forgets `company_id` hands a stranger's record to
    Rooftop's staff, silently.
  - A route nobody tested shows one company's clients or money to
    another.
  - Every read I sampled was scoped, but nothing proves it.
- **If built now: medium risk.** Dropping the defaults makes every helper
  that leaned on them fail until it names its company: test helpers, the
  QA seed (`crm_qa/db/seed-data.ts`), `scripts/seed-walkthrough-data.js`.
  - That breakage is the point, but it must be fixed in the same pass.
  - The migration must not rewrite existing rows.
  - Per-company numbering must keep every number already issued.

**Work.** Medium.

- **One migration.**
  - Drop the 23 defaults.
  - Add a per-company invoice counter, starting from each company's
    current highest number and taken under a lock inside the invoice
    transaction.
- **Fix the QuickBooks insert.**
- **Decide where Rooftop Realty's row lives.** Probably in the seeds rather
  than the baseline's starting rows. Brand's
  `0001_rooftop_realty_logo.sql` already handles existing databases.
- **A two-company matrix test** in `crm_backend/test`.
  - Company B gets a full job: lead, job, measurement, estimate, invoice,
    payment, file, note, task, portal token, saved view, automation rule.
  - Company A must get 404 or an empty list from every route that takes an
    id, and from every list and summary.
- **A QA spec** that signs in as a second company.

**Gain.** High. It's mostly tests plus one migration, and it turns
"consistent when read" into "proven".

**Depends on.** No code dependency. It ranks after 1 and 2 because there's
no second company until there's a host, and 2 closes a more certain
exposure for less work.

**Done looks like:**

- **No built-in company.** A new database has no company until someone
  registers.
- **Missing company fails loudly.** An insert that leaves out `company_id`
  fails with a not-null error in the tests.
- **Own numbering.** A newly registered company's first invoice is
  INV-0001, and no existing number changes.
- **The matrix.** The test enumerates the mounted routers and fails when a
  router has no cross-company case.

**Must not become:** row-level security, schema-per-tenant or
database-per-tenant. That's prospect 8, a different size with a different
risk.

### 4. A way back in, and sessions that end — *usable*

**Anchors.**

- **No password routes.** There is no forgot, reset or change-password
  route or screen. I searched `crm_backend/src` and `crm_frontend/src`;
  the only other password form is accept-invite.
- **Sign out doesn't end the session.** `auth.routes.ts:365`: logout
  clears the cookie only. The JWT (`JWT_EXPIRES_IN`, default 7 days) stays
  valid until it expires, and nothing ties a token to a password version.
- **Resend kills the link it replaces.**
  - Resend's `sendMail` is commented out (`users.routes.ts:352`).
  - The route still mints a new token and supersedes the old one.
  - The Users page's **Resend** button
    (`crm_frontend/src/app/users/page.js:272`) calls it.
  - So with SMTP configured, Resend kills the link the person was emailed
    and sends nothing.
  - The route also returns the whole row, hashes included
    (`RETURNING *`, `:343`).
- **Two invite lifetimes.** An invite lasts 24 hours on first send
  (`:90`) and 7 days on resend (`:330`).
- **Wrong last sign-in.** Login never writes `last_login_at`; only
  accept-invite does (`auth.routes.ts:284`). The Users page's last sign-in
  is wrong after each person's first visit.
- **No account history.** Nothing records a role change, a disable or a
  failed sign-in.
- **Mail is wired for invites only.** `src/lib/mailer.ts` works once
  `SMTP_*` is set, and only invites call it.

**Importance.** It blocks the usable horizon: "ordinary work does not
require the operator to edit the database".

**Safety.**

- **If it waits: takes an account.**
  - A cookie copied from a shared truck tablet keeps working for a week
    after Sign out.
  - A forgotten password becomes a database edit, or a shared login.
- **If built now: high risk, unless 1 lands first.** Reset links are a new
  way in. Built before 1 pins the link host, `getAppBaseUrl` would let a
  forged `Host` or `Origin` header mail a reset link pointing at an
  attacker's domain (reset-link poisoning).

**Work.** Medium.

- **Backend.**
  - A reset request, with reset tokens shaped like invite tokens: hashed,
    with a short expiry.
  - Change password.
  - `users.session_version`, checked in `requireAuth` and bumped by sign
    out and by a password change.
  - Resend actually sends mail, or stops superseding the old link.
  - One invite lifetime.
  - Login writes `last_login_at`.
- **The security record.** A small table of account events: sign-in,
  failed sign-in, reset, role or status change, invite sent or revoked.
- **Frontend.**
  - A Forgot link on sign-in.
  - A reset page.
  - Change password in Preferences.
  - Real last sign-in and a short account history on the Users page.
- **Mail templates.** In the two brand layers.
- **Tests.** Jest and QA.

**Gain.** High. It ends the last everyday database edit, and an
account-takeover path.

**Depends on.**

- **Prospect 1.** It pins the link host.
- **SMTP credentials on the host.** Owners need them to recover their own
  password. That's an operator secret and can't be invented.
- **Without SMTP, a thinner slice still works.** An owner issues a staff
  member's reset link and copies it, as with invites today. Only the
  owner's own recovery would stay an operator task.

**Done looks like:**

- **Self-service reset.** An owner who forgot their password clicks
  Forgot, gets an email, sets a new password, and every other device is
  signed out.
- **Sign out is final.** Signing out on one browser ends that session.
- **Resend works.** It delivers a new email, and the Users page says so.
- **Honest Users page.** It shows the real last sign-in and a short
  history of account changes.

**Must not become:** single sign-on, a two-factor or passkey program, an
audit log of every table, an email-marketing system, or client logins
(declined: the client never logs in).

### 5. Backups, and one restore that was actually done — *usable*

It's unsafe to wait, which is why it sits on the usable horizon.

**Anchors.**

- **No backup tooling.** No backup script, job or runbook exists. The
  README's "Back up first" (`crm_backend/README.md`, Hosted database) is
  the whole of it. `scripts/` holds only migrate and the seeds.
- **Files live on the API's disk.** `src/lib/upload.ts:5` keeps
  `uploads/<company>/` under the working directory. A database dump alone
  restores file rows that point at missing photos.
- **The documented reset wipes every company.**
  `scripts/seed-walkthrough-data.js:221` `--reset` runs
  `TRUNCATE … RESTART IDENTITY CASCADE` on every business table, across
  all companies. `docs/guide/hosted-demo-seed.md` tells the operator to run
  `--confirm --reset` against the hosted database.

**Importance.** Backup and restore are named on the industry horizon, but
waiting is already unsafe on day one.

**Safety.**

- **If it waits: total data loss.** The outside company's ledger, photos
  and contracts exist in exactly one place. One lost disk, or one run of
  the documented demo reset, deletes them, and `RESTART IDENTITY` reissues
  their ids.
- **If built now: low risk.** A restore drill must go into a named scratch
  database, behind a guard like the one in `crm_qa/db/admin.ts`, and never
  into the live database.

**Work.** Small to medium.

- **Backup.** A script for `pg_dump` (custom format) plus an uploads
  archive, copied off the host, with retention, run on a schedule.
- **Restore.** A guarded restore script into a scratch database, and a
  runbook.
- **The seed.** The walkthrough seed refuses `--reset` once more than one
  company has data.

**Gain.** High.

**Depends on.** 1.

**Done looks like:**

- **Off-host copies.** The operator shows last night's dump and uploads
  archive off the host.
- **A real restore.** They restore both into `joist_restore_check` and
  open a job's photo from the restored copy.
- **A safe seed.** `--reset` on a database with two companies refuses.

**Must not become:** a point-in-time-recovery program, a backup vendor
integration, or per-company restore (that's prospect 10).

### 6. Money writes that survive a double submit — *usable*

**Anchors.**

- **Duplicate final invoices are possible.** `createInvoiceFromEstimate`
  (`src/services/invoices.service.ts:697`) checks for an existing final or
  deposit at `:719`, with `pool.query`.
  - That check runs **before** the transaction opens at `:772`.
  - It takes no lock on the estimate.
  - No unique index covers a live invoice per (estimate, kind); see the
    unique indexes in `sql/schema.sql`.
  - So two requests at once can both pass the check and both insert a
    final.
- **The close gate can race.** `transitionJobStatus`
  (`src/services/jobs.service.ts:413`) reads the job's money, runs
  `assertTransition`, then writes the status, outside a transaction and
  without `FOR UPDATE`. A close racing an owner's payment removal can leave
  a Closed job that still has a balance.
- **Payments already hold.** Recording a payment locks the invoice
  (`invoices.service.ts:1239`), and it's tested. This prospect extends that
  rule to the two writes that skipped it.

**Importance.** It blocks neither horizon. It protects the ledger once
real clients are billed over a slower network, by two staff in two tabs.

**Safety.**

- **If it waits: the ledger can't be trusted.** A client gets two final
  invoices for one contract, or a job closes still owing money. It stays
  within one company.
- **If built now: low risk.** The change touches two functions and one
  migration. The risk is lock order (estimate, then invoice), which the
  tests must pin.

**Work.** Small.

- **Services.** Changes in the two functions.
- **Migration.** A partial unique index.
- **Tests.** Concurrent Jest tests, built like the existing
  simultaneous-payments test.

**Gain.** High for a small change.

**Depends on.** Nothing. It can ship in the same migration window as 3.

**Done looks like:**

- **One final.** Two simultaneous "Final invoice" requests return the same
  invoice.
- **No closed job owes money.** A close that races a payment removal
  leaves the job in Work Complete with the balance showing.

**Must not become:** version columns on every table, a job queue, or
progress billing (declined).

### 7. A company's account with Joist: status, plan, an operator view — *industry*

This is the slice of plan billing that needs no provider.

**Anchors.**

- **No account fields.** `companies` (`sql/schema.sql:150`) holds name,
  slug, palette, mark, logo and workspace defaults. There's no status,
  plan, trial end or billing contact, and no subscription code in either
  app (searched).
- **No operator.** `users_role_check` allows only owner, admin and agent.
  Nothing lists companies, suspends one or removes one. All 28 foreign keys
  to `companies` are `ON DELETE CASCADE`, so removing a company is one
  unguarded SQL statement with no product path.
- **Registration can't be closed.** It's open to anyone who can reach the
  host, with no email verification (`auth.routes.ts:73`).
- **New companies start empty.** The baseline's five roofing templates
  belong to Rooftop only (`sql/schema.sql:2705`).

**Importance.** It blocks the industry horizon: Joist can't charge a
company, or stop serving one that doesn't pay, without editing rows.

**Safety.**

- **If it waits: no cross-company harm.** The cost is revenue and abuse:
  junk signups use storage until someone runs SQL.
- **If built now: medium risk.**
  - Enforcing suspension in `requireAuth` could lock out a paying company
    by mistake.
  - A suspended company's client pages must keep working, or say something
    honest, because those clients are mid-job. The pass must decide which.

**Work.** Medium.

- **Migration.** Status, plan, trial end and billing email.
- **Enforcement.** In `requireAuth`, plus a registration setting: open or
  invite code.
- **An operator surface.** A CLI or a small page behind its own
  credential, never a company role.
- **Provisioning.** Starter templates on register.
- **Tests.**

**Gain.** High at this horizon. With this alone, Joist can sell, invoicing
by hand.

**Depends on.** 1, 3 (a company row that means one company) and 4
(account handling).

**Done looks like:**

- **The operator's list.** It shows every company with its status and last
  activity, and the operator can move one from trial to active or
  suspended.
- **Suspension explains itself.** A suspended company's staff see why when
  they sign in.
- **Provisioning.** A new company starts with the starter templates.
- **A closable door.** Registration can be switched to invite codes.

**Must not become:** a self-serve billing portal (that's 12), seat
metering, feature flags per plan, a marketing site, or an operator mode
that reads companies' work.

### 8. Isolation enforced by the database — *industry*

This is the remainder of 3.

**Anchors.**

- **Isolation lives only in application SQL** (`src/lib/tenant.ts`).
- **Foreign keys use `id` alone.** Nothing stops `jobs.lead_id` from
  pointing at another company's lead if a check is ever missed.
- **The app connects as a single role** (`src/db.ts`).

**Importance.** It matters on the industry horizon: with many companies
and more code, prospect 3's matrix covers only the routes it lists.

**Safety.**

- **If it waits: crosses companies, through a new bug only.** Until then,
  the matrix from 3 is the guard.
- **If built now: high risk.**
  - Row-level security needs the company set on every pooled connection
    for every request.
  - Background sweeps and public token routes run without a user, so they
    must be given an explicit scope.
  - Every query path is affected.
  - Composite `(company_id, id)` foreign keys touch every child table.

  That's why it's split from 3 and ranked below the account and money
  work.

**Work.** Large. It touches the database, `db.ts` and every service's call
path, plus tests.

**Gain.** Medium for the size; high once many companies exist.

**Depends on.** 3. The defaults must be gone, and the matrix must exist to
catch regressions.

**Done looks like:**

- **Scoped by the database.** A deliberately unscoped query inside a
  request returns only the caller's company's rows.
- **Cross-company references fail.** The database rejects a child row that
  points into another company.

**Must not become:** a move to schema-per-tenant or database-per-tenant,
or an ORM.

### 9. Telling what broke — *industry*

**Anchors.**

- **Logs.** Request logs are `morgan('dev')` (`src/app.ts`). Errors are one
  console line with no request or company id (`src/middleware/error.ts`).
- **Tokens in logs.** Public token URLs such as `/public/portal/:token` are
  written to the request log in full.
- **Sweeps per process.** Two `setInterval` sweeps run inside every API
  process (`src/app.ts`), so two instances double the reminders.
- **No record, no alert.** Nothing records a sweep's run, and nothing
  alerts.

**Importance.** It matters on the industry horizon: "an operator can tell
what broke". Today a company's complaint can't be traced to a request.

**Safety.**

- **If it waits:** slower recovery; nothing crosses companies.
- **If built now: low risk.** The pass must not move client details or raw
  tokens into new places.

**Work.** Medium.

- **Logging.** A structured logger with request, company and user ids, and
  tokens scrubbed from URLs.
- **One job runner.** A separate process, or an advisory lock.
- **Alerts.** An error hook that feeds the host's own alerting, tied to no
  vendor.

**Gain.** Medium.

**Depends on.** 1.

**Done looks like:**

- **Traceable.** Given a company and a time, the operator finds the
  failing request, its error and the sweep that touched that company.
- **No raw tokens.** No log line contains a raw public token.
- **One reminder.** Two API processes send one reminder, not two.

**Must not become:** an observability vendor program, tracing everywhere,
or metrics dashboards.

### 10. One company out, one company back — *industry*

**Anchors.**

- **Restore is whole-database.** Prospect 5 restores the whole database.
- **No export.** No export route or script exists.
- **Unguarded removal.** Removing a company is an unguarded cascade (see
  7).
- **Ids are global.** Ids are global serials, so one company's rows can't
  be re-inserted into a shared database as they were.

**Importance.** It matters on the industry horizon. Undoing one company's
mistake from last night's dump today rolls every other company back too,
and a company that leaves Joist can't take its data.

**Safety.**

- **If it waits:** the operator has only a database-wide restore.
- **If built now: medium risk.** An import into a live database must not
  collide with other companies' ids.

**Work.** Medium to large.

- **Export.** A company export (JSON or CSV, plus a files archive), from
  the owner or a script.
- **Single-company restore.** Restore the dump into a scratch database,
  then copy one company's rows back.
- **An offboarding runbook.**

**Gain.** Medium.

**Depends on.** 5 and 3.

**Done looks like:**

- **Export.** An owner downloads their company as one archive.
- **Single-company restore.** The operator restores one company's deleted
  job from yesterday, and no other company changes.

**Must not become:** an importer from other CRMs, or continuous
replication.

### 11. Each company's own clock — *industry*

**Anchors.**

- **No timezone column.** `companies` has none.
- **The database's clock.** "Today" is `date_trunc('day', NOW())` in the
  database session's zone (`tasks.service.ts:379,511`). The dashboard and
  reminders compare against `NOW()`.
- **The server's locale.** `src/jobs/invoiceReminders.ts:23` formats due
  dates in the server's locale.

**Importance.** It matters on the industry horizon: with companies in two
zones on one host, one of them gets "Due today" and Today's agenda wrong
for hours every evening. For the first company, prospect 1 sets the server
zone instead.

**Safety.**

- **If it waits:** daily lists are wrong; nothing crosses companies.
- **If built now: low risk.** Tests that build "today" at fixed UTC times,
  such as the known flaky `due=today` test, must follow the company's
  zone.

**Work.** Small to medium.

- **A field.** `companies.timezone`, plus a Settings field.
- **Queries.** Date queries use the company's zone.

**Gain.** Medium.

**Depends on.** 7, which adds company settings.

**Done looks like:** on one host, a Pacific company and a Central company
each see their own "Due today" at 9 pm local time.

**Must not become:** per-user timezones or localisation.

### 12. Self-serve subscription billing — *industry*

This is the remainder of 7.

**Anchors.**

- **Nothing in code.** There's no billing code (searched for stripe,
  subscription and plan).
- **The status to drive.** Prospect 7 adds the company status this would
  set.

**Importance.** It lets a company start and pay without the operator.
That's growth more than unblocking, since 7 already lets Joist invoice by
hand.

**Safety.**

- **If it waits:** no harm.
- **If built now: needs secrets that don't exist.** It handles payment
  details through a provider. The provider keys don't exist, and webhooks
  need the public HTTPS endpoint from 1.

**Work.** Medium.

- **Provider.** Hosted checkout and a webhook that updates
  `companies.status`.
- **Owner page.** A billing page.

**Gain.** Medium.

**Depends on.** 7, 1, and a provider account and secret.

**Done looks like:**

- **Signup to active.** A new owner starts a trial, enters a card on the
  provider's own page, and the webhook makes the company active.
- **Failed renewal.** A failed renewal moves the company to past due.

**Must not become:**

- taking clients' cards (declined);
- usage metering;
- a ledger shared with the client ledger. `invoice_payments` stays what a
  client paid the contractor, and Joist's billing never writes to it.

## 5. Sequence

Tick a step when its pass is built and checked, and name the branch it
landed on.

- [x] **Step 1** — prospects **1 + 2**, as one pass (a public host that
  fails closed; abuse limits). Landed on `experiment/CC_public_host`, all
  three repos. Built: the production boot check, `HOST` and `TRUST_PROXY`,
  the Secure cookie, invite links from `APP_BASE_URL` only, no built-in
  QuickBooks key, a `/health` that checks the database, the rate limits,
  raster-only logos served sandboxed, page headers, both
  `.env.production.example` files and the runbook
  (`docs/guide/hosting.md`). The tracked `crm_dev_backup.sql` is out of
  git. Checked: typecheck, Jest 30 suites / 230 tests, frontend lint,
  `npm run test:qa` 287 passed, `tests/e2e/public-host.spec.ts` (headers
  through the rewrite), and a production boot of `dist/server.js`: a bad
  environment exits 1 naming every reason; a good one listens on
  127.0.0.1 only and `/health` answers 503 while the database is down.
  **Not yet walked on a real host**: the runbook's TLS proxy, systemd and
  `Secure` cookie steps are unexercised. The leaked hashes' passwords
  still need rotating if those accounts are live (Unverified).
- [x] **Step 2** — prospect **5** (backups, and one restore done). Landed
  on `experiment/CC_backups` (backend; a note in `crm_qa`; no frontend
  change). Built:
  - `npm run db:backup`: a set of a custom-format dump, an uploads archive
    and a manifest (checksums, plus every table's row count taken in the
    dump's own snapshot); an rsync off-host copy (`BACKUP_REMOTE`, without
    which a production backup exits 2); retention that always keeps the
    newest sets.
  - `npm run db:restore-check`: checks the checksums, restores into a
    guarded `*_restore_check` database (never the live or source one),
    unpacks the uploads apart from the live ones, compares every count and
    checks every file row and logo, prints a job photo to open; `--owner`
    and a recovery procedure in `docs/guide/hosting.md`.
  - `UPLOADS_DIR`. Jest had emptied the app's own `uploads/` on every run;
    it now uses a temporary directory.
  - The walkthrough seed's `--reset` refuses when any other company has
    rows it would truncate (`lead_status_events`, which the cascade
    reaches, included), and the seed only targets the default company.

  Checked: Jest 32 suites / 248 tests with the backup round trip on, and
  `npm run test:qa` 290 passed. The drill: backed up `crm_qa`, copied the
  set to a second directory, restored it from there into
  `joist_restore_check` (6 companies, 10 jobs, 281 rows, 5 of 5 files),
  and opened job #1's restored photo, identical to the original. **Not yet
  on a real host**: the off-host copy went to a local directory, not
  another machine, and the nightly timer hasn't run.
- [x] **Step 3** — prospects **3 + 6**, one migration window (rows that
  can't land in another company; money writes that survive a double
  submit). Landed on `experiment/CC_tenancy` (backend; the QA seed and a
  spec in `crm_qa`; no frontend change). Built:
  - Migration `0002_company_scoping`. No `company_id` has a default and
    `crm_default_company_id()` is gone, so an insert that leaves it out
    fails. Each company has its own invoice counter, started from its own
    highest `INV-` number and taken inside the invoice transaction; the
    global sequence is gone and no number changes. A partial unique index
    allows one live deposit and one live final per estimate; the migration
    stops, naming them, if an estimate already has two. The built-in
    Rooftop Realty row and its templates are removed while nothing belongs
    to them, so a new database has no company until someone registers.
  - The QuickBooks connection takes its user's company; product events
    require one (the fail-open filter is gone).
  - Money: "Final invoice" locks the estimate and checks for a live
    invoice inside its transaction, so a second request gets the first
    one's invoice. A status change locks the job and rereads its money
    before closing, and removing a payment locks the job first. Lock
    order: job before invoice, estimate before counter.
  - `test/tenancy.matrix.test.ts`: company B gets a full job (lead,
    measurement, estimate, invoice and payment, file, note, task, portal
    token, saved view, rule, template, invite, intake link). Company A's
    owner then goes through all 154 routes Express has mounted. A route
    with neither a case nor a written exemption fails the test (29 are
    exempt, each with its reason).
  - What the matrix found, all fixed: `POST /automation/evaluate` could
    add one of A's tasks to B's job; `POST /invoices` accepted an estimate
    from another job or company; revoking the portal on B's job answered
    200 (it deleted nothing); B's ids gave 500, not 404, on task edits,
    notification read and delete, and a job from B's lead. The walkthrough
    seed's updates and its payments insert touched every company.
  - Seeds name their company. The walkthrough seed takes `--company
    <slug>` (with one company, that one) and limits every write to it; the
    demo seed runs only on a database with exactly one company; the QA
    seed puts Rooftop back from the baseline's own starting rows.

  Checked: typecheck; Jest 34 suites / 269 tests (the fresh-database check
  included). `test/money.double-submit.test.ts` (10) holds the estimate
  or job lock in a test transaction so the race happens every time: two
  Final or two deposit requests at once return one invoice, five clicks
  return one, a close racing a payment removal leaves the job in Work
  Complete with the balance in either order, and a new company starts at
  INV-0001. `npm run test:qa` 292 passed (96 skipped at other widths, none failed), with
  `tests/e2e/tenancy.spec.ts`: a company registered beside Rooftop sees
  none of Rooftop's records in its lists or search, Rooftop's record URLs
  read "isn’t available", its first invoice is INV-0001, and Rooftop's
  owner can't find or open its records. The seeds were run against a
  scratch database. **Not done here**: the copied-link staff reset stays
  with step 4.
- [ ] **Step 4** — prospect **4**, once SMTP exists on the host (a way back
  in, sessions that end). The copied-link staff reset can go with step 3.
- [ ] **Milestone** — *the first outside company goes live*
- [ ] **Step 5** — prospect **7** (a company's account with Joist)
- [ ] **Step 6** — prospect **9** (telling what broke)
- [ ] **Step 7** — prospect **8** (isolation enforced by the database)
- [ ] **Step 8** — prospect **10** (one company out, one company back)
- [ ] **Step 9** — prospect **11** (each company's own clock)
- [ ] **Step 10** — prospect **12** (self-serve subscription billing)

Where the build order differs from the rank:

- **5 is built ahead of 3 and 4.** It needs only a host, and it must be
  running before the first outside company writes a single row. Its rank
  stays 5 because 3 and 4 protect against harms that are more likely day
  to day.
- **6 ships with 3.** Both are a migration plus backend tests in
  neighbouring code, so they share one migration window and one QA run.
- **4 waits on an operator secret (SMTP), not on code.** Its copied-link
  slice doesn't need mail, so it can go out earlier.
- **9 is built ahead of 8.** Row-level security is large and risky, and
  structured logs are what let an operator see a scoping regression while
  8 is being built.

## 6. The next pass

> **Make Joist safe to put on the public internet for its first outside
> company (prospects 1 and 2).** The code assumes a trusted LAN. Give both
> apps one documented production start path: build, `npm run db:migrate`,
> start. Make the backend refuse to boot under `NODE_ENV=production`
> without `APP_BASE_URL`, `FRONTEND_URL` and a JWT secret of at least 32
> bytes. Make it also refuse while `QB_*` or `ABC_*` is set. Mark the
> session cookie `Secure`, and take the hardcoded ngrok origin out of CORS.
> Build invite links only from `APP_BASE_URL`, never from request headers.
> Remove the literal fallback key in `quickbooks.service.ts`. Make
> `/health` check the database. Take the tracked `crm_dev_backup.sql` out
> of the tree. Then add rate limits to sign-in, registration, accept-invite,
> invite validation and the public client routes. Key them on the real
> client IP (`trust proxy` set to the deploy's topology) and on slug plus
> email. Replace intake's global cap with a per-link limit. Accept only
> raster logos, and send `frame-ancestors` and a basic CSP from the
> frontend. Development and QA keep their current defaults. Every limit and
> boot check gets a Jest test, and `npm run test:qa` still passes on 3100
> and 4100 against `crm_qa`. Done is the runbook followed on a clean
> machine to an HTTPS Joist that a stranger can register on. That stranger
> can't be brute-forced, and their invite emails point at the real host.
> Leave tenancy, accounts, backups and billing to their own passes.

## 7. Parked

These are understood and left out of the ranked list.

### Dependencies that must stay off on a shared host

**Company-level integrations (QuickBooks, ABC Supply).** Their secrets are
absent, and neither horizon needs them.

- **Why they block a shared host:**
  - ABC uses one install-wide supplier account that any company's staff
    can reach.
  - QuickBooks connections are per user, filed under Rooftop's
    `company_id`, encrypted with a fallback key, and bound by a callback
    that never checks `state`.
- **The rule:** on a shared host both stay off. Prospect 1 makes the boot
  refuse their variables.
- **The smallest honest version, when they're wanted:**
  - one QuickBooks connection per company, managed by owner or admin only;
  - a signed `state` that is checked on the callback;
  - `ENCRYPTION_KEY` required;
  - ABC credentials stored per company in `supplier_connections`.
- **What stays declined:** payment sync.

### Slices split off and folded

- **Email verification on registration.** Folded into 7's registration
  setting.
- **Server-side sessions with a device list.** 4's `session_version` gives
  the safety without them. The device list is parked.
- **The audit log.** Only the security record (account events) is in 4. A
  general audit-log product is refused.
- **Per-company timezone for the first company.** It's an operator setting
  in 1. The product version is 11.

### Programs refused

- **Scaling past one API process.** Object storage for uploads, a shared
  limiter store, horizontal API instances. One instance is enough for both
  horizons as read; revisit when two processes are needed. The smallest
  honest version is uploads in object storage.
- **A CI program.** It doesn't change whether Joist can be hosted. 1's
  runbook runs `npm test` and `npm run test:qa` before each deploy.
- **CSRF tokens.** The same-origin rewrite plus `SameSite=Lax` covers the
  documented deploy. With `AUTH_COOKIE_CROSS_SITE=true` (`SameSite=None`),
  POST routes with no body become forgeable, for example
  `/users/invite/:id/revoke` and `/auth/logout`. The runbook pins the
  same-origin deploy; CSRF tokens only if a cross-site deploy is ever
  needed.
- **Compliance badges.** SOC 2 or PCI: there's no gap behind them. If 12
  uses the provider's hosted checkout, card data never touches Joist.
- **Purging the dump from git history.** Rewriting history needs a
  force-push to shared branches, and that's the owner's decision. 1 removes
  the file from the tree going forward.
- **The proxy matcher.** `crm_frontend/src/proxy.js` covers some routes,
  and the shell covers the rest. The API enforces every route, so this
  doesn't block hosting.
- **Product areas declined earlier.** Outbound email and SMS to clients
  (copy-link stays), online card capture for client invoices, the
  household/property model, progress billing, refunds and credits, crews
  and work orders, e-signature, material orders on the job, QuickBooks
  payment sync. None blocks a horizon.
- **Brand leftovers and scale.** A company mark as the tab icon, a
  per-company manifest, new palettes, layout changes, a bulk endpoint,
  drag-and-drop, an offline queue. Out of scope by the brief.

## 8. Unverified

How I worked: I read code, schema, tests and docs. I didn't boot the
apps, and I didn't run any tests, because this pass changes no code.
Results quoted from earlier passes come from their logs. The Brand log
reports 28 suites and 207 tests passing.

- **The hosted setup.** The Docker deployment on the home server
  (`docs/guide/hosted-demo-seed.md`) is disabled for now, per the owner on
  2026-11-10. Its files are in no repository. I couldn't see its TLS, proxy
  headers, database timezone, backups or environment.
  - *Would change the rank:* if that host already terminates TLS, holds
    real secrets and takes nightly dumps, 1 and 5 shrink. They don't move,
    because the code's defaults still fail open.
- **What the Next rewrite passes through.** *Answered in step 1.* Next
  16's rewrite proxy passes the request's headers through and adds only
  `X-Forwarded-Host`: it writes no `X-Forwarded-For` of its own, so the TLS
  proxy must set it (`docs/guide/hosting.md`). Read from
  `next/dist/server/lib/router-utils/proxy-request.js`. Helmet's CSP,
  `X-Frame-Options` and `nosniff` reach the browser on `/api/*`, and the
  logo route's `sandbox` CSP does too. `crm_qa/tests/e2e/public-host.spec.ts`
  checks this through the real rewrite.
  - *What it meant for the rank:* nothing moved. Logos are now raster only
    anyway, so the CSP is a second guard for logos stored before the
    change.
- **The two money races (6).** *Fixed in step 3*, and pinned by
  concurrent tests that force the interleaving with a held lock. Those
  tests were written against the fixed code; I didn't run them against
  the old code, so the races themselves are still read from code, not
  reproduced.
  - *Would change the rank:* nothing now; 6 is built.
- **The QuickBooks callback forgery.** Read from code (the callback never
  reads `state`), not exercised; there are no app keys.
  - *Would change the rank:* nothing moves. The rule keeping QuickBooks off
    a shared host stands either way.
- **SMTP delivery.** No pass has sent real mail. Jest covers the invite
  markup only.
  - *Would change the rank:* if the host can't get SMTP, the owner's own
    recovery in 4 waits, and the copied-link slice carries it.
- **The two hashes in `crm_dev_backup.sql`.** I don't know whether they
  belong to accounts that still exist on any live database.
  - *Would change the rank:* if they do, rotate those passwords now, ahead
    of everything in this plan.
- **Tenant scoping I didn't read.** I read the scoping in jobs, estimates,
  invoices, portal, templates, product events, users, files and the uploads
  route. I didn't read every query in reports, dashboard, team
  performance, automation or search.
  - *Would change the rank:* if 3's matrix finds a leak, fixing it ranks
    first.
  - *Answered in step 3.* The matrix covers every mounted route, reports,
    dashboard, team performance, automation and search included. It found
    two crossings (automation evaluate, an invoice naming another
    company's estimate) and a few wrong status codes, all fixed in that
    pass. Reads were scoped everywhere.
- **Load.** One Node process, the default `pg` pool of 10, and an
  in-memory limiter look adequate for one company, by reading. Untested.
  - *Would change the rank:* if the first company is large, multi-process
    work moves out of Parked, and 9's single job runner moves up.
- **A billing provider.** None chosen, and no keys. 12 stays a dependency.
