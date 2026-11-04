# Experiment: `experiment/CC_expansion`

Decision log for one run. It covers what I believe this product is, what the
code actually did on `main` at `2c83eb7` (backend), `3ca07f7` (frontend) and
`6fe1474` (QA), the thesis I chose, what changed in each repo, and how it was
verified.

Short version: **the job was the "work hub", but its lifecycle ended at the
sale.** "Closed Won" was the last status a job could reach, and it is exactly
the moment a contractor's real work starts. Nothing after the sale had a
state. Money was a Paid/not-paid flag with no payments. A won job dropped
out of health, workload and the blocked-jobs queue. This branch carries the
job from first contact to paid and closed, and it gives the money a ledger.

---

## 1. What this product is for, and who works in it

A job-centric CRM for a small residential / light-commercial contractor.
The seed data, templates and copy are roofing: tear-off, shingles, gutters,
storm-damage inspection, insurance adjuster, ABC Supply. The company is a
handful of people:

- **Owner / admin.** Sees every record. Prices work, sends estimates and
  invoices, chases money, reads reports, manages users and integrations.
- **Agent.** A salesperson or project lead. Sees the leads, jobs and tasks
  assigned to them (or created by them and unassigned), plus invoices and
  estimates they created or that sit on their jobs. Field agents also take
  checks on site.
- **Client.** Never logs in. They touch the product through tokenized pages:
  public intake (lead capture), the shared estimate (accept / decline /
  revision), the customer portal (job status, documents, photos) and,
  after this branch, a shared invoice page.

What the company needs from the CRM: who the client is, what site they're
at, what scope was agreed, at what price, who is doing it and when, what
paperwork went out, and whether the money has come in.

## 2. The lifecycle as the code implements it

### On `main`

```
lead (person + opportunity; New → Contacted → Qualified → Closed / Inactive)
  └── job (lead_id required at creation)
        status: free text, UI offers
          New → Contacted → Appointment Scheduled → Proposal Sent → Closed Won | Closed Lost
        ├── tasks / appointments (task.kind), notes (typed comms), files (client_visible flag)
        ├── measurements
        ├── estimates: Draft → Sent → Approved | Rejected  (client responds by share token)
        │     └── line items (editable in any status)
        └── invoices: Draft / Sent / Paid / Overdue, set by hand
              (one per estimate via /from-estimate, or blank)
```

What I found, by layer:

