BEGIN;
CREATE TABLE IF NOT EXISTS ordering.scpda_companion_accounts (
 operator_code text PRIMARY KEY,
 branch_code text NOT NULL CHECK(branch_code IN ('004','005')),
 primary_operator_code text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 2 AND 9999),
 password_hash text NOT NULL,credential_version uuid NOT NULL,
 rotation_due_at timestamptz NOT NULL,created_at timestamptz NOT NULL,
 revoked_at timestamptz,
 UNIQUE(primary_operator_code,ordinal),
 CHECK((branch_code='004' AND primary_operator_code IN ('01004','01004SHPEE')) OR (branch_code='005' AND primary_operator_code='01005')),
 CHECK(operator_code=(CASE WHEN ordinal<10 THEN '0' ELSE '' END)||ordinal::text||branch_code||(CASE WHEN primary_operator_code='01004SHPEE' THEN 'SHPEE' ELSE '' END))
);
-- Add 004 team-scoped daily access without rewriting existing evidence,
-- credentials, permanent bindings, invitations, or the existing 005 pilot.
DO $$
DECLARE c record;
BEGIN
 FOR c IN
  SELECT t.relname, k.conname FROM pg_constraint k
  JOIN pg_class t ON t.oid=k.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='ordering' AND k.contype='c'
   AND t.relname IN ('scpda_operator_devices','scpda_daily_sessions','scpda_companion_grants')
   AND (pg_get_constraintdef(k.oid) LIKE '%operator_code%' OR pg_get_constraintdef(k.oid) LIKE '%branch_code%')
 LOOP EXECUTE format('ALTER TABLE ordering.%I DROP CONSTRAINT %I',c.relname,c.conname); END LOOP;
END $$;
ALTER TABLE ordering.scpda_operator_devices ADD CONSTRAINT scpda_operator_devices_identity_check
 CHECK((branch_code='004' AND operator_code ~ '^(0[2-9]|[1-9][0-9]{1,3})004(SHPEE)?$') OR
       (branch_code='005' AND operator_code ~ '^(0[2-9]|[1-9][0-9]{1,3})005$'));
ALTER TABLE ordering.scpda_daily_sessions ADD CONSTRAINT scpda_daily_sessions_identity_check
 CHECK((branch_code='004' AND operator_code ~ '^(01|0[2-9]|[1-9][0-9]{1,3})004(SHPEE)?$') OR
       (branch_code='005' AND operator_code ~ '^(01|0[2-9]|[1-9][0-9]{1,3})005$'));
ALTER TABLE ordering.scpda_daily_sessions ADD CONSTRAINT scpda_daily_sessions_parent_role_check
 CHECK((operator_code IN ('01004','01004SHPEE','01005') AND primary_session_id IS NULL) OR
       (operator_code ~ '^(0[2-9]|[1-9][0-9]{1,3})(004(SHPEE)?|005)$' AND primary_session_id IS NOT NULL));
ALTER TABLE ordering.scpda_companion_grants ADD CONSTRAINT scpda_companion_grants_operator_code_check
 CHECK(operator_code ~ '^(0[2-9]|[1-9][0-9]{1,3})(004(SHPEE)?|005)$');
ALTER TABLE ordering.scpda_observations DROP CONSTRAINT IF EXISTS scpda_observations_operator_code_check;
ALTER TABLE ordering.scpda_observations ADD CONSTRAINT scpda_observations_operator_code_check
 CHECK(operator_code IN ('01001','02001','03001') OR operator_code ~ '^(01|0[2-9]|[1-9][0-9]{1,3})(004(SHPEE)?|005)$');
ALTER TABLE ordering.scpda_observations DROP CONSTRAINT IF EXISTS scpda_observations_operator_branch_check;
ALTER TABLE ordering.scpda_observations ADD CONSTRAINT scpda_observations_operator_branch_check
 CHECK((branch_code='001' AND operator_code IN ('01001','02001','03001')) OR
       (branch_code='004' AND operator_code ~ '^(01|0[2-9]|[1-9][0-9]{1,3})004(SHPEE)?$') OR
       (branch_code='005' AND operator_code ~ '^(01|0[2-9]|[1-9][0-9]{1,3})005$'));
ALTER TABLE ordering.scpda_observations DROP CONSTRAINT IF EXISTS scpda_observations_companion_scope_check;
ALTER TABLE ordering.scpda_observations ADD CONSTRAINT scpda_observations_companion_scope_check
 CHECK((operator_code !~ '^(0[2-9]|[1-9][0-9]{1,3})004$' OR count_scope IS NOT DISTINCT FROM '004-front') AND
       (operator_code !~ '^(0[2-9]|[1-9][0-9]{1,3})004SHPEE$' OR count_scope IS NOT DISTINCT FROM '004-shopee'));
COMMIT;
