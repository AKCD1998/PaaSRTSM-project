BEGIN;

CREATE TABLE IF NOT EXISTS ada.transfer_delta_checkpoints (
  branch_code text NOT NULL,
  dataset text NOT NULL DEFAULT 'transfers',
  contract_version text NOT NULL,
  checkpoint_sequence bigint NOT NULL DEFAULT 0 CHECK (checkpoint_sequence >= 0),
  checkpoint_token text,
  state_hash text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_code, dataset, contract_version)
);

CREATE TABLE IF NOT EXISTS ada.transfer_delta_requests (
  transfer_delta_request_id bigserial PRIMARY KEY,
  branch_code text NOT NULL,
  dataset text NOT NULL DEFAULT 'transfers',
  contract_version text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('apply', 'rebaseline')),
  idempotency_key text NOT NULL,
  content_hash text NOT NULL,
  base_checkpoint_token text,
  base_state_hash text,
  next_state_hash text NOT NULL,
  checkpoint_sequence bigint NOT NULL CHECK (checkpoint_sequence > 0),
  checkpoint_token text NOT NULL,
  status text NOT NULL CHECK (status IN ('applying', 'applied')),
  header_count integer NOT NULL DEFAULT 0 CHECK (header_count >= 0),
  line_count integer NOT NULL DEFAULT 0 CHECK (line_count >= 0),
  tombstone_count integer NOT NULL DEFAULT 0 CHECK (tombstone_count >= 0),
  response_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE (branch_code, dataset, contract_version, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_transfer_delta_requests_checkpoint
  ON ada.transfer_delta_requests (branch_code, dataset, contract_version, checkpoint_sequence DESC);

CREATE TABLE IF NOT EXISTS ada.transfer_delta_tombstone_audit (
  transfer_delta_request_id bigint NOT NULL
    REFERENCES ada.transfer_delta_requests(transfer_delta_request_id) ON DELETE RESTRICT,
  branch_code text NOT NULL,
  doc_type text NOT NULL,
  doc_no text NOT NULL,
  evidence_type text NOT NULL CHECK (evidence_type = 'source-hard-delete'),
  evidence_id text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transfer_delta_request_id, branch_code, doc_type, doc_no)
);

COMMIT;
