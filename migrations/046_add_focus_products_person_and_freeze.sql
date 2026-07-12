BEGIN;

-- Two additions to focus.focus_products (migration 045):
-- 1. assigned_person_name: free-text employee name for salesperson-type focus
--    rows. There's no HR/employee master table yet, so this is hardcoded text
--    until that system exists.
-- 2. frozen_*: once a focus row's date_to has passed, its sold-qty progress is
--    snapshotted once and locked, so later AdaPOS corrections (voids/refunds
--    posted after month-end) can't silently rewrite a month's historical
--    performance record. See services/focusProducts.js for the freeze-on-read logic.

ALTER TABLE focus.focus_products
  ADD COLUMN IF NOT EXISTS assigned_person_name text,
  ADD COLUMN IF NOT EXISTS frozen_sold_by_branch jsonb,
  ADD COLUMN IF NOT EXISTS frozen_total_sold numeric(14,4),
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz;

COMMIT;
