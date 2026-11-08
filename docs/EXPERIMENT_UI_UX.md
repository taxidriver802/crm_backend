# Experiment: `experiment/CC_ui_reimagination`

Decision log for a complete rethink of the frontend experience. This branch
was cut from **`experiment/CC_expansion`** (the parent), not from `main`, in all
three repositories:

| Repo | Parent tip (`experiment/CC_expansion`) | `main` (untouched) |
|---|---|---|
| crm_backend | `9563757` | `2c83eb7` |
| crm_frontend | `8d7a5b2` | `3ca07f7` |
| crm_qa | `808d998` | `6fe1474` |

Short version: **the CRM had a strong data model wearing a page-per-table
interface.** Every click on a row threw away the list you were working in;
the home screen was a report, not a place to work; nothing about the
workspace was yours. This branch turns the frontend into a **Workbench**: one
persistent shell you shape yourself, a Today screen built from widgets you
arrange, a peek panel that opens any record beside the list you came from,
records organised as header + tabs + details rail, one configurable table for
every list, a global Create and keyboard-first navigation. Every one of those
preferences is stored on the server, per person, with company defaults an
admin can set.

---

## 1. Product understanding

A job-centric CRM for a small residential contractor (the seed is roofing).
Three kinds of people touch it:

- **Owner / admin.** Sees everything. Prices, sends estimates and invoices,
  chases money, manages users, templates, automation, integrations.
- **Agent.** Sees the leads, jobs and tasks assigned to them. Works from the
  field, often on a phone.
- **Client.** Never logs in. Uses tokenized pages: intake, the shared estimate,
  the customer portal, the shared invoice.

The relationships the UI must respect (verified in the schema and services,
and preserved by this branch):

- A **lead** can exist without a job (enquiries, people not yet qualified).
- The **job** is the hub. It belongs to a lead and owns the estimates,
  invoices, appointments, tasks, files and conversation for one piece of work.
- A **task** belongs to exactly one of a lead or a job
  (`tasks_exactly_one_owner_check`). Appointments are tasks with a time.
- **Estimates become invoices** (deposit and final), and payments settle
  invoices. The parent branch added the lifecycle that carries a job from
  first contact to paid and closed, with a computed **next step** and **health**.
- **Files and notes** can sit on a lead or a job.
- The **portal and public pages** carry the company's own brand. They are the
  customer's view and must not change with a staff member's personal look.

The work this product exists for is a loop: *a lead comes in → someone talks
to them → a job is scoped and sold → it is scheduled and done → it is billed
and paid.* The frontend should keep that loop in view and make the next step
on any record one click away.

## 2. Research

What the products that do this well have in common, and what I took:

| Product | What they do | What this branch takes |
|---|---|---|
| **Jobber** | The sidebar follows the workflow (requests → quotes → jobs → invoices); one prominent **Create** button; Home shows the workflow overview and today's visits. | A single global Create (rail and phone tab bar), workflow-ordered nav, Today with agenda + handoffs. |
| **Housecall Pro** vs **ServiceTitan** | Housecall Pro wins small teams on simplicity; ServiceTitan is deeper (dispatch board, memberships) but heavy. | Stay small-team simple: no dispatch board, no configuration that needs an admin to make the app usable. |
| **HubSpot** (2024 record layout) | Record = header highlights + middle tabs + right sidebar of associations. Users customise their sidebar cards; admins customise the default layout. | Record = head (status, phase rail, next step) + tabs + details rail. People arrange Overview sections and hide the rail; admins set team defaults. |
| **Pipedrive** | Rotting deals go red; the deal view centres on the next activity. | Health dot + "Needs you" built from overdue follow-ups, money to chase and stalled handoffs; the **next step** sits in the record head. |
| **Salesforce Lightning** | Per-user Comfy / Compact density (compact is ~30% denser); the admin only sets the org default. | Density is a personal preference; compact fits ~a third more rows; team defaults set the starting point. |
| **Attio** | Per-user favourites in the sidebar; configurable record pages. | **Pins** (records and views) in the rail and on Today. |
| **Linear** | "My issues" focus, display options per view, keyboard-first (`G` then a letter), ⌘K. | Mine/Team on Today and lists, a **Display** menu per list, `g`+key, `c` to create, `[` to collapse, `?` for help, ⌘K. |
| **Notion / ClickUp / Monday** | Views over the same data, layouts per person, side-peek of an item over a list. | **Peek**: the side panel that opens a record over a list, addressed by the URL. |

