# Product documentation (versioned)

This folder is the **git-tracked** copy of planning and guide docs for the CRM. It lives in the **backend** repository so product decisions and API-adjacent notes (build plan, migrations, Phase notes) stay with the same version control as the server.

If you also keep a `docs/` folder at a parent **monorepo** or Desktop path for Cursor/workspace convenience, treat **`crm-backend/docs` in this repo as the source of truth** when committing and pushing. Sync or copy from here when updating the workspace copy, or vice versa—just avoid letting them drift unnoticed.

Contents include:

- `build_plan_updated.md` — phased delivery checklist
- `context.md` — next directions (e.g. team management)
- `guide/` — testing walkthroughs and dev guides
- `archive/` — older roadmaps
