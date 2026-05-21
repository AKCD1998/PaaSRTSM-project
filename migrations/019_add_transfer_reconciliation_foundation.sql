BEGIN;

CREATE SCHEMA IF NOT EXISTS reconciliation;

CREATE TABLE IF NOT EXISTS reconciliation.transfer_documents (
  transfer_document_id bigserial PRIMARY KEY,
  source_doc_no text NOT NULL,
  source_doc_type text NOT NULL,
  source_branch_code text NOT NULL,
  dispatch_branch_code text,
  receiving_branch_code text,
  warehouse_code text,
  warehouse_code_to text,
  doc_date date,
  doc_time text,
  source_direction text NOT NULL
    CHECK (source_direction IN ('outbound', 'inbound', 'other')),
  doc_status text,
  process_status text,
  process_state text NOT NULL
    CHECK (process_state IN ('processed', 'unprocessed', 'not_applicable', 'unknown')),
  source_status_class text NOT NULL
    CHECK (source_status_class IN ('outbound_dispatch', 'inbound_receipt', 'other')),
  reference_doc_no text,
  reference_doc_type text,
  source_match_method text,
  matched_doc_no text,
  matched_doc_type text,
  matched_branch_code text,
  matched_candidate_count integer NOT NULL DEFAULT 0 CHECK (matched_candidate_count >= 0),
  unique_match boolean NOT NULL DEFAULT FALSE,
  total_line_count integer NOT NULL DEFAULT 0 CHECK (total_line_count >= 0),
  total_qty_base numeric(14,4) NOT NULL DEFAULT 0,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL,
  source_synced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_transfer_documents_source_key
    UNIQUE (source_doc_no, source_doc_type, source_branch_code)
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_documents_status
  ON reconciliation.transfer_documents (source_status_class, process_state, doc_date DESC);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_documents_receiving_branch
  ON reconciliation.transfer_documents (receiving_branch_code, doc_date DESC, source_doc_no);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_documents_dispatch_branch
  ON reconciliation.transfer_documents (dispatch_branch_code, doc_date DESC, source_doc_no);

CREATE TABLE IF NOT EXISTS reconciliation.transfer_document_lines (
  transfer_document_line_id bigserial PRIMARY KEY,
  source_doc_no text NOT NULL,
  source_doc_type text NOT NULL,
  source_branch_code text NOT NULL,
  source_line_no integer NOT NULL,
  dispatch_branch_code text,
  receiving_branch_code text,
  source_direction text NOT NULL
    CHECK (source_direction IN ('outbound', 'inbound', 'other')),
  product_code text NOT NULL,
  barcode text,
  unit_code text,
  unit_name text,
  qty numeric(14,4),
  qty_base numeric(14,4),
  normalized_qty_base numeric(14,4) NOT NULL DEFAULT 0,
  stock_factor numeric(14,4),
  lot_no text,
  expiry_date date,
  warehouse_code text,
  reference_doc_no text,
  reference_line_no text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL,
  source_synced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_transfer_document_lines_source_key
    UNIQUE (source_doc_no, source_doc_type, source_branch_code, source_line_no, product_code)
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_document_lines_product
  ON reconciliation.transfer_document_lines (product_code, source_synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_document_lines_doc_lookup
  ON reconciliation.transfer_document_lines (source_doc_no, source_doc_type, source_branch_code, source_line_no);

CREATE TABLE IF NOT EXISTS reconciliation.transfer_match_candidates (
  transfer_match_candidate_id bigserial PRIMARY KEY,
  outbound_doc_no text NOT NULL,
  outbound_doc_type text NOT NULL,
  outbound_branch_code text NOT NULL,
  inbound_doc_no text NOT NULL,
  inbound_doc_type text NOT NULL,
  inbound_branch_code text NOT NULL,
  match_method text NOT NULL,
  match_rank integer NOT NULL CHECK (match_rank > 0),
  inbound_process_state text NOT NULL
    CHECK (inbound_process_state IN ('processed', 'unprocessed', 'not_applicable', 'unknown')),
  source_synced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_transfer_match_candidates_key
    UNIQUE (outbound_doc_no, outbound_doc_type, outbound_branch_code, inbound_doc_no, inbound_doc_type, inbound_branch_code)
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_match_candidates_outbound
  ON reconciliation.transfer_match_candidates (outbound_branch_code, outbound_doc_no, match_rank);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_match_candidates_inbound
  ON reconciliation.transfer_match_candidates (inbound_branch_code, inbound_doc_no, match_rank);

CREATE TABLE IF NOT EXISTS reconciliation.transfer_cases (
  case_key text PRIMARY KEY,
  outbound_doc_no text,
  outbound_doc_type text,
  outbound_branch_code text,
  inbound_doc_no text,
  inbound_doc_type text,
  inbound_branch_code text,
  dispatch_branch_code text,
  receiving_branch_code text,
  case_doc_date date,
  source_match_status text NOT NULL
    CHECK (source_match_status IN ('outbound_only', 'inbound_present_unprocessed', 'inbound_processed', 'ambiguous_match', 'inbound_only_unmatched', 'other')),
  source_match_method text,
  match_candidate_count integer NOT NULL DEFAULT 0 CHECK (match_candidate_count >= 0),
  inbound_process_state text
    CHECK (inbound_process_state IN ('processed', 'unprocessed', 'not_applicable', 'unknown')),
  expected_total_qty_base numeric(14,4) NOT NULL DEFAULT 0,
  source_received_total_qty_base numeric(14,4) NOT NULL DEFAULT 0,
  qty_delta_source numeric(14,4) NOT NULL DEFAULT 0,
  latest_source_synced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_cases_status
  ON reconciliation.transfer_cases (source_match_status, case_doc_date DESC);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_cases_receiving_branch
  ON reconciliation.transfer_cases (receiving_branch_code, source_match_status, case_doc_date DESC);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_cases_dispatch_branch
  ON reconciliation.transfer_cases (dispatch_branch_code, source_match_status, case_doc_date DESC);

CREATE TABLE IF NOT EXISTS reconciliation.transfer_case_lines (
  transfer_case_line_id bigserial PRIMARY KEY,
  line_key text NOT NULL UNIQUE,
  case_key text NOT NULL,
  product_code text NOT NULL,
  barcode text,
  unit_code text,
  lot_no text,
  expiry_date date,
  outbound_qty_base numeric(14,4) NOT NULL DEFAULT 0,
  inbound_qty_base numeric(14,4) NOT NULL DEFAULT 0,
  qty_delta_source numeric(14,4) NOT NULL DEFAULT 0,
  line_status text NOT NULL
    CHECK (line_status IN ('outbound_only', 'inbound_only', 'matched', 'qty_mismatch', 'ambiguous_case')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_case_lines_case_key
  ON reconciliation.transfer_case_lines (case_key);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_case_lines_product
  ON reconciliation.transfer_case_lines (product_code, line_status);

CREATE TABLE IF NOT EXISTS reconciliation.transfer_reconciliations (
  reconciliation_id bigserial PRIMARY KEY,
  case_key text NOT NULL UNIQUE,
  receiving_branch_code text,
  resolution_status text NOT NULL DEFAULT 'draft'
    CHECK (resolution_status IN ('draft', 'confirmed', 'discrepancy_recorded', 'approved', 'cancelled')),
  confirmed_by text,
  approved_by text,
  resolved_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_reconciliations_status
  ON reconciliation.transfer_reconciliations (resolution_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_reconciliations_receiving_branch
  ON reconciliation.transfer_reconciliations (receiving_branch_code, updated_at DESC);

CREATE TABLE IF NOT EXISTS reconciliation.transfer_reconciliation_lines (
  reconciliation_line_id bigserial PRIMARY KEY,
  reconciliation_id bigint NOT NULL REFERENCES reconciliation.transfer_reconciliations(reconciliation_id) ON DELETE CASCADE,
  product_code text NOT NULL,
  source_barcode text,
  source_unit_code text,
  lot_no text,
  expiry_date date,
  expected_qty_base numeric(14,4) NOT NULL DEFAULT 0,
  actual_received_qty_base numeric(14,4) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_reconciliation_lines_reconciliation
  ON reconciliation.transfer_reconciliation_lines (reconciliation_id);

CREATE TABLE IF NOT EXISTS reconciliation.transfer_reconciliation_events (
  reconciliation_event_id bigserial PRIMARY KEY,
  reconciliation_id bigint NOT NULL REFERENCES reconciliation.transfer_reconciliations(reconciliation_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user_id text,
  actor_role text,
  note text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_transfer_reconciliation_events_reconciliation
  ON reconciliation.transfer_reconciliation_events (reconciliation_id, created_at DESC);

CREATE OR REPLACE VIEW reconciliation.transfer_documents_source_v AS
WITH line_rollups AS (
  SELECT
    tl.doc_no,
    tl.doc_type,
    tl.branch_code,
    COUNT(*)::integer AS total_line_count,
    SUM(COALESCE(tl.qty_base, tl.qty * NULLIF(tl.stock_factor, 0), tl.qty, 0))::numeric(14,4) AS total_qty_base
  FROM ada.transfer_lines tl
  GROUP BY tl.doc_no, tl.doc_type, tl.branch_code
)
SELECT
  th.doc_no AS source_doc_no,
  th.doc_type AS source_doc_type,
  th.branch_code AS source_branch_code,
  CASE
    WHEN th.doc_type = '4' THEN th.branch_code
    WHEN th.doc_type = '7' THEN th.branch_code_to
    ELSE th.branch_code
  END AS dispatch_branch_code,
  CASE
    WHEN th.doc_type = '4' THEN th.branch_code_to
    WHEN th.doc_type = '7' THEN th.branch_code
    ELSE th.branch_code_to
  END AS receiving_branch_code,
  th.warehouse_code,
  th.warehouse_code_to,
  th.doc_date,
  th.doc_time,
  CASE
    WHEN th.doc_type = '4' THEN 'outbound'
    WHEN th.doc_type = '7' THEN 'inbound'
    ELSE 'other'
  END AS source_direction,
  th.doc_status,
  th.process_status,
  CASE
    WHEN th.doc_type = '7' AND LOWER(COALESCE(th.process_status, '')) IN ('1', 'true', 't', 'processed', 'success', 'y') THEN 'processed'
    WHEN th.doc_type = '7' THEN 'unprocessed'
    WHEN th.doc_type = '4' THEN 'not_applicable'
    ELSE 'unknown'
  END AS process_state,
  CASE
    WHEN th.doc_type = '4' THEN 'outbound_dispatch'
    WHEN th.doc_type = '7' THEN 'inbound_receipt'
    ELSE 'other'
  END AS source_status_class,
  th.reference_doc_no,
  th.reference_doc_type,
  COALESCE(lr.total_line_count, 0) AS total_line_count,
  COALESCE(lr.total_qty_base, 0)::numeric(14,4) AS total_qty_base,
  th.source_system,
  th.source_table,
  th.source_synced_at
FROM ada.transfer_headers th
LEFT JOIN line_rollups lr
  ON lr.doc_no = th.doc_no
 AND lr.doc_type = th.doc_type
 AND lr.branch_code = th.branch_code;

CREATE OR REPLACE VIEW reconciliation.transfer_document_lines_source_v AS
SELECT
  tl.doc_no AS source_doc_no,
  tl.doc_type AS source_doc_type,
  tl.branch_code AS source_branch_code,
  tl.line_no AS source_line_no,
  CASE
    WHEN th.doc_type = '4' THEN th.branch_code
    WHEN th.doc_type = '7' THEN th.branch_code_to
    ELSE th.branch_code
  END AS dispatch_branch_code,
  CASE
    WHEN th.doc_type = '4' THEN th.branch_code_to
    WHEN th.doc_type = '7' THEN th.branch_code
    ELSE th.branch_code_to
  END AS receiving_branch_code,
  CASE
    WHEN th.doc_type = '4' THEN 'outbound'
    WHEN th.doc_type = '7' THEN 'inbound'
    ELSE 'other'
  END AS source_direction,
  tl.product_code,
  tl.barcode,
  tl.unit_code,
  tl.unit_name,
  tl.qty,
  tl.qty_base,
  COALESCE(tl.qty_base, tl.qty * NULLIF(tl.stock_factor, 0), tl.qty, 0)::numeric(14,4) AS normalized_qty_base,
  tl.stock_factor,
  tl.lot_no,
  tl.expiry_date,
  tl.warehouse_code,
  tl.reference_doc_no,
  tl.reference_line_no,
  tl.source_system,
  tl.source_table,
  tl.source_synced_at
FROM ada.transfer_lines tl
JOIN ada.transfer_headers th
  ON th.doc_no = tl.doc_no
 AND th.doc_type = tl.doc_type
 AND th.branch_code = tl.branch_code;

CREATE OR REPLACE VIEW reconciliation.transfer_match_candidates_source_v AS
WITH outbound_docs AS (
  SELECT *
  FROM reconciliation.transfer_documents_source_v
  WHERE source_doc_type = '4'
    AND source_direction = 'outbound'
),
inbound_docs AS (
  SELECT *
  FROM reconciliation.transfer_documents_source_v
  WHERE source_doc_type = '7'
    AND source_direction = 'inbound'
),
candidate_methods AS (
  SELECT
    o.source_doc_no AS outbound_doc_no,
    o.source_doc_type AS outbound_doc_type,
    o.source_branch_code AS outbound_branch_code,
    i.source_doc_no AS inbound_doc_no,
    i.source_doc_type AS inbound_doc_type,
    i.source_branch_code AS inbound_branch_code,
    'inbound_reference_doc'::text AS match_method,
    1 AS match_rank,
    i.process_state AS inbound_process_state,
    GREATEST(o.source_synced_at, i.source_synced_at) AS source_synced_at
  FROM outbound_docs o
  JOIN inbound_docs i
    ON i.reference_doc_no = o.source_doc_no
   AND COALESCE(NULLIF(i.reference_doc_type, ''), o.source_doc_type) = o.source_doc_type
   AND (o.receiving_branch_code IS NULL OR i.receiving_branch_code IS NULL OR o.receiving_branch_code = i.receiving_branch_code)
   AND (o.dispatch_branch_code IS NULL OR i.dispatch_branch_code IS NULL OR o.dispatch_branch_code = i.dispatch_branch_code)

  UNION ALL

  SELECT
    o.source_doc_no AS outbound_doc_no,
    o.source_doc_type AS outbound_doc_type,
    o.source_branch_code AS outbound_branch_code,
    i.source_doc_no AS inbound_doc_no,
    i.source_doc_type AS inbound_doc_type,
    i.source_branch_code AS inbound_branch_code,
    'outbound_reference_doc'::text AS match_method,
    2 AS match_rank,
    i.process_state AS inbound_process_state,
    GREATEST(o.source_synced_at, i.source_synced_at) AS source_synced_at
  FROM outbound_docs o
  JOIN inbound_docs i
    ON o.reference_doc_no = i.source_doc_no
   AND COALESCE(NULLIF(o.reference_doc_type, ''), i.source_doc_type) = i.source_doc_type
   AND (o.receiving_branch_code IS NULL OR i.receiving_branch_code IS NULL OR o.receiving_branch_code = i.receiving_branch_code)
   AND (o.dispatch_branch_code IS NULL OR i.dispatch_branch_code IS NULL OR o.dispatch_branch_code = i.dispatch_branch_code)

  UNION ALL

  SELECT
    o.source_doc_no AS outbound_doc_no,
    o.source_doc_type AS outbound_doc_type,
    o.source_branch_code AS outbound_branch_code,
    i.source_doc_no AS inbound_doc_no,
    i.source_doc_type AS inbound_doc_type,
    i.source_branch_code AS inbound_branch_code,
    'same_doc_branch_pair'::text AS match_method,
    3 AS match_rank,
    i.process_state AS inbound_process_state,
    GREATEST(o.source_synced_at, i.source_synced_at) AS source_synced_at
  FROM outbound_docs o
  JOIN inbound_docs i
    ON o.source_doc_no = i.source_doc_no
   AND (o.receiving_branch_code IS NULL OR i.receiving_branch_code IS NULL OR o.receiving_branch_code = i.receiving_branch_code)
   AND (o.dispatch_branch_code IS NULL OR i.dispatch_branch_code IS NULL OR o.dispatch_branch_code = i.dispatch_branch_code)
)
SELECT DISTINCT ON (
  cm.outbound_doc_no,
  cm.outbound_doc_type,
  cm.outbound_branch_code,
  cm.inbound_doc_no,
  cm.inbound_doc_type,
  cm.inbound_branch_code
)
  cm.outbound_doc_no,
  cm.outbound_doc_type,
  cm.outbound_branch_code,
  cm.inbound_doc_no,
  cm.inbound_doc_type,
  cm.inbound_branch_code,
  cm.match_method,
  cm.match_rank,
  cm.inbound_process_state,
  cm.source_synced_at
FROM candidate_methods cm
ORDER BY
  cm.outbound_doc_no,
  cm.outbound_doc_type,
  cm.outbound_branch_code,
  cm.inbound_doc_no,
  cm.inbound_doc_type,
  cm.inbound_branch_code,
  cm.match_rank;

CREATE OR REPLACE VIEW reconciliation.transfer_documents_enriched_source_v AS
WITH outbound_candidate_stats AS (
  SELECT
    c.outbound_doc_no,
    c.outbound_doc_type,
    c.outbound_branch_code,
    COUNT(*)::integer AS candidate_count
  FROM reconciliation.transfer_match_candidates_source_v c
  GROUP BY c.outbound_doc_no, c.outbound_doc_type, c.outbound_branch_code
),
outbound_unique_matches AS (
  SELECT
    c.outbound_doc_no,
    c.outbound_doc_type,
    c.outbound_branch_code,
    c.inbound_doc_no,
    c.inbound_doc_type,
    c.inbound_branch_code,
    c.match_method
  FROM reconciliation.transfer_match_candidates_source_v c
  JOIN outbound_candidate_stats s
    ON s.outbound_doc_no = c.outbound_doc_no
   AND s.outbound_doc_type = c.outbound_doc_type
   AND s.outbound_branch_code = c.outbound_branch_code
   AND s.candidate_count = 1
),
inbound_candidate_stats AS (
  SELECT
    c.inbound_doc_no,
    c.inbound_doc_type,
    c.inbound_branch_code,
    COUNT(*)::integer AS candidate_count
  FROM reconciliation.transfer_match_candidates_source_v c
  GROUP BY c.inbound_doc_no, c.inbound_doc_type, c.inbound_branch_code
),
inbound_unique_matches AS (
  SELECT
    c.inbound_doc_no,
    c.inbound_doc_type,
    c.inbound_branch_code,
    c.outbound_doc_no,
    c.outbound_doc_type,
    c.outbound_branch_code,
    c.match_method
  FROM reconciliation.transfer_match_candidates_source_v c
  JOIN inbound_candidate_stats s
    ON s.inbound_doc_no = c.inbound_doc_no
   AND s.inbound_doc_type = c.inbound_doc_type
   AND s.inbound_branch_code = c.inbound_branch_code
   AND s.candidate_count = 1
)
SELECT
  d.source_doc_no,
  d.source_doc_type,
  d.source_branch_code,
  d.dispatch_branch_code,
  d.receiving_branch_code,
  d.warehouse_code,
  d.warehouse_code_to,
  d.doc_date,
  d.doc_time,
  d.source_direction,
  d.doc_status,
  d.process_status,
  d.process_state,
  d.source_status_class,
  d.reference_doc_no,
  d.reference_doc_type,
  CASE
    WHEN d.source_direction = 'outbound' AND COALESCE(ocs.candidate_count, 0) = 1 THEN oum.match_method
    WHEN d.source_direction = 'inbound' AND COALESCE(ics.candidate_count, 0) = 1 THEN ium.match_method
    ELSE NULL
  END AS source_match_method,
  CASE
    WHEN d.source_direction = 'outbound' AND COALESCE(ocs.candidate_count, 0) = 1 THEN oum.inbound_doc_no
    WHEN d.source_direction = 'inbound' AND COALESCE(ics.candidate_count, 0) = 1 THEN ium.outbound_doc_no
    ELSE NULL
  END AS matched_doc_no,
  CASE
    WHEN d.source_direction = 'outbound' AND COALESCE(ocs.candidate_count, 0) = 1 THEN oum.inbound_doc_type
    WHEN d.source_direction = 'inbound' AND COALESCE(ics.candidate_count, 0) = 1 THEN ium.outbound_doc_type
    ELSE NULL
  END AS matched_doc_type,
  CASE
    WHEN d.source_direction = 'outbound' AND COALESCE(ocs.candidate_count, 0) = 1 THEN oum.inbound_branch_code
    WHEN d.source_direction = 'inbound' AND COALESCE(ics.candidate_count, 0) = 1 THEN ium.outbound_branch_code
    ELSE NULL
  END AS matched_branch_code,
  CASE
    WHEN d.source_direction = 'outbound' THEN COALESCE(ocs.candidate_count, 0)
    WHEN d.source_direction = 'inbound' THEN COALESCE(ics.candidate_count, 0)
    ELSE 0
  END AS matched_candidate_count,
  CASE
    WHEN d.source_direction = 'outbound' THEN COALESCE(ocs.candidate_count, 0) = 1
    WHEN d.source_direction = 'inbound' THEN COALESCE(ics.candidate_count, 0) = 1
    ELSE FALSE
  END AS unique_match,
  d.total_line_count,
  d.total_qty_base,
  d.source_system,
  d.source_table,
  d.source_synced_at
FROM reconciliation.transfer_documents_source_v d
LEFT JOIN outbound_candidate_stats ocs
  ON ocs.outbound_doc_no = d.source_doc_no
 AND ocs.outbound_doc_type = d.source_doc_type
 AND ocs.outbound_branch_code = d.source_branch_code
LEFT JOIN outbound_unique_matches oum
  ON oum.outbound_doc_no = d.source_doc_no
 AND oum.outbound_doc_type = d.source_doc_type
 AND oum.outbound_branch_code = d.source_branch_code
LEFT JOIN inbound_candidate_stats ics
  ON ics.inbound_doc_no = d.source_doc_no
 AND ics.inbound_doc_type = d.source_doc_type
 AND ics.inbound_branch_code = d.source_branch_code
LEFT JOIN inbound_unique_matches ium
  ON ium.inbound_doc_no = d.source_doc_no
 AND ium.inbound_doc_type = d.source_doc_type
 AND ium.inbound_branch_code = d.source_branch_code;

CREATE OR REPLACE VIEW reconciliation.transfer_cases_source_v AS
WITH documents AS (
  SELECT *
  FROM reconciliation.transfer_documents_enriched_source_v
),
outbound_docs AS (
  SELECT *
  FROM documents
  WHERE source_doc_type = '4'
    AND source_direction = 'outbound'
),
inbound_docs AS (
  SELECT *
  FROM documents
  WHERE source_doc_type = '7'
    AND source_direction = 'inbound'
),
outbound_cases AS (
  SELECT
    format('outbound:%s:%s:%s', o.source_branch_code, o.source_doc_type, o.source_doc_no) AS case_key,
    o.source_doc_no AS outbound_doc_no,
    o.source_doc_type AS outbound_doc_type,
    o.source_branch_code AS outbound_branch_code,
    i.source_doc_no AS inbound_doc_no,
    i.source_doc_type AS inbound_doc_type,
    i.source_branch_code AS inbound_branch_code,
    o.dispatch_branch_code,
    o.receiving_branch_code,
    COALESCE(o.doc_date, i.doc_date) AS case_doc_date,
    CASE
      WHEN o.matched_candidate_count = 0 THEN 'outbound_only'
      WHEN o.matched_candidate_count > 1 THEN 'ambiguous_match'
      WHEN COALESCE(i.process_state, 'unknown') = 'processed' THEN 'inbound_processed'
      ELSE 'inbound_present_unprocessed'
    END AS source_match_status,
    o.source_match_method,
    o.matched_candidate_count AS match_candidate_count,
    CASE
      WHEN o.matched_candidate_count = 1 THEN i.process_state
      ELSE NULL
    END AS inbound_process_state,
    o.total_qty_base AS expected_total_qty_base,
    CASE
      WHEN o.matched_candidate_count = 1 THEN COALESCE(i.total_qty_base, 0)
      ELSE 0
    END AS source_received_total_qty_base,
    CASE
      WHEN o.matched_candidate_count = 1 THEN COALESCE(i.total_qty_base, 0) - COALESCE(o.total_qty_base, 0)
      ELSE 0
    END AS qty_delta_source,
    GREATEST(o.source_synced_at, COALESCE(i.source_synced_at, o.source_synced_at)) AS latest_source_synced_at
  FROM outbound_docs o
  LEFT JOIN inbound_docs i
    ON o.matched_candidate_count = 1
   AND i.source_doc_no = o.matched_doc_no
   AND i.source_doc_type = o.matched_doc_type
   AND i.source_branch_code = o.matched_branch_code
),
inbound_unmatched_cases AS (
  SELECT
    format('inbound:%s:%s:%s', i.source_branch_code, i.source_doc_type, i.source_doc_no) AS case_key,
    NULL::text AS outbound_doc_no,
    NULL::text AS outbound_doc_type,
    NULL::text AS outbound_branch_code,
    i.source_doc_no AS inbound_doc_no,
    i.source_doc_type AS inbound_doc_type,
    i.source_branch_code AS inbound_branch_code,
    i.dispatch_branch_code,
    i.receiving_branch_code,
    i.doc_date AS case_doc_date,
    'inbound_only_unmatched'::text AS source_match_status,
    NULL::text AS source_match_method,
    0::integer AS match_candidate_count,
    i.process_state AS inbound_process_state,
    0::numeric(14,4) AS expected_total_qty_base,
    i.total_qty_base AS source_received_total_qty_base,
    i.total_qty_base AS qty_delta_source,
    i.source_synced_at AS latest_source_synced_at
  FROM inbound_docs i
  WHERE i.matched_candidate_count = 0
)
SELECT *
FROM outbound_cases
UNION ALL
SELECT *
FROM inbound_unmatched_cases;

CREATE OR REPLACE VIEW reconciliation.transfer_case_lines_source_v AS
WITH cases AS (
  SELECT *
  FROM reconciliation.transfer_cases_source_v
),
outbound_lines AS (
  SELECT
    c.case_key,
    l.product_code,
    MAX(l.barcode) AS barcode,
    l.unit_code,
    l.lot_no,
    l.expiry_date,
    SUM(l.normalized_qty_base)::numeric(14,4) AS outbound_qty_base
  FROM cases c
  JOIN reconciliation.transfer_document_lines_source_v l
    ON c.outbound_doc_no = l.source_doc_no
   AND c.outbound_doc_type = l.source_doc_type
   AND c.outbound_branch_code = l.source_branch_code
  GROUP BY c.case_key, l.product_code, l.unit_code, l.lot_no, l.expiry_date
),
inbound_lines AS (
  SELECT
    c.case_key,
    l.product_code,
    MAX(l.barcode) AS barcode,
    l.unit_code,
    l.lot_no,
    l.expiry_date,
    SUM(l.normalized_qty_base)::numeric(14,4) AS inbound_qty_base
  FROM cases c
  JOIN reconciliation.transfer_document_lines_source_v l
    ON c.inbound_doc_no = l.source_doc_no
   AND c.inbound_doc_type = l.source_doc_type
   AND c.inbound_branch_code = l.source_branch_code
  GROUP BY c.case_key, l.product_code, l.unit_code, l.lot_no, l.expiry_date
)
SELECT
  format(
    '%s|%s|%s|%s|%s',
    c.case_key,
    COALESCE(o.product_code, i.product_code, ''),
    COALESCE(o.unit_code, i.unit_code, ''),
    COALESCE(o.lot_no, i.lot_no, ''),
    COALESCE(o.expiry_date::text, i.expiry_date::text, '')
  ) AS line_key,
  c.case_key,
  COALESCE(o.product_code, i.product_code) AS product_code,
  COALESCE(o.barcode, i.barcode) AS barcode,
  COALESCE(o.unit_code, i.unit_code) AS unit_code,
  COALESCE(o.lot_no, i.lot_no) AS lot_no,
  COALESCE(o.expiry_date, i.expiry_date) AS expiry_date,
  COALESCE(o.outbound_qty_base, 0)::numeric(14,4) AS outbound_qty_base,
  COALESCE(i.inbound_qty_base, 0)::numeric(14,4) AS inbound_qty_base,
  (COALESCE(i.inbound_qty_base, 0) - COALESCE(o.outbound_qty_base, 0))::numeric(14,4) AS qty_delta_source,
  CASE
    WHEN c.source_match_status = 'ambiguous_match' THEN 'ambiguous_case'
    WHEN o.product_code IS NULL THEN 'inbound_only'
    WHEN i.product_code IS NULL THEN 'outbound_only'
    WHEN ABS(COALESCE(o.outbound_qty_base, 0) - COALESCE(i.inbound_qty_base, 0)) < 0.0001 THEN 'matched'
    ELSE 'qty_mismatch'
  END AS line_status
FROM cases c
LEFT JOIN outbound_lines o
  ON o.case_key = c.case_key
FULL OUTER JOIN inbound_lines i
  ON i.case_key = c.case_key
 AND COALESCE(i.product_code, '') = COALESCE(o.product_code, '')
 AND COALESCE(i.unit_code, '') = COALESCE(o.unit_code, '')
 AND COALESCE(i.lot_no, '') = COALESCE(o.lot_no, '')
 AND COALESCE(i.expiry_date::text, '') = COALESCE(o.expiry_date::text, '')
WHERE c.case_key = COALESCE(o.case_key, i.case_key);

CREATE OR REPLACE FUNCTION reconciliation.refresh_transfer_derivations()
RETURNS TABLE(stage text, affected_rows integer)
LANGUAGE plpgsql
AS $$
DECLARE
  rowcount integer := 0;
BEGIN
  DELETE FROM reconciliation.transfer_case_lines;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'reconciliation.transfer_case_lines_deleted'::text, rowcount;

  DELETE FROM reconciliation.transfer_cases;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'reconciliation.transfer_cases_deleted'::text, rowcount;

  DELETE FROM reconciliation.transfer_match_candidates;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'reconciliation.transfer_match_candidates_deleted'::text, rowcount;

  DELETE FROM reconciliation.transfer_document_lines;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'reconciliation.transfer_document_lines_deleted'::text, rowcount;

  DELETE FROM reconciliation.transfer_documents;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'reconciliation.transfer_documents_deleted'::text, rowcount;

  INSERT INTO reconciliation.transfer_documents
    (
      source_doc_no,
      source_doc_type,
      source_branch_code,
      dispatch_branch_code,
      receiving_branch_code,
      warehouse_code,
      warehouse_code_to,
      doc_date,
      doc_time,
      source_direction,
      doc_status,
      process_status,
      process_state,
      source_status_class,
      reference_doc_no,
      reference_doc_type,
      source_match_method,
      matched_doc_no,
      matched_doc_type,
      matched_branch_code,
      matched_candidate_count,
      unique_match,
      total_line_count,
      total_qty_base,
      source_system,
      source_table,
      source_synced_at,
      created_at
    )
  SELECT
    source_doc_no,
    source_doc_type,
    source_branch_code,
    dispatch_branch_code,
    receiving_branch_code,
    warehouse_code,
    warehouse_code_to,
    doc_date,
    doc_time,
    source_direction,
    doc_status,
    process_status,
    process_state,
    source_status_class,
    reference_doc_no,
    reference_doc_type,
    source_match_method,
    matched_doc_no,
    matched_doc_type,
    matched_branch_code,
    matched_candidate_count,
    unique_match,
    total_line_count,
    total_qty_base,
    source_system,
    source_table,
    source_synced_at,
    now()
  FROM reconciliation.transfer_documents_enriched_source_v;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'reconciliation.transfer_documents_inserted'::text, rowcount;

  INSERT INTO reconciliation.transfer_document_lines
    (
      source_doc_no,
      source_doc_type,
      source_branch_code,
      source_line_no,
      dispatch_branch_code,
      receiving_branch_code,
      source_direction,
      product_code,
      barcode,
      unit_code,
      unit_name,
      qty,
      qty_base,
      normalized_qty_base,
      stock_factor,
      lot_no,
      expiry_date,
      warehouse_code,
      reference_doc_no,
      reference_line_no,
      source_system,
      source_table,
      source_synced_at,
      created_at
    )
  SELECT
    source_doc_no,
    source_doc_type,
    source_branch_code,
    source_line_no,
    dispatch_branch_code,
    receiving_branch_code,
    source_direction,
    product_code,
    barcode,
    unit_code,
    unit_name,
    qty,
    qty_base,
    normalized_qty_base,
    stock_factor,
    lot_no,
    expiry_date,
    warehouse_code,
    reference_doc_no,
    reference_line_no,
    source_system,
    source_table,
    source_synced_at,
    now()
  FROM reconciliation.transfer_document_lines_source_v;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'reconciliation.transfer_document_lines_inserted'::text, rowcount;

  INSERT INTO reconciliation.transfer_match_candidates
    (
      outbound_doc_no,
      outbound_doc_type,
      outbound_branch_code,
      inbound_doc_no,
      inbound_doc_type,
      inbound_branch_code,
      match_method,
      match_rank,
      inbound_process_state,
      source_synced_at,
      created_at
    )
  SELECT
    outbound_doc_no,
    outbound_doc_type,
    outbound_branch_code,
    inbound_doc_no,
    inbound_doc_type,
    inbound_branch_code,
    match_method,
    match_rank,
    inbound_process_state,
    source_synced_at,
    now()
  FROM reconciliation.transfer_match_candidates_source_v;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'reconciliation.transfer_match_candidates_inserted'::text, rowcount;

  INSERT INTO reconciliation.transfer_cases
    (
      case_key,
      outbound_doc_no,
      outbound_doc_type,
      outbound_branch_code,
      inbound_doc_no,
      inbound_doc_type,
      inbound_branch_code,
      dispatch_branch_code,
      receiving_branch_code,
      case_doc_date,
      source_match_status,
      source_match_method,
      match_candidate_count,
      inbound_process_state,
      expected_total_qty_base,
      source_received_total_qty_base,
      qty_delta_source,
      latest_source_synced_at,
      created_at
    )
  SELECT
    case_key,
    outbound_doc_no,
    outbound_doc_type,
    outbound_branch_code,
    inbound_doc_no,
    inbound_doc_type,
    inbound_branch_code,
    dispatch_branch_code,
    receiving_branch_code,
    case_doc_date,
    source_match_status,
    source_match_method,
    match_candidate_count,
    inbound_process_state,
    expected_total_qty_base,
    source_received_total_qty_base,
    qty_delta_source,
    latest_source_synced_at,
    now()
  FROM reconciliation.transfer_cases_source_v;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'reconciliation.transfer_cases_inserted'::text, rowcount;

  INSERT INTO reconciliation.transfer_case_lines
    (
      line_key,
      case_key,
      product_code,
      barcode,
      unit_code,
      lot_no,
      expiry_date,
      outbound_qty_base,
      inbound_qty_base,
      qty_delta_source,
      line_status,
      created_at
    )
  SELECT
    line_key,
    case_key,
    product_code,
    barcode,
    unit_code,
    lot_no,
    expiry_date,
    outbound_qty_base,
    inbound_qty_base,
    qty_delta_source,
    line_status,
    now()
  FROM reconciliation.transfer_case_lines_source_v;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  RETURN QUERY SELECT 'reconciliation.transfer_case_lines_inserted'::text, rowcount;
END;
$$;

COMMIT;
