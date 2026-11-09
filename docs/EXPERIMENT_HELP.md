# Experiment: Help (`experiment/CC_help`)

Branch `experiment/CC_help` in `crm_backend`, `crm_frontend` and `crm_qa`,
cut from `experiment/CC_revise`. This pass adds the explanation: one user
guide, and that same guide opened over the work the person is already doing.

## Parent

`experiment/CC_revise`. The four parent branches were not committed to,
merged, rebased, reset, amended or force-pushed.

| Repo | `main` | `experiment/CC_expansion` | `experiment/CC_ui_reimagination` | `experiment/CC_revise` (parent) |
|---|---|---|---|---|
| crm_backend | `2c83eb7e0c5a` | `95637577aca4` | `7984acd43402` | `6328ca13e375` |
| crm_frontend | `3ca07f78b71b` | `8d7a5b2504e3` | `68dedadf6f3f` | `3f83fd832cc9` |
| crm_qa | `6fe1474a3cbb` | `808d998890c9` | `dccef30421f9` | `042af0eaf781` |

`git merge-base experiment/CC_revise experiment/CC_help` equals
`git rev-parse experiment/CC_revise` in each repository.

## The guide

`docs/guide/using-the-crm.md`, listed in `docs/README.md`. It uses the words
on the screens of this branch.

1. **What this service is.** The client, a lead, a job, how a job moves from
   first contact to paid and closed, the three staff roles, and what the
   client can do with no account.
2. **Start here.** One first job on an empty company: sign up, lead, job,
   task, appointment, note, file, estimate, send, accept as the client,
   deposit, record the payment, schedule the work, portal, do the work,
   final invoice, send, record the payment, job closes.
3. **How to do a task.** 34 task and reference articles. Each has who can do
   it, where, the steps, and what success looks like.

The panel serves 36 articles (the overview, Start here, and those 34). The
closing list is not an article.

Left out of the guide, with the reason, at the bottom of the file:

- Ordering from ABC Supply, and price lookups. No live account.
- Connecting QuickBooks and Sync to QuickBooks. No app keys.
- Emailed invites and reminders. No mail settings. Copy-the-link is documented.
- Taking card payments online. Not in the product.
- Measurements. The section exists; it is not a step in the job's flow, and it was not walked.
- Moving or completing several rows at once. Only assigning was walked.

## The panel

Help is a sheet over the current screen. Opening it does not navigate. The
open article is `?help=` (contents is `?help=contents`), same habit as peek,
so reload, back and a shared link restore it. Help and peek can both be open.
On a phone it is the same panel, opened from the phone menu.

- **Account menu → Help** opens the contents on the page you are on.
- **`?`** still opens Keyboard shortcuts. That dialog has one new line,
  **Help, the user guide**, which closes the dialog and opens Help.
- **⌘K** has a separate **Help** group. What you type is matched against
  article titles and keywords, not against records. Choosing one opens that
  article and leaves you on the same page.
- **Contextual links**, one each, labelled **How?**:
  - the job's next step, to the article for that action
  - the invoice's current action (send, or record a payment)
  - an empty Today: **Start here** for an owner or admin, **Use Today** for an agent
- An article can offer **Go to** the screen where the task is done. That is
  the moment Help navigates.
- An agent does not receive an article their role cannot perform. The list
  from `GET /help` is already filtered, so ⌘K and a pasted `?help=` id cannot
  open an owner-only article (the API returns 404).
- Public intake, the shared estimate, the portal and the shared invoice do
  not get this panel. They are outside the staff shell.

## One source of words

The backend reads `docs/guide/using-the-crm.md` at request time
(`src/lib/helpGuide.ts`). There is no second copy of the words and no editor.
`GET /help` and `GET /help/:id` return only the articles the caller's role
allows.

A heading is an article only when the next line is a `<!-- help: ... -->`
marker whose id is the heading's anchor. `<!-- help: none -->` marks a
heading that is deliberately not an article (the part titles, the skip list).
The parser reports a section with no marker, an id that is not the anchor,
and a **Who can do this** line that names different roles than the marker.

