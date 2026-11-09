# Experiment: Revise — make the base solid (`experiment/CC_revise`)

Branch `experiment/CC_revise` in `crm_backend`, `crm_frontend` and `crm_qa`,
cut from `experiment/CC_ui_reimagination`. This pass adds no new product
areas. It makes the existing loop (lead → job → estimate → approval →
deposit → work → final invoice → payment → closed) run as one product,
from the job's next step, for both roles, at desktop and phone widths.

## Parent and reference points

Tips recorded before branching. None of these branches was committed to,
merged into, rebased, reset, amended or force-pushed.

| Repo | `main` | `experiment/CC_expansion` | `experiment/CC_ui_reimagination` (parent) |
|---|---|---|---|
| crm_backend | `2c83eb7e0c5a` | `95637577aca4` | `7984acd43402` |
| crm_frontend | `3ca07f78b71b` | `8d7a5b2504e3` | `68dedadf6f3f` |
| crm_qa | `6fe1474a3cbb` | `808d998890c9` | `dccef30421f9` |

## The theses, unchanged

- **Job-centric lifecycle** (`docs/EXPERIMENT.md`): the job runs from first
  contact to paid and closed; the backend owns the status path, the money
  (a payments ledger) and the one next step.
- **Workbench** (`docs/EXPERIMENT_UI_UX.md`): one workspace the person
  shapes; records open beside where you are (peek); the next step is
  always in view; layout preferences follow the person.
- **Field Ledger** visual language (`crm_frontend/src/app/workbench.css`).

Judgment here was about fit, finish and truth inside those theses. No new
identity, information architecture, component library or theme.

## What I found

I walked the loop as owner and agent at 1440 and 390 before changing
anything, read the money rules in the backend, and probed them.

### Breaks

1. **Two billing paths that disagreed.** Billing could start from the
   job's next step, the job's Money tab buttons, or the estimate's menu,
   and each did it differently. The next step's "Bill deposit" sent you to
   the Money tab and then to a full invoice page; nothing opened beside the
   job.
2. **Estimates and invoices were the last records on the old layout.** No
   next step on the document itself; the job said what to do but the
   document did not.
3. **A drafted deposit was treated as requested.** A Sold job with a draft
   deposit invoice said "Schedule the work", so the request never reached
   the client.
4. **An applied deposit could be changed after the fact.** Voiding,
   editing or deleting a deposit that a final invoice had already
   subtracted left approved work looking unbilled, and "Create final
   invoice" kept reopening the existing final.
5. **A second approval path.** The estimate edit form had a Status select
   that could set Approved or Rejected without the approval side effects
   (the job moving to Sold, the client response).
6. **Copy that was not true.** Copy-link buttons did not say that each copy
   mints a new link and kills the old one. Estimate and invoice notes were
   labelled as internal although the public pages and PDFs show them. The
   reports page counted distinct status names as "Job stages".
7. **Not-yours states that lied.** An agent opening an owner's record got
   empty controls and $0.00 (jobs, estimates, invoices) or "Lead not
   found." over an empty shell. Two admin pages silently redirected agents,
   automation showed "Insufficient permissions" over empty rule lists, and
   integrations offered live setup buttons the API refuses.
8. **Permissions the UI got wrong both ways.** Agents could not add job
   photos although the API allows it; agents saw portal-link buttons the
   API refuses.
9. **Lists forgot their filters.** Filters lived only in component state,
   so reload, back and shared links lost them. Saved views could not be
   linked or pinned, although the preference schema accepted view pins.
   Lists also carried their own inline create forms beside the Create menu
   and `/new` pages: three ways to make a job.
10. **Preferences the backend refused.** The new estimate and invoice
    records save the details-rail toggle under `preferences.records`; the
    validator knew only `job` and `lead`, so hiding the rail would have
    failed with a 400.
11. **No guard against vocabulary drift.** The frontend mirrors the
    backend's statuses, phases, next-step actions, invoice kinds and
    payment methods by hand. A renamed status or a new next-step action
    could ship with no control and nothing would fail.

### What was solid (probed, not changed)

Probed through the API against the QA database (results from the final
build):

