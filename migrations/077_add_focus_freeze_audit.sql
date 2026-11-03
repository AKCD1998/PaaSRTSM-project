BEGIN;

ALTER TABLE focus.focus_products
  ADD COLUMN IF NOT EXISTS freeze_completion_runs jsonb;

CREATE TABLE IF NOT EXISTS focus.freeze_audit (
  audit_id bigserial PRIMARY KEY,
  focus_id bigint NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  definition jsonb NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_focus_freeze_audit_focus
  ON focus.freeze_audit (focus_id, changed_at);

-- Evidence is appended in the same transaction as a freeze or correction.
CREATE OR REPLACE FUNCTION focus.record_freeze_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_snapshot jsonb;
  new_snapshot jsonb;
BEGIN
  old_snapshot := jsonb_build_object(
    'soldByBranch', OLD.frozen_sold_by_branch, 'totalSold', OLD.frozen_total_sold,
    'soldByBranchByProduct', OLD.frozen_sold_by_branch_by_product,
    'frozenAt', OLD.frozen_at, 'completionRuns', OLD.freeze_completion_runs);
  new_snapshot := jsonb_build_object(
    'soldByBranch', NEW.frozen_sold_by_branch, 'totalSold', NEW.frozen_total_sold,
    'soldByBranchByProduct', NEW.frozen_sold_by_branch_by_product,
    'frozenAt', NEW.frozen_at, 'completionRuns', NEW.freeze_completion_runs);
  IF old_snapshot IS DISTINCT FROM new_snapshot THEN
    INSERT INTO focus.freeze_audit (focus_id, reason, definition, before_snapshot, after_snapshot)
    VALUES (NEW.id,
      COALESCE(NULLIF(current_setting('app.focus_freeze_reason', true), ''),
        CASE WHEN NEW.frozen_at IS NULL THEN 'range_changed' ELSE 'automatic_close' END),
      jsonb_build_object('productCodes', OLD.product_codes, 'focusType', OLD.focus_type,
        'dateFrom', OLD.date_from, 'dateTo', OLD.date_to, 'branchCodes', OLD.branch_codes,
        'targetQty', OLD.target_qty, 'branchTargets', OLD.branch_targets,
        'assignedStaffId', OLD.assigned_staff_id),
      old_snapshot, new_snapshot);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS focus_freeze_audit ON focus.focus_products;
CREATE TRIGGER focus_freeze_audit
AFTER UPDATE OF frozen_sold_by_branch, frozen_total_sold, frozen_at,
  frozen_sold_by_branch_by_product, freeze_completion_runs
ON focus.focus_products
FOR EACH ROW EXECUTE FUNCTION focus.record_freeze_audit();

COMMIT;
