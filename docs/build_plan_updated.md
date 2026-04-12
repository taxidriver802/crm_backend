# 🚀 CRM Build Plan — Unified System (v4)

---

## 🎯 Current State (Verified)

- [x] Leads CRUD
- [x] Tasks CRUD
- [x] Jobs CRUD
- [x] Files system (global + attached)
- [x] User invites + roles
- [x] Notifications (refined)
- [x] Activity timeline on jobs
- [x] Routing between entities working
- [x] Backend integration test suite established
- [x] Estimate data model + API foundation started

---

# 🧭 Core Product Model (LOCK THIS IN)

## Entities

### Leads (Contacts / Opportunities)
- Who the customer is
- Initial communication + qualification
- Can exist without a job

### Jobs (Workspaces)
- Where actual work happens
- Represents real-world execution
- Central hub for workflow

### Tasks (Units of Work)
- Actionable items
- Can belong to:
  - Lead (early stage)
  - Job (execution stage)

### Files (Documents / Assets)
- Can belong to:
  - Lead
  - Job
  - Global

### Estimates (Pricing / Scope)
- Belong to a Job
- Contain one or more line items
- Move through estimate status workflow

---

## Relationships

- [x] Lead → many Jobs
- [x] Job → many Tasks
- [x] Job → many Files
- [x] Lead → optional Tasks
- [x] Lead → optional Files
- [x] Job → many Estimates
- [x] Estimate → many Line Items

---

## Behavioral Rules (IMPORTANT)

> Tasks start on Leads → migrate to Jobs as work begins

> Estimates belong to Jobs, not Leads

> Totals are recalculated on the backend, not trusted from the frontend

---

# 🧱 Phase 0 — Foundation (COMPLETE) ✅

- [x] Task system stabilized
- [x] File system unified
- [x] API/service consistency verified
- [x] UI inconsistencies resolved

---

# 🧱 Phase 1 — Data Model Formalization (COMPLETE) ✅

## 🎯 Goal
Make system meaning explicit and consistent

---

## 🔧 Backend

- [x] Confirm DB relationships reflect model
- [x] Ensure task supports:
  - [x] lead_id OR job_id (not neither)
- [x] Prevent both unless intentional
- [x] Normalize task response:
  - [x] includes lead context
  - [x] includes job context

---

## 🎨 Frontend

- [x] Replace “Lead” column with “Linked To”
- [x] Display:
  - [x] Lead name (if exists)
  - [x] Job name (if exists)
- [x] Standardize labels:
  - [x] “Related Lead”
  - [x] “Related Job”
  - [x] “Linked To”

---

## ✅ Done When

- [x] No ambiguity in ownership
- [x] UI matches mental model
- [x] No lead-only assumptions remain

---

# 🧱 Phase 2 — Task System (Context-Aware UX) (COMPLETE) ✅

## 🎯 Goal
Tasks always feel connected and intentional

---

## 📋 Task List Page

- [x] Show “Linked To” instead of just Lead
- [x] Display:
  - [x] Lead (if exists)
  - [x] Job (if exists)
- [x] Filters:
  - [x] Status
  - [x] Lead vs Job
  - [x] Overdue / Upcoming

---

## 🔍 Task Detail Page

- [x] Show:
  - [x] Related Lead
  - [x] Related Job
- [x] Ensure navigation between entities works

---

## ✍️ Task Creation / Editing

- [x] Detect entry context:
  - [x] From lead page
  - [x] From job page
  - [x] From global page
- [x] Pre-fill relationships correctly
- [NA] Allow reassignment

---

## ✅ Done When

- [x] No task appears “orphaned”
- [x] Task context always visible
- [x] UX feels unified

---

# 🧱 Phase 3 — Jobs as Workspaces (COMPLETE) ✅

## 🎯 Goal
Jobs become the center of execution

---

## 🧩 Job Detail Page

- [x] Display clearly:
  - [x] Linked Lead
  - [x] Status / pipeline
  - [x] Created date
