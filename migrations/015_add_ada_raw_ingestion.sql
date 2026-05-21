BEGIN;

CREATE SCHEMA IF NOT EXISTS ada;

CREATE TABLE IF NOT EXISTS ada.sync_runs (
  sync_run_id bigserial PRIMARY KEY,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_location text,
  agent_name text,
  agent_version text,
  sync_type text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed')),
  records_read integer NOT NULL DEFAULT 0 CHECK (records_read >= 0),
  records_sent integer NOT NULL DEFAULT 0 CHECK (records_sent >= 0),
  watermark_from text,
  watermark_to text,
  message text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ada_sync_runs_started_at
  ON ada.sync_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_ada_sync_runs_status
  ON ada.sync_runs (status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_ada_sync_runs_source_system
  ON ada.sync_runs (source_system, started_at DESC);

CREATE TABLE IF NOT EXISTS ada.sync_errors (
  sync_error_id bigserial PRIMARY KEY,
  sync_run_id bigint REFERENCES ada.sync_runs(sync_run_id) ON DELETE SET NULL,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text,
  error_code text,
  error_message text NOT NULL,
  error_details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ada_sync_errors_sync_run_id
  ON ada.sync_errors (sync_run_id);

CREATE INDEX IF NOT EXISTS idx_ada_sync_errors_created_at
  ON ada.sync_errors (created_at DESC);

CREATE TABLE IF NOT EXISTS ada.branches (
  ada_branch_id bigserial PRIMARY KEY,
  branch_code text NOT NULL,
  branch_name text,
  branch_name_th text,
  branch_status text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TCNMBranch',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_branches_branch_code_key UNIQUE (branch_code)
);

CREATE INDEX IF NOT EXISTS idx_ada_branches_source_synced_at
  ON ada.branches (source_synced_at DESC);

CREATE TABLE IF NOT EXISTS ada.products (
  ada_product_id bigserial PRIMARY KEY,
  product_code text NOT NULL,
  product_name text,
  product_name_th text,
  supplier_code text,
  category_code text,
  category_name text,
  unit_small text,
  factor_small numeric(14,4),
  unit_medium text,
  factor_medium numeric(14,4),
  unit_large text,
  factor_large numeric(14,4),
  stock_current numeric(14,4),
  stock_retail numeric(14,4),
  stock_warehouse numeric(14,4),
  min_stock numeric(14,4),
  max_stock numeric(14,4),
  lead_time_days numeric(14,2),
  is_active text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TCNMPdt',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_products_product_code_key UNIQUE (product_code)
);

CREATE INDEX IF NOT EXISTS idx_ada_products_source_synced_at
  ON ada.products (source_synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_ada_products_supplier_code
  ON ada.products (supplier_code);

CREATE TABLE IF NOT EXISTS ada.product_barcodes (
  ada_product_barcode_id bigserial PRIMARY KEY,
  product_code text NOT NULL,
  barcode text NOT NULL,
  barcode_role text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TCNMPdt',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_product_barcodes_product_barcode_key UNIQUE (product_code, barcode)
);

CREATE INDEX IF NOT EXISTS idx_ada_product_barcodes_barcode
  ON ada.product_barcodes (barcode);

CREATE INDEX IF NOT EXISTS idx_ada_product_barcodes_source_synced_at
  ON ada.product_barcodes (source_synced_at DESC);

CREATE TABLE IF NOT EXISTS ada.transfer_headers (
  ada_transfer_header_id bigserial PRIMARY KEY,
  doc_no text NOT NULL,
  doc_type text NOT NULL,
  doc_status text,
  process_status text,
  branch_code text NOT NULL,
  branch_code_to text,
  warehouse_code text,
  warehouse_code_to text,
  doc_date date,
  doc_time text,
  approved_at timestamptz,
  processed_at timestamptz,
  created_by text,
  approved_by text,
  remark text,
  reference_doc_no text,
  reference_doc_type text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TCNTPdtTnfHD',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_transfer_headers_doc_branch_key UNIQUE (doc_no, doc_type, branch_code)
);

CREATE INDEX IF NOT EXISTS idx_ada_transfer_headers_doc_type_status
  ON ada.transfer_headers (doc_type, process_status, doc_status);

CREATE INDEX IF NOT EXISTS idx_ada_transfer_headers_branch_date
  ON ada.transfer_headers (branch_code, doc_date DESC, doc_no);

CREATE INDEX IF NOT EXISTS idx_ada_transfer_headers_branch_to_date
  ON ada.transfer_headers (branch_code_to, doc_date DESC, doc_no);

CREATE INDEX IF NOT EXISTS idx_ada_transfer_headers_source_synced_at
  ON ada.transfer_headers (source_synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_ada_transfer_headers_unprocessed_type7
  ON ada.transfer_headers (branch_code, doc_date DESC, doc_no)
  WHERE doc_type = '7' AND COALESCE(process_status, '') <> '1';

CREATE TABLE IF NOT EXISTS ada.transfer_lines (
  ada_transfer_line_id bigserial PRIMARY KEY,
  doc_no text NOT NULL,
  doc_type text NOT NULL,
  branch_code text NOT NULL,
  line_no integer NOT NULL,
  product_code text NOT NULL,
  barcode text,
  unit_code text,
  unit_name text,
  qty numeric(14,4),
  qty_base numeric(14,4),
  stock_factor numeric(14,4),
  lot_no text,
  expiry_date date,
  warehouse_code text,
  reference_doc_no text,
  reference_line_no text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TCNTPdtTnfDT',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_transfer_lines_doc_line_product_key
    UNIQUE (doc_no, doc_type, branch_code, line_no, product_code)
);

CREATE INDEX IF NOT EXISTS idx_ada_transfer_lines_product_date
  ON ada.transfer_lines (product_code, source_synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_ada_transfer_lines_barcode
  ON ada.transfer_lines (barcode);

CREATE INDEX IF NOT EXISTS idx_ada_transfer_lines_doc_lookup
  ON ada.transfer_lines (doc_no, doc_type, branch_code, line_no);

CREATE TABLE IF NOT EXISTS ada.sales_headers (
  ada_sales_header_id bigserial PRIMARY KEY,
  branch_code text NOT NULL,
  doc_no text NOT NULL,
  doc_date date,
  doc_time text,
  customer_code text,
  paid_status text,
  grand_amount numeric(14,2),
  net_amount numeric(14,2),
  vat_amount numeric(14,2),
  cashier_code text,
  terminal_code text,
  reference_doc_no text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TPSTSalHD',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_sales_headers_branch_doc_key UNIQUE (branch_code, doc_no)
);

CREATE INDEX IF NOT EXISTS idx_ada_sales_headers_branch_date
  ON ada.sales_headers (branch_code, doc_date DESC, doc_no);

CREATE INDEX IF NOT EXISTS idx_ada_sales_headers_customer_code
  ON ada.sales_headers (customer_code, doc_date DESC);

CREATE INDEX IF NOT EXISTS idx_ada_sales_headers_source_synced_at
  ON ada.sales_headers (source_synced_at DESC);

CREATE TABLE IF NOT EXISTS ada.sales_lines (
  ada_sales_line_id bigserial PRIMARY KEY,
  branch_code text NOT NULL,
  doc_no text NOT NULL,
  line_no integer NOT NULL,
  product_code text NOT NULL,
  barcode text,
  qty numeric(14,4),
  unit_price numeric(14,4),
  discount_amount numeric(14,4),
  line_amount numeric(14,4),
  stock_factor numeric(14,4),
  qty_base numeric(14,4),
  lot_no text,
  expiry_date date,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TPSTSalDT',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_sales_lines_branch_doc_line_product_key
    UNIQUE (branch_code, doc_no, line_no, product_code)
);

CREATE INDEX IF NOT EXISTS idx_ada_sales_lines_product_date
  ON ada.sales_lines (product_code, source_synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_ada_sales_lines_barcode
  ON ada.sales_lines (barcode);

CREATE INDEX IF NOT EXISTS idx_ada_sales_lines_lot_expiry
  ON ada.sales_lines (lot_no, expiry_date);

CREATE TABLE IF NOT EXISTS ada.purchase_headers (
  ada_purchase_header_id bigserial PRIMARY KEY,
  branch_code text NOT NULL,
  doc_no text NOT NULL,
  doc_date date,
  supplier_code text,
  doc_status text,
  remark text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TACTPiHD',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_purchase_headers_branch_doc_key UNIQUE (branch_code, doc_no)
);

CREATE INDEX IF NOT EXISTS idx_ada_purchase_headers_branch_date
  ON ada.purchase_headers (branch_code, doc_date DESC, doc_no);

CREATE INDEX IF NOT EXISTS idx_ada_purchase_headers_source_synced_at
  ON ada.purchase_headers (source_synced_at DESC);

CREATE TABLE IF NOT EXISTS ada.purchase_lines (
  ada_purchase_line_id bigserial PRIMARY KEY,
  branch_code text NOT NULL,
  doc_no text NOT NULL,
  line_no integer NOT NULL,
  product_code text NOT NULL,
  barcode text,
  qty numeric(14,4),
  qty_base numeric(14,4),
  stock_factor numeric(14,4),
  unit_code text,
  lot_no text,
  expiry_date date,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TACTPiDT',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_purchase_lines_branch_doc_line_product_key
    UNIQUE (branch_code, doc_no, line_no, product_code)
);

CREATE INDEX IF NOT EXISTS idx_ada_purchase_lines_product_date
  ON ada.purchase_lines (product_code, source_synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_ada_purchase_lines_barcode
  ON ada.purchase_lines (barcode);

CREATE TABLE IF NOT EXISTS ada.stock_adjustment_headers (
  ada_stock_adjustment_header_id bigserial PRIMARY KEY,
  branch_code text NOT NULL,
  doc_no text NOT NULL,
  doc_date date,
  doc_type text,
  remark text,
  created_by text,
  approved_by text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TCNTPdtAjsHD',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_stock_adjustment_headers_branch_doc_key UNIQUE (branch_code, doc_no)
);

CREATE INDEX IF NOT EXISTS idx_ada_stock_adjustment_headers_branch_date
  ON ada.stock_adjustment_headers (branch_code, doc_date DESC, doc_no);

CREATE INDEX IF NOT EXISTS idx_ada_stock_adjustment_headers_source_synced_at
  ON ada.stock_adjustment_headers (source_synced_at DESC);

CREATE TABLE IF NOT EXISTS ada.stock_adjustment_lines (
  ada_stock_adjustment_line_id bigserial PRIMARY KEY,
  branch_code text NOT NULL,
  doc_no text NOT NULL,
  line_no integer NOT NULL,
  product_code text NOT NULL,
  barcode text,
  qty numeric(14,4),
  qty_base numeric(14,4),
  stock_factor numeric(14,4),
  unit_code text,
  lot_no text,
  expiry_date date,
  reason_code text,
  reference_doc_no text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TCNTPdtAjsDT',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_stock_adjustment_lines_branch_doc_line_product_key
    UNIQUE (branch_code, doc_no, line_no, product_code)
);

CREATE INDEX IF NOT EXISTS idx_ada_stock_adjustment_lines_product_date
  ON ada.stock_adjustment_lines (product_code, source_synced_at DESC);

CREATE TABLE IF NOT EXISTS ada.stock_snapshots (
  ada_stock_snapshot_id bigserial PRIMARY KEY,
  snapshot_key text NOT NULL,
  snapshot_at timestamptz NOT NULL,
  branch_code text,
  warehouse_code text,
  product_code text NOT NULL,
  barcode text,
  lot_no text,
  expiry_date date,
  qty_on_hand numeric(14,4),
  qty_reserved numeric(14,4),
  unit_code text,
  qty_base numeric(14,4),
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TCNTPdtStkCard',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_stock_snapshots_snapshot_key_key UNIQUE (snapshot_key)
);

CREATE INDEX IF NOT EXISTS idx_ada_stock_snapshots_branch_date
  ON ada.stock_snapshots (branch_code, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_ada_stock_snapshots_product_date
  ON ada.stock_snapshots (product_code, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_ada_stock_snapshots_barcode
  ON ada.stock_snapshots (barcode);

CREATE INDEX IF NOT EXISTS idx_ada_stock_snapshots_source_synced_at
  ON ada.stock_snapshots (source_synced_at DESC);

COMMIT;