| Probe | Result |
|---|---|
| Share an estimate twice, use the first link | `404` "Invalid or expired link" for view and approve; the new link `200` |
| Pay more than the balance | `409` "That is more than the $290.00 balance due on INV-…" |
| Negative amount / unknown payment method | `400` / `400` |
| Two payments of the exact remaining balance at the same moment | one `201`, one `409`; paid equals total, status Paid (row lock holds) |
| Pay a draft invoice | accepted, and the invoice becomes issued (sent date set, Partially Paid): money in means it was sent |
| Add a line to a paid invoice | `409` |
| Close a job with money still owed | `409` with the blocker text |
| Void or delete a deposit a final already subtracts | `409` with the reason (after this pass) |
| Ask for a second final invoice | returns the existing final, no duplicate |
| Job money vs. the sum of its invoice balances | equal (990 = 990) |

Also solid: the close gate's draft-invoice blocker, approval moving the job
to Sold by itself, the final invoice subtracting the deposit, the final
payment closing a settled job, and customer-facing pages ignoring personal
appearance preferences.

## Changes, and the break each closes

### crm_backend

- `df63e34` **Keep the deposit honest** (breaks 3, 4). `computeNextStep`
  asks to send a drafted deposit before scheduling, and the schedule step
  names a deposit still due. A deposit applied to a live final is locked
  (`applied_on` on the invoice) against void, edit and delete until the
  final is voided. Tests cover both.
- `a80d34a` **Accept estimate and invoice record preferences** (break 10).
  `RECORD_KEYS` gains `estimate` and `invoice`; a test covers the rail
  toggle and pinning a saved view whose link has a query string.
- `docs/guide/hosted-demo-seed.md`: no longer says the demo has "Closed
  Won" jobs (the seed writes Closed and Lost).

No schema change was needed, so there is no new SQL patch.

### crm_frontend

- `38779e3` **Document actions on the documents; the job's next step opens
  them** (breaks 1, 2, 6, 7, 8).
  - Estimate and invoice records use the job's head / next step / tabs /
    rail pattern, each with its own next step.
  - The same parts render in the peek, so the job's next step opens the
    document beside the job, already at the action (`intent: "deposit"`,
    `"pay"`).
  - The Money tab is only the picture: figures, an unbilled warning, and
    document rows that peek.
  - `record-events` makes the page underneath reload when a document
    changes.
  - `RecordUnavailable` answers once for records and peeks.
  - Agents can add job photos; portal actions show only for owner/admin.
  - Copy says what the API does.
- `2eeb0b3` **One answer for records and admin tools that aren't yours; no
  second approval path** (breaks 5, 6, 7).
  - Lead and task pages use `RecordUnavailable`.
  - `AdminOnly` wraps team, templates, automation and integrations.
  - Integrations is an admin nav item, and the command palette skips
    admin pages for agents.
  - The estimate form loses its Status select.
  - Notes are labelled as client-visible, and Sync to QuickBooks shows
    only when connected.
- `fc4c4f1` **Filters in the URL; saved views linkable and pinnable**
  (break 9).
  - `useUrlFilterSync` and `?view=<id>`: Pin view, opening a pin
    re-applies the view, changing a filter leaves the view, and deleting a
    view removes its pin.
  - Inline create forms are removed; "New …" opens the one form, and a
    calendar day click prefills its date.
- `0dc3457` **Say who is where on the team agenda** (area 5). In the team
  view, Today's agenda leads with the assignee. The empty text no longer
  claims "this week".
- `569c6c3` **Signed-out visitors on admin pages go to sign in.** The QA
  run caught that `AdminOnly` waited forever for a user when the session
  was gone. The provider now records a 401 from `/auth/me`.
- `6e6a0b1` **Palettes through `useSyncExternalStore`; dead components
  removed** (area 8).
  - This fixes the repo's one lint error, in `theme-controller.js`.
  - Removed `invoice-payments` (made dead by the invoice record) and six
    components already unused on the parent.
- `38acf99` **Say what the numbers are** (break 6, area 8).
  - Reports: "Open jobs" replaces "Job stages / Distinct statuses", and
    the chart is "Jobs by stage".
  - Today: "Jobs by phase" replaces "Pipeline", and the Needs-you filter
    is "Jobs & leads". Widget ids are unchanged, so saved layouts still
    apply.
  - "Start the work" shows the visit in local time instead of a UTC date.
  - A pinned view no longer lights up on every visit to its list.
- `9c4ad9c` README rewritten where it described the pre-Workbench pages
  (shared UI, adding a page, routing, design status), plus the
  `EXPERIMENT_REVISE.md` pointer. `3f83fd8` re-indents the job rail's
  portal block (whitespace only).

### crm_qa