The recurring lesson: the best tools separate **what the team agrees on**
(data, statuses, defaults) from **how each person likes to work** (order,
density, what's visible, what's pinned) and persist the latter per person.

## 3. UX assessment of the parent branch

What was good and kept: the lifecycle and next-step logic, health, saved
views, the command palette, the phase filter on jobs, the notes timeline,
the money ledger, PWA and the public pages.

What was in the way:

1. **Navigation threw away context.** Opening a row navigated away from the
   list; going back reloaded and lost scroll and selection. A return-stack
   helper patched the symptom.
2. **Home was a report.** Several large, fixed panels (attention strip,
   action queue, workload table, context rail) of which a person could change
   nothing. The one thing a contractor needs at 7 a.m. — what is late, what
   is today, what money is waiting — was spread across them.
3. **Records were long scrolls.** A job page stacked every card (lifecycle,
   conversation, estimates, invoices, tasks, files, portal) vertically. The
   next step was in the middle of the page.
4. **Four list implementations.** Jobs, leads, tasks and invoices each had
   their own table/card component with their own row actions (inline assign
   menus, action dropdowns positioned by hand). No column choice, no sort
   memory, no bulk actions.
5. **Nothing was personal.** Theme and palette lived in localStorage per
   device. Sidebar collapse too. Nothing followed you to your phone.
6. **Create was scattered.** "New" buttons lived on each list; there was no
   way to make a task for *this* job without scrolling to the task card.
7. **Phones got the desktop layout squeezed,** with a bottom nav that did not
   match the sidebar and a header crowded with actions.

## 4. Design thesis: the Workbench

> One persistent workspace you shape yourself. Every record is a peek away;
> nothing makes you lose your place; the next step is always in view.

Principles that drove every decision:

- **Keep your place.** Lists stay put; records open beside them (peek). The
  URL is the state (`?peek=job:12`, `?tab=money`), so reload, back and shared
  links land in the same spot.
- **The next step leads.** A record head says where the work is (phase rail)
  and what to do next, with the button to do it.
- **Yours, then the team's.** Personal preferences on top of company
  defaults on top of product defaults. Nothing personal leaks to customers.
- **One way to do a thing.** One table, one menu, one Create, one toast with
  Undo.
- **Paper and ink.** A calm, warm-neutral visual identity with one accent,
  tabular numbers and density as a setting, so a dense working tool still
  reads like a ledger rather than a dashboard.

## 5. Design system ("Field Ledger")

`crm_frontend/src/app/workbench.css` (loaded after `globals.css`) plus the
retuned `rooftop` palette:

- **Colour.** Warm neutrals (light: paper `#f6f5f1`, surface `#efede7`,
  ink `#1b1a17`; dark: `#111110` / `#191917` / `#f2f1ec`) and one accent from
  the active palette. Status colour only where it carries meaning (late,
  past due, health).
- **Density tokens.** `--d-row`, `--d-control`, `--d-pad`, `--d-gap`,
  `--d-section`, `--d-text`, switched by `html[data-density="compact"]`.
  Every new component reads these, so one preference changes the whole app.
- **Motion.** Short (100–180 ms) transitions on panels; `html[data-motion="reduce"]`
  (the "Reduce motion" preference) and `prefers-reduced-motion` turn them off.
- **Type.** Tabular numerals (`.num`) for money and counts; eyebrow labels
  for sections; one title size per surface.
- **Components.** Rail, topbar, tab bar, sheet; menu (keyboard: arrows, Home,
  End, Esc); toast with action; pill / tag / health dot / phase rail / money
  strip; panel; tabs; table + cards; bulk bar; choice cards for settings.

## 6. Architecture

### Shell (frontend)

- `ShellGate` (in the root layout) wraps every authenticated route in
  `WorkspaceProvider` → `PeekProvider` → `AppShellFrame`. The shell is
  **persistent**: pages no longer render their own chrome; they declare it
  with `<AppShell title description right back>` and the frame renders it.
