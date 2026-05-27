BEGIN;

CREATE TABLE IF NOT EXISTS ada.branch_stock_uploads (
  branch_stock_upload_id bigserial PRIMARY KEY,
  branch_code text NOT NULL,
  source_mode text NOT NULL,
  source_date date NOT NULL,
  generated_at timestamptz NOT NULL,
  source_reference text,
  idempotency_key text NOT NULL UNIQUE,
  payload_hash text NOT NULL,
  raw_payload jsonb NOT NULL,
  diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb,
  normalized_records jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  accepted_rows integer NOT NULL DEFAULT 0,
  rejected_rows integer NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ada_branch_stock_uploads_branch_source_date
  ON ada.branch_stock_uploads (branch_code, source_date DESC);

CREATE INDEX IF NOT EXISTS idx_ada_branch_stock_uploads_generated_at
  ON ada.branch_stock_uploads (generated_at DESC);

COMMIT;
