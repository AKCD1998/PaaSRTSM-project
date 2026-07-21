# Agent instructions — PaaSRTSM-project

Applies to every AI agent working in this repo (Codex, Claude, any other).
`CLAUDE.md` points here; this file is the canonical copy.

This repo owns the **production Postgres** (`sc_drug_db` on Render) and the
`admin-api` backend that both web apps call. Mistakes here hit live data.

---

## 🚨 Migrations — read before creating OR running one

More than one agent works in this repo at the same time, and the migration
runner has a known Windows bug. Both have already caused incidents.

### Before creating a migration file

1. `git fetch origin main` **first** — another agent may have pushed a migration
   you do not have locally. The number you think is free may not be.
2. Take the highest number from **both** places, not just your working copy:
   ```sh
   ls migrations | tail -5
   git ls-tree --name-only origin/main migrations/ | tail -5
   ```
3. Use the next number above the higher of the two.
4. **Re-check both again immediately before you push.** A file can land in the
   gap between you creating yours and pushing it. Two migrations sharing a
   number is a known outstanding problem in this repo (there are already two
   `020_` files) — do not add a third case.

### Before running migrations against production

`npm run db:migrate` decides what to skip by exact-matching the filename it
recorded in `public.schema_migrations`. **It records the path using the running
OS's separator.** Render (Linux) writes `migrations/060_x.sql`; Windows writes
`migrations\060_x.sql`. They never match, so **running `db:migrate` from Windows
re-applies every migration Render already applied.**

This happened on 2026-07-21: migrations 051–060 silently re-ran against
production. Nothing broke, but only because every one of them happened to be
idempotent. One non-idempotent `INSERT` or unqualified `UPDATE` in any past
migration would have corrupted live data.

So, every time, before running:

1. Look at what is actually recorded, and in which style:
   ```sql
   SELECT filename FROM public.schema_migrations ORDER BY filename DESC LIMIT 10;
   ```
2. Compare that separator (`/` vs `\`) against what your OS will generate.
3. **If they differ, do not use the runner.** Apply your single new file
   directly instead, then record it in the same style already in the table:
   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0NN_your_file.sql
   ```
4. Dry-run first when you can: copy the file, replace its final `COMMIT;` with
   `ROLLBACK;`, and run that. It validates syntax and constraints against real
   data while committing nothing.
5. Afterwards, verify the specific tables you touched actually look right.

### Writing migrations

Always make them safely re-runnable, because the above means they may be:
`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
`ON CONFLICT DO NOTHING`, `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`,
and `UPDATE`s that are no-ops on a second pass (guard with `COALESCE` or a
`WHERE` that excludes already-updated rows).

Prefer a trigger over a `CHECK` when a new column must stay in step with an old
one. A `CHECK` breaks the still-running previous build, which writes only the old
column; a trigger keeps old and new writers correct and removes any
migration/deploy ordering requirement. See `061_add_focus_product_multi_codes.sql`.

---

## 🚨 Deploying

**This repo does NOT auto-deploy.** There is no `render.yaml` and no deploy
hook. Pushing to `main` changes nothing on the live service — a **Manual Deploy
must be clicked** in the Render dashboard for `paasrtsm-project`.

When someone reports "I deployed and it's still broken", confirm which of the
two repos was actually deployed before debugging anything else. `admin-web` in
`SC-StockDay-Ordering` *does* auto-deploy, so it is easy to ship a frontend
change and assume the backend went with it. It did not.

Feature-flagged backend work also needs its env var set in Render (e.g.
`FEATURE_VIDEO_STUDIO=true`) — merging alone does not activate it.

---

## Concurrent agents

Assume another agent is editing this repo right now.

- `git fetch` before you branch, before you create numbered files, and again
  before you push.
- If a push is rejected, **look at what landed before reconciling** — check
  whether their commits touch the same files as yours rather than reflexively
  rebasing or forcing.
- Never `reset --hard` or discard a commit you did not write without asking the
  user first. Record the SHA before any history rewrite so it stays recoverable.
