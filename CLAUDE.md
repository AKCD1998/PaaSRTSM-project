# CLAUDE.md

**Read [AGENTS.md](AGENTS.md) — it is the canonical instruction file for this
repo and applies to you in full.** It is kept in one place so Codex and Claude
cannot drift apart.

The two rules that have already caused incidents, repeated here so they are
never missed:

1. **Migrations.** `git fetch origin main` and check the highest migration
   number on **both** disk and `origin/main` before creating one, and again
   before pushing. Before *running* migrations, `SELECT filename FROM
   public.schema_migrations ORDER BY filename DESC LIMIT 10` and compare the
   path separator against your OS — **running `npm run db:migrate` from Windows
   re-applies every migration Render already applied** (happened 2026-07-21,
   051–060). If the separators differ, apply your one file with `psql -f`
   instead of using the runner.

2. **Deploying.** This repo does **not** auto-deploy. Pushing to `main` changes
   nothing live; a **Manual Deploy** must be clicked in the Render dashboard.
   `admin-web` in `SC-StockDay-Ordering` *does* auto-deploy, so a frontend
   change can ship while the backend it depends on silently does not.

See AGENTS.md for the full checklists, how to dry-run a migration with
`ROLLBACK`, and the rules for working alongside concurrent agents.
