BEGIN;

CREATE TABLE IF NOT EXISTS ordering.stock_request_drafts (
  draft_id bigserial PRIMARY KEY,
  draft_public_id text NOT NULL UNIQUE,
  owner_user_id bigint NULL,
  owner_username text NOT NULL,
  branch_code text NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUBMITTED', 'DISCARDED')),
  version integer NOT NULL DEFAULT 1,
  submitted_batch_public_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz NULL
);

-- Only one ACTIVE draft per user+branch at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_request_drafts_active_owner_branch
  ON ordering.stock_request_drafts (owner_username, branch_code)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS ordering.stock_request_draft_lines (
  draft_line_id bigserial PRIMARY KEY,
  draft_id bigint NOT NULL REFERENCES ordering.stock_request_drafts(draft_id) ON DELETE CASCADE,
  line_key text NOT NULL,
  source_branch_code text NOT NULL,
  request_mode text NOT NULL DEFAULT 'STANDARD' CHECK (request_mode IN ('STANDARD', 'ADMIN_ALERT')),
  product_code text NOT NULL,
  unit text NOT NULL,
  requested_qty numeric(14,4) NOT NULL CHECK (requested_qty > 0),
  snapshot_qty numeric(14,4) NULL,
  snapshot_synced_at timestamptz NULL,
  line_note text NOT NULL DEFAULT '',
  product_name_th text NOT NULL DEFAULT '',
  product_name_en text NOT NULL DEFAULT '',
  barcode text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, line_key)
);

CREATE INDEX IF NOT EXISTS idx_stock_request_draft_lines_draft_id
  ON ordering.stock_request_draft_lines (draft_id);

COMMIT;