- `WorkspaceProvider` loads `/auth/me` and `/me/preferences` once, exposes
  `prefs` (effective, with product defaults filled in), `updatePrefs(patch)`
  (optimistic, debounced 350 ms, flushed on `pagehide`), `resetPrefs`,
  `saveAsDefaults`, pins, role. It applies density, motion, theme and palette
  to the document.
- `PeekProvider` reads `?peek=kind:id` with `useSyncExternalStore` and writes
  it with `history.replaceState`; `PeekLink` peeks on a plain click and
  follows the link on ⌘/Ctrl/middle click.
- `NavRail` (desktop), `MobileTabBar` + sheet (phones), `CreateMenu`,
  `NotificationsMenu`, `UserMenu`, `useGlobalShortcuts` + `ShortcutsDialog`.

### Records

- `record-layout.js`: `useUrlTab`, `Tabs` (arrow-key navigation, ARIA tabs),
  `useRecordSections` (per-person order/visibility of Overview sections and
  the rail, saved under `preferences.records[kind]`), `SectionArranger`,
  `RailPanel`.
- `record-bits.js`: `StatusPill`, `HealthDot`, `PhaseRail`, `MoneyStrip`,
  `QuickTasks` (inline complete with Undo, Enter-to-add), `QuickNotes`,
  `ContactLinks`, `DetailList`.
- Job record: head (status, health, days in status, client, owner, pin,
  edit, details toggle, phase rail, next step with its action) → tabs
  **Overview · Work · Money · Files · Activity** → rail **Client · Site ·
  Money · Dates · Customer portal**.
- Lead record: head (status, days, source, urgency, owner, contact, New job,
  pin, edit, more) → tabs **Overview · Jobs · Work · Files** → rail
  **Contact · Qualification · Work with us**.

### Lists

- `RecordTable` replaces the four list components. Per list: chosen columns,
  their order and the sort are saved under `preferences.lists[listKey]`.
  Row click peeks; ⌘-click opens a tab; keyboard: arrows, Enter, `x` to
  select; shift-click range selection; a bulk bar (assign, move status,
  complete) that runs one request per row through the normal endpoints and
  reports partial failures. Phones get cards — one layout in the DOM, chosen
  by `useMediaQuery`, not two copies hidden by CSS.

### Backend

- `sql/patch_phase24_workspace_preferences.sql`: `user_preferences`
  (one JSONB document per user, `ON DELETE CASCADE`) and
  `companies.workspace_defaults` (JSONB).
- `preferences.schemas.ts` (Zod, all objects `.strict()`): the closed lists of
  nav ids, widget ids, list keys and record keys; bounded arrays; pins must be
  same-origin paths (`/…`, not `//…`). 12 KB cap per document.
- `preferences.service.ts`: `applyPreferencesPatch` merges one level per
  section, replaces arrays, and treats `null` as "clear this section";
  `resolveEffective` overlays the user's document on the company defaults;
  stored documents are sanitised on read so an id removed in a later release
  cannot break anyone's workspace.
- Routes: `GET/PATCH/DELETE /me/preferences` (any signed-in user, own row
  only); `GET /company/workspace-defaults` (anyone), `PATCH` (owner/admin only).

## 7. Customization

What a person can change, where, and where it is stored:

| What | Where in the UI | Stored as |
|---|---|---|
| Theme (light / dark / auto) | Account menu, Preferences → Appearance | `appearance.theme` |
| Accent palette (or company default) | Preferences → Appearance | `appearance.palette` |
| Density (comfortable / compact) | Account menu, Preferences → Appearance | `appearance.density` |
| Reduce motion | Preferences → Appearance | `appearance.reduceMotion` |
| Sidebar order and hidden items | Preferences → Navigation | `nav.order`, `nav.hidden` |
| Sidebar collapsed | `[` key, rail toggle, Preferences | `nav.collapsed` |
| Pins (jobs, leads, tasks, invoices, estimates, views) | Pin on a record head or peek; manage in Preferences | `nav.pins` (max 20) |
| Today: which widgets, which column, what order | Today → Customize, Preferences → Today | `home.widgets` |
| List columns, order, sort | Display menu on each list | `lists.<jobs|leads|tasks|invoices>` |
| Record Overview sections and the details rail | Arrange menu / Details toggle on a record | `records.<job|lead>` |
| Team defaults (sidebar, Today, list layouts, theme + density) | Preferences → Workspace (owner/admin) | `companies.workspace_defaults` |
| Reset (one section or everything) | Reset buttons; Preferences → Reset all | `null` patch / `DELETE` |

