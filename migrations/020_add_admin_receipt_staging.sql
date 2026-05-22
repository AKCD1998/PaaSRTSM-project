BEGIN;

CREATE TABLE IF NOT EXISTS ada.pending_receipt_headers (
  doc_no text PRIMARY KEY,
  branch_code text NOT NULL,
  doc_type text,
  doc_date date,
  doc_time text,
  supplier_code text,
  supplier_name text,
  ref_ext text,
  ref_ext_date date,
  warehouse_code text,
  total numeric(14,4) NOT NULL DEFAULT 0,
  vat numeric(14,4) NOT NULL DEFAULT 0,
  grand numeric(14,4) NOT NULL DEFAULT 0,
  usr_code text,
  created_by text,
  created_at_ada timestamptz,
  sta_doc text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TACTPiHD',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ada_pending_receipt_headers_branch_date
  ON ada.pending_receipt_headers (branch_code, doc_date DESC, doc_no);

CREATE TABLE IF NOT EXISTS ada.pending_receipt_lines (
  doc_no text NOT NULL REFERENCES ada.pending_receipt_headers(doc_no) ON DELETE CASCADE,
  seq_no integer NOT NULL,
  product_code text,
  product_name text,
  barcode text,
  unit_code text,
  unit_name text,
  factor numeric(14,4) NOT NULL DEFAULT 1,
  qty numeric(14,4) NOT NULL DEFAULT 0,
  qty_base numeric(14,4) NOT NULL DEFAULT 0,
  stock_factor numeric(14,4) NOT NULL DEFAULT 1,
  set_price numeric(14,4) NOT NULL DEFAULT 0,
  net numeric(14,4) NOT NULL DEFAULT 0,
  vat numeric(14,4) NOT NULL DEFAULT 0,
  cost_in numeric(14,4) NOT NULL DEFAULT 0,
  lot_no text,
  expired_date date,
  warehouse_code text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TACTPiDT',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_no, seq_no)
);

CREATE INDEX IF NOT EXISTS idx_ada_pending_receipt_lines_product
  ON ada.pending_receipt_lines (product_code);

CREATE TABLE IF NOT EXISTS ada.approved_receipt_headers (
  doc_no text PRIMARY KEY,
  branch_code text NOT NULL,
  doc_type text,
  doc_date date,
  doc_time text,
  supplier_code text,
  supplier_name text,
  ref_ext text,
  ref_ext_date date,
  warehouse_code text,
  total numeric(14,4) NOT NULL DEFAULT 0,
  vat numeric(14,4) NOT NULL DEFAULT 0,
  grand numeric(14,4) NOT NULL DEFAULT 0,
  usr_code text,
  created_by text,
  created_at_ada timestamptz,
  sta_doc text,
  sta_prc_doc text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TACTPiHD',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ada_approved_receipt_headers_branch_date
  ON ada.approved_receipt_headers (branch_code, doc_date DESC, doc_no);

CREATE TABLE IF NOT EXISTS ada.approved_receipt_lines (
  doc_no text NOT NULL REFERENCES ada.approved_receipt_headers(doc_no) ON DELETE CASCADE,
  seq_no integer NOT NULL,
  product_code text,
  product_name text,
  barcode text,
  unit_code text,
  unit_name text,
  factor numeric(14,4) NOT NULL DEFAULT 1,
  qty numeric(14,4) NOT NULL DEFAULT 0,
  qty_base numeric(14,4) NOT NULL DEFAULT 0,
  stock_factor numeric(14,4) NOT NULL DEFAULT 1,
  set_price numeric(14,4) NOT NULL DEFAULT 0,
  net numeric(14,4) NOT NULL DEFAULT 0,
  vat numeric(14,4) NOT NULL DEFAULT 0,
  cost_in numeric(14,4) NOT NULL DEFAULT 0,
  lot_no text,
  expired_date date,
  warehouse_code text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TACTPiDT',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_no, seq_no)
);

CREATE INDEX IF NOT EXISTS idx_ada_approved_receipt_lines_product
  ON ada.approved_receipt_lines (product_code);

COMMIT;
