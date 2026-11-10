# Experiment CA — expansion

Branch: `experiment/CA_expansion`

## What this product is

This is a job CRM for a small crew that sells and then builds the work. The first account is an owner. Later people arrive by invite as admin or agent. Agents see assigned leads, jobs, and tasks. Owners and admins see the company.

The company in the seed and the guides is a roofing contractor: intake asks for the property and the roof, estimates carry material and labor lines, ABC Supply can price materials, photos are before/after, and QuickBooks is the accounting system next door. A realtor-style contact manager would be the wrong shape. The client is a person on a lead. The thing the company actually runs is the job at an address.

## Lifecycle, as the code implements it

A lead can exist with no job. It moves New → Contacted → Qualified → Closed or Inactive. Tasks, files, and notes can hang on the lead before any job exists.

A job is optional at first and then becomes the hub. Its pipeline is New → Contacted → Appointment Scheduled → Proposal Sent → Closed Won or Closed Lost. Tasks belong to exactly one of a lead or a job. Measurements, activity, portal tokens, estimates, and invoices hang on the job.

An estimate is Draft, Sent, Approved, or Rejected. The client can accept, decline, or ask for a revision through a share link. Line items are the source of the total. Approving an estimate fires automation. It does not, before this change, change what the job is worth.

An invoice can be created from an approved estimate or by hand. It is Draft, Sent, Paid, or Overdue. Overdue is a status the reminder job writes when a sent invoice passes its due date. Paid was a flag plus `paid_at`. There was no row for the check, the card, or the deposit. A second approved estimate sat beside the first. Nothing added them into one price.

The customer portal shows the job, estimates, invoices, shared photos, and a thin timeline. It did not say what was agreed or what was still owed.

## Where a strong job CRM is ahead, and what is already worth keeping

A strong CRM for this company treats the accepted estimate as the contract, then keeps one number for the job: contracted, collected, still owed. Deposits land before the invoice. Change orders revise the contract instead of replacing it. Partial payment is normal. The client sees the same balance the office sees.

This app was already specific in ways worth keeping:

- The job is the hub, and a lead can exist without one.
- Estimates are job-scoped, with templates, ABC line sources, share links, and a client response.
- Invoices copy an approved estimate and can become a PDF.
- Files know whether the client may see them, and photos have before/after.
- Tasks and appointments share one table and one calendar.
- Assignment, saved views, notes, automation, and the portal are real, not placeholders.
- Company branding follows the public pages.

The strategic notes in this folder still describe kanban, notes, search, and invoicing as future work. Those shipped in later phases. The notes are evidence of intent, not the current gap.

## Thesis

Acceptance never became a contract, and money never became a ledger. After the client said yes, the job still had no price, a deposit could not be recorded, and an invoice was either unpaid or paid in full. The handoff from "they accepted" to "we got paid" was a person flipping a status.

That is the gap this run closes. The first approved estimate on a job is the contract. A later approval is a change order, and a change order may credit the job. Payments are rows. A deposit sits on the job until someone applies it to an invoice. Marking an invoice paid applies those deposits first, then records only the remainder. The job, the invoice, and the customer portal all show contracted, collected, and still owed.

## Alternatives understood and declined

- **Rebuild the pipeline into production stages** (scheduled, in progress, complete). Closed Won is a sales ending, and the crew still has to build the roof after it. That mismatch is real. It is a second product. The money gap is what makes the job feel unfinished the moment the client accepts.
- **Make QuickBooks the ledger.** The integration can look up a balance elsewhere. The office still needs the number on the job when QuickBooks is disconnected, and a deposit check does not start in QuickBooks.
- **A fuller contact and company model.** The client is already the lead on the job. Splitting households and accounts would not fix the sold-to-paid hole.
- **Dispatch, materials purchasing, or a deeper automation catalog.** Appointments, ABC pricing, and rules already exist. They do not answer what the job is worth or what is still owed.
- **The team-admin polish in `context.md`.** Invite lifecycle and an audit log would make the users page more trustworthy. They are not the workflow that breaks between a signed estimate and a paid invoice.

## What changed

### crm_backend

`sql/patch_phase23_contract_payments.sql`, also appended to `sql/schema.sql`, and registered in `test/helpers/setup.ts`.

