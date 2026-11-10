# Experiment: Brand — Joist (`experiment/CC_brand`)

Branch `experiment/CC_brand` in `crm_backend`, `crm_frontend` and `crm_qa`.
This pass gives the product a name and a mark of its own, and takes the
previous customer's identity out of the product. It does not redesign the
Workbench, the palettes' colours or the type.

Short version: **the product was wearing a customer's clothes.** The
installed app was "Rooftop Realty CRM", its icon was Rooftop's logo, every
company that never uploaded a logo showed Rooftop's logo as its own, the
default palette was called Rooftop, and the browser tab still showed the
Next.js starter triangle. Now the product is **Joist**, it has one mark drawn
once, a company without a logo shows its own initials, and Rooftop Realty's
logo belongs to Rooftop Realty's row and nobody else's.

## Parents

Each repository was verified on its own; they do not share ancestry.

| Repo | Expected parent | Used | Why |
|---|---|---|---|
| crm_frontend | `experiment/CC_help` `5e3cbb10a49b` | same | Newest intended work. No `CC_schema` branch exists here. |
| crm_backend | `experiment/CC_schema` `910c22e0899b` | same | Contains all of `CC_help` plus the migration runner and the dock preference. |
| crm_qa | `experiment/CC_help` `c111608abaf4` | **`experiment/CC_schema` `369fa516edad`** | `CC_help` is an ancestor of `CC_schema` here, and `CC_schema` adds the two commits that build the QA database with the backend's migration runner. The backend parent needs them, so the QA branch must have them. `crm_qa` was also checked out on `CC_schema` at the start. |

The frontend worktree had one uncommitted line in `next.config.mjs` (a LAN
address in `allowedDevOrigins`). The owner confirmed it was theirs and could
be committed, so it is its own first commit on the frontend branch.

No commit, merge, rebase, reset, amend or force-push touched `main`,
`experiment/CC_expansion`, `experiment/CC_ui_reimagination`,
`experiment/CC_revise`, `experiment/CC_help` or `experiment/CC_schema`.

| Repo | `main` | `CC_expansion` | `CC_ui_reimagination` | `CC_revise` | `CC_help` | `CC_schema` |
|---|---|---|---|---|---|---|
| crm_backend | `2c83eb7e0c5a` | `95637577aca4` | `7984acd43402` | `6328ca13e375` | `435ecfb5513c` | `910c22e0899b` |
| crm_frontend | `3ca07f78b71b` | `8d7a5b2504e3` | `68dedadf6f3f` | `3f83fd832cc9` | `5e3cbb10a49b` | — |
| crm_qa | `6fe1474a3cbb` | `808d998890c9` | `dccef30421f9` | `042af0eaf781` | `c111608abaf4` | `369fa516edad` |

## The mark

### Three directions

Rendered on the brand tile (`#363a43`, glyph `#f4f4f5`, accent `#f97316`)
at 16, 32, 64 and 128px, in monochrome on white and on black, and as the 16px
render blown up pixel by pixel: [`brand/exploration-directions.png`](brand/exploration-directions.png).

1. **Structural I-beam.** Top flange, web, bottom flange. Crisp at every size,
   but it is a capital **I**, and at 16px it reads as a text cursor. Nothing
   in it says J or Joist, and every steel supplier already owns it.
2. **Engineered I-joist.** Chunky flanges, a thin web, true to a wood I-joist.
   The thin web is the identity, and at 16px it falls between pixels and
   turns grey. Also still an I.
3. **Abstract structural J.** Built from the same parts: top flange, web, and
   a bottom flange that runs to one side only. Three versions: a long flat
   J (reads as a step or a Z at large sizes), a lipped J (clearest letter, but
   at 16px the lip turns it into a cup, and it starts to look like a font),
   and a J with I-joist proportions (3c).

### Refinement and choice

3c won on paper, so it was redrawn on a pixel grid: every edge on an even
unit of a 32-unit grid, so edges land on whole pixels at 16px and 32px.
Five proportions compared side by side: [`brand/exploration-refinement.png`](brand/exploration-refinement.png).

**Selected: "B square 6/8/6".** An engineered I-joist in section with half
its bottom flange cut away, which leaves a J.

