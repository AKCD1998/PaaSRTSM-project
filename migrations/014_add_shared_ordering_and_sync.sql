BEGIN;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS ingest;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS ordering;

ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS min_stock numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_stock numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_time_days numeric(14,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS core.branches (
  branch_code text PRIMARY KEY,
  branch_name text NOT NULL,
  is_hq boolean NOT NULL DEFAULT FALSE,
  is_active boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analytics.product_stock_snapshots (
  stock_snapshot_id bigserial PRIMARY KEY,
  product_code text NOT NULL REFERENCES public.skus(company_code),
  snapshot_at timestamptz NOT NULL,
  stock_current numeric(14,4) NOT NULL DEFAULT 0,
  stock_retail numeric(14,4) NOT NULL DEFAULT 0,
  stock_warehouse numeric(14,4) NOT NULL DEFAULT 0,
  source_name text NOT NULL DEFAULT 'adapos_sync',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_stock_snapshots_product_snapshot_key
    UNIQUE (product_code, snapshot_at, source_name)
);

CREATE INDEX IF NOT EXISTS idx_product_stock_snapshots_product_code
  ON analytics.product_stock_snapshots (product_code);

CREATE INDEX IF NOT EXISTS idx_product_stock_snapshots_snapshot_at
  ON analytics.product_stock_snapshots (snapshot_at DESC);

CREATE TABLE IF NOT EXISTS analytics.product_sales_summary_periods (
  sales_summary_id bigserial PRIMARY KEY,
  product_code text NOT NULL REFERENCES public.skus(company_code),
  branch_code text REFERENCES core.branches(branch_code),
  period_start date NOT NULL,
  period_end date NOT NULL,
  period_days integer NOT NULL CHECK (period_days > 0),
  sold_qty_base numeric(14,4) NOT NULL DEFAULT 0,
  avg_daily_usage numeric(14,4) NOT NULL DEFAULT 0,
  source_name text NOT NULL DEFAULT 'adapos_sync',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_sales_summary_periods_key
    UNIQUE (product_code, branch_code, period_start, period_end, source_name)
);

CREATE INDEX IF NOT EXISTS idx_product_sales_summary_periods_product_code
  ON analytics.product_sales_summary_periods (product_code);

CREATE INDEX IF NOT EXISTS idx_product_sales_summary_periods_branch_code
  ON analytics.product_sales_summary_periods (branch_code);

CREATE INDEX IF NOT EXISTS idx_product_sales_summary_periods_period_end
  ON analytics.product_sales_summary_periods (period_end DESC);

CREATE TABLE IF NOT EXISTS analytics.product_purchase_summary_periods (
  purchase_summary_id bigserial PRIMARY KEY,
  product_code text NOT NULL REFERENCES public.skus(company_code),
  period_start date NOT NULL,
  period_end date NOT NULL,
  period_days integer NOT NULL CHECK (period_days > 0),
  purchased_qty_base numeric(14,4) NOT NULL DEFAULT 0,
  source_name text NOT NULL DEFAULT 'adapos_sync',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_purchase_summary_periods_key
    UNIQUE (product_code, period_start, period_end, source_name)
);

CREATE INDEX IF NOT EXISTS idx_product_purchase_summary_periods_product_code
  ON analytics.product_purchase_summary_periods (product_code);

CREATE INDEX IF NOT EXISTS idx_product_purchase_summary_periods_period_end
  ON analytics.product_purchase_summary_periods (period_end DESC);

CREATE TABLE IF NOT EXISTS ordering.branch_order_requests (
  order_request_id bigserial PRIMARY KEY,
  branch_code text NOT NULL REFERENCES core.branches(branch_code),
  requested_by text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('draft', 'submitted', 'reviewed', 'approved', 'rejected', 'fulfilled')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branch_order_requests_branch_code
  ON ordering.branch_order_requests (branch_code);

CREATE INDEX IF NOT EXISTS idx_branch_order_requests_requested_at
  ON ordering.branch_order_requests (requested_at DESC);

CREATE TABLE IF NOT EXISTS ordering.branch_order_request_items (
  order_request_item_id bigserial PRIMARY KEY,
  order_request_id bigint NOT NULL REFERENCES ordering.branch_order_requests(order_request_id) ON DELETE CASCADE,
  product_code text NOT NULL REFERENCES public.skus(company_code),
  requested_qty numeric(14,4) NOT NULL CHECK (requested_qty > 0),
  requested_unit text NOT NULL,
  line_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_order_request_items_request_product_unit_key
    UNIQUE (order_request_id, product_code, requested_unit)
);

CREATE INDEX IF NOT EXISTS idx_branch_order_request_items_order_request_id
  ON ordering.branch_order_request_items (order_request_id);

CREATE INDEX IF NOT EXISTS idx_branch_order_request_items_product_code
  ON ordering.branch_order_request_items (product_code);

CREATE TABLE IF NOT EXISTS ingest.sync_runs (
  sync_run_id bigserial PRIMARY KEY,
  sync_type text NOT NULL,
  source_name text NOT NULL DEFAULT 'adapos_sync',
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed')),
  records_read integer NOT NULL DEFAULT 0 CHECK (records_read >= 0),
  records_sent integer NOT NULL DEFAULT 0 CHECK (records_sent >= 0),
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at
  ON ingest.sync_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_runs_status
  ON ingest.sync_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS ingest.sync_errors (
  sync_error_id bigserial PRIMARY KEY,
  sync_run_id bigint REFERENCES ingest.sync_runs(sync_run_id) ON DELETE SET NULL,
  sync_type text NOT NULL,
  source_name text NOT NULL DEFAULT 'adapos_sync',
  error_message text NOT NULL,
  error_details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_errors_sync_run_id
  ON ingest.sync_errors (sync_run_id);

CREATE INDEX IF NOT EXISTS idx_sync_errors_created_at
  ON ingest.sync_errors (created_at DESC);

COMMIT;
