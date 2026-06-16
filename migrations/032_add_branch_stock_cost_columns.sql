BEGIN;

ALTER TABLE ada.branch_stock_snapshots
  ADD COLUMN IF NOT EXISTS cost_avg_branch_000 numeric(18,4),
  ADD COLUMN IF NOT EXISTS cost_avg_branch_001 numeric(18,4),
  ADD COLUMN IF NOT EXISTS cost_avg_branch_002 numeric(18,4),
  ADD COLUMN IF NOT EXISTS cost_avg_branch_003 numeric(18,4),
  ADD COLUMN IF NOT EXISTS cost_avg_branch_004 numeric(18,4),
  ADD COLUMN IF NOT EXISTS cost_avg_branch_005 numeric(18,4);

COMMIT;