Rules worth stating:

- **Precedence:** your setting → team default → product default, resolved per
  section, one level deep.
- **Never shared:** pins and the personal palette are not part of team
  defaults. Customer-facing pages always use the company palette.
- **Role-safe:** an agent cannot unlock admin destinations or admin widgets by
  preference; `resolveNav` and `resolveWidgets` filter by role after reading
  preferences, and the API refuses agents writing team defaults.

## 8. Implementation per repo

### crm_backend (1 commit)

- Phase 24 patch, schema.sql, test setup, npm script, apply script, README
  order list.
- Validators, service, routes, mounted in `app.ts` before `/company`.
- `test/preferences.integration.test.ts` (8 tests): merge rules, effective
  defaults, save/reload, partial patch, validation, 413 size cap, per-user
  privacy, company defaults + agent 403 + reset + cross-company isolation,
  401 without a session.

### crm_frontend

New: `app/workbench.css`, `app/settings/page.js`, `lib/preferences.js`,
`lib/use-media-query.js`, `components/workspace/*`, `components/peek/*`,
`components/records/*`, `components/shell/*` (nav rail, create, notifications,
user menu, shortcuts), `components/today/*` (widgets, customize),
`components/ui/menu.js`, `components/ui/record-table.js`,
`components/lists/columns.js`.

Rewritten: `components/app-shell.js` (persistent shell), `toast-provider.js`
(actions/Undo), `app/dashboard/page.js` (Today), `app/jobs/[id]/page.js`,
`app/leads/[id]/page.js`, the four list pages, `theme/themes/rooftop.js`.

Smaller: kanban card peeks; `tasks/new` accepts `?kind=appointment`;
`job-lifecycle.js` can hide its own next step (the record head shows it);
`customize-home.js` Done is optional; the Notifications page is titled
**Inbox** to match the nav; `/settings` is a protected route in `proxy.js`;
the command palette closes on Escape even before its input has focus.

Removed (no remaining importers): `dashboard/context-rail.js`,
`work-queue.js`, `action-queue.js`, `workload-table.js`, and
`lists/jobs-list.js`, `leads-list.js`, `tasks-list.js`, `invoices-list.js`.

### crm_qa

- `db/schema.ts` applies the phase 24 patch; `db/admin.ts` truncates
  `user_preferences` on reset.
- `tests/utils/nav.ts`: the tab bar is `nav[aria-label="Primary"]`; helpers
  for Create and the peek panel.
- `job-lifecycle.spec.ts`: money assertions open the **Money** tab (and assert
  the tab is in the URL); the end-to-end flow uses the next step's own
  "Bill deposit" button to get there.
- New `workbench.spec.ts` (8 tests, see §10).

## 9. Tradeoffs and decisions I would revisit

- **Preferences are one JSONB document, not normalised tables.** Simple,
  atomic, cheap to read once per session; the cost is that querying "who
  hid X" needs JSON operators. Zod and a size cap keep the document honest.
- **Debounced optimistic saves.** The UI never waits on the network; a
  failed save toasts and the next load restores the server's truth. A save
  in flight when the tab dies is flushed on `pagehide`, best effort.
- **Peek uses `replaceState`, not a route.** Opening five previews does not
  add five history entries; the trade is that Back closes the list page, not
  the preview. Escape and the close button close it.
- **Bulk actions are N requests,** not a bulk endpoint. Fine at small-team
  scale (tens of rows) and it reuses every permission check; partial
  failures are reported per run.
- **No drag-and-drop for layout.** Up/down buttons and menus are accessible
  by keyboard and on touch with no library; drag can be added later.
- **Legacy screens inherit, not redesigned.** Forms, estimate and invoice
  detail, reports, files, templates, automation and integrations sit inside
  the new shell and pick up the tokens, but keep their parent layouts.
