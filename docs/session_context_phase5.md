# 🧠 CRM Session Context — Phase 5 → 6 Transition

---

## 📌 PROJECT
CRM Realtor App (Next.js + Express + PostgreSQL)

---

## 🎯 CURRENT GOAL

Phase 5A: Estimates System (Job → Estimate → Line Items)

- Backend: ✅ COMPLETE
- Integration tests: ✅ COMPLETE
- Next: calculation refinement + UI

---

## 🧱 CURRENT SYSTEM STATE

### ✅ Completed Systems

- Leads (CRUD)
- Tasks (lead + job ownership enforced)
- Jobs (workspace model)
- Files (lead/job/global)
- Notifications (entity-aware, actionable)
- Activity Log (job timeline)
- Integration Tests (Jest + test DB)

---

## 🔑 KEY DECISIONS

### 1. Jobs = Primary Workspace
All execution happens in jobs. Leads are pre-work.

---

### 2. Task Ownership Rule
```bash
lead_id XOR job_id
```

---

### 3. Files System
- Attach to: job, lead, or global
- Tasks inherit via job/lead
- No direct task attachment

---

### 4. Notifications
- Must link to entity
- Types include: task, lead, job, invite
- Messages are contextual

---

### 5. Activity Log
- Stored in `job_activity`
- Powers job timeline

---

### 6. Testing Standard
- Jest + `crm_test` DB
- Schema rebuilt per run
- Integration tests required for new features

---

### 7. Backend Pattern
- Routes = thin
- Services = logic
- DB only in services

---

## ⚠️ IMPORTANT CONTEXT

### Schema
- Source of truth:
```bash
/sql/schema.sql
```

---

### DB
- PostgreSQL
- Money = NUMERIC (not float)

---

### Env
`.env.test` includes:
- DATABASE_URL=crm_test
- JWT_SECRET=test_secret

SMTP not required (warnings OK)

---

### Jest Stability
- Pool cleanup handled
- No more open handle issues

---

## 🔧 RECENT CHANGES

- Fixed corrupted schema.sql (duplicate tail)
- Stabilized Jest + teardown
- Added job support to notifications
- Dynamic file upload messages
- Collapsible UI sections (tasks/activity)
- Built estimates backend
- Added full integration tests

---

## 📦 ESTIMATES SYSTEM (IMPLEMENTED)

### Tables
- estimates
- estimate_line_items

---

### Routes
```bash
POST /estimates
GET /estimates/job/:jobId
GET /estimates/:id
POST /estimates/:id/line-items
PATCH /estimates/:id/line-items/:lineItemId
```

---

### Tests
- Creation
- Ownership validation
- Line item updates
- Totals recalculation

✅ All passing

---

## 🚧 NEXT STEPS

1. Finalize calculation logic
2. Build estimate UI
3. Expand dashboard (Phase 6)
4. Add estimate activity events

---

## 🏁 CURRENT POSITION

System is:
- Stable ✅
- Tested ✅
- Architecturally clean ✅

Now entering:
➡️ Feature expansion (Estimates UI)