- [x] Improve layout clarity
- [x] Task and activity sections support progressive disclosure

---

## 🔄 Workflow

- [x] Confirm status transitions work cleanly
- [x] Ensure tasks/files fully integrated

---

## ➕ Creation Flow

- [x] Add “Create Job from Lead” (optional)
- [x] Ensure job creation supports expansion

---

## 🔮 Extensibility Prep

- [x] Leave space/components for:
  - [x] Activity
  - [x] Estimates
  - [x] Proposals slot *(deferred product — see [Catalog of deferred work](#catalog-of-deferred-work))*

---

## ✅ Done When

- [x] Job page feels like a workspace
- [x] Work can be managed from job view

---

# 🧱 Phase 4 — Activity Log (COMPLETE) ✅

## 🎯 Goal
Add visibility and trust

---

## ⚙️ Backend

- [x] Create job activity table/service
- [x] Store metadata JSON

---

## 📌 Events to Track

- [x] Job created
- [x] Job status updated
- [x] Task created
- [x] Task completed/reopened
- [x] Task due date updated
- [x] Task deleted
- [x] File uploaded
- [x] File deleted

---

## 🖥 UI

- [x] Add activity section to job page
- [x] Render grouped timeline
- [x] Add activity CTA labels
- [x] Limit long activity sections by group with show more/show fewer

---

## ✅ Done When

- [x] Job shows recent activity
- [x] Events are clear and useful
- [x] Timeline is readable as jobs grow

---

# 🧱 Phase 5 — Notifications (COMPLETE) ✅

## 🎯 Goal
Make notifications actionable

---

## 🔔 UI

- [x] Improve notification panel
- [x] Add:
  - [x] Mark as read
  - [x] Mark all read
  - [x] Clear read notifications
- [x] Improve CTA wording
- [x] Reduce toast spam while panel is open

---

## 🔗 Behavior

- [x] Notifications link to:
  - [x] Task
  - [x] Job
  - [x] Lead
  - [x] Files page / file context where applicable

---

## ✏️ Content

- [x] Improve wording (actionable)
- [x] Add richer metadata/context
- [x] Differentiate due soon vs overdue correctly
- [x] Add file upload notification support

---

## ✅ Done When

- [x] Notifications drive action
- [x] Navigation works from notification
- [x] Notifications reflect actual entity context

---

# 🧱 Phase 5.5 — Quality & Test Foundation (COMPLETE) ✅

## 🎯 Goal
Protect workflow changes with confidence

---

## 🧪 Backend Integration Tests

- [x] Jest + ts-jest configured cleanly
- [x] Dedicated test env + test DB in use
- [x] DB reset helper updated for current schema
- [x] Integration tests added for:
  - [x] Auth/dashboard smoke flow
  - [x] Tasks
  - [x] Jobs
  - [x] Files
  - [x] Notifications
  - [x] Estimates foundation
- [x] Test harness exits cleanly

---

## ✅ Done When

- [x] Full suite passes consistently
- [x] New backend work can be refactored safely

---

# 🧱 Phase 6 — Dashboard Evolution

## 🎯 Goal
Reflect real workflow

---

## 📊 Updates

- [x] Add job-focused summary cards
- [x] Show:
  - [x] Jobs by status
  - [x] Overdue tasks tied to jobs (overdue count + `overdue_on_jobs` on dashboard; `GET /tasks?duePreset=overdue&linkedTo=job`)
  - [x] Estimate summary signals
- [x] Improve task widgets (context-aware)

---

## 🧪 Optional

- [x] Add recent activity preview

---

## ✅ Done When

- [x] Dashboard reflects real workflow

---

# 🧱 Phase 7 — Team Management (from context.md)

## 🎯 Goal
Polish admin experience

---

## 👥 Users / Invites

- [x] Resend invite *(UUID lookup fixed; integration tests in `crm-backend/test/users.integration.test.ts`)*
- [x] Show invite status
- [x] Show invited / accepted dates *(Invited, Accepted/password set, Last login columns)*
- [x] Copy invite link *(clipboard via `POST /users/invite/:id/resend` — refreshes token)*
- [x] Revoke invite *( `POST /users/invite/:id/revoke` )*

---

## 🎛 Controls

- [x] Role-aware UI *(admins cannot edit owner rows; Owner role option remains owner-only)*
- [x] Hide invalid actions *(owner rows locked for non-owner admins)*
- [x] Improve disabled messaging *(helper text for admins; tooltips on locked controls)*

---

## 🔎 Filters

- [x] Search (name/email)
- [x] Filter by role
- [x] Filter by status

---

## 📜 Audit

- [ ] Admin activity log *(deferred — see [Catalog of deferred work](#catalog-of-deferred-work) · Phase 7)*

---

## ✅ Done When

- [x] Admin experience feels complete *(team invite lifecycle + permission-aware UI; audit trail deferred)*

---

# 🧱 Phase 8 — Estimates System

## 🎯 Goal
Turn jobs into pricing + proposal-ready workspaces

---

## ⚙️ Backend Foundation

- [x] Add `estimates` table
- [x] Add `estimate_line_items` table
- [x] Add estimate routes/service foundation
- [x] Add estimate integration tests
- [x] Recalculate totals on backend

---

## 📌 Core Estimate Features

- [x] Create estimate for a job
- [x] List estimates by job
- [x] Add estimate line item
- [x] Update estimate line item
- [x] Get estimate detail with line items
- [x] Delete estimate from UI flow *(edit page — `DELETE`)*
- [x] Update estimate status from UI *(edit estimate form)*
- [x] Edit estimate notes/title from UI *(edit estimate form)*

---

## 🖥 Frontend

- [x] Add estimates section to job page
- [x] Add new estimate flow from job context
- [x] Add estimate detail/editor page
- [x] Show totals summary
- [x] Show estimate status chips/actions

---

## 🔗 Workflow Integration

- [x] Activity: estimate created *(backend `job_activity`)*
- [x] Activity: estimate status changed *(backend `job_activity`)*
- [x] Optional notification hooks for estimate milestones *(in-app notifications — see implementation)*

---

## ✅ Done When

- [x] Job can meaningfully move from work tracking to pricing
- [x] Estimate editing feels native to the CRM

---

# 🧱 Phase 9 — Future Expansion (chunked)

Work **one sub-phase at a time**; check off only the chunk that ships. Default order follows realtor workflow: **share → client decision → supporting data → integrations**.

---

## 9.1 — PDF / export / shareable estimate

**Outcome:** Agent can generate a client-ready PDF and a time-limited share link from an estimate on a job.

**MVP:** PDF download (authenticated); rotate share token + expiry; public view-only page by token; optional copy link from CRM.

- [x] **9.1 complete** *(deferred scope: [9.1 in catalog](#catalog-of-deferred-work))*

---

## 9.2 — Customer approval / acceptance

**Outcome:** Client can record accept / reject / request revision from the shared view; CRM shows response time and note.

**MVP:** Public POST by token updates estimate status + `client_responded_at` / `client_response_note`; agents see status on estimate detail.

- [x] **9.2 complete** *(deferred scope: [9.2 in catalog](#catalog-of-deferred-work))*

---

## 9.3 — Proposals (product scope)

**Decision:** Treat **estimate PDF + narrative notes** as the proposal artifact for MVP; a separate “proposal” product is deferred until distinct from 9.1.

- [x] **9.3 documented** *(scope clarified — no separate proposal UI required for MVP; product deferrals: [9.3 in catalog](#catalog-of-deferred-work))*

---

## 9.4 — Measurement system

**Outcome:** Structured measurements stored on the job for pricing context.

**MVP:** Manual rows (label, value, unit); list and edit on job detail.

- [x] **9.4 complete** *(deferred scope: [9.4 in catalog](#catalog-of-deferred-work))*

---

## 9.5 — ABC pricing / data integration

**Outcome:** One concrete pricing lookup path from configured ABC credentials.

**MVP:** Authenticated endpoint that returns a sample or health-adjacent pricing payload when ABC is configured.

- [x] **9.5 complete** *(deferred scope: [9.5 in catalog](#catalog-of-deferred-work))*

---

# 📦 Catalog of deferred work

Single reference for scope that was **explicitly postponed**. Tags show where the idea originated. This list does not block shipped work.

| Source | Deferred item | Notes |
|--------|----------------|--------|
| **Phase 3** | Dedicated **Proposals** UI block on job page | Superseded in practice by **estimates + PDF** (Phases 8–9); a separate proposal product is optional. |
| **Phase 7** | **Admin activity log** | Persistent audit trail (`admin_audit_log` or equivalent) + UI for invite/role changes; needs schema + retention policy. |
| **9.1** | Full **branding studio** for PDFs | Custom themes / white-label PDF output. |
| **9.1** | **E-sign** inside PDF | In-PDF signing; not part of MVP PDF flow. |
| **9.2** | **Legally binding** e-sign | Distinct from informal client response on shared page. |
| **9.2** | **Payment capture** at acceptance | Charging card or deposit at “accept.” |
| **9.3** | Standalone **proposal builder** | Narrative/cover/terms beyond estimate PDF + notes. |
| **9.3** | **Template marketplace** | Third-party or shared proposal templates. |
| **9.4** | **Device / API** measurement integrations | Import from tools or APIs. |
| **9.4** | **Aerial** imports | Measurements from imagery providers. |
| **9.5** | Full ABC **catalog sync** | Ongoing supplier catalog mirror. |
| **9.5** | **Bi-directional orders** | Full order automation with ABC (beyond MVP sample lookup). |

### Cross-cutting (not tied to one phase)

- **Observability** — Structured logging, metrics, centralized error tracking (typical production hardening).
- **Rules → Don’t** — Ongoing discipline (see **Rules While Building** below), not a backlog ticket.

---

# 🧠 Rules While Building

## ✅ Do

- [x] Use service layer (no DB in routes)
- [x] Keep relationships explicit
- [x] Reuse components
- [x] Build for workflow (not features)
- [x] Protect backend with integration tests

## ❌ Don’t

- [ ] Overbuild early
- [ ] Duplicate logic
- [ ] Assume relationships
- [ ] Trust frontend totals for money math

---

# 🏁 Definition of Success

- [x] System is predictable
- [x] System is flexible
- [x] Workflow feels natural
- [x] Easy to extend
- [x] Backend changes are testable and safer

---

# 📍 Progress Tracker

- [x] Phase 0
- [x] Phase 1
- [x] Phase 2
- [x] Phase 3
- [x] Phase 4
- [x] Phase 5
- [x] Phase 5.5
- [x] Phase 6
- [x] Phase 7
- [X] Phase 8
- [x] Phase 9 *(see 9.1–9.5 above)*

---

# 📝 Notes / Decisions Log

- Jobs are now the primary workspace layer and are created in context from leads.
- Tasks may still exist on leads for early-stage work, but job-based tasks are the preferred execution flow.
- Files support global, lead-attached, and job-attached visibility in the main library and in contextual views.
- Notifications were refined into context-aware workflow prompts rather than generic alerts.
- Job activity is now grouped and progressively disclosed to avoid long-page sprawl.
- A dedicated integration test suite now protects the backend workflow foundation.
- Estimates belong to jobs and line-item totals are calculated on the backend.
- Dashboard task stats align with `/tasks` via `duePreset` (overdue, due_today, next_7_days); task summary includes `overdue_on_jobs`.
- Phase 7 team management: resend/revoke/copy-link routes are live; admin audit log remains in the **Catalog of deferred work** (Phase 7).