- **Lint baseline.** `npm run lint` still reports one error and three
  warnings, all in files this branch did not touch (`theme-controller.js`
  set-state-in-effect, two exhaustive-deps warnings in login/accept-invite, an
  `<img>` warning in `company-mark.js`). Fixing the theme controller means
  changing how palette hydration works and belongs in its own change.

## 10. Verification

Commands, run on this branch on 2026-11-08 against Postgres.app on 5432:

| Check | Command | Result |
|---|---|---|
| Frontend lint (touched files) | `npx eslint <33 touched files>` | clean |
| Frontend lint (whole repo) | `npm run lint` (crm_frontend) | 1 error, 3 warnings — all in files unchanged from the parent |
| Undefined identifiers (touched files) | eslint with `no-undef` on all touched files | clean (caught and fixed a crash in the jobs list before commit) |
| Backend typecheck | `npx tsc --noEmit -p .` (crm_backend) | clean |
| Backend tests | `npx jest --runInBand` (crm_backend, `crm_test`) | 26 suites, 165 tests passed |
| QA pipeline | `npm run test:qa` (crm_qa: guard check → `crm_qa` setup → build → e2e on 3100/4100) | 264 tests: 238 passed, 26 skipped (desktop-only mutating and role tests on the other three viewports, plus 11 pre-existing skips), 0 failed |
| QA hygiene | `npm run qa:verify-hygiene` | passed: no QA secret in tracked files or artifacts |

What the QA suite now proves, at desktop 1440, laptop 1280, tablet 768 and
phone 390 unless noted:

- **Navigation:** the right chrome per width (rail with the person's nav, or
  tab bar + sheet); the Create menu lists Lead/Job/Task/Appointment/Estimate/
  Invoice and goes where it says; on a job it offers the job's own children.
- **Record workflows:** a list row peeks the record without leaving the
  list; the URL carries the preview and a reload restores it; Escape closes
  it; "Open full page" goes to the record; record tabs survive a reload; a
  job under a lead peeks from the lead; the full job lifecycle (client
  approval → deposit → production → final invoice → payment → closed)
  still runs end to end through the new record layout.
- **Customization persistence (desktop):** density, a hidden sidebar item and
  a pin survive a reload **and a brand-new browser context** (proving they
  come from the server, not localStorage); Reset all restores them; a hidden
  Today widget stays hidden; a removed list column stays removed and does not
  affect other lists.
- **Keyboard (desktop):** `c` opens Create, `g j` goes to Jobs, `?` opens help,
  ⌘K opens search, and shortcuts do not fire while typing.
- **Roles (desktop):** the seeded agent sees no Team/Automation/Templates, no
  Money or Team-load widgets and no Workspace settings; `PATCH
  /company/workspace-defaults` returns 403 for them; their own preferences do
  not change the owner's.
- **Responsive:** no horizontal overflow on the lead record and Preferences
  at every width, plus the existing route smoke checks.
- **Console:** the new specs and the existing smoke specs fail on any page
  error or console error.

Visual review: screenshots at 1440 and 390 of Today, Jobs, a job, a lead,
Tasks, Invoices, Inbox, Preferences, and the job and lead peeks, in light and
dark. Issues found that way and fixed: phone card titles running into their
subtitles, the jobs table overflowing at 1440, a duplicated Reset on
Preferences, overlapping Preferences tabs on phones.

## 11. Remaining work

- Redesign the screens that only inherited the new system: estimate and
  invoice detail (they deserve the same head + tabs + rail), the forms
  (they should open as sheets over the list, like peek), reports, files.
- A **Schedule** surface (week view of appointments by person) — the agenda
  widget is the start of it; Jobber and Housecall Pro both lead with it.
- Saved views as first-class pins with their own columns (today the pin
  stores the URL; columns are per list, not per view).
- Drag-and-drop for Today and the sidebar, on top of the button controls.
- A bulk endpoint if teams grow beyond a few dozen rows per action.
- Fix the pre-existing theme-controller lint error by moving palette
  hydration to `useSyncExternalStore`.
- Offline: the PWA shell caches, but preference changes made offline are
  lost; queue them.
