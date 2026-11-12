# Demo company seed

`npm run db:seed-demo-company` fills one company, **Demo**, with a year of
believable roofing records so the hosted site looks lived in. It is safe on a
host that serves real companies:

- It only fills a company whose slug is `demo` (or `demo-…`). Any other slug
  is refused.
- Every write and every delete is limited to that company. It never
  truncates a table.
- Everything happens in one transaction. Before it commits, it checks that
  every row belonging to any other company is exactly as it was (a count and
  a content hash per table). If anything differs, it rolls back and saves
  nothing.

Each run **replaces** the demo company's records with a fresh year dated
from today. People, sign-ins and the intake link stay.

**Script:** `crm_backend/scripts/seed-demo-company.js` (data rules in
`scripts/lib/demo-plan.js`, the scoped reset in `scripts/lib/company-reset.js`)

## What it writes

About 290 leads over twelve months: busier in spring and summer, a burst after
a July hail storm, and a steady last three weeks so the open pipeline is never
thin. From those come about 190 jobs, 170 estimates, 140 invoices and $700k to
$850k collected, with the history the reports read: lead status changes, job
status activity, assignments, tasks, notes, payments and notifications.

Rates are set to look like a small residential roofer: about 9 in 10 leads
reached, about 2 in 3 of those inspected, about half of proposals won. Jobs of
$5,000 or more take a deposit (usually 30%), then a final invoice net of it.
A few customers pay late or in parts, so there is always something owed.

Eight featured customers are the same on every run, at fixed points relative
to today, for a walkthrough:

| Customer | Where they are |
|----------|----------------|
| Marcus Nelson | Hail lead from two days ago; inspection tomorrow at 1:00 PM |
| Priya Patel | Gutter proposal sent two days ago; public estimate link |
| Grace Lindqvist | Crew on the roof today; deposit paid; client portal link |
| Hector Ruiz | Work complete, final invoice past due; collection call today |
| Tom Andersen | Re-roof finished and paid in full; referred Priya Patel |
| Jordan Hayes | Lost to a competitor who could start sooner |
| Elena Brooks | Door-knock lead, contacted, follow-up due today |
| David Chen | Urgent leak lead from yesterday, call-back overdue |

It also adds three team members, used for assignments and the team report:
`maya.ortiz@example.com`, `luis.brennan@example.com` (agents) and
`dana.whitfield@example.com` (admin, production). Their passwords are random
unless `DEMO_TEAM_PASSWORD` is set the first time they are created. To sign in
as one, send a reset link from the Users page, or on the host:
`npm run user:reset-link -- --company demo --email maya.ortiz@example.com`.

Customer emails use `example.com`, `example.net` and `example.org`, and phone
numbers are in the 555-0100 to 555-0199 range, so none of them reach a real
person. No photo files are written.

## Run it on the host

1. **Register the company** on the hosted site: company name `Demo`, slug
   `demo`. The owner you create is the demo login.
2. **Back up** first: `npm run db:backup`.
3. **Dry run.** It does all the work, prints the counts, then rolls back:

   ```bash
   cd /srv/joist/crm_backend
   npm run db:seed-demo-company -- --dry-run
   ```

4. **Run it.** A database that isn't on localhost needs `--confirm`:

   ```bash
   npm run db:seed-demo-company -- --confirm
   ```

   It prints the owner it used, the counts, and two public links (the Patel
   estimate and the Lindqvist client portal). It takes a few seconds.

| Flag | Meaning |
|------|---------|
| `--dry-run` | Do everything, print the counts, roll back |
| `--confirm` | Required to write when `DATABASE_URL` is not localhost |
| `--company` | Slug to fill. Default `demo`; only `demo` or `demo-…` |
| `--owner-email` | Owner the records belong to. Default: the oldest active owner |
| `--tz` | Time zone for working hours. Default `DEMO_TZ`, else `America/Chicago` |

Set `APP_BASE_URL` so the printed links use the public host.

## Keep it fresh (optional)

Dates are relative to the day it runs, so the demo slowly goes stale: "tomorrow's"
inspection becomes last week's. If the demo login is shared, visitors' edits
also pile up. A nightly run fixes both:

```ini
# joist-demo-seed.service
[Service]
Type=oneshot
WorkingDirectory=/srv/joist/crm_backend
ExecStart=/usr/bin/npm run db:seed-demo-company -- --confirm
User=joist

# joist-demo-seed.timer
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

`systemctl enable --now joist-demo-seed.timer`. Run it after the 03:00 backup.
Exit code `0` means it committed, `1` means it saved nothing.

## Troubleshooting

| Message | Fix |
|---------|-----|
| `No company with slug "demo"` | Register it on the site first |
| `Refusing company "…"` | Only `demo` or `demo-…` companies can be filled |
| `Refusing to write to database host … without --confirm` | Add `--confirm` (after a dry run) |
| `This company has no active owner` | Sign in once as the registered owner, or pass `--owner-email` |
| `This database is missing …` | Run `npm run db:migrate` first |
| `Rows outside the demo company changed in …` | Nothing was saved. Report it: the seed found a write it shouldn't have made |

## Not the walkthrough seed

[`hosted-demo-seed.md`](hosted-demo-seed.md) describes the older
`db:seed-walkthrough` (seven narrative leads, a global `--reset`). Use this
one on a shared host.