- Top flange 16×6 units (orange), web 4×8, bottom flange 14×6 to the left,
  in a 20×20 glyph box centred on the tile with 6 units of tile all round.
  Tile radius 7 units.
- Why this one:
  - **Small sizes.** The only candidate that is pixel-sharp at 16px with no
    grey edges, because no edge sits on a half pixel. It still has orange and
    light pixels at 16px; QA counts them.
  - **Silhouette.** Three rectangles, two weights. It reads as one heavy shape
    at a glance, and it is not a letterform you have seen in a font.
  - **Meaning.** It is literally a joist section (flanges thicker than the
    web), and it is a J. The name and the drawing explain each other.
  - **Balance.** The square glyph box sits still in the tile. The wide
    variant (A) leaned like a Z; the tall one (D) only worked off-grid.
  - **Monochrome.** All filled shapes, so one colour on white or black works
    without change.
  - **Software, not construction.** No roof, no house, no tool, no texture.
    It would work for a product that had nothing to do with building.
- The orange is one element: the top flange, the surface the floor bears on.
  It is about a sixth of the glyph and never fills the tile, so the identity
  is charcoal and light with one deliberate accent.
- No lettering inside the mark.

Rejected on the way: a hairline gap between the orange flange and the web
(it turned grey at 16px), and a rounded glyph (softer, but less structural
and blurry at 16px).

### Three forms only

1. **Mark** (`JoistMark`): icons and compact places. Minimum 16px.
2. **Lockup** (`JoistLockup`): the mark beside the word **Joist** in the
   app's sans, semibold, tracking-tight. Only at 24px and above (the
   component clamps).
3. **Attribution** (`PoweredByJoist`): the text "Powered by Joist", 11px,
   `--text-soft`, no link. There is no Joist site to link to and none was
   invented.

A quiet tone of the mark (the glyph alone in `currentColor` at low opacity)
exists for loading placeholders. It is the same drawing, not a variant.

## One drawing

`crm_frontend/src/assets/brand/joist-mark.svg` is the only place the mark is
drawn. The app imports it through SVGR. `npm run icons:pwa` writes every
other copy from it:

| Output | Notes |
|---|---|
| `src/app/icon.svg` | Browser tab, vector |
| `src/app/favicon.ico` | 16, 32 and 48px PNG frames. Replaces the Next.js triangle |
| `src/app/apple-icon.png` | 180px, full bleed (iOS applies its own corner mask) |
| `public/icons/icon-192/512.svg/png` | Installed app, purpose `any` |
| `public/icons/icon-512-maskable.png` | Full bleed, mark scaled to 80% so its farthest corner is 35% from centre, inside Android's 40% safe circle |
| `public/offline.html` | Inline copy between `joist-mark:start` / `:end` markers. Inline because the service worker caches this page and it must not fetch anything |

`npm run icons:pwa -- --check` fails if any output differs from what the
source would produce. `crm_qa`'s brand check runs it, and also fails if the
mark's geometry appears in any other frontend file.

**Decision: Apple icon by file convention.** The layout's `metadata.icons`
used to list the PNGs. With it set, Next emitted no link for `app/icon.svg`
at all; the config entry suppresses the file-based icon links. The metadata
now sets no icons, and the Apple icon moved from
`public/icons/apple-touch-icon.png` to `src/app/apple-icon.png`, so all
three head links come from files.

## Two layers

| Surface | Brand |
|---|---|
| Tab icon, installed app (name and icon), signed-out tab title | Joist |
| Sign-in before a company is known; register (always); offline page; 404/error with no company on screen | Joist |
| Sign-in once the slug resolves, accept-invite, nav rail, phone top bar, Settings, signed-in tab title (`<company> CRM`, unchanged) | Company |
| Customer pages (intake, estimate, portal, invoice), invite email | Company, plus one muted "Powered by Joist" line |

Decisions inside that table:

- **Never both at full size.** `AuthFrame` takes the company record and shows
  either the Joist lockup or the company's mark and name.
