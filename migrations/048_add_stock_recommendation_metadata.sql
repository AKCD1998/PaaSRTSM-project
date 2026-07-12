BEGIN;

CREATE TABLE IF NOT EXISTS ordering.stock_request_draft_line_recommendations (
  draft_line_recommendation_id bigserial PRIMARY KEY,
  draft_line_id bigint NOT NULL
    REFERENCES ordering.stock_request_draft_lines(draft_line_id) ON DELETE CASCADE,
  target_days integer NOT NULL DEFAULT 90,
  incoming_allocation_mode text NOT NULL DEFAULT 'UNKNOWN',
  incoming_source_mode text NOT NULL DEFAULT 'UNKNOWN',
  recommendation_generated_at timestamptz NULL,
  recommendation_basis_date_from date NULL,
  recommendation_basis_date_to date NULL,
  product_code text NOT NULL,
  current_stock numeric(14,4) NULL,
  unit_cost_avg numeric(14,4) NULL,
  inventory_value numeric(14,4) NULL,
  sold_qty_30d numeric(14,4) NULL,
  sold_qty_90d numeric(14,4) NULL,
  adu_30 numeric(14,6) NULL,
  adu_90 numeric(14,6) NULL,
  adjusted_adu numeric(14,6) NULL,
  incoming_po_qty_total numeric(14,4) NULL,
  incoming_po_allocation_qty numeric(14,4) NULL,
  effective_stock numeric(14,4) NULL,
  current_days_cover numeric(14,4) NULL,
  effective_days_cover numeric(14,4) NULL,
  target_qty numeric(14,4) NULL,
  surplus_qty numeric(14,4) NOT NULL DEFAULT 0,
  shortage_qty numeric(14,4) NOT NULL DEFAULT 0,
  recommended_action text NOT NULL DEFAULT 'NO_ACTION',
  recommended_transfer_qty numeric(14,4) NOT NULL DEFAULT 0,
  recommended_purchase_qty numeric(14,4) NOT NULL DEFAULT 0,
  primary_suggested_donor_branch_code text NULL
    REFERENCES core.branches(branch_code),
  recommendation_reason text NULL,
  recommendation_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  donor_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_request_draft_line_recommendations_draft_line_id_key
    UNIQUE (draft_line_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_request_draft_line_recommendations_draft_line_id
  ON ordering.stock_request_draft_line_recommendations (draft_line_id);

CREATE INDEX IF NOT EXISTS idx_stock_request_draft_line_recommendations_product_code
  ON ordering.stock_request_draft_line_recommendations (product_code);

CREATE TABLE IF NOT EXISTS ordering.stock_request_line_recommendations (
  request_line_recommendation_id bigserial PRIMARY KEY,
  line_id bigint NOT NULL
    REFERENCES ordering.stock_request_lines(line_id) ON DELETE CASCADE,
  target_days integer NOT NULL DEFAULT 90,
  incoming_allocation_mode text NOT NULL DEFAULT 'UNKNOWN',
  incoming_source_mode text NOT NULL DEFAULT 'UNKNOWN',
  recommendation_generated_at timestamptz NULL,
  recommendation_basis_date_from date NULL,
  recommendation_basis_date_to date NULL,
  product_code text NOT NULL,
  current_stock numeric(14,4) NULL,
  unit_cost_avg numeric(14,4) NULL,
  inventory_value numeric(14,4) NULL,
  sold_qty_30d numeric(14,4) NULL,
  sold_qty_90d numeric(14,4) NULL,
  adu_30 numeric(14,6) NULL,
  adu_90 numeric(14,6) NULL,
  adjusted_adu numeric(14,6) NULL,
  incoming_po_qty_total numeric(14,4) NULL,
  incoming_po_allocation_qty numeric(14,4) NULL,
  effective_stock numeric(14,4) NULL,
  current_days_cover numeric(14,4) NULL,
  effective_days_cover numeric(14,4) NULL,
  target_qty numeric(14,4) NULL,
  surplus_qty numeric(14,4) NOT NULL DEFAULT 0,
  shortage_qty numeric(14,4) NOT NULL DEFAULT 0,
  recommended_action text NOT NULL DEFAULT 'NO_ACTION',
  recommended_transfer_qty numeric(14,4) NOT NULL DEFAULT 0,
  recommended_purchase_qty numeric(14,4) NOT NULL DEFAULT 0,
  request_matches_recommendation boolean NOT NULL DEFAULT true,
  primary_suggested_donor_branch_code text NULL
    REFERENCES core.branches(branch_code),
  recommendation_reason text NULL,
  recommendation_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  donor_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_request_line_recommendations_line_id_key
    UNIQUE (line_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_request_line_recommendations_line_id
  ON ordering.stock_request_line_recommendations (line_id);

CREATE INDEX IF NOT EXISTS idx_stock_request_line_recommendations_product_code
  ON ordering.stock_request_line_recommendations (product_code);

CREATE INDEX IF NOT EXISTS idx_stock_request_line_recommendations_match_flag
  ON ordering.stock_request_line_recommendations (request_matches_recommendation);

COMMIT;
