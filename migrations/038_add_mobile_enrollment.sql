BEGIN;

-- Mobile PDA app enrollment (person-lite credential model).
-- Additive and backward-compatible. Gated at the route layer by FEATURE_MOBILE_PDA.
--
-- Flow: a branch "master" device (an existing role=branch user) mints a single-use,
-- short-lived enrollment code (rendered as a QR). An employee phone scans it, taps
-- their name from the branch roster, and redeems the code for a 24h branch-scoped
-- mobile token. Revocation is row-based (enrolled_devices.revoked_at) so a lost phone
-- or departed staff can be cut off immediately, without waiting for the 24h expiry.

CREATE SCHEMA IF NOT EXISTS ordering;

-- Branch staff roster. Drives the "tap your name" enrollment picker and the
-- "permanent staff only" policy (probationary staff are hidden from self-enroll).
CREATE TABLE IF NOT EXISTS core.branch_staff (
  staff_id bigserial PRIMARY KEY,
  branch_code text NOT NULL REFERENCES core.branches(branch_code),
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'sales' CHECK (role IN ('sales', 'manager')),
  is_active boolean NOT NULL DEFAULT TRUE,
  is_probationary boolean NOT NULL DEFAULT FALSE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branch_staff_branch
  ON core.branch_staff (branch_code, is_active);

-- Single-use, short-lived enrollment codes (the QR payload). Minted by a branch master.
CREATE TABLE IF NOT EXISTS ordering.enrollment_codes (
  code_id bigserial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  branch_code text NOT NULL REFERENCES core.branches(branch_code),
  issued_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  redeemed_staff_id bigint REFERENCES core.branch_staff(staff_id),
  redeemed_device_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enrollment_codes_branch
  ON ordering.enrollment_codes (branch_code, created_at DESC);

-- Active mobile device enrollments + revocation list. The 24h mobile token carries
-- enrollment_id; every authenticated request re-checks this row (revoked_at / expires_at).
CREATE TABLE IF NOT EXISTS ordering.enrolled_devices (
  enrollment_id bigserial PRIMARY KEY,
  device_id text NOT NULL,
  branch_code text NOT NULL REFERENCES core.branches(branch_code),
  staff_id bigint NOT NULL REFERENCES core.branch_staff(staff_id),
  role text NOT NULL CHECK (role IN ('sales', 'manager')),
  enrolled_by text,
  device_label text,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by text
);

CREATE INDEX IF NOT EXISTS idx_enrolled_devices_device
  ON ordering.enrolled_devices (device_id, revoked_at);

CREATE INDEX IF NOT EXISTS idx_enrolled_devices_branch_active
  ON ordering.enrolled_devices (branch_code, revoked_at);

COMMIT;
