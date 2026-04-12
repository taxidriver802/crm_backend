# 🧠 CRM Deep Session Context — Alignment Layer (Phase 6 Ready)

---

## 📌 PURPOSE

This file **extends the base session context**.

It captures:
- Decision philosophy
- Architectural patterns
- UX/system consistency rules
- “How we think” while building

This is NOT a replacement for the original context — it is a **precision layer** to prevent drift.

---


## 🧭 DEVELOPMENT PHILOSOPHY

### 1. Backend First (Always)

All features follow this order:

1. Database schema
2. Service layer logic
3. Routes
4. Tests (integration)
5. Frontend UI

🚫 Never build UI first and “figure out backend later”

---

### 2. Systems > Features

We are not building isolated features.

We are building:
- reusable systems
- consistent patterns
- scalable architecture

Every feature must:
- plug into existing systems (activity, notifications, etc.)
- avoid creating parallel logic

---

### 3. Single Source of Truth

No duplication of logic across:
- pages
- components
- services

If logic appears twice → extract it.

---

### 4. Event-Driven Thinking

System actions generate events:
- job updated
- task completed
- estimate created

Frontend renders structured events — it does not invent them.

---

## 🧱 FRONTEND RULES

- Shared components first
- UI consistency over customization
- Pages orchestrate, components render
- Always handle loading / empty / error states

---

## 🔁 ACTIVITY SYSTEM

- Centralized formatter + component
- Backend defines meaning
- Frontend displays only

Scaling:
- backend limits (50)
- frontend groups + collapses
- optional “load older”

---

## 💰 ESTIMATES SYSTEM

- Estimate = parent
- Line items = source of truth
- Backend owns totals

Activity must include:
- ESTIMATE_CREATED
- ESTIMATE_UPDATED
- ESTIMATE_STATUS_CHANGED

---

## ⚠️ PITFALLS

- UI-driven logic ❌
- duplicated formatting ❌
- over-fetching ❌
- silent drift ❌

---

## 🧪 TESTING

- Integration tests required
- Validate ownership + relationships + side effects

---

## 🤝 ASSISTANT STYLE

- Direct, honest, architectural
- Provide code + placement + reasoning
- Favor long-term structure

---

## 🏁 CURRENT STATE

- Modular ✅
- Consistent ✅
- Event-driven ✅

➡️ Ready for expansion

---

## 🚀 NEXT

1. Estimate lifecycle
2. UI refinement
3. Activity expansion
4. Dashboard improvements

---

## 🧩 FINAL

Cohesion > speed
