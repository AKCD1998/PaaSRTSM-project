# migrations/

Applied against the **production** Postgres (`sc_drug_db` on Render). Read
[../AGENTS.md](../AGENTS.md) before adding or running anything here.

## Two-minute checklist

**Creating a file**

```sh
git fetch origin main
ls migrations | tail -5                                    # local
git ls-tree --name-only origin/main migrations/ | tail -5   # remote
```

Number above the higher of the two. **Re-check both right before you push** —
another agent may have taken your number in the meantime. This repo already has
two `020_` files from exactly that race; do not add a third.

**Running against production**

```sql
SELECT filename FROM public.schema_migrations ORDER BY filename DESC LIMIT 10;
```

Compare the path separator with what your OS produces. Linux/Render records
`migrations/0NN_x.sql`; Windows records `migrations\0NN_x.sql`. The runner
skip-check is an exact string match, so **`npm run db:migrate` on Windows
re-applies everything Render already applied.** If the styles differ, skip the
runner:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0NN_your_file.sql
```

**Dry run first** — copy the file, swap the final `COMMIT;` for `ROLLBACK;`, and
run that. Validates syntax and constraints against real data, commits nothing.

Then verify the tables you touched actually changed as intended.

## Style

Write every migration so re-running it is a no-op — the above means it may be.

- `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`
- `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`
- `INSERT ... ON CONFLICT DO NOTHING`
- `UPDATE`s guarded so a second pass changes nothing (`COALESCE`, or a `WHERE`
  that excludes already-updated rows)

When a new column must stay in step with an older one, prefer a **trigger** over
a `CHECK`. A `CHECK` fails every write from the still-running previous build,
which only knows the old column; a trigger keeps both old and new writers
correct and removes any ordering requirement between the migration and the
deploy. Worked example: `061_add_focus_product_multi_codes.sql`.
