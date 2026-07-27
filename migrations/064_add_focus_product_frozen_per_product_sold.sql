BEGIN;

-- frozen_sold_by_branch (migration 046) only stores the group's combined
-- per-branch total, so a frozen (past, locked) shared-target row can't show
-- which individual product code contributed how much. This adds the same
-- snapshot at per-product granularity: {productCode: {branchCode: qty}}.
-- Rows frozen before this migration keep frozen_sold_by_branch_by_product
-- NULL — their per-product detail was never captured and can't be recovered.

ALTER TABLE focus.focus_products
  ADD COLUMN IF NOT EXISTS frozen_sold_by_branch_by_product jsonb;

COMMIT;
