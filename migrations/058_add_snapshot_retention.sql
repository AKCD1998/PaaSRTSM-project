BEGIN;

-- CP3.2 (snapshot-runaway) fix, part 2: retention for
-- analytics.product_stock_snapshots. The current-stock table (migration
-- 057) already removed reads' dependency on this table's size, so this is
-- purely disk/cost hygiene now, not a performance fix.
--
-- No new scheduled infrastructure (deliberately avoided a Render Cron Job
-- to not grow spend) — pruning is piggybacked onto normal /api/sync/products
-- traffic (see pruneOldSnapshotsIfDue() in sync.js) and self-throttled via
-- this table so concurrent sync requests can't double-run it.
CREATE TABLE IF NOT EXISTS analytics.maintenance_runs (
  task_name text PRIMARY KEY,
  last_run_at timestamptz,
  last_run_deleted_count integer
);

COMMIT;