- **No flash of the wrong brand.** Sign-in renders a quiet empty tile on the
  server and while a remembered slug is looked up, so a returning user goes
  from blank straight to their company. Joist only appears when there is
  genuinely no company. QA records every state the frame passes through and
  fails if "joist" is among them.
- **No leak between companies.** Sign-in only shows the company the slug
  names right now; the previous company leaves the moment the slug changes.
  Clearing the slug by hand drops that company's palette. Register always
  uses the default palette (Ember), because it is making a new company and a
  remembered company's palette does not belong there.
- **Accept-invite** sets the company's name and brand together, so it goes
  from a quiet tile to the company with no initials-then-logo step.
- **Customer pages** show a quiet tile while their company loads, the company
  once it does, and Joist's mark and name only for a dead link (no company to
  show). The attribution line appears only when a company is on the page.
- **404 and errors.** New `not-found.js`, `error.js` and `global-error.js`.
  Inside the staff shell the company's rail is already on screen, so the
  message stands alone with no Joist. Outside it (a customer link, a crash
  that took the shell down, a root-layout failure) Joist's lockup heads the
  page. A signed-out visitor at an unknown staff URL is still sent to
  sign-in by the shell guard (unchanged), which shows Joist.
- **Loading** stays quiet: an empty tile at 12% of the text colour in the
  mark's slot. No spinners, no animation, no decorative logo.
- **Theme colour.** Already followed the active palette's `--bg`; signed in,
  the active palette is the person's own or else the company's. Verified,
  not rebuilt.

## Companies without a logo

Same order as before: an uploaded logo wins, then a chosen icon mark. The
default (stored id `product`) used to draw Rooftop's logo. It now draws a
**monogram tile**:

- One initial for a one-word name, two (the first two words) otherwise.
- Skip a leading "The" and trailing LLC, L.L.C., Inc, Incorporated, Co,
  Company, Corp, Ltd, PLC, ignoring case and dots, while a word remains.
- "Rooftop Realty" → RR, "The Gutter Guys LLC" → GG, "Northside" → N.
- Background is the **company's** accent and the ink is that palette's
  `--on-accent`, read from the company's palette rather than CSS variables,
  so a staff member's personal palette never recolours another company's
  tile. Same radius as an uploaded logo.

Decisions:

- **First two words, not first and last.** Names like "Smith Roofing and
  Gutters" read as their first two words; first-and-last would give SG. The
  rule also splits on commas so "Acme, Inc." resolves cleanly. Hyphenated
  names count as one word ("Jasons-roofing" → J), which matches how people
  read a hyphenated name.
- **The `product` id stays.** It is in existing rows and in the column
  default. Renaming it would need a data migration for no visible gain. The
  picker now calls it **Initials** and previews the company's own tile.
- **One rule, two copies, one table.** The invite email already fell back
  to initials, by a different rule (two letters from one word, "The" and
  "LLC" counted as words). Now `crm_frontend/src/lib/monogram.js` and
  `crm_backend/src/lib/monogram.ts` implement the same rule and both are held
  to `crm_backend/test/fixtures/monogram-cases.json` (21 cases): the backend
  in Jest, the frontend copy in `crm_qa`'s brand check.
- **Readability.** `--on-accent` on `--accent`, per palette: Azure 5.2,
  Emerald 3.8, Graphite 10.4, Ember 6.6, Rose 4.7, Sand 7.3, Slate 5.5,
  Violet 5.7. All above 3:1 (the tile's letters are 13–16px semibold, so the
  large-text and UI-mark threshold applies). The brand check fails below 3:1.

## Rooftop Realty keeps its own logo

Rooftop's drawing (`src/assets/mainlogo.svg`) is deleted from the frontend.
Its logo is now Rooftop Realty's row's logo.

**Schema inspected, no schema change.** `companies` already has
`logo_storage_key`, served by `GET /public/companies/:slug/logo` and used by
the app and the invite email. The model already supports "this company has
this logo"; the only gap was that logo files live in `uploads/`, which is
runtime data and not in git, so a fresh install could not carry one.

- A `builtin/` storage key resolves to `crm_backend/assets/company-logos/`
  (`src/lib/companyLogo.ts`). The file ships with the code, is served by the
  same route as an upload, and cannot be reached outside its folder.