- **Job status is a sales pipeline.** The job's six statuses repeat the
  lead's sales stages ("Contacted" exists on both) and stop at "Closed Won".
  Everything the build plan and roadmap call execution has no state:
  ordering material, scheduling the crew, doing the work, completing it,
  billing it, collecting. The seeded automation rule ("Kick off production
  when an estimate is approved") stands in for production with a checklist of
  tasks.
- **A won job vanishes from operations.**
  - `computeJobHealth` returned `none` for `Closed Won`.
  - Dashboard `blockedJobs` filtered out `Closed Won`.
  - Workload `jobs_open` excluded it.
  - Team performance counted overdue invoices only on jobs that were *not*
    Closed Won.

  A job in production with overdue tasks and an overdue invoice therefore
  looked healthy everywhere.
- **Approval did not move the job.** A client accepting on the public page
  changed the estimate only. The job sat in "Proposal Sent" until someone
  remembered to move it. Sharing a draft estimate also didn't mark it Sent,
  so "Proposal Sent" and "estimate Sent" were disconnected.
- **The pipeline UI could not express a loss without a win.** It only allowed
  one step forward, and "Closed Lost" came after "Closed Won". To lose a job
  from "Proposal Sent" you had to win it first, which fired automation and
  performance history along the way.
- **Money had no ledger.** `invoices.status` was set by hand. `paid_at` was
  stamped when someone clicked "Paid". There was no payment row, amount,
  method or reference, and so no partial payment and no balance due.
  Deposits were typed as separate manual invoices; the QA seed literally has
  a "Deposit invoice - 30 percent of contract value" note on an unlinked
  invoice. `/from-estimate` copied the full scope, with no way to subtract a
  deposit already billed.
- **Approved scope could be edited.** Line items on an Approved estimate stayed
  editable, so the "contract" could change silently after the client said
  yes. A stale share link could also flip an answer: the client could accept,
  then decline on the same link.
- **What leaves the building was wrong.**
  - The portal listed **Draft** estimates and **Draft** invoices.
  - It showed raw internal statuses ("Proposal Sent", "Closed Won").
  - Its timeline read `metadata.newStatus` while job activity stores
    `toStatus`, so every status line rendered as "Project status updated".
  - The invoice "Copy share link" generated `/public/invoice/<token>`, a
    page that did not exist on the frontend or the backend, so clients got a
    404.
- **Automation's `UPDATE_STATUS` action** wrote `jobs.status` with raw SQL. That
  skipped `status_changed_at`, activity, history and any validation.
- **Team performance was already trying to measure post-sale handoff** ("won
  but not invoiced 14 days later"), but it had no lifecycle to measure it
  against. It also used `status_changed_at` as the decision time, so any
  later status move would have rewritten when a deal was won.

## 3. The comparison

### Where a strong contractor CRM is ahead

Field-service, roofing and exterior CRMs (JobNimbus, AccuLynx and Roofr in
this space; Jobber and Housecall Pro for service trades) share a shape:

1. **One job lifecycle spans the sale, production and accounts
   receivable.** Typical milestones are Lead → Estimate → Sold/Approved →
   Production (scheduled, in progress) → Completed → Invoiced → Paid/Closed,
   with Lost off-path. The board people live in shows where *work* is, not
   just where *deals* are.
2. **The handoffs are explicit, and the system notices when they stall.**
   Examples: approved but not scheduled, completed but not invoiced, invoiced
   but not paid.
3. **Money is a ledger.** Contract value comes from approved scope (plus
   change orders). Deposits are requested at signing and applied to the final
   bill. Payments are recorded with method and reference, partial payments
   leave a balance, and AR aging is a standard report.
4. **Approved scope is a contract.** Changes go through change orders that
   the client approves separately.
5. **The client sees progress and balance, not internal stages.** Most
   competitors also take payment online.
6. **Accounting sync carries payments, not just invoices.**
7. Beyond this thesis: multiple contacts per job (spouse, property manager,
   adjuster), insurance claim fields, crew/sub assignment, material orders
   tied to the job, e-signature, SMS/email sending from templates.

### Where this app is already specific and worth keeping

- **A lead can exist without a job, and a lead → many jobs.** That models
  repeat customers. The QA seed's Helen Brooks now has a second job.
- **Tasks with `kind = appointment`** (start/end/location) live on the same
  model as follow-ups. The job page's "Schedule" already flips the job's
  stage, and I extended that rather than adding a scheduling entity.
- **Typed communication log** (call/text/email/in-person, inbound/outbound)
  with follow-up tasks, and "copy message + log it" templates.
- **The `client_visible` flag on files** and the portal's curated timeline.
- **Tenant scoping** (`applyTenantScope`, `applyOwnOrAssignedJob`) is
  consistent and test-covered. Every query I added uses it.
- **Activity as an event log** (`job_activity` with metadata), assignment
  history and performance attribution "at the moment of outcome".
- **Backend-owned math** ("Totals are recalculated on the backend, not
  trusted from the frontend"). The payments ledger follows the same rule.
- **Dashboard "Start here" queue**, which merges reasons across kinds. It was
  the right place to surface the new handoffs.

## 4. Thesis

> **The job is called the work hub, but its lifecycle ends at the sale.
> Make the job carry the work from first contact to paid and closed: one
> lifecycle across selling, production and billing, a payments ledger that
> makes "balance due" true, and a computed next step. Then show that same
> truth to the office, the field and the client.**

You can feel this in a workflow: approve → deposit → schedule → build →
complete → final invoice less deposit → partial payment → paid → closed.
Before this branch, that sequence existed only in people's heads plus a few
hand-flipped status chips.

### Alternatives I understood and declined

- **Client / property / contact record model.** Today the lead is the person
  and the opportunity at once. There is no household with several contacts,
  no property separate from the job address, and no insurance-claim fields.
  This is real, but the app already handles repeat customers (lead → many
  jobs), and fixing it doesn't change what anyone does on Tuesday. It also
  touches every list and search. It's second on my list.
- **Outbound communication (send email/SMS from templates, sequences on quiet
  leads).** This is a strong daily-work gain, but it needs SMTP/SMS
  providers. QA deliberately leaves SMTP unconfigured, and I would have had
  to invent secrets. The clipboard-and-log templates are an honest stopgap.
- **Concurrency and audit (two people editing a job; an admin audit log).**
  These are worth doing, but they're polish on surfaces that work. I did fix
  the one concurrency hole the thesis created: simultaneous payments on one
  invoice.
- **Online payment capture (Stripe).** That would be the natural end of the
  ledger, but it needs secrets I can't safely invent. The ledger, the public
  invoice page and the portal balance are designed so that capture can attach
  later, as one more payment `method`.
- **A separate "production" object beside the job** (work orders), or a
  second status axis. I declined this: it would make the job less of a hub.
  One status vocabulary, grouped by phase, is easier to read and to report on.

## 5. What changed, by repo

### `crm_backend` (commits `cdc80a9`, `a57ff9b`, `f5f47f4`)

**Schema** — `sql/patch_phase23_job_lifecycle_money.sql`. It is also
appended to `schema.sql`, as phase 22 was, and registered in
`test/helpers/setup.ts`, `package.json` (`db:patch-phase23-job-lifecycle-money`),
`scripts/apply-phase23-…` and the README order list.

- Jobs:
  - `sold_at`, `work_completed_at`, `closed_at`, `lost_at`, `lost_reason`.
  - Data migration: `Closed Won` → `Closed` when every invoice is paid,
    otherwise → `Sold`, so it reappears as open work. `Closed Lost` → `Lost`.
  - Historical `JOB_STATUS_CHANGED` metadata and messages, automation rule
    conditions and saved views are renamed too.
  - `jobs_status_check` added `NOT VALID`: new writes must use the
    vocabulary, and any legacy custom value stays readable.
- Estimates: `approved_at` (backfilled), and `change_order_of` pointing at the
  approved estimate a change order amends.
- Invoices:
  - New columns: `kind` (`standard | deposit | final`), `prior_billed_total`,
    `amount_paid`, `sent_at`, `voided_at`.
  - Status set widened to Draft / Sent / **Partially Paid** / Paid / Overdue
    / **Void**.
- `invoice_payments`: amount, method (check/card/cash/ach/financing/other),
  reference, internal notes, `received_at`, `recorded_by`. Every invoice that
  was already Paid gets one backfilled payment, so the ledger and the status
  agree on day one.

**One owner for lifecycle meaning** — `src/lib/jobLifecycle.ts`:

```
selling     New → Contacted → Appointment Scheduled → Proposal Sent
production  Sold → Work Scheduled → In Progress
billing     Work Complete
closed      Closed          (nothing owed)
lost        Lost            (reopens into selling)
```

It owns:

- The phase map, plus won / open / terminal sets used by SQL filters.
- The shared money aggregate (`JOB_MONEY_LATERAL_SQL`): contract, invoiced,
  drafted, collected, outstanding, overdue, unbilled.
- The transition rules (`assertTransition`):
  - **Close gate:** no open balance and no unsent draft invoices.
  - Only owner/admin can reopen a Closed job.
  - A job cannot be marked Lost after money has been collected.
- Milestone stamping.
- `computeNextStep`: what has to happen for this job to move forward, with
  the action to take.
- The customer-facing stage map for the portal.

**One writer for job status** — `transitionJobStatus` in
`jobs.service.ts`. Manual edits, automatic moves and automation all go
through it, so milestones, activity (with `automatic` and `reason` metadata)
and `JOB_STATUS_CHANGED` rules behave the same way. Automatic moves:

| Trigger | Move |
| --- | --- |
| Share or send an estimate | selling → Proposal Sent |
| Approve an estimate (staff or client) | selling → Sold |
| Payment that settles a Work Complete job | → Closed |
| Payment removed from a Closed job | → Work Complete |

Automation `UPDATE_STATUS` now calls the same function instead of raw SQL.

**Jobs API.**

- `GET /jobs` returns `money`, `next_step`, `phase` and milestones on every
  job, and accepts `?phase=selling|production|billing|closed|lost|open`.
- `GET /jobs/summary` adds `byPhase`.
- A gated move answers `409 { error, blockers[] }`.
- Zod validates status against the vocabulary.
- Health now covers the whole lifecycle:
  - red for overdue tasks or an overdue invoice, at any open stage;
  - yellow for "Sold 7+ days, not scheduled", "Scheduled date has passed",
    "In progress 7+ days", "Work complete, not invoiced" and "Balance unpaid
    7+ days".

**Money.** `invoices.service.ts` was rewritten around the ledger.

- Status is **derived** in one function (`syncPaymentState`, run inside
  every write transaction). Draft and Void stay put. Otherwise the invoice is
  Paid when the balance is zero, Overdue when it's past due with a balance,
  Partially Paid when some money has come in, and Sent otherwise.
- A person can set only Draft, Sent, Void or Paid. "Paid" records a payment
  for the remaining balance, so a quick "mark paid" still keeps the ledger
  true.
- Routes:
  - `POST /invoices/:id/payments` records a payment. Overpayment is refused,
    and the balance is re-checked under `FOR UPDATE`.
  - `DELETE /invoices/:id/payments/:paymentId` is owner/admin only; it's a
    ledger correction, and it reopens a closed job.
  - `POST /invoices/from-estimate/:id` takes `{ kind: 'deposit',
    deposit_percent | deposit_amount }` or `{ kind: 'final' }`. The final
    bills the full scope less the deposit already billed; both are
    idempotent per estimate.
- Locks and refusals:
  - Lines lock once money is in, or once the invoice is void.
  - Deleting an invoice with payments is refused (void it instead).
  - Sharing a draft invoice sends it.
- The overdue sweep (`markOverdueInvoices`) includes Partially Paid.
- The PDF shows "Less deposit billed", each payment, and the balance due.
- The list query moved from the route into the service.

**Estimates.**

- Approved estimates are locked (`409`, with a pointer to change orders).
- `POST /estimates/:id/change-order` creates a draft that amends an approved
  estimate. Approved change orders add to the contract value.
- Un-approving or deleting an estimate that has been invoiced is refused.
- A client can answer a share link once. `resend` still starts a new round.
- `getEstimateById` returns the estimate's live invoices, so the UI knows
  whether it's already billed.

**Surfaces that read the lifecycle.**

- Dashboard:
  - Won jobs stay in blocked/workload.
  - New `soldNotScheduled` and `readyToBill` queues, both ranked into "Start
    here".
  - A `money` block: outstanding, overdue, unbilled, collected in the last
    30 days, jobs in production and billing.
  - Invoices-due rows show the balance.
  - Workload adds `jobs_in_production`.
- `GET /reports/collections`: signed / billed / collected for each of the
  last 12 months, plus AR aging buckets. The job pipeline report is sorted in
  lifecycle order.
- Team performance:
  - Wins are measured at `sold_at`, losses at `lost_at`, so moving a won job
    through production doesn't erase or re-date the win.
  - "Won but poorly collected" uses the ledger.
  - Overdue receivables now include partially paid invoices and jobs past
    Sold.
- Portal:
  - Drafts and voided paper are hidden.
  - Adds `stage` (a client-facing label and step), `money` (project total,
    billed, paid, balance) and `payments`.
  - Status lines read `toStatus` and use client language; internal selling
    steps are filtered out.
  - Payments appear in the timeline.
  - New `GET /public/portal/:token/invoices/:id/pdf`.
- New `/public/invoices/:token` (+ `/pdf`) router, so the existing invoice
  share link resolves. It returns a client-safe projection: no internal
  payment notes and no recorder names.
- QuickBooks: invoice sync adds a `DiscountLineDetail` for prior billing, so
  a final invoice doesn't bill the deposited part of the scope twice.
- `scripts/seed-walkthrough-data.js`: the new vocabulary, payment rows for
  Paid invoices, and milestones (the constraint would otherwise reject its
  inserts).

**Notifications.** Payments notify the job's assignee (or creator) and the
invoice's creator, never the person who recorded the payment. They use the
existing `INVOICE_PAID` and `INVOICE_STATUS_CHANGED` types on purpose. Older
patches (`phase12_invoicing`, `phase18`, `assignment_notifications`) re-add
`notifications_type_check` with a fixed list every time the chain is
re-applied, so a new type would fail re-application on any database that
holds such a row. The same reasoning kept me from adding automation
triggers.

### `crm_frontend` (commit `5eef176`)

- `src/lib/job-lifecycle.js` is the single frontend copy of the vocabulary:
  phases, short labels, payment methods, invoice kinds and money formatting.
  It replaces five hardcoded status lists.
- **Job detail.**
  - A "Lifecycle" card, grouped by phase, replaces "Pipeline". It shows the
    server's next step as a callout with the matching action (Schedule, New
    estimate, Bill deposit, Create final invoice, Record payment, Move to …),
    plus milestones, "Mark lost" with a reason, and Reopen. Close-gate
    blockers render inline. Skipping steps forward asks for confirmation.
  - A "Money" card replaces the bare invoice list. It shows contract,
    invoiced, collected and balance due; an unbilled warning; per approved
    estimate, *Request deposit* (with a %) or *Final invoice (less
    deposit)*; and invoices with kind, status and balance.
  - "Schedule" moves Sold → Work Scheduled, the same way it already moved
    early jobs to Appointment Scheduled.
- **Invoice detail.**
  - A Payments section (record with amount, method, reference, received date
    and an internal note; owner/admin remove).
  - Mark sent, Void, and delete hidden once money is in.
  - Totals show deposit billed, paid, and balance due.
  - Lines lock with an explanation.
  - The timeline uses `sent_at`.
- **Lists.** Invoices get an "Open" filter, a balance column and outstanding
  money in the header. Jobs get a phase filter with counts (exact-status deep
  links still work) and contract / owed on each row.
- **Estimate detail.** The approved-and-locked banner, Add change order,
  Request 30% deposit, and Final invoice (or "Open INV-xxxx" once billed).
  Change orders link to what they amend.
- **New page** `/public/invoice/[token]`: amount due, what it covers,
  deposit applied, payments received.
- **Portal.** Client-facing step pills, a payments summary and list, invoice
  PDFs, and change-order labels.
- **Dashboard and reports.**
  - Dashboard: the "Owed to you" metric (danger tone when past due), and the
    "Money" queue filter includes ready-to-bill jobs.
  - Reports: a "Money after the sale" section with outstanding, past due,
    collected this month, AR aging, and signed/billed/collected bars.

### `crm_qa` (commit `dca1b77`)

- The schema chain gets the phase 23 patch, and `invoice_payments` is added
  to the truncate list.
- The seed uses the new vocabulary, derives milestones from status, and
  writes invoice kind, prior billing, `amount_paid`, `sent_at` and payment
  rows. It refuses a Paid status that its payments don't support. New
  billing-phase job: **Helen Brooks — Gutter guard install** (Work Complete;
  deposit INV-1004 paid; final INV-1005 for $1,960 with $1,000 paid and
  **$960 due**). The infrastructure counts are updated to match.
- `tests/e2e/job-lifecycle.spec.ts`:
  - Every viewport, read-only: the billing job page (lifecycle, money, next
    step), the jobs phase filter, the invoice ledger, the dashboard money
    metric, the customer portal (stage, balance, drafts hidden) and the
    public invoice link, all with horizontal-overflow checks.
  - Desktop only, mutating: client approval on the public page → job Sold
    automatically → deposit billed and paid → Work Scheduled → In Progress →
    Work Complete → final invoice less deposit → close refused with the
    draft-invoice blocker → mark sent → full payment → job closes itself. It
    creates its own records through the API, so the seeded fixtures stay
    unchanged for the other three projects.
  - Share and portal tokens are minted per test and never written to the
    manifest, which keeps the manifest's "ids and emails only" rule.

## 6. What I left alone on purpose

- **Lead statuses** (New/Contacted/Qualified/Closed/Inactive) are not synced
  to the job lifecycle. A lead can have several jobs, and the lead is the
  relationship, not the deal.
- **Progress billing.** Only deposit + final are modeled, which covers most
  residential work. Multiple progress invoices against one estimate would
  need a "billed so far" rule on `/from-estimate`.
- **Refunds and credits.** Overpayment is refused, and removing a payment is
  the only correction path.
- **Manual close with unbilled approved work** is allowed. The owner may have
  agreed to less at the end. The amount is recorded on the close activity
  (`unbilledAtClose`), and unbilled work blocks the *automatic* close.
- **ABC Supply.** Untouched. `supplier_orders` hangs off `lead_id`, not
  `job_id`, so material orders aren't tied to the job they're for; that's
  the obvious next integration step. **QuickBooks payment sync** is also not
  built: payments recorded here are still retyped into QuickBooks.
- **Online payment**, e-signature, SMS/email sending: they need secrets or
  providers.
- **The notification and automation trigger vocabularies** (see the
  re-application note above).
- **`patch_*.sql` history.** No earlier patch was edited; phase 23 is a new
  ordered file.

## 7. How I verified it

**Environment.**

- The local Postgres.app server (5432) refuses every client until someone
  confirms its GUI permission dialog. psql and node both got `Postgres.app
  failed to verify "trust" authentication`.
- I didn't change its settings. Instead I started a separate throwaway
  cluster on **port 5433**, with Postgres.app's own 18.x binaries and a data
  directory in the session scratchpad.
- Backend tests ran there against `crm_test`. QA ran there against a
  database named **`crm_qa`**, on ports **3100/4100**, by overriding
  `QA_DATABASE_URL`, `QA_ADMIN_DATABASE_URL` and `DATABASE_URL` in the
  process environment.
- No `.env*` file was edited, and nothing pointed at `crm_dev` or 3000/4000.

**Backend.**

```
DATABASE_URL=postgresql://<user>:<pw>@localhost:5433/crm_test JWT_SECRET=<test secret> npx jest --runInBand
npx tsc --noEmit -p .
```

- Baseline on untouched `main`: 142/143 passed.
- Final: **156/157 passed**. The 14 new tests are 13 in
  `test/job-lifecycle.integration.test.ts` (lifecycle rules, the full
  estimate→paid→closed flow, ledger permissions, lost/reopen, the status
  vocabulary, change orders, dashboard handoffs, the portal, collections and
  overdue, simultaneous payments) plus a paid-invoice line lock in
  `invoices.integration.test.ts`. I updated the existing tests that encoded
  "Closed Won", manual "Paid"/"Overdue" creation, and editing lines on a paid
  invoice; those behaviors changed on purpose.
- The single failure is pre-existing and appears on the baseline too:
  `tasks.integrations.test.ts › GET /tasks accepts due=today` builds "today"
  at 15:00 UTC, while the server buckets by local date. It fails whenever the
  suite runs between 18:00 and 24:00 US Central. I didn't touch it.
- `tsc` is clean.
- `node scripts/seed-walkthrough-data.js --reset` was run against the scratch
  `crm_test`. It succeeds, and its Paid invoices carry matching payments.

**Frontend.**

```
npm run lint
```

- The result is the same before and after: 6 pre-existing problems (1 error
  in `theme-controller.js`, 5 warnings), none in any file this branch
  touched.
- A production build succeeds through `qa:build`, including the new
  `/public/invoice/[token]` route.
- I checked screenshots at 1440 and 390 for the job page (lifecycle and money
  cards), invoice detail, jobs list, reports, approved estimate, portal and
  public invoice.

**QA.**

```
QA_DATABASE_URL=…5433/crm_qa QA_ADMIN_DATABASE_URL=…5433/postgres QA_DB_NAME=crm_qa npm run test:qa
```

- Guard check passed (15 unsafe targets rejected). Drift check passed (20 SQL
  files). Seed: 5 jobs, 5 invoices, 3 payments.
- Playwright: **209 passed, 11 skipped, 4 failed.** The skips are
  viewport-scoped specs (PWA, plus the desktop-only end-to-end flow).
- All 4 failures are the same environment assertion, `infrastructure ›
  criterion 9`, on each viewport. It requires `crm_dev` and `overnight_dev`
  to exist on the admin server, and they live on the Postgres.app server I
  couldn't reach. I didn't create stand-in databases to satisfy a safety
  check.
- Every new lifecycle test passed on all four viewports, as did every
  existing smoke, auth and PWA test.

## 8. Unfinished, and the exact blockers

- **QA `criterion 9` and running against the real dev Postgres.** Blocker:
  Postgres.app (`~/Library/Application Support/Postgres/var-18`, port 5432)
  requires the user to approve each client binary in its permission dialog
  (`auth_permission_dialog`). To run QA against the configured server, open
  Postgres.app → Settings → App Permissions, allow `node`, and run
  `npm run test:qa` with no overrides.
- **QuickBooks prior-billing line** is unverified against a real QuickBooks
  company: there are no QB credentials. The mapping follows the documented
  `DiscountLineDetail` shape.
- **Existing databases** need `npm run db:patch-phase23-job-lifecycle-money`
  (or the full chain). The patch is idempotent and was exercised by every
  test run, which re-applies the entire chain.
