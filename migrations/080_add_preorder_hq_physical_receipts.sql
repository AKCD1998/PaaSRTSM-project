BEGIN;

CREATE TABLE IF NOT EXISTS customer_relations.preorder_hq_receipt_batches (
  batch_id uuid PRIMARY KEY,
  source_key text NOT NULL UNIQUE,
  source_branch_code text NOT NULL,
  source_doc_no text NOT NULL,
  source_line_seq integer NOT NULL CHECK (source_line_seq > 0),
  product_code text NOT NULL,
  unit_code text NOT NULL CHECK (btrim(unit_code) <> ''),
  verified_quantity numeric(14,4) NOT NULL DEFAULT 0 CHECK (verified_quantity >= 0),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  last_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_relations.preorder_hq_receipt_events (
  receipt_event_id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES customer_relations.preorder_hq_receipt_batches(batch_id) ON DELETE RESTRICT,
  case_id bigint NOT NULL REFERENCES customer_relations.preorder_cases(case_id) ON DELETE RESTRICT,
  item_id bigint NOT NULL REFERENCES customer_relations.preorder_items(item_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('COUNTED', 'CORRECTED')),
  quantity numeric(14,4) NOT NULL CHECK (quantity >= 0),
  unit_code text NOT NULL CHECK (btrim(unit_code) <> ''),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id text NOT NULL,
  actor_work_role text NOT NULL CHECK (actor_work_role = 'fulfillment'),
  expected_case_version integer NOT NULL CHECK (expected_case_version > 0),
  resulting_case_version integer NOT NULL CHECK (resulting_case_version = expected_case_version + 1),
  expected_batch_version integer NOT NULL CHECK (expected_batch_version >= 0),
  resulting_batch_version integer NOT NULL CHECK (resulting_batch_version = expected_batch_version + 1),
  supersedes_event_id uuid REFERENCES customer_relations.preorder_hq_receipt_events(receipt_event_id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  reason text,
  CONSTRAINT preorder_hq_receipt_event_version_unique UNIQUE (batch_id, resulting_batch_version),
  CONSTRAINT preorder_hq_receipt_event_shape CHECK (
    (event_type = 'COUNTED' AND expected_batch_version = 0 AND resulting_batch_version = 1
      AND supersedes_event_id IS NULL)
    OR
    (event_type = 'CORRECTED' AND expected_batch_version > 0 AND supersedes_event_id IS NOT NULL
      AND NULLIF(btrim(reason), '') IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_preorder_hq_receipt_events_case_item
  ON customer_relations.preorder_hq_receipt_events(case_id, item_id, recorded_at DESC);

CREATE OR REPLACE FUNCTION customer_relations.reject_preorder_hq_receipt_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'preorder HQ receipt events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS preorder_hq_receipt_events_append_only
  ON customer_relations.preorder_hq_receipt_events;
CREATE TRIGGER preorder_hq_receipt_events_append_only
  BEFORE UPDATE OR DELETE ON customer_relations.preorder_hq_receipt_events
  FOR EACH ROW EXECUTE FUNCTION customer_relations.reject_preorder_hq_receipt_event_mutation();

COMMIT;
