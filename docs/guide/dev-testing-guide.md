# CRM Developer Testing Guide (v2)

Goal:
Validate full system behavior after a fresh database reset.
Focus on:
- Data integrity
- Relationships (lead ↔ task ↔ job ↔ files)
- UX consistency
- Edge cases
- New systems (activity, notifications, collapsing, limits)

---

# Phase 0 — Fresh Environment Validation

## Test 0.1 — Empty State Behavior

With a fresh DB:

Check:
- Dashboard
- Leads page
- Tasks page
- Jobs page

Expected:
- No crashes
- Clear empty states
- Visible CTAs (Create Lead, Create Task, etc.)

Feel check:
- Does the app guide a new user?
- Or feel empty/confusing?

---

# Phase A — Fresh Lead Intake

## Test A1 — Create a Lead

Create:
- Sarah Johnson
- sarah@example.com
- 555-111-2222
- Source: Referral
- Status: New
- Notes: Roof inspection inquiry

Expected:
- Saves successfully
- Appears in list
- Redirects to detail page
- Summary counts update

Feel check:
- Flow intuitive?
- Fields clear?
- Anything missing?

---

## Test A2 — Lead Detail Initial State

Expected:
- Info displays correctly
- “No tasks yet” message
- “No files yet” message
- Actions visible (edit, create task)

Feel check:
- Useful or too empty?
- Clear purpose?

---

# Phase B — Lead Task Workflow

## Test B1 — Create Task from Lead

Task:
- Call Sarah
- Confirm appointment
- Due tomorrow

Expected:
- Lead prefilled
- Appears:
  - Lead page
  - Tasks page
  - Task detail
- Correct linking

Feel check:
- Natural flow?
- Ownership clear?

---

## Test B2 — Edit Task

Expected:
- Ownership locked
- Fields prefilled
- Save works

Feel check:
- Feels safe?
- Clear constraints?

---

## Test B3 — Complete / Reopen Task

Expected:
- Status updates instantly
- Lead + Tasks page update
- Notifications trigger
- Activity logs update

Feel check:
- Fast and satisfying?
- Clear feedback?

---

# Phase C — Lead Files

## Test C1 — Upload File

Expected:
- File appears immediately
- Preview works (if supported)
- Delete works

Feel check:
- Clearly tied to lead?
- UI consistent?

---

## Test C2 — File Visibility in Task

Expected:
- Shows in task “Related Files”
- Preview/open works

Feel check:
- Intuitive relationship?

---

# Phase D — Job Workflow

## Test D1 — Create Job

Create:
- Roof inspection for Sarah
- Address
- Description

Expected:
- Saves correctly
- Pipeline visible
- Detail page loads

Feel check:
- Distinct from lead?
- Workspace vs record?

---

## Test D2 — Job Task Creation

Expected:
- Appears everywhere
- Linked to job (not lead)
- Ownership locked on edit

Feel check:
- Feels like real “work layer”?

---

## Test D3 — Job File Upload

Expected:
- Appears correctly
- Shows in job + related task

Feel check:
- Properly attached?

---

# Phase E — Activity Timeline (NEW)

## Test E1 — Activity Generation

Trigger:
- Create task
- Complete task
- Upload file
- Update job status

Expected:
- Activity appears
- Correct type labels/icons

---

## Test E2 — Activity Grouping

Expected:
- Today
- Yesterday
- Last 7 Days
- Last 30 Days

---

## Test E3 — Collapsing Behavior

Expected:
- Limited items per group
- "Show more" expands
- "Show fewer" collapses

---

## Test E4 — Navigation

Expected:
- Clicking activity routes correctly
  - task → task page
  - job → job page
  - file → job/files

Feel check:
- Helpful or noisy?
- Easy to scan?

---

# Phase F — Notifications (NEW)

## Test F1 — Task Creation

Expected:
- Notification appears

## Test F2 — Task Completion

Expected:
- Notification triggered
- No duplicates

## Test F3 — Job Status Change

Expected:
- Notification triggered

Feel check:
- Useful or spammy?

---

# Phase G — Global Tasks Page

## Test G1 — Mixed Task View

Expected:
- Lead + Job tasks visible
- Linked To correct
- Dates + status correct

Feel check:
- Clear ownership?
- Overwhelming?

---

## Test G2 — Task Limiting (NEW)

Expected:
- Only subset shown initially
- Toggle works
- No layout issues

Feel check:
- Reduces clutter?
- Or hides too much?

---

# Phase H — Task Detail Deep Check

## Lead Task

Expected:
- Lead snapshot
- Related files
- Edit works
- Status toggles

## Job Task

Expected:
- Job snapshot
- Related files
- Navigation works

Important:
- “View related job” must work

Feel check:
- Balanced layout?
- Context clear?

---

# Phase I — Lead & Job After Activity

## Test I1 — Lead Page After Job Exists

Expected:
- Still focused
- No job bleed
- Tasks/files intact

Feel check:
- Still a “contact layer”?

---

## Test I2 — Job Page Revisit

Expected:
- Tasks intact
- Files intact
- Pipeline works
- Activity accurate

Feel check:
- Feels like main workspace?

---

# Phase J — Edge Cases

## J1 — Task with no due date
Expected: graceful display

## J2 — Task with no description
Expected: fallback text

## J3 — Unsupported file
Expected:
- “Open” instead of preview
- No broken modal

## J4 — Delete file
Expected:
- Removed everywhere
- Activity updates

## J5 — Delete task
Expected:
- Removed from all views
- No orphan UI

## J6 — Delete lead
Expected:
- Tasks cascade
- Files handled properly
- No errors

## J7 — Delete job (if implemented later)
Expected:
- No orphan data
- Clean UI

---

# Phase K — System Integrity

## Test K1 — Relationships

Verify:
- Lead → tasks
- Job → tasks
- Files → correct entity
- No cross-contamination

---

## Test K2 — Activity Integrity

Expected:
- No broken links
- No duplicate entries
- Accurate history

---

# Final Evaluation

## I1 — Does the system feel cohesive end-to-end?

## I2 — Strongest area?
- Leads
- Jobs
- Tasks
- Activity
- Files

## I3 — Weakest area?

## I4 — Activity system:
- Helpful or noise?

## I5 — Does the app guide behavior or require thinking?

## I6 — Where would bugs most likely appear?

## I7 — Anything “technically correct but product wrong”?

---

# Goal

By the end of this:
- System should feel connected
- Data should flow cleanly
- UX should feel intentional
- No confusion between lead vs job vs task