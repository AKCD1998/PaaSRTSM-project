BEGIN;

-- CP3.2 (snapshot-runaway) fix, part 1: a maintained "current stock" table,
-- one row per product, updated in place by the same sync write that used to
-- only append to analytics.product_stock_snapshots. Reads that only need
-- "latest stock" (queryStockDayBase, product search) stop depending on the
-- ever-growing history table entirely — its size becomes irrelevant to read
-- performance regardless of retention decisions made later.
--
-- product_stock_snapshots has no branch_code column (confirmed via
-- information_schema during the 2026-07-15 incident investigation) — stock
-- here is already a single global figure per product_code, so one row per
-- product is the correct grain for this table.
CREATE TABLE IF NOT EXISTS analytics.product_current_stock (
  product_code text PRIMARY KEY,
  stock_current numeric NOT NULL DEFAULT 0,
  stock_retail numeric,
  stock_warehouse numeric,
  snapshot_at timestamptz NOT NULL,
  source_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One-time backfill from existing history, via a per-SKU LATERAL index
-- probe (idx_product_stock_snapshots_latest, added 2026-07-15) rather than
-- a bare DISTINCT ON. Confirmed live on 2026-07-15 that Postgres will NOT
-- use that index for a plain DISTINCT ON scan (still full seq-scan+sort,
-- ~60s+ even with the index present) — only the per-row LATERAL probe
-- pattern actually uses it, same fix already applied to the read path in
-- ordering.js. Scoped to public.skus.company_code (the actual product
-- universe reads care about) rather than every product_code that ever
-- appeared in history, so it can't backfill stale/retired codes.
INSERT INTO analytics.product_current_stock
  (product_code, stock_current, stock_retail, stock_warehouse, snapshot_at, source_name)
SELECT s.company_code, ls.stock_current, ls.stock_retail, ls.stock_warehouse, ls.snapshot_at, ls.source_name
FROM public.skus s
CROSS JOIN LATERAL (
  SELECT ps.stock_current, ps.stock_retail, ps.stock_warehouse, ps.snapshot_at, ps.source_name
  FROM analytics.product_stock_snapshots ps
  WHERE ps.product_code = s.company_code
  ORDER BY ps.snapshot_at DESC, ps.stock_snapshot_id DESC
  LIMIT 1
) ls
WHERE s.company_code IS NOT NULL
ON CONFLICT (product_code) DO NOTHING;

COMMIT;
