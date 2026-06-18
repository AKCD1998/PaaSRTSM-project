BEGIN;

-- Inter-branch stock request workflow (WP-01, plan §8).
-- Additive and backward-compatible: introduces a dedicated ordering.stock_request_*
-- domain alongside the legacy single-branch ordering.branch_order_requests flow,
-- which is left untouched. Gated at the route/UI layer by FEATURE_STOCK_REQUESTS.

CREATE SCHEMA IF NOT EXISTS ordering;

-- One row per checkout submission (a batch may fan out to several source branches).
CREATE TABLE IF NOT EXISTS ordering.stock_request_batches (
  batch_id bigserial PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  requesting_branch_code text NOT NULL REFERENCES core.branches(branch_code),
  status text NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN (
      'DRAFT', 'SUBMITTED', 'PARTIALLY_RESPONDED', 'RESPONDED',
      'ACKNOWLEDGED', 'COMPLETED', 'CANCELLED'
    )),
  created_by text,
  note text,
  idempotency_key text UNIQUE,
  version integer NOT NULL DEFAULT 1,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_request_batches_requesting_branch
  ON ordering.stock_request_batches (requesting_branch_code, status);

CREATE INDEX IF NOT EXISTS idx_stock_request_batches_created_at
  ON ordering.stock_request_batches (created_at DESC);

-- One child request per source branch within a batch.
CREATE TABLE IF NOT EXISTS ordering.stock_requests (
  request_id bigserial PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  batch_id bigint NOT NULL
    REFERENCES ordering.stock_request_batches(batch_id) ON DELETE CASCADE,
  requesting_branch_code text NOT NULL REFERENCES core.branches(branch_code),
  source_branch_code text NOT NULL REFERENCES core.branches(branch_code),
  status text NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN (
      'SUBMITTED', 'RESPONDED', 'ACKNOWLEDGED', 'READY_TO_DISPATCH',
      'DISPATCHED', 'RECEIVED', 'COMPLETED', 'CANCELLED'
    )),
  responded_by text,
  responded_at timestamptz,
  acknowledged_by text,
  acknowledged_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_requests_source_not_requesting
    CHECK (source_branch_code <> requesting_branch_code)
);

CREATE INDEX IF NOT EXISTS idx_stock_requests_source_branch_status
  ON ordering.stock_requests (source_branch_code, status);

CREATE INDEX IF NOT EXISTS idx_stock_requests_requesting_branch_status
  ON ordering.stock_requests (requesting_branch_code, status);

CREATE INDEX IF NOT EXISTS idx_stock_requests_batch_id
  ON ordering.stock_requests (batch_id);

-- One requested product per child request, with immutable snapshots frozen at submit.
CREATE TABLE IF NOT EXISTS ordering.stock_request_lines (
  line_id bigserial PRIMARY KEY,
  request_id bigint NOT NULL
    REFERENCES ordering.stock_requests(request_id) ON DELETE CASCADE,
  product_code text NOT NULL REFERENCES public.skus(company_code),
  product_name_thai text,
  product_name_eng text,
  barcode text,
  unit text NOT NULL,
  requested_qty numeric(14,4) NOT NULL CHECK (requested_qty > 0),
  snapshot_qty numeric(14,4),
  snapshot_synced_at timestamptz,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED_FULL', 'APPROVED_PARTIAL', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_request_lines_request_product_unit_key
    UNIQUE (request_id, product_code, unit)
);

CREATE INDEX IF NOT EXISTS idx_stock_request_lines_request_id
  ON ordering.stock_request_lines (request_id);

CREATE INDEX IF NOT EXISTS idx_stock_request_lines_product_code
  ON ordering.stock_request_lines (product_code);

-- Receiver's per-line answer; versioned/amendable (corrections add a superseding row).
CREATE TABLE IF NOT EXISTS ordering.stock_request_line_responses (
  response_id bigserial PRIMARY KEY,
  line_id bigint NOT NULL
    REFERENCES ordering.stock_request_lines(line_id) ON DELETE CASCADE,
  response_status text NOT NULL
    CHECK (response_status IN ('APPROVED_FULL', 'APPROVED_PARTIAL', 'REJECTED')),
  approved_qty numeric(14,4) NOT NULL DEFAULT 0 CHECK (approved_qty >= 0),
  reason_code text,
  note text,
  revalidated_snapshot_qty numeric(14,4),
  is_submitted boolean NOT NULL DEFAULT FALSE,
  responded_by text,
  superseded_by bigint
    REFERENCES ordering.stock_request_line_responses(response_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_request_line_responses_line_id
  ON ordering.stock_request_line_responses (line_id);

-- Append-only domain event timeline (distinct from generic admin.audit_logs).
CREATE TABLE IF NOT EXISTS ordering.stock_request_events (
  event_id bigserial PRIMARY KEY,
  batch_id bigint
    REFERENCES ordering.stock_request_batches(batch_id) ON DELETE CASCADE,
  request_id bigint
    REFERENCES ordering.stock_requests(request_id) ON DELETE CASCADE,
  line_id bigint
    REFERENCES ordering.stock_request_lines(line_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user text,
  actor_branch text,
  metadata jsonb,
  note text,
  request_correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_request_events_batch_id
  ON ordering.stock_request_events (batch_id, created_at);

CREATE INDEX IF NOT EXISTS idx_stock_request_events_request_id
  ON ordering.stock_request_events (request_id, created_at);

-- DB-backed inbox (Phase-1 notifications: polling reads this table).
CREATE TABLE IF NOT EXISTS ordering.stock_request_notifications (
  notification_id bigserial PRIMARY KEY,
  recipient_branch_code text NOT NULL REFERENCES core.branches(branch_code),
  recipient_user text,
  type text NOT NULL,
  batch_id bigint
    REFERENCES ordering.stock_request_batches(batch_id) ON DELETE CASCADE,
  request_id bigint
    REFERENCES ordering.stock_requests(request_id) ON DELETE CASCADE,
  message text,
  link_target text,
  dedup_key text UNIQUE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_request_notifications_recipient
  ON ordering.stock_request_notifications (recipient_branch_code, read_at);

-- Versioned printable packing snapshot; reprints add a new version, never mutate.
CREATE TABLE IF NOT EXISTS ordering.stock_request_documents (
  document_id bigserial PRIMARY KEY,
  request_id bigint NOT NULL
    REFERENCES ordering.stock_requests(request_id) ON DELETE CASCADE,
  version integer NOT NULL,
  document_payload jsonb NOT NULL,
  generated_by text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  reprint_of bigint
    REFERENCES ordering.stock_request_documents(document_id),
  CONSTRAINT stock_request_documents_request_version_key
    UNIQUE (request_id, version)
);

CREATE INDEX IF NOT EXISTS idx_stock_request_documents_request_id
  ON ordering.stock_request_documents (request_id);

COMMIT;
