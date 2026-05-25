BEGIN;

CREATE TABLE IF NOT EXISTS ada.branch_stock_snapshots (
  product_code text PRIMARY KEY,
  product_name_thai text,
  product_name_eng text,
  barcode text,
  unit text,
  qty_branch_000 numeric(14,4) NOT NULL DEFAULT 0,
  qty_branch_001 numeric(14,4) NOT NULL DEFAULT 0,
  qty_branch_002 numeric(14,4) NOT NULL DEFAULT 0,
  qty_branch_003 numeric(14,4) NOT NULL DEFAULT 0,
  qty_branch_004 numeric(14,4) NOT NULL DEFAULT 0,
  qty_branch_005 numeric(14,4) NOT NULL DEFAULT 0,
  qty_total_all_branches numeric(14,4) NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TCNTPdtInWha',
  source_synced_at timestamptz NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ada_branch_stock_snapshots_product_name_thai
  ON ada.branch_stock_snapshots (product_name_thai);

CREATE INDEX IF NOT EXISTS idx_ada_branch_stock_snapshots_product_name_eng
  ON ada.branch_stock_snapshots (product_name_eng);

CREATE INDEX IF NOT EXISTS idx_ada_branch_stock_snapshots_barcode
  ON ada.branch_stock_snapshots (barcode);

CREATE INDEX IF NOT EXISTS idx_ada_branch_stock_snapshots_synced_at
  ON ada.branch_stock_snapshots (synced_at DESC);

COMMIT;
