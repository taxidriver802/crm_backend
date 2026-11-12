# Hosted Demo Seed Guide

> **On a host with other companies, use
> [`demo-company-seed.md`](demo-company-seed.md) instead.** It fills a
> `demo` company with a year of records and can rerun safely.

> **Not on a host that serves real companies.** The seed writes demo
> records into one company: the one named with `--company <slug>`, or the
> only one. There is no default company, so a new database needs a company
> registered first. `--reset` truncates business tables for every company,
> so it refuses whenever another company has data in them. Use this only on a demo database, and take a backup first
> (`npm run db:backup`). The production runbook is [`hosting.md`](hosting.md).

Apply the Rooftop Realty walkthrough dataset to the hosted CRM database on the Windows home server, using the same SSH + Docker pattern as the Phase 19 patch fallback.

**Script:** `crm_backend/scripts/seed-walkthrough-data.js`  
**npm:** `npm run db:seed-walkthrough`

## What it seeds

Narrative demo covering a real roofing/exterior workflow:

- 7 leads across New → Contacted → Qualified → Closed / Inactive
- 4 jobs including Proposal Sent, Appointment Scheduled, Closed (paid in full) and Lost
- Tasks + Phase 19 appointments (`kind`, `end_at`, `location`)
- Typed notes (call / text / email / in_person)
- Estimates (Draft / Sent / Approved / Rejected) + line items
- Invoices (Sent / Paid / Overdue) + line items
- Measurements, job activity, notifications, saved views, automation rule
- Client portal token + estimate share link
- Optional demo agents (`--include-team`)

File rows are **metadata only** (no photo binaries).

## Safety

| Flag | Meaning |
|------|---------|
| `--confirm` | **Required** when `DATABASE_URL` host is not `localhost` / `127.0.0.1` (includes Docker host `crm-db`) |
| `--reset` | Truncates CRM business tables, **keeps users**. Wipes existing hosted CRM data. Refused when any company other than the seeded one has rows in those tables (it names them) |
| `--force` | Append even if `@example.com` walkthrough leads already exist |
| `--dry-run` | Print planned work; no writes |
| `--company` | Slug of the company to seed. Required when there is more than one company (it lists them); with exactly one, that one |
| `--owner-email` | Target a specific active owner of that company |
| `--include-team` | Create/reuse Alex + Sam demo agents |

Without `--reset` / `--force`, the script refuses to run if walkthrough leads already exist.

**Important:** If the hosted DB has real customer data you want to keep, do **not** use `--reset`. Prefer a fresh demo DB, or accept that append (`--force`) can duplicate narrative records.

## Recommended hosted command

First-time demo fill (wipes business data, keeps logins):

```bash
node scripts/seed-walkthrough-data.js --confirm --reset --include-team --owner-email YOUR_OWNER@EMAIL
```

Set `APP_BASE_URL` or `FRONTEND_URL` in the environment so printed portal/estimate URLs use your real public host.

Demo agent password (both): `DemoAgent123!`

- `alex.morgan@example.com`
- `sam.lee@example.com`

---

## Apply via SSH + Docker (Windows home server)

### 1. Start an SSH session

From the Mac:

```bash
ssh jacox@desktop-aappbde.tail5b5ea6.ts.net
```

### 2. Confirm containers

In PowerShell on the server:

```powershell
whoami
hostname
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
```

Confirm `crm-db` and the API container (often named like `crm-api`) are running. Note the exact API container name.

### 3. Copy the seed script from the Mac

On the Mac:

```bash
cd ~/Desktop/Cursor/CRM/crm_backend
scp scripts/seed-walkthrough-data.js jacox@DESKTOP-AAPPBDE:C:/homelab/apps/crm-api/
```

If hostname resolution fails, use the Tailscale hostname from step 1.

### 4. Copy the script into the API container

On the server (replace `crm-api` with the real container name if different):

The seed needs its `lib/reset-guard.js` beside it:

```powershell
cd C:\homelab\apps\crm-api
docker exec crm-api mkdir -p /tmp/seed/lib
docker cp .\seed-walkthrough-data.js crm-api:/tmp/seed/seed-walkthrough-data.js
docker cp .\lib\reset-guard.js crm-api:/tmp/seed/lib/reset-guard.js
```

### 5. Dry-run first (recommended)

```powershell
docker exec -e NODE_PATH=/app/node_modules crm-api node /tmp/seed/seed-walkthrough-data.js --dry-run --confirm --reset --include-team
```

Confirm the owner email printed matches the account you demo with.

### 6. Apply for real

```powershell
docker exec -e NODE_PATH=/app/node_modules -e APP_BASE_URL=https://YOUR_PUBLIC_CRM_HOST crm-api node /tmp/seed/seed-walkthrough-data.js --confirm --reset --include-team
```

Optional:

```powershell
docker exec -e NODE_PATH=/app/node_modules -e APP_BASE_URL=https://YOUR_PUBLIC_CRM_HOST crm-api node /tmp/seed/seed-walkthrough-data.js --confirm --reset --include-team --owner-email you@example.com
```

### 7. Save the printed public links

On success the script prints:

- Portal URL (`/public/portal/...`)
- Estimate share URL (`/public/estimate/...`)
- Demo agent emails + shared password

Treat those tokens as sensitive.

### 8. Verify in the UI

Suggested path:

1. Login as owner → Today (what needs you, money owed, the agenda)
2. Leads → Marcus Nelson / Priya Patel
3. Jobs → Patel proposal / Nelson appointment / Andersen closed (paid in full)
4. Estimates + Invoices
5. Tasks calendar / appointments
6. Notifications bell
7. Optional: login as `alex.morgan@example.com` and check assigned work / team view

Quick DB sanity check:

```powershell
docker exec crm-db psql -U crm -d crm -c "SELECT status, count(*) FROM leads GROUP BY status ORDER BY status;"
docker exec crm-db psql -U crm -d crm -c "SELECT kind, status, count(*) FROM tasks GROUP BY kind, status ORDER BY 1,2;"
docker exec crm-db psql -U crm -d crm -c "SELECT status, count(*) FROM estimates GROUP BY status ORDER BY status;"
```

---

## Local development (Mac)

```bash
cd ~/Desktop/Cursor/CRM/crm_backend
npm run db:seed-walkthrough -- --dry-run --force --include-team
npm run db:seed-walkthrough -- --reset --include-team
```

Localhost does not require `--confirm`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Refusing to write to non-local database host` | Add `--confirm` |
| `Walkthrough leads already exist` | Use `--reset` (wipe) or `--force` (append) |
| `This database has no company yet` | Register on the hosted site first, then rerun |
| `This database has N companies (…). Name the one to seed with --company <slug>` | Pass `--company` with one of the slugs it lists |
| `No active owner in this company` | Register/login once on the hosted site first, or pass the right `--company` |
| `Refusing --reset: … other company has data` | The database serves more than one company. Seed without `--reset`, or use a demo database |
| `Cannot find module 'pg'` / `bcryptjs` | Ensure `NODE_PATH=/app/node_modules` and you are exec'ing the **API** container, not `crm-db` |
| Wrong owner targeted | Pass `--owner-email` |
| Portal/estimate URLs look wrong | Set `APP_BASE_URL` on the `docker exec` |
| Photo files 404 | Expected — seed stores metadata only |

## Relation to `db:seed-demo`

`npm run db:seed-demo` loads the tiny legacy `crm_dev_backup.sql` (leads/jobs/tasks/files/notifications only). Prefer **`db:seed-walkthrough`** for demos — it mirrors the current product workflow through Phase 19.