The frontend (`src/lib/help.js`) stores no sentences. It stores which article
id answers which moment.

Checks:

- `crm_backend` `test/help.integration.test.ts` fails when a section's words
  and the blocks the panel would show disagree, and when an agent can fetch
  an owner-only article.
- `crm_qa` `npm run qa:help-check` runs `npm run help:articles` and fails
  when any id in `src/lib/help.js` is not an article the guide serves.
  It is part of `npm run test:qa`.

Shown failing, then passing: `close_job` in `src/lib/help.js` was pointed at
`close-a-job-missing`. The check exited 1 with "the UI asks for articles the
guide does not serve: close-a-job-missing". Restored, it exited 0:
"13 UI article ids are served by the guide (36 articles)."

## What changed

### crm_backend

- `docs/guide/using-the-crm.md` — the guide.
- `src/lib/helpGuide.ts`, `src/routes/help.routes.ts`, `scripts/help-articles.ts` — parse the file and serve it.
- `test/help.integration.test.ts` — parser rules, word match, role filter.
- `src/lib/companySlug.ts` — a taken generated slug retries inside a savepoint.
  Without that, Postgres aborted the transaction and the next try returned
  500, so a second company with the same name could not be created. Found
  while walking Start here. Covered by `test/companies.auth.test.ts`.
- The guide's estimate steps now say choose **Add line**, then fill **Item
  name**, **Quantity** and **Unit price**, then **Add line** again. That is
  the order on the screen.

### crm_frontend

The panel, the account and phone menus, the shortcuts line, the ⌘K Help
group, the three contextual links, and the appointment button on
`/tasks/new?kind=appointment` (it said **Create task**; it now says
**Schedule appointment**). Detail is in `crm_frontend/EXPERIMENT_HELP.md`.

### crm_qa

The one-source check, the Help specs, and the Start here walk. Detail is in
`crm_qa/EXPERIMENT_HELP.md`.

## Left out on purpose

A coach-mark tour, a chat widget, a support inbox, video, a content editor,
and help on public client pages. No schema change. Articles are not stored
in the database.

## Commands and results

```bash
# crm_backend
npx tsc --noEmit
npx jest test/help.integration.test.ts test/companies.auth.test.ts --runInBand
```

Typecheck clean. Jest: 18 passed (help parser, word match, role filter, and
registration including a second company with the same generated name).

```bash
# crm_frontend
npx eslint .
```

0 errors, 3 warnings, all in files this pass does not touch
(`accept-invite/page.js`, `login/page.js`, `brand/company-mark.js`).

```bash
# crm_qa
npm run qa:help-check          # fail on a forced bad id, then pass
npm run test:qa                # ports 3100 and 4100, database crm_qa
```

`npm run test:qa`: guard check passed, lifecycle drift passed (14 checks),
help source check passed, database reset and seed, staged frontend build,
then Playwright. **261 passed, 63 skipped, 0 failed** (7.0m).

Played in that suite, on this branch:

- Start here, as a new owner, from **Create company** through paid and closed,
  including the client's shared estimate, shared invoice and portal in a
  signed-out browser. No console errors on that walk.
- Help from the account menu without leaving the page; reload restores the
  article; ⌘K opens **Record a payment**; `?` still opens shortcuts and its
  new line opens Help; the billing job's next step opens **Record a payment**.
- An agent gets 404 for **Invite a teammate**, and that article is absent
  from ⌘K and from the contents.
- A public portal page has no help panel and no account menu.
- The phone menu opens the panel, then **Use Today**, with no horizontal overflow.
- Every article the owner can see, and every article the agent can see, opens
  with its own title. The agent list does not include Start here or Invite a teammate.

## Unfinished

Nothing is blocked. The procedures inside Start here were performed in the
UI. Every other article was opened and showed its title for the role allowed
to see it. Those other procedures were not each repeated as their own walk
in this session; the product paths they describe are the ones the rest of
`npm run test:qa` already drives (documents, roles, saved views, the workbench).
