BEGIN;

CREATE SCHEMA IF NOT EXISTS evidence;

CREATE TABLE IF NOT EXISTS evidence.hourly_stock_capture_runs (
  capture_id BIGSERIAL PRIMARY KEY,
  idempotency_key CHAR(64) NOT NULL UNIQUE,
  contract_version TEXT NOT NULL,
  branch_code CHAR(3) NOT NULL,
  observation_kind TEXT NOT NULL,
  planned_slot CHAR(5) NOT NULL,
  planned_for TIMESTAMPTZ NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  source_event_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  record_count INTEGER NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  client_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT hourly_stock_capture_branch_check
    CHECK (branch_code IN ('000', '001', '003', '004', '005')),
  CONSTRAINT hourly_stock_capture_kind_check
    CHECK (observation_kind IN ('morning_anchor', 'intraday')),
  CONSTRAINT hourly_stock_capture_slot_check
    CHECK (planned_slot ~ '^[0-2][0-9]:[0-5][0-9]$'),
  CONSTRAINT hourly_stock_capture_record_count_check
    CHECK (record_count > 0 AND record_count <= 500),
  CONSTRAINT hourly_stock_capture_digest_check
    CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hourly_stock_capture_idempotency_check
    CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hourly_stock_source_event_order_check
    CHECK (source_event_at IS NULL OR source_event_at <= captured_at),
  CONSTRAINT hourly_stock_planned_date_check
    CHECK ((planned_for AT TIME ZONE 'Asia/Bangkok')::date = (captured_at AT TIME ZONE 'Asia/Bangkok')::date)
);

CREATE TABLE IF NOT EXISTS evidence.hourly_stock_capture_rows (
  capture_id BIGINT NOT NULL
    REFERENCES evidence.hourly_stock_capture_runs(capture_id) ON DELETE RESTRICT,
  product_code TEXT NOT NULL,
  retail_on_hand NUMERIC NOT NULL,
  latest_estimated_on_hand NUMERIC,
  PRIMARY KEY (capture_id, product_code),
  CONSTRAINT hourly_stock_product_code_nonempty_check
    CHECK (length(btrim(product_code)) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS hourly_stock_capture_branch_time_idx
  ON evidence.hourly_stock_capture_runs(branch_code, captured_at DESC);

CREATE INDEX IF NOT EXISTS hourly_stock_capture_slot_idx
  ON evidence.hourly_stock_capture_runs(branch_code, observation_kind, planned_slot, captured_at DESC);

CREATE INDEX IF NOT EXISTS hourly_stock_capture_rows_product_idx
  ON evidence.hourly_stock_capture_rows(product_code, capture_id DESC);

COMMIT;
