BEGIN;

ALTER TABLE focus.focus_products
  ADD COLUMN IF NOT EXISTS assigned_staff_id bigint
  REFERENCES core.branch_staff(staff_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_focus_products_assigned_staff
  ON focus.focus_products (assigned_staff_id)
  WHERE assigned_staff_id IS NOT NULL;

COMMIT;
