BEGIN;

-- Full-snapshot generation tracking (_ledger/claude.md CLAIM-C-046/C-047/C-048).
--
-- Generation identity = ingest.sync_runs.sync_run_id of the branch's full-stock
-- sync run. Every branch-stock write (v1 legacy route or v2/CP4 worker) now
-- stamps which generation last touched that row for that branch, so that:
--   (a) reconciliation can read "was this row touched by generation N" instead
--       of relying on a freshness timestamp that legacy v1 never populated
--       (this is the direct fix for C-046), and
--   (b) a generation's finalization step can sweep rows NOT touched by the
--       newest complete generation, retiring products that silently vanished
--       from a branch's full snapshot (this is the fix for C-047's "ghost
--       stock" gap), without requiring v1 to retain a durable copy of its
--       source payload (it never has).
--
-- ada.branch_stock_snapshots (wide, one row per product, one column set per
-- branch): each branch needs its OWN generation marker, mirroring the
-- existing per-branch synced_at_branch_XXX columns added for the v2 rollout.
ALTER TABLE ada.branch_stock_snapshots
  ADD COLUMN full_sync_run_id_branch_000 bigint,
  ADD COLUMN full_sync_run_id_branch_001 bigint,
  ADD COLUMN full_sync_run_id_branch_002 bigint,
  ADD COLUMN full_sync_run_id_branch_003 bigint,
  ADD COLUMN full_sync_run_id_branch_004 bigint,
  ADD COLUMN full_sync_run_id_branch_005 bigint;

-- ada.branch_stock_current (normalized, one row per product+branch): a single
-- generation marker per row, plus retirement bookkeeping so a zeroed-out row
-- from a retirement sweep is distinguishable (for debugging/audit) from a
-- genuine zero reported by the source system.
ALTER TABLE ada.branch_stock_current
  ADD COLUMN last_full_sync_run_id bigint,
  ADD COLUMN retired_at timestamptz,
  ADD COLUMN retired_by_sync_run_id bigint;

-- ingest.sync_runs: snapshot_mode distinguishes a full-catalog dump (today's
-- only mode; retirement sweeps are only ever allowed to run for these) from a
-- future delta/changes-only sync (retirement must NEVER run for a delta run --
-- a delta payload's absence of a product means "unchanged", not "gone").
-- retirement_finalized_at makes the finalize step idempotent and gives an
-- audit trail of when (if ever) a generation's sweep ran.
ALTER TABLE ingest.sync_runs
  ADD COLUMN snapshot_mode text NOT NULL DEFAULT 'full'
    CONSTRAINT sync_runs_snapshot_mode_check CHECK (snapshot_mode IN ('full', 'delta')),
  ADD COLUMN retirement_finalized_at timestamptz;

COMMIT;
