BEGIN;

-- WP3 Phase 1 (_ledger/claude.md CLAIM-C-019/X-034, CONFIRMED): ada.branch_stock_snapshots
-- hardcodes exactly 6 branches as columns (qty_branch_000..005, cost_avg_branch_000..005,
-- synced_at_branch_000..005 across migrations 022/032/060) -- adding branch 006 needs a
-- schema migration. This table replaces that with one row per (product_code, branch_code),
-- so branch count becomes a DATA concern, not a SCHEMA concern -- the long-pole identified
-- for scaling toward 100-1000 branches.
--
-- PHASE 1 ONLY (human decision, 2026-07-29): create this table and backfill it from the
-- current wide table. Nothing reads from it yet -- readers (stockRecommendations.js,
-- branch-stock.js's own read paths, movement-analytics.js, stockRequests.js,
-- mobile-products.js, ordering.js, and others) migrate ONE AT A TIME in a later phase.
-- ada.branch_stock_snapshots remains the single source of truth for reads until every
-- reader has moved. This migration is additive only -- it does not touch, alter, or drop
-- any existing column.
--
-- Deliberately excluded from this table:
--   - product_name_thai/eng, barcode, unit: these are per-PRODUCT, not per-branch --
--     duplicating them into every branch's row here wastes space at 1000-branch scale for
--     no benefit. ada.products/ada.product_barcodes are already the primary source for
--     these elsewhere in this codebase (stockRecommendations.js's loadCurrentStockByProduct
--     already prefers ada.products via COALESCE over the wide table's own name columns).
--   - qty_total_all_branches: becomes a query-time `SUM(qty) ... GROUP BY product_code`
--     instead of a stored, upsert-recomputed column. This also removes the single trickiest
--     piece of the old design: worker.js's applyBranchStockBatch had to special-case which
--     of 6 columns was "the one being updated" vs "the other 5, read back unchanged" on
--     EVERY upsert just to keep that stored sum correct (see worker.js lines ~106-112 as
--     it stood before this migration). A row-per-branch table needs no such bookkeeping.
CREATE TABLE IF NOT EXISTS ada.branch_stock_current (
  product_code text NOT NULL,
  branch_code text NOT NULL,
  qty numeric(14,4) NOT NULL DEFAULT 0,
  cost_avg numeric(18,4),
  -- Per-branch freshness. Unlike the wide table's single shared `synced_at`
  -- (which only ever recorded "most recent sync of ANY branch"), every row
  -- here has its own -- this is what makes the freshness-guarded upsert
  -- pattern already used for the wide table's synced_at_branch_XXX columns
  -- (worker.js) trivial to carry over per row, and finally gives the LEGACY
  -- v1 write path (branch-stock.js, which never populated the wide table's
  -- synced_at_branch_XXX columns at all) a real per-branch freshness signal
  -- for the first time.
  synced_at timestamptz,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TCNTPdtInWha',
  source_synced_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_code, branch_code)
);

CREATE INDEX IF NOT EXISTS idx_ada_branch_stock_current_branch_code
  ON ada.branch_stock_current (branch_code);

CREATE INDEX IF NOT EXISTS idx_ada_branch_stock_current_synced_at
  ON ada.branch_stock_current (synced_at DESC NULLS LAST);

-- One-time backfill from the wide table, unpivoting all 6 hardcoded branch
-- columns into rows. Idempotent (ON CONFLICT DO NOTHING) -- safe if this
-- migration is applied more than once (e.g. bootstrapping a fresh
-- environment from the full migrations/ folder).
--
-- Inclusion filter, and why it is NOT simply "synced_at_branch_XXX IS NOT
-- NULL": the legacy v1 write path (branch-stock.js's upsertBranchStockSnapshot,
-- confirmed by reading its SQL directly) has NEVER populated the per-branch
-- synced_at_branch_XXX columns -- only the v2/CP4 worker path
-- (apps/admin-api/src/worker.js) does. Since production has run primarily on
-- v1 to date, most/all existing rows likely have synced_at_branch_XXX = NULL
-- for every branch even where real qty data exists. Filtering on that column
-- alone would backfill close to nothing. Instead: include a (product,
-- branch) pair if it has a NONZERO quantity (unambiguous real data,
-- regardless of which write path produced it) OR a real per-branch synced_at
-- (covers v2-synced branches, including a legitimate zero-quantity sync).
-- This is a best-effort historical seed, not a perfect reconstruction -- a
-- product that is genuinely zero-stock at a branch AND was only ever synced
-- via v1 has no way to be distinguished from "this branch never had this
-- product" using the wide table alone, and is intentionally left unbackfilled
-- (it will appear the first time that branch's next real sync writes through
-- the new dual-write path added in this same phase). Falls back to the
-- shared `synced_at` column when the per-branch one is unavailable, so
-- backfilled rows still carry a meaningful (if less precise) freshness value
-- rather than NULL.
INSERT INTO ada.branch_stock_current
  (product_code, branch_code, qty, cost_avg, synced_at, source_system, source_table, source_synced_at, raw_payload)
SELECT
  s.product_code, x.branch_code, x.qty, x.cost_avg,
  COALESCE(x.synced_at, s.synced_at),
  s.source_system, s.source_table, s.source_synced_at, s.raw_payload
FROM ada.branch_stock_snapshots s
CROSS JOIN LATERAL (VALUES
  ('000', s.qty_branch_000, s.cost_avg_branch_000, s.synced_at_branch_000),
  ('001', s.qty_branch_001, s.cost_avg_branch_001, s.synced_at_branch_001),
  ('002', s.qty_branch_002, s.cost_avg_branch_002, s.synced_at_branch_002),
  ('003', s.qty_branch_003, s.cost_avg_branch_003, s.synced_at_branch_003),
  ('004', s.qty_branch_004, s.cost_avg_branch_004, s.synced_at_branch_004),
  ('005', s.qty_branch_005, s.cost_avg_branch_005, s.synced_at_branch_005)
) AS x(branch_code, qty, cost_avg, synced_at)
WHERE x.qty <> 0 OR x.synced_at IS NOT NULL
ON CONFLICT (product_code, branch_code) DO NOTHING;

COMMIT;
