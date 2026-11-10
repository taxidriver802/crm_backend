# Experiment CA — UI reimagination

Branch: `experiment/CA_ui_reimagination`
Parent: `experiment/CA_expansion` (untouched)

## Product understanding

This CRM is the office for a small crew that sells a job and then does the work. The person using it all day is an owner or an agent: they start from what is late or due, open a job, and need the price, the schedule, the site, and the record without hunting through a catalog of tables. A lead can exist before a job. The job is the hub. Estimates become the contract. Payments sit against that contract. The client sees a portal, not this shell.

## Research

I used the working patterns of field-service and operations tools, not their visual skins.

- Jobber and Housecall Pro put the day and the job ahead of a generic contact database. Money is a lane on the job, not a separate product.
- ServiceTitan is denser and more departmental than this company needs. Copying it would add navigation the crew does not have roles for.
- Linear and Pipedrive earn their speed with one home queue and a record that stays in context. They do not make you re-learn the object on every visit.
- Salesforce and HubSpot show the failure mode: every object is a destination, and the home screen becomes a pile of numbers. That is the shape this app already had.
- Notion's personal workspace is the useful idea from customization: a few preferences that stick, not a layout builder.

## UX assessment

The shell was a flat list of record types (Dashboard, Leads, Jobs, Tasks, Invoices, then tools). The job page was one long scroll: conversation, pipeline, money, estimates, invoices, measurements, tasks, files, and activity, in that order, every time. Palettes and saved list views were the only personalization, and they did not change how the day or the job was organized. After the contract work, the price of the job was still buried in that scroll.

## Design thesis

The desk is the day. The job is a workspace with four panes. People should open the app on the queue or on money, then move through a job as Work, Money, Site, and Record, and have that choice waiting for them tomorrow.

## Design system

The existing tokens, type, and components stay. The change is structure, not a second palette. Navigation is labeled Desk and Office. Density is a real setting: comfortable, or compact, which tightens page padding and drops card shadow. Status, forms, and lists keep their current components so the app still feels like one product.

## Architecture

Sidebar and phone navigation lead with Today, Leads, Jobs, Schedule, and Money. Files, reports, automation, templates, integrations, and team sit under Office. Today is still `/dashboard`, and its heading is still the greeting, so the day starts in the same place. If the desk preference is money, Today opens filtered to invoices.

A job keeps one header, then a Work / Money / Site / Record switch. Work is communication, pipeline, and tasks. Money is the contract, estimates, and invoices. Site is measurements and files. Record is the activity log. The other panes stay mounted and hidden so their data does not reload on every switch.

## Customization

Stored on `users.ui_preferences` and returned by `GET /auth/me`:

- `density`: `comfortable` or `compact`
- `desk`: `queue` or `money`
- `job_pane`: `work`, `money`, `site`, or `record`

`PATCH /auth/preferences` merges a partial update. The shell applies density on `<html data-density>` and writes changes from Settings. The job switch writes `job_pane`. These survive reload because they are columns, not `localStorage`.

## Implementation

- `crm_backend`: `sql/patch_phase24_workspace.sql`, preference validation, `/auth/me` and `/auth/preferences`, integration test.
- `crm_frontend`: desk navigation, job panes, density styles, settings controls, Today opening on the saved desk.
- `crm_qa`: schema list includes the patch. Bottom nav is identified by Today. `tests/e2e/workspace.spec.ts` sets compact density and the Money pane, reloads, and resets the owner.

## Tradeoffs

- A widget home or drag-and-drop nav would be more customization and less clarity for a four-person crew. Rejected.
- Replacing the visual system (type, color, a new component kit) would make the app look new without making the day or the job faster. Rejected.
- Renaming routes (`/today`, `/money`) would break bookmarks and the QA route catalog for no gain. Labels changed; URLs stayed.
- Per-company layouts were rejected. Density and desk are personal. Company look stays the admin branding control that already exists.

## Verification

From `crm_backend`:

`npm test -- --testPathPatterns='workspace.integration|auth-dashboard|users.integration|companies.auth' --forceExit`

Workspace preferences: 2 passed. Auth, users, and company auth: 13 passed.

`npx tsc --noEmit` in `crm_backend`: clean.

From `crm_frontend`:

`npx eslint` on `app-shell.js`, the job page, and the dashboard page: no errors. One existing hook-deps warning in the shell.

From `crm_qa`, with Playwright using the machine browser cache:

`env -u PLAYWRIGHT_BROWSERS_PATH npm run test:qa`

194 passed, 14 skipped. That includes route smoke at four widths, the contract figures on the Money pane, a recorded deposit, and the workspace spec: compact density and the Money pane survive a reload, then the owner is restored to the defaults.

## Remaining work

Phone navigation still uses the same five destinations as the desk, not a separate field-tech mode. A second mobile information architecture was not required to make the job usable on a phone, and it would have split every workflow. QuickBooks still does not receive payments; that belongs to the previous experiment's boundary.
