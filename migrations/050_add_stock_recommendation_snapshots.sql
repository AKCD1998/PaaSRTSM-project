BEGIN;

CREATE TABLE IF NOT EXISTS ordering.stock_recommendation_snapshots (
  snapshot_id bigserial PRIMARY KEY,
  anchor_date date NOT NULL,
  target_days integer NOT NULL CHECK (target_days > 0),
  branch_code text NOT NULL REFERENCES core.branches(branch_code),
  branch_label text NULL,
  product_code text NOT NULL,
  product_name_thai text NULL,
  product_name_eng text NULL,
  barcode text NULL,
  unit text NULL,
  current_stock numeric(14,4) NOT NULL DEFAULT 0,
  unit_cost_avg numeric(14,4) NULL,
  inventory_value numeric(16,2) NOT NULL DEFAULT 0,
  sold_qty_30d numeric(14,4) NOT NULL DEFAULT 0,
  sold_qty_90d numeric(14,4) NOT NULL DEFAULT 0,
  sold_qty_same_period_last_year numeric(14,4) NULL,
  adu_30 numeric(14,6) NOT NULL DEFAULT 0,
  adu_90 numeric(14,6) NOT NULL DEFAULT 0,
  trend_ratio_30_vs_90 numeric(14,4) NULL,
  adjusted_adu numeric(14,6) NOT NULL DEFAULT 0,
  incoming_po_qty_total numeric(14,4) NOT NULL DEFAULT 0,
  incoming_po_allocation_qty numeric(14,4) NOT NULL DEFAULT 0,
  effective_stock numeric(14,4) NOT NULL DEFAULT 0,
  current_days_cover numeric(14,2) NULL,
  effective_days_cover numeric(14,2) NULL,
  target_qty numeric(14,4) NOT NULL DEFAULT 0,
  surplus_qty numeric(14,4) NOT NULL DEFAULT 0,
  shortage_qty numeric(14,4) NOT NULL DEFAULT 0,
  transfer_plan_qty numeric(14,4) NOT NULL DEFAULT 0,
  purchase_qty numeric(14,4) NOT NULL DEFAULT 0,
  priority_score numeric(16,2) NOT NULL DEFAULT 0,
  action text NOT NULL
    CHECK (action IN ('NO_ACTION', 'TRANSFER_IN', 'PURCHASE', 'TRANSFER_AND_PURCHASE', 'NO_PURCHASE_SLOW_MOVING')),
  recommendation_reason text NULL,
  recommendation_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  donors_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  primary_suggested_donor_branch_code text NULL REFERENCES core.branches(branch_code),
  synced_at timestamptz NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_recommendation_snapshots_anchor_target_branch_product_key
    UNIQUE (anchor_date, target_days, branch_code, product_code)
);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_snapshots_scope
  ON ordering.stock_recommendation_snapshots (anchor_date DESC, target_days, branch_code);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_snapshots_action_priority
  ON ordering.stock_recommendation_snapshots (anchor_date DESC, target_days, action, priority_score DESC);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_snapshots_product
  ON ordering.stock_recommendation_snapshots (product_code, branch_code, anchor_date DESC);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_snapshots_generated_at
  ON ordering.stock_recommendation_snapshots (generated_at DESC);

COMMIT;
