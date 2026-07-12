BEGIN;

-- group_manager focus rows need a distinct target per branch (e.g. branch 001
-- targets 8 units of a product while branch 005 targets 3 of the same product),
-- with success requiring every branch to independently clear its own number.
-- branch_targets is a {branch_code: target_qty} map; when a branch isn't
-- present in the map, services/focusProducts.js falls back to the row's
-- global target_qty. NULL (the common case for the other 3 focus types,
-- which use one shared/global target) means "no overrides".

ALTER TABLE focus.focus_products
  ADD COLUMN IF NOT EXISTS branch_targets jsonb;

COMMIT;
