# 🚀 CRM Roadmap V2 — Job-Based Workflow System

## 🎯 Purpose

This roadmap evolves the CRM from a **lead/task tracker** into a **job-based workflow platform**, inspired by real-world usage patterns and tools like Roofr.

The goal is NOT to rebuild external platforms.

The goal is to:

* unify workflows
* reduce tool switching
* build a clean, extensible system
* maintain strong backend architecture and code quality

---

# 🧠 Guiding Principles

## 1. Build Around Workflow, Not Features

Users don’t think in tables—they think in:

* jobs
* follow-ups
* deals progressing

---

## 2. One Source of Truth = Job

Everything connects to:

* a job
* or becomes a job

---

## 3. Backend First, UI Second

* schema clarity > UI complexity
* relationships > features

---

## 4. Follow the Health Checklist ALWAYS

Reference:

* projectHealthChecklist.md

No shortcuts.

---

## 5. Extend, Don’t Rewrite

Current system is strong:

* leads
* tasks
* files
* auth
* notifications (in progress)

We evolve—not replace.

---

# 🧱 Phase 0 — Stability Check (MANDATORY)

Before adding anything:

### Backend

* Ensure service layer exists for:

  * leads
  * tasks
  * notifications

### Frontend

* Confirm:

  * consistent API usage
  * loading/error states exist

### System

* No broken flows:

  * lead CRUD
  * task CRUD
  * auth

---

# 🟢 Phase 1 — Introduce Jobs (CORE SHIFT)

## 🎯 Goal

Create a **central entity** that represents real-world workflow.

---

## Database

### New Table: `jobs`

```sql
jobs:
- id
- lead_id (nullable)
- created_by_user_id
- title
- address
- status
- job_value (nullable)
- created_at
- updated_at
```

---

## Relationships

* job → lead (optional)
* job → tasks (1 to many)
* job → files (1 to many)
* job → future: proposals, reports

---

## Backend

* create:

  * `jobs.routes.ts`
  * `jobs.service.ts`
  * `jobs.schemas.ts`

Follow:

* service layer rules
* Zod validation
* asyncHandler usage

---

## Frontend

* new page: `/jobs`
* basic list view first

---

## Success Criteria

* jobs can be created
* jobs can be viewed
* jobs link to leads

---

# 🟢 Phase 2 — Pipeline (Board View)

## 🎯 Goal

Replace task-centric thinking with workflow progression

---

## Job Statuses

```ts
[
  "New Lead",
  "Contacted",
  "Appointment Scheduled",
  "Proposal Sent",
  "Closed Won",
  "Closed Lost"
]
```

---

## Frontend

* board view (columns)
* job cards
* drag/drop (optional later)

---

## Backend

* update job status endpoint
* log status changes (future activity system)

---

## Success Criteria

* jobs move through stages visually
* reflects real workflow

---

# 🟢 Phase 3 — Job Details (Unified Workspace)

## 🎯 Goal

Everything about a job lives in ONE place

---

## Sections

* Overview
* Tasks (existing system reused)
* Files (existing system reused)
* Activity Log (NEW)

---

## Key Upgrade

Tasks are now:

* **owned by jobs**
* not floating independently

---

## Success Criteria

* user never leaves job page to manage workflow

---

# 🟡 Phase 4 — Activity Log (High Impact)

## 🎯 Goal

Make the system feel alive and traceable

---

## Track

* job created
* status changes
* task created/completed
* file uploaded

---

## Schema

```ts
activity_logs:
- id
- job_id
- actor_user_id
- action_type
- metadata (json)
- created_at
```

---

## Success Criteria

* visible timeline per job
* useful debugging + UX value

---

# 🟡 Phase 5 — Smart Task Integration

## 🎯 Goal

Tasks support workflow, not exist separately

---

## Changes

* require `job_id` on tasks
* optional fallback for legacy tasks

---

## Enhancements

* overdue affects job visibility
* upcoming tasks surface in dashboard

---

# 🟠 Phase 6 — Proposal System (Controlled Expansion)

## 🎯 Goal

Introduce real business value without overbuilding

---

## MVP

* create proposal
* attach to job
* track status:

  * draft
  * sent
  * accepted

---

## NOT building yet

* payments
* signatures
* automation-heavy flows

---

# 🟠 Phase 7 — File System Integration (Refinement)

Reference:

* crm_files_notifications_roadmap.md 

---

## Enhancement

* files strongly tied to jobs
* still allow global uploads

---

## UI

* files visible inside job page
* preview support

---

# 🟠 Phase 8 — Notification System (Completion)

## Goal

* in-app notifications
* email escalation

---

## Additions

* job-based notifications
* task reminders tied to jobs

---

# 🟠 Phase 9 — Dashboard Evolution

## Replace static dashboard with:

* jobs needing attention
* overdue tasks
* pipeline summary

---

# 🔴 Phase 10 — Advanced Workflow (Future)

ONLY after real usage:

* measurement integrations
* estimate generation
* material calculations
* invoicing

---

# 🧱 Backend Alignment (IMPORTANT)

Your current structure already supports this:

Reference:

* projectFolderTree.md 

---

## Additions

```
src/
├── jobs/
│   ├── jobs.routes.ts
│   ├── jobs.service.ts
│   ├── jobs.schemas.ts
│   └── jobs.types.ts
```

---

## Follow Existing Patterns

* integrations/ pattern stays
* lib/ stays
* middleware stays

---

# 🧠 Product Positioning

This app becomes:

❌ Not just a CRM
✅ A workflow system for real estate operations

---

# 🧭 What Makes This Different

You are NOT competing with Roofr.

You are:

* simplifying the workflow
* owning the full flow
* building flexibility

---

# 🏁 Definition of Success

The app is successful when:

* user can go from:

  * lead → job → tasks → files → proposal
    WITHOUT leaving the app

* system is:

  * predictable
  * extensible
  * cleanly structured

---

# 🔥 Immediate Next Steps

1. Create `jobs` table
2. Build `/jobs` page (list)
3. Link tasks → jobs
4. Add job status field
5. Display basic pipeline

---

# 🧠 Final Reminder

If something feels complex, ask:

> “Is this improving workflow or just adding features?”

Only build if the answer is:
👉 workflow

---
