# CRM Roadmap v2 — FINAL (Workflow + Files + Notifications + Measurement + Estimation)

---

## Purpose

This roadmap reflects the CRM evolving into a:

> Task-first workflow system with document handling, notifications, and future estimation capabilities.

---

## New Key Insight (From Realtor)

> "Measure house from images → generate estimate → use ABC pricing"

### Translation

User wants:
1. Measurement (image-based)
2. Area calculation
3. Material estimation
4. Pricing integration (ABC)

---

## Updated Product Direction

The system is evolving into:

> Workflow + Documents + Notifications + Estimation

---

# Updated Phases

---

## Phase 0 — Architecture Tightening
(Same as before)

---

## Phase 1 — Workflow Foundation
(Same as before)

---

## Phase 2 — Files Backend
(Same as before)

---

## Phase 3 — Notifications Backend
(Same as before)

---

## Phase 4 — Activity Log
(Same as before)

---

## Phase 5 — Files Frontend
(Same as before)

---

## Phase 6 — Notifications Frontend
(Same as before)

---

## Phase 7 — Light Transaction Support
(Same as before)

---

## Phase 8 — UX Polish
(Same as before)

---

## Phase 9 — Measurement + Estimation System

### Goal

Replicate simplified Roofr-style workflow:

> Image → Measure → Estimate → Attach to Lead

---

### Step 1 — Measurement (MVP)

#### Approach
- Upload image
- Draw polygon (canvas)
- Calculate area
- Apply pitch multiplier

---

### Backend

Table: measurements

- id
- lead_id
- image_url
- polygon_data (JSON)
- area
- pitch
- adjusted_area
- created_at

---

### Step 2 — Material Estimation

Use simple formulas:

- shingles = area / coverage_rate
- waste factor (e.g. +10%)

Store:

- material_type
- estimated_quantity

---

### Step 3 — Pricing (ABC Integration - Later)

DO NOT build full integration yet.

Prepare structure:

- material_id
- price_per_unit
- total_cost

Later:
- plug into ABC API

---

### Step 4 — Estimate Output

Generate:

- summary of materials
- total cost
- export as PDF (future)
- attach to lead (via files system)

---

## Integration Points

### Leads
- measurements linked to leads

### Files
- store generated estimate documents

### Notifications
- notify when estimate created

---

## Important Constraints

- Start manual (no AI)
- No OpenCV initially
- No auto detection
- No full pricing engine
- Keep logic simple + accurate

---

## Updated Priority

1. Architecture tightening
2. Files backend
3. Notifications backend
4. Files frontend
5. Notifications frontend
6. Measurement MVP (manual)
7. Estimation logic
8. Pricing integration (later)
9. UX polish

---

## Definition of Success

System allows:

- tracking leads/tasks
- storing documents
- managing workflow
- generating basic estimates from images

WITHOUT:

- overengineering
- unnecessary complexity