- `0d7d891` **Lifecycle drift check** (break 11).
  - `scripts/lifecycle-drift-check.ts` reads both repos' source and
    compares: statuses and their order, phase membership, status tones,
    invoice kinds, payment methods, and a job control for every next-step
    action.
  - It runs in `test:qa` after the guard check, and as
    `npm run qa:drift-check`.
  - Checked against a doctored copy: it reports each kind of drift and
    exits 1.
- `e6c3375` **Specs for the product as it now works.**
  - `job-lifecycle`: the end-to-end flow runs from the next step through
    the peeks.
  - `documents` (new): the seeded approved estimate, plus an estimate
    scoped, sent, approved, billed and change-ordered from its own page.
  - `access` (new): the seeded agent at 1440 and 390, covering owner
    records, admin areas, and an assigned job.
  - `saved-views` (new): URL filters at every width; save, pin, open,
    leave and delete at 1440, with preferences reset before and after.
  - `workbench`: follows the "Jobs by phase" rename.
  - README updated.

## Looked at and left alone

- **Invoice numbering.** New invoices are INV-0001…, seeded ones INV-1001+.
  Numbers come from a per-company sequence; the seed sets its own. It is
  consistent within a company, so I did not touch it.
- **Unbilled work does not block a manual close.** This is deliberate: the
  owner may settle for less at the end. It is recorded on the close
  activity, and it does block the automatic close on final payment.
- **Overdue in QA.** The stored `Overdue` status can lag the date-based
  aging in reports, because the overdue sweep is off under
  `NODE_ENV=test`. It runs in real environments.
- **Task detail** still uses the older `DetailHeader` layout. It reads
  correctly, and converting it is layout work, not a break.
- **`useUrlTab`** passes Next's history state to `replaceState`. Tabs do
  not read `useSearchParams`, so the router-sync issue that bit filters
  does not apply.
- **Toasts** stack to four for 3.2 s each. They pile up only under scripted
  speed.
- **Historical docs** (`EXPERIMENT.md`, `docs/archive`, the pre-Workbench
  design docs in `crm_frontend/docs`) keep "Closed Won" and "Pipeline" as
  history. The READMEs now point at the current docs.
- **The Reports chart labels** read run-together in the accessibility tree
  ("AppointmentScheduled"). This is how recharts wraps SVG text into
  tspans; on screen the words are separate.

## Deferred (out of scope for this pass)

- **Security and abuse.**
  - QuickBooks connections are per user, and agents can reach the
    QuickBooks routes.
  - `/invoices` and record pages outside the proxy matcher render the
    shell before a 401 (QA auth tier 3).
- **Offline preference queue.** A full page load within the 350 ms
  debounce can drop the last preference write. The pagehide flush covers
  most navigations; the QA spec waits for the PATCH.
- SaaS operations, anything needing provider secrets, the bulk endpoint,
  drag-and-drop, and declined product areas.

## Verification

| Check | Command | Baseline (parent) | Result |
|---|---|---|---|
| Backend types | `npx tsc --noEmit -p .` | clean | clean |
| Backend tests | `npx jest --runInBand` | 26 suites, 165 tests (due-today flaky near midnight UTC) | 26 suites, 167 tests: 166 passed, 1 failed (the known "due=today" test; run at 05:15 UTC) |
| Frontend lint | `npm run lint` | 1 error (`theme-controller.js`), 3 warnings | 0 errors, 3 warnings (the same three, in files this pass did not touch) |
| Frontend no-undef | ESLint `no-undef` on all 42 added or modified `src` files | — | clean |
| Drift check | `npm run qa:drift-check` | — | ok, 14 checks |
| QA suite | `npm run test:qa` | 264 tests: 238 passed, 26 skipped, 0 failed | 288 tests: 252 passed, 36 skipped, 0 failed (24 new tests: 14 more passing, 10 more desktop-only or role skips at other widths) |
| QA hygiene | `npm run qa:verify-hygiene` | — | passed: no QA secret in tracked files or artifacts |

Walked by hand (screenshots kept out of the repos):

- Owner at 1440 and 390: the full loop through peeks on a fresh job, from
  sending the estimate to closed.
- Owner at 1440: paying from the job's next step; saved views
  (filter → save → pin → open from the sidebar → leave → delete).
- Agent at 1440 and 390: owner records, admin areas, and an assigned job.
- Client: the public estimate (approve), the portal, and the public
  invoice.

No console errors on the touched screens, other than the expected 404
"Failed to load resource" line when an agent opens a record that is not
theirs.

## Unfinished

Nothing in scope is left unfinished, and no secret or environment blocker
was hit.
