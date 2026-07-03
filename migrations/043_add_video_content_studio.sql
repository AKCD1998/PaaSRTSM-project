BEGIN;

CREATE SCHEMA IF NOT EXISTS content;

CREATE TABLE IF NOT EXISTS content.video_assets (
  asset_id bigserial PRIMARY KEY,
  asset_public_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  storage_provider text NOT NULL,
  storage_key text NOT NULL,
  original_filename text NULL,
  mime_type text NULL,
  file_size_bytes bigint NULL,
  asset_type text NOT NULL CHECK (asset_type IN ('input_image','input_video','generated_video','thumbnail','export')),
  checksum text NULL,
  width integer NULL,
  height integer NULL,
  duration_seconds numeric NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS content.video_jobs (
  job_id bigserial PRIMARY KEY,
  job_public_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','processing','completed','failed','cancelled','approved','rejected')),
  provider text NOT NULL,
  model text NOT NULL,
  provider_job_id text NULL,
  prompt text NOT NULL,
  negative_prompt text NULL,
  aspect_ratio text NOT NULL CHECK (aspect_ratio IN ('16:9','9:16','1:1')),
  duration_seconds integer NOT NULL,
  input_asset_id bigint NULL REFERENCES content.video_assets(asset_id),
  product_id_or_sku_reference text NULL,
  output_asset_id bigint NULL REFERENCES content.video_assets(asset_id),
  estimated_cost numeric NULL,
  actual_cost numeric NULL,
  error_code text NULL,
  error_message text NULL,
  retry_count integer NOT NULL DEFAULT 0,
  submitted_at timestamptz NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  approved_at timestamptz NULL,
  approved_by text NULL,
  rejected_at timestamptz NULL,
  rejected_by text NULL,
  rejection_reason text NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS content.video_job_events (
  event_id bigserial PRIMARY KEY,
  video_job_id bigint NOT NULL REFERENCES content.video_jobs(job_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  message text NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NULL
);

CREATE INDEX IF NOT EXISTS idx_video_jobs_status
  ON content.video_jobs (status);

CREATE INDEX IF NOT EXISTS idx_video_jobs_created_by
  ON content.video_jobs (created_by);

CREATE INDEX IF NOT EXISTS idx_video_jobs_product_id_or_sku_reference
  ON content.video_jobs (product_id_or_sku_reference);

CREATE INDEX IF NOT EXISTS idx_video_job_events_video_job_id
  ON content.video_job_events (video_job_id);

COMMIT;
