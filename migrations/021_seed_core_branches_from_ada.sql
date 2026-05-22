BEGIN;

-- Populate core.branches from ada.branches so that is_hq and is_active are
-- correctly derived. Branch 000 is identified as HQ by the derivation logic in
-- ada.refresh_foundations() which uses: branch_code = '000' AS is_hq.
-- This is idempotent (ON CONFLICT ... DO UPDATE inside the function).
SELECT stage, affected_rows FROM ada.refresh_foundations();

COMMIT;