- Clearing or replacing a built-in logo changes only the row. The committed
  file is never deleted (uploads are, as before).
- The file is a 512px PNG of Rooftop's own orange lockup (the old app icon),
  because uploads and mail clients do not take SVG.

**Data, two paths.** The baseline's starting row for Rooftop Realty now
carries `builtin/rooftop-realty.png`, so a new database and the backend's test
reset (which re-inserts the baseline's starting rows) both have it.
Migration `0001_rooftop_realty_logo.sql` brings a database built before this
to the same state, and only while the row is as the baseline left it
(`logo_storage_key IS NULL AND updated_at = created_at`), so an owner who has
since uploaded or removed a logo keeps that choice. Applied to `crm_dev`: the
Rooftop row got the key; the two walkthrough companies have none and show
their initials. Nothing else in the database was touched.

## Palette naming

The orange palette's label is **Ember**. Its id stays `rooftop`, so saved
company palettes and personal preferences keep resolving; nothing else
needed an alias. Colours unchanged. Label and notes updated in the palette
file, `tokens.md`, `companySlug.ts` and `print-theme.ts`. Settings now shows
the palette's label ("Palette: Ember") instead of its id. Azure, Slate and
the others are unchanged; the brand check holds their labels and accents.

## Metadata

- Manifest `name` and `short_name`: Joist. Description: "The job, from first
  contact to paid." The trade list and "Buy & Sell" are gone from the
  manifest, layout metadata and Apple title.
- Signed-out title: Joist. Signed-in title: `<company> CRM`, unchanged.
- The iOS install hint says "Install Joist".
- The service worker's cache name is bumped (`crm-v6`) so existing installs
  re-cache the new offline page.
- Deleted unused starter files `vercel.svg`, `next.svg`, `file.svg`,
  `globe.svg`, `window.svg` (nothing imported them).

## What changed

### crm_backend

- `assets/company-logos/rooftop-realty.png`, `src/lib/companyLogo.ts`, the logo
  routes in `company.routes.ts` and `publicCompanies.routes.ts`.
- `sql/migrations/0001_rooftop_realty_logo.sql`; the baseline's Rooftop row.
- `src/lib/monogram.ts`, `src/lib/brand.ts`, `src/lib/invite-email.ts`
  (initials by the shared rule, one muted "Powered by Joist" line in HTML and text).
- `src/lib/companySlug.ts`, `src/lib/print-theme.ts`: Ember notes; why the
  `rooftop` and `product` ids stay.
- `test/brand.test.ts`, `test/fixtures/monogram-cases.json`; the Rooftop
  public branding expectation in `test/companies.auth.test.ts`.

### crm_frontend

The mark source, generator and generated icons; the Joist components; the
monogram; the auth, public and status frames; metadata; Ember; `brand.md`.
Detail in `crm_frontend/EXPERIMENT_BRAND.md`.

### crm_qa

`scripts/brand-check.ts` (part of `npm run test:qa`), `tests/e2e/brand.spec.ts`,
and the PWA spec's Apple icon path and offline-page brand. Detail in
`crm_qa/EXPERIMENT_BRAND.md`.

## Commands and results

```bash
# crm_backend
npx tsc --noEmit
npm test
npm run db:migrate          # crm_dev
```

Typecheck clean. Jest: **28 suites, 207 tests passed**, including
`test/brand.test.ts` (21 monogram cases; Rooftop's row points at its served
logo; a new company has none; replacing or clearing the built-in logo leaves
the committed file alone; a `builtin/` key cannot escape its folder; the
migration fills an untouched row and leaves an owner's later choice; the
invite email has exactly one Powered by Joist line, after the company) and
the updated public-branding expectation in `companies.auth.test.ts`.
`db:migrate` on `crm_dev`: "applied 0001_rooftop_realty_logo.sql".

```bash
# crm_frontend
npm run icons:pwa -- --check
npx eslint .
```

"9 brand files match src/assets/brand/joist-mark.svg". ESLint 0 errors,
1 warning (`<img>` in `company-mark.js`, pre-existing). Two older
exhaustive-deps warnings in `login` and `accept-invite` were fixed while
those files were open.

```bash
# crm_qa
npm run qa:brand-check      # fail on forced drift, then pass
npm run test:qa             # ports 3100 and 4100, database crm_qa
```

`npm run test:qa`: guard check passed, lifecycle drift passed (14 checks),
help source passed (13 ids, 36 articles), **brand check passed**, database
built and seeded, staged frontend build, then Playwright:
**287 passed, 85 skipped, 0 failed** (5.8m). The new `brand.spec.ts` runs
11 tests on desktop-1440 and phone-390 (22 runs) and skips the other two
widths.

Played in that suite, on this branch:

- The tab shows `icon.svg`, `favicon.ico` (three frames, not the triangle)
  and `apple-icon.png` (180), and nothing else; manifest and Apple title say
  Joist; no Rooftop, trade list or Buy & Sell in the manifest.
- 192, 512, maskable 512 and 180 icons have those sizes; no pixel of the
  mark is outside the maskable 40% circle; at 16px the mark still has its
  orange flange and light web.
- Sign-in: Joist lockup (mark ≥24px, square), then `rooftop` shows Rooftop's
  logo (it loads, 512px wide), then another company's slug shows **GG** and
  no Rooftop image, then back, then an unknown slug falls back to Joist.
- A remembered `rooftop` slug: the server HTML holds the quiet tile, and the
  frame goes to the company without ever passing through "joist".
- Register stays Joist and on the default palette with a violet company
  remembered; its Initials option previews **SE** for "Summit Exteriors Corp".
- The staff shell shows Rooftop's logo in the rail (desktop) and top bar
  (phone), titles the tab "Rooftop Realty CRM", and contains no Joist mark
  and no attribution.
- A new company ("The Gutter Guys LLC", violet): **GG** tile in the violet
  accent with violet's on-accent ink, tab "The Gutter Guys LLC CRM", no
  Rooftop image, theme-color equal to violet's canvas. Then sign-in shows GG
  remembered, and signing in to Rooftop in the same browser brings back
  Rooftop's logo, title and palette with no GG left.
- A customer portal link: company header with Rooftop's logo, exactly one
  "Powered by Joist", unlinked, in `--text-soft`; no Joist mark. A dead
  portal link shows Joist and no attribution. With the portal API held, the
  mark slot is the quiet tile, with neither Joist nor Rooftop, until it loads.
- `/public/no-such-page` returns 404 with the Joist lockup; `/no-such-page`
  signed in shows the message inside the shell with Rooftop's rail and no Joist.
- Settings says "Palette: Ember" with the stored `rooftop` id; Ember,
  Azure (#2563eb) and Slate (#0f766e) keep their accents; the picker lists
  Ember and no Rooftop.
- Offline reload (PWA spec): the cached page shows the inline Joist mark,
  the name, "Can't reach the CRM" and Retry.

Found by the new spec and fixed in this pass: after sign-in, `theme-color`
fell back to Ember's canvas, because Next re-applies the layout's viewport
`themeColor` on the client navigation to `/dashboard` and nothing synced it
again. The theme controller now re-applies the active palette's `--bg`
whenever Next rewrites that meta tag (only the existing tag; viewport
handling unchanged).

Not covered by a browser test: the invite email (QA sends no mail; Jest
covers its markup), the root `global-error.js` (nothing in the app can make
the root layout throw on demand), and a real device's home-screen install
(manual, `crm_qa/docs/pwa-manual.md`).

Committed `.sql` files are the schema baseline and the new migration, not
backups. No `.env`, `cookies.txt`, backups, `uploads/`, `node_modules/`,
`.next/` or `qa-artifacts/` were committed.

## Left for later

- A company's logo or monogram as the tab icon, with or without an unread dot.
- A per-company installed-app manifest.
- Any new palette, any change to palette colours, the Workbench layout, or a
  broader visual or type redesign.
- The branding modal's file input still offers GIF and SVG, which the logo
  upload accepts; uploaded SVG logos do not show in most mail clients. Not a
  branding-identity change, so left alone.
- Other palettes' source comments still say "Same token keys as Rooftop".
  They describe the id, which is still `rooftop`, and the instruction was to
  leave those palettes as they are.
