BEGIN;
-- Add only the user-authorized004 pilot to the append-only count evidence ledger.
-- This does not change an Ada balance, observation, review or other branch.
ALTER TABLE ordering.scpda_observations DROP CONSTRAINT IF EXISTS scpda_observations_branch_code_check;
ALTER TABLE ordering.scpda_observations ADD CONSTRAINT scpda_observations_branch_code_check CHECK(branch_code IN ('001','004','005'));
ALTER TABLE ordering.scpda_observations DROP CONSTRAINT IF EXISTS scpda_observations_operator_code_check;
ALTER TABLE ordering.scpda_observations ADD CONSTRAINT scpda_observations_operator_code_check CHECK(operator_code IN ('01001','02001','03001','01004','01005'));
ALTER TABLE ordering.scpda_observations DROP CONSTRAINT IF EXISTS scpda_observations_operator_branch_check;
ALTER TABLE ordering.scpda_observations ADD CONSTRAINT scpda_observations_operator_branch_check CHECK((branch_code='001' AND operator_code IN ('01001','02001','03001')) OR (branch_code='004' AND operator_code='01004') OR (branch_code='005' AND operator_code='01005'));
ALTER TABLE ordering.scpda_fefo_projections DROP CONSTRAINT IF EXISTS scpda_fefo_projections_branch_code_check;
ALTER TABLE ordering.scpda_fefo_projections ADD CONSTRAINT scpda_fefo_projections_branch_code_check CHECK(branch_code IN ('001','004','005'));
COMMIT;