- `estimates.kind` is `proposal` or `change_order`. `estimates.contract_estimate_id` points a change order at the contract. `jobs.contract_estimate_id` and `jobs.contracted_at` hold the accepted estimate.
- Proposal totals stay non-negative in the service. Change-order lines may be credits, so the old non-negative checks on estimate subtotal, grand total, and line price are dropped.
- `payments` records amount, method (`cash`, `check`, `card`, `ach`, `other`), reference, note, and optional invoice. A payment with no invoice is a deposit.
- Invoices may be `Partial`. Status follows the ledger: fully covered is Paid, some money and not past due is Partial, past due with a balance is Overdue.
- Existing Paid invoices are backfilled with one payment so old rows match the ledger. The earliest approved estimate on a job becomes its contract. Other approved estimates on that job become change orders.
- `PAYMENT_RECORDED` is a notification type. The older notification patches also list it, because the test and QA harness re-apply those files and would otherwise reject the new rows.

API:

- Approving an estimate, including from the public share link, sets the contract or marks a change order.
- The contract cannot be reopened or deleted while change orders still point at it. Approved prices cannot be edited. A change order is the revision.
- `GET /jobs/:id/money` returns contract, change orders, collected, still owed, unbilled, payments, and invoice balances.
- `POST /jobs/:id/change-orders` opens a draft change order.
- `POST /jobs/:id/payments`, `POST /jobs/:id/payments/:id/apply`, and `DELETE /jobs/:id/payments/:id` maintain the ledger. Applying a deposit that is larger than the invoice balance splits the remainder back onto the job.
- `PATCH /invoices/:id` with `Paid` applies unapplied deposits, then records the rest as "Marked paid".
- The customer portal returns the same contract, collected, and still owed figures, plus payment date, amount, and method. Staff notes stay off the portal.

### crm_frontend

The job page has a Money section: contract, collected, still owed or credit, unbilled, change orders, and a form to record a deposit or a payment against an open invoice. Estimate rows say Contract or Change order. An approved estimate explains that its price is locked. A draft change order can mark a line as a credit. Invoice lists show the open balance once any money is recorded, and the invoice page records a payment and shows Partial. The public estimate calls a change order a change order. The portal shows what the client agreed to, what they have paid, and what they still owe.

### crm_qa

The schema list includes the new patch. The Brooks job's approved estimate is seeded as the contract, and its paid invoice has a matching check in `payments`. Playwright checks those figures on the job, and one desktop test accepts a contract and records a deposit through the form.

## Left alone on purpose

- Job and lead status names. Closed Won is still the sales ending.
- ABC Supply ordering and QuickBooks push. A payment recorded here is not sent to QuickBooks.
- Estimate and invoice PDF layout, aside from prefixing a change-order title.
- Automation rules, saved views, assignment, and the team page.
- How files, notes, tasks, and appointments already attach to a lead or a job.

## Verification

Backend, from `crm_backend`:

`npm test -- --forceExit`

25 suites, 146 tests, all passed. That includes the new `test/contract-payments.integration.test.ts` (client acceptance sets the contract, credits, deposits, partial application, mark-paid remainder, portal balance) and the existing estimate, invoice, and portal suites.

Frontend, from `crm_frontend`:

`npx eslint` on the job page, job money component, invoice list and detail, estimate detail, line-item form, status tones, and the public estimate and portal pages. Clean.

`npx tsc --noEmit` in `crm_backend`. Clean.

QA, from `crm_qa`, against database `crm_qa` on ports 3100 and 4100. Playwright's browser cache was the machine cache, not the sandbox path:

`env -u PLAYWRIGHT_BROWSERS_PATH npm run test:qa`

That run finished 192 passed and 1 failed. The failure was the new deposit spec calling `getByText('Deposit')`, which matched the stat caption, the deposit option, and the payment row. The contract figures and the $250 / $750 balances had already asserted. The spec now looks for `Check · $250.00` and clears that job before and after. Re-running `tests/e2e/contract-money.spec.ts` finished 5 passed and 3 skipped. No application code changed between those two runs.

## Not finished

Nothing in the thesis was left unfinished. QuickBooks still does not receive these payments. That was declined on purpose, not blocked. No missing secret and no dirty worktree stood in the way.
