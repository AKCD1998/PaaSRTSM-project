BEGIN;
CREATE SCHEMA IF NOT EXISTS app_center;
CREATE TABLE IF NOT EXISTS app_center.releases (
  release_id uuid PRIMARY KEY,
  app_id text NOT NULL CHECK (app_id = 'scpda'),
  package_name text NOT NULL,
  version_code integer NOT NULL CHECK (version_code > 0),
  version_name text NOT NULL CHECK (length(version_name) BETWEEN 1 AND 100),
  min_sdk integer NOT NULL CHECK (min_sdk >= 26),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1024 AND 16777216),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  signer_sha256 text NOT NULL CHECK (signer_sha256 ~ '^[a-f0-9]{64}$'),
  object_key text NOT NULL UNIQUE,
  release_notes text NOT NULL CHECK (length(release_notes) BETWEEN 1 AND 8000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','withdrawn')),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  published_at timestamptz,
  published_by text,
  UNIQUE(app_id, version_code)
);
CREATE INDEX IF NOT EXISTS app_center_published_versions ON app_center.releases(app_id, version_code DESC) WHERE status = 'published';
COMMENT ON TABLE app_center.releases IS 'SC-owned immutable APK identities; publication state only. APK bytes reside in private R2, never Render temporary disk.';
COMMIT;
