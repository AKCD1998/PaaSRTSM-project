BEGIN;

CREATE TABLE IF NOT EXISTS ada.product_category_states (
  product_code text PRIMARY KEY,
  category_name text NOT NULL,
  review_status text NOT NULL
    CHECK (review_status IN ('confirmed', 'proposed', 'needs_review', 'reverify', 'imported_exact_match')),
  rationale text,
  source_kind text,
  source_reference text,
  source_report_file text,
  source_workbook_file text,
  source_workbook_sheet text,
  source_workbook_row integer,
  source_match_level text,
  source_barcode text,
  previous_category_name text,
  previous_review_status text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_category_states_review_status
  ON ada.product_category_states (review_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_category_states_source_report
  ON ada.product_category_states (source_report_file, updated_at DESC);

COMMIT;
