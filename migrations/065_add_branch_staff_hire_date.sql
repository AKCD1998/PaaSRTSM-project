BEGIN;

-- Salesperson focus tables (โฟกัสรายคน) need to list staff in seniority order
-- (earliest hire first) instead of whatever order they happen to have been
-- inserted in. hire_date is admin-entered via a new staff management panel —
-- NULL for existing staff until backfilled, so callers must sort NULLs last
-- rather than treating an unknown date as "earliest".
ALTER TABLE core.branch_staff
  ADD COLUMN IF NOT EXISTS hire_date date;

COMMIT;
