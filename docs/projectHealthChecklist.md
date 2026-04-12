# 🧠 CRM Project Health Checklist

## 🎯 Goal

Ensure the CRM is **clean, consistent, maintainable, and production-aware** — not just “working.”

---

# 🧱 1. Backend Health

## 1.1 Route Consistency

* [ ] Every route uses `asyncHandler`
* [ ] No business logic inside routes (routes only orchestrate)
* [ ] All routes return consistent response shape:

  * `{ data, error }` or `{ success, data }`
* [ ] Proper HTTP status codes used (200, 201, 400, 401, 404, 500)

---

## 1.2 Service Layer (IMPORTANT)

* [ ] Each domain has a service layer:

  * `leads.service.ts`
  * `tasks.service.ts`
  * `notifications.service.ts`
* [ ] Routes call services — NOT database directly
* [ ] Services contain business logic only (no Express req/res)

---

## 1.3 Validation & Schemas

* [ ] Every POST/PATCH route uses Zod validation
* [ ] Validation schemas live in `/validators`
* [ ] No duplicate validation logic across files
* [ ] Clear error messages returned to client

---

## 1.4 Database Access

* [ ] All queries are centralized (not scattered randomly)
* [ ] No raw SQL duplication across routes
* [ ] Consistent naming:

  * `getLeads`
  * `updateTask`
  * `createUser`
* [ ] Safe handling of null/undefined results

---

## 1.5 Middleware

* [ ] Auth middleware applied to all protected routes
* [ ] Error middleware handles all thrown errors
* [ ] No try/catch duplication in every route

---

## 1.6 Utilities & Structure

* [ ] `utils/` only contains pure helper functions
* [ ] No overlap between `utils/`, `lib/`, and services
* [ ] Shared logic is reused (not rewritten)

---

## 1.7 Notifications System

* [ ] Jobs (cron/manual triggers) are isolated in `/jobs`
* [ ] Notification logic is reusable (not tied to one route)
* [ ] Clear separation:

  * trigger → service → delivery (email/in-app)

---

## 1.8 Integrations (ABC, etc.)

* [ ] Each integration follows structure:

  * client → service → mapper → schema
* [ ] No direct external API calls inside routes
* [ ] Errors from integrations are handled gracefully

---

## 1.9 File Uploads

* [ ] Upload logic is isolated (not inside routes)
* [ ] Files can be linked to leads cleanly
* [ ] No hardcoded file paths
* [ ] Future-ready (can swap to cloud storage)

---

## 1.10 Environment & Config

* [ ] All env variables validated on startup
* [ ] No hardcoded secrets
* [ ] Dev vs prod behavior clearly separated

---

# 🎨 2. Frontend Health

## 2.1 Page Consistency

* [ ] Every page has:

  * loading state
  * empty state
  * error state
* [ ] Layout is consistent across pages (AppShell)

---

## 2.2 Data Fetching

* [ ] All API calls go through `lib/api.js`
* [ ] No raw `fetch` scattered across components
* [ ] Errors are caught and displayed cleanly

---

## 2.3 Reusability

* [ ] Repeated logic extracted into hooks:

  * `useLeads`
  * `useTasks`
* [ ] Shared UI patterns reused (cards, lists, tables)

---

## 2.4 Component Structure

* [ ] Components are small and focused
* [ ] No massive “god components”
* [ ] UI vs logic separation is clear

---

## 2.5 Navigation & UX

* [ ] Navbar works on all screen sizes
* [ ] Mobile dropdown behaves correctly
* [ ] Navigation matches backend routes logically

---

## 2.6 Forms

* [ ] All forms have:

  * validation
  * loading state
  * error feedback
* [ ] No duplicated form logic across pages

---

## 2.7 Notifications UI (Planned Feature)

* [ ] Notification bell in navbar
* [ ] Modal or panel displays notifications
* [ ] Read/unread state handled
* [ ] Matches backend notification system

---

## 2.8 File System UI

* [ ] Files can be:

  * viewed globally
  * attached to leads
* [ ] Clicking file routes correctly
* [ ] Lead page shows attached files

---

# 🔗 3. Full System Flow

## 3.1 Lead Lifecycle

* [ ] Create → View → Edit → Delete works smoothly
* [ ] Status transitions make sense
* [ ] No broken states

---

## 3.2 Task Flow

* [ ] Tasks correctly link to leads
* [ ] Due dates display properly
* [ ] Overdue / upcoming logic works

---

## 3.3 Auth Flow

* [ ] Login sets cookie correctly
* [ ] Protected routes block unauthorized users
* [ ] Logout clears session cleanly

---

## 3.4 Invite System

* [ ] Invite email works (correct URL)
* [ ] Accept flow creates account properly
* [ ] Roles assigned correctly

---

## 3.5 Notifications Flow

* [ ] Task triggers notification
* [ ] Notification stored + retrievable
* [ ] UI reflects backend state

---

# 🧹 4. Code Quality

## 4.1 Naming

* [ ] Consistent naming across frontend + backend
* [ ] No confusing abbreviations

---

## 4.2 Duplication Check

* [ ] No duplicated API logic
* [ ] No duplicated helper functions
* [ ] Shared logic extracted

---

## 4.3 File Organization

* [ ] Files live in correct domain
* [ ] No “random” files in root folders
* [ ] Folder names reflect purpose

---

## 4.4 Readability

* [ ] Functions are small and clear
* [ ] No overly complex blocks
* [ ] Comments explain “why”, not “what”

---

# 🚀 5. Production Readiness (Optional but 🔥)

## 5.1 Logging

* [ ] Errors logged (not just console.log)
* [ ] Important actions tracked

---

## 5.2 Deployment Awareness

* [ ] Works with env-based URLs (no localhost hardcoding)
* [ ] Backend + frontend can run independently

---

## 5.3 Performance (Light Pass)

* [ ] No unnecessary re-renders
* [ ] API calls are not duplicated
* [ ] Large lists are handled reasonably

---

# 🧠 Final Check

## Ask yourself:

* [ ] Could another developer understand this in 10 minutes?
* [ ] Can I explain the architecture confidently?
* [ ] Does this feel like a real product?

---

# 🏁 Definition of Done

This project is “done” when:

* It is **predictable**
* It is **consistent**
* It is **easy to extend**
* It feels **intentional, not accidental**
