BEGIN;

-- Inter-branch stock request fulfillment (WP-13, Phase 5).
-- Additive: dispatch (source branch ships) and receipt (requesting branch receives)
-- with per-line quantities for difference reporting. The request lifecycle moves
-- ACKNOWLEDGED -> DISPATCHED -> RECEIVED using statuses already allowed by the
-- ordering.stock_requests CHECK constraint from migration 033.

CREATE SCHEMA IF NOT EXISTS ordering;

-- One shipment per dispatch event (source branch hands a parcel to the requester).
CREATE TABLE IF NOT EXISTS ordering.stock_request_shipments (
  shipment_id bigserial PRIMARY KEY,
  request_id bigint NOT NULL
    REFERENCES ordering.stock_requests(request_id) ON DELETE CASCADE,
  dispatched_by text,
  note text,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_request_shipments_request_id
  ON ordering.stock_request_shipments (request_id);

CREATE TABLE IF NOT EXISTS ordering.stock_request_shipment_lines (
  shipment_line_id bigserial PRIMARY KEY,
  shipment_id bigint NOT NULL
    REFERENCES ordering.stock_request_shipments(shipment_id) ON DELETE CASCADE,
  line_id bigint NOT NULL
    REFERENCES ordering.stock_request_lines(line_id) ON DELETE CASCADE,
  dispatched_qty numeric(14,4) NOT NULL DEFAULT 0 CHECK (dispatched_qty >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_request_shipment_lines_shipment_line_key
    UNIQUE (shipment_id, line_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_request_shipment_lines_shipment_id
  ON ordering.stock_request_shipment_lines (shipment_id);

CREATE INDEX IF NOT EXISTS idx_stock_request_shipment_lines_line_id
  ON ordering.stock_request_shipment_lines (line_id);

-- One receipt per receive event (requesting branch records what actually arrived).
CREATE TABLE IF NOT EXISTS ordering.stock_request_receipts (
  receipt_id bigserial PRIMARY KEY,
  request_id bigint NOT NULL
    REFERENCES ordering.stock_requests(request_id) ON DELETE CASCADE,
  received_by text,
  note text,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_request_receipts_request_id
  ON ordering.stock_request_receipts (request_id);

CREATE TABLE IF NOT EXISTS ordering.stock_request_receipt_lines (
  receipt_line_id bigserial PRIMARY KEY,
  receipt_id bigint NOT NULL
    REFERENCES ordering.stock_request_receipts(receipt_id) ON DELETE CASCADE,
  line_id bigint NOT NULL
    REFERENCES ordering.stock_request_lines(line_id) ON DELETE CASCADE,
  received_qty numeric(14,4) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_request_receipt_lines_receipt_line_key
    UNIQUE (receipt_id, line_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_request_receipt_lines_receipt_id
  ON ordering.stock_request_receipt_lines (receipt_id);

CREATE INDEX IF NOT EXISTS idx_stock_request_receipt_lines_line_id
  ON ordering.stock_request_receipt_lines (line_id);

COMMIT;
