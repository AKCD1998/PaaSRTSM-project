BEGIN;
-- Additive, opt-in pilot. Existing device invitations and observations survive.
CREATE TABLE IF NOT EXISTS ordering.scpda_operator_devices (
 operator_code text PRIMARY KEY CHECK(operator_code='02005'),
 branch_code text NOT NULL CHECK(branch_code='005'),
 device_ref text NOT NULL CHECK(device_ref ~ '^[a-f0-9]{64}$'),
 device_id uuid NOT NULL,
 public_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS ordering.scpda_daily_sessions (
 session_id uuid PRIMARY KEY,
 operator_code text NOT NULL CHECK(operator_code IN ('01005','02005')),
 branch_code text NOT NULL CHECK(branch_code='005'),
 device_ref text NOT NULL CHECK(device_ref ~ '^[a-f0-9]{64}$'),
 device_id uuid NOT NULL,
 public_key text NOT NULL,
 business_date date NOT NULL,
 primary_session_id uuid REFERENCES ordering.scpda_daily_sessions(session_id),
 network_hash text NOT NULL,
 app_version integer NOT NULL CHECK(app_version > 0),
 credential_version text NOT NULL,
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 CHECK(expires_at > created_at),
 CHECK((operator_code='01005' AND primary_session_id IS NULL) OR
       (operator_code='02005' AND primary_session_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS scpda_daily_active_device_day_idx ON ordering.scpda_daily_sessions(operator_code,device_ref,business_date) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS ordering.scpda_companion_grants (
 grant_id uuid PRIMARY KEY,
 secret_hash text NOT NULL,
 primary_session_id uuid NOT NULL REFERENCES ordering.scpda_daily_sessions(session_id),
 operator_code text NOT NULL CHECK(operator_code='02005'),
 app_version integer NOT NULL CHECK(app_version>0),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_session_id uuid REFERENCES ordering.scpda_daily_sessions(session_id),
 consumed_device_ref text,
 CHECK(expires_at>created_at)
);
CREATE TABLE IF NOT EXISTS ordering.scpda_selfie_archives (
 session_id uuid PRIMARY KEY REFERENCES ordering.scpda_daily_sessions(session_id),
 image_bytes bytea,
 image_sha256 text NOT NULL,
 file_name text NOT NULL,
 drive_file_id text UNIQUE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','uploaded','deleted')),
 created_at timestamptz NOT NULL,
 delete_after timestamptz NOT NULL,
 uploaded_at timestamptz,
 deleted_at timestamptz,
 CHECK(image_bytes IS NULL OR octet_length(image_bytes) BETWEEN 100 AND 204800)
);
CREATE INDEX IF NOT EXISTS scpda_selfie_archives_work_idx
 ON ordering.scpda_selfie_archives(state,delete_after);
ALTER TABLE ordering.scpda_observations DROP CONSTRAINT IF EXISTS scpda_observations_operator_code_check;
ALTER TABLE ordering.scpda_observations ADD CONSTRAINT scpda_observations_operator_code_check
 CHECK(operator_code IN ('01001','02001','03001','01004','01005','02005'));
ALTER TABLE ordering.scpda_observations DROP CONSTRAINT IF EXISTS scpda_observations_operator_branch_check;
ALTER TABLE ordering.scpda_observations ADD CONSTRAINT scpda_observations_operator_branch_check
 CHECK((branch_code='001' AND operator_code IN ('01001','02001','03001')) OR
 (branch_code='004' AND operator_code='01004') OR
 (branch_code='005' AND operator_code IN ('01005','02005')));
COMMIT;
