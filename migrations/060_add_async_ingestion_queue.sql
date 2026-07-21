BEGIN;

-- CP4 async ingestion v2. This migration has not been deployed, so its
-- definitions intentionally describe the corrected contract directly.

-- Also backfills `branch_code`, discovered while building this migration to
-- be undocumented schema drift: it already exists on production (with a
-- supporting index) but was never captured in any committed migration file
-- — code in routes/sync.js (`/run-start`) has depended on it since CP2. The
-- IF NOT EXISTS guards make this a no-op against production (already
-- there); it only matters for bootstrapping a fresh environment (e.g. a
-- local staging DB) from the migrations folder, which is how the gap was
-- found.
ALTER TABLE ingest.sync_runs
  ADD COLUMN IF NOT EXISTS branch_code text,
  ADD COLUMN IF NOT EXISTS ingestion_mode text NOT NULL DEFAULT 'v1'
    CHECK (ingestion_mode IN ('v1', 'hybrid_v2')),
  ADD COLUMN IF NOT EXISTS handoff_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (handoff_status IN ('not_applicable', 'running', 'success', 'failed')),
  ADD COLUMN IF NOT EXISTS apply_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (apply_status IN ('not_applicable', 'waiting', 'pending', 'partial', 'applied', 'failed')),
  ADD COLUMN IF NOT EXISTS total_batches integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_batches integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_batches integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS handoff_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS manifest_hash text,
  ADD COLUMN IF NOT EXISTS failure_stage text;

-- Existing rows are v1 and must never appear pending in the v2 pipeline.
UPDATE ingest.sync_runs
SET ingestion_mode = 'v1',
    handoff_status = 'not_applicable',
    apply_status = 'not_applicable'
WHERE ingestion_mode = 'v1';

CREATE INDEX IF NOT EXISTS idx_sync_runs_branch_started
  ON ingest.sync_runs (branch_code, started_at DESC);

-- One row per chunk/batch an agent hands off (a products batch, a
-- sales_detail chunk, a transfer chunk, ...) — the actual unit of queued
-- work a worker claims and applies independently.
CREATE TABLE IF NOT EXISTS ingest.sync_batches (
  batch_id        bigserial PRIMARY KEY,
  sync_run_id     bigint NOT NULL REFERENCES ingest.sync_runs(sync_run_id) ON DELETE CASCADE,
  dataset         text NOT NULL,
  batch_seq       integer NOT NULL,
  payload_hash    text NOT NULL,
  payload         jsonb NOT NULL,
  record_count    integer NOT NULL,
  status          text NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged', 'queued', 'processing', 'retry_wait', 'applied', 'dead_letter')),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 5,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  queued_at       timestamptz,
  claimed_at      timestamptz,
  applied_at      timestamptz,
  next_attempt_at timestamptz,
  UNIQUE (sync_run_id, dataset, batch_seq)
);

-- Worker claim query filters on (status, next_attempt_at) and orders by
-- queued_at — this partial index covers exactly that WHERE clause so the
-- FOR UPDATE SKIP LOCKED claim stays cheap regardless of how many
-- already-applied/dead-lettered rows accumulate in the table over time.
CREATE INDEX IF NOT EXISTS idx_sync_batches_claimable
  ON ingest.sync_batches (next_attempt_at)
  WHERE status IN ('queued', 'retry_wait');

CREATE INDEX IF NOT EXISTS idx_sync_batches_sync_run_id
  ON ingest.sync_batches (sync_run_id);

ALTER TABLE ada.branch_stock_snapshots
  ADD COLUMN IF NOT EXISTS synced_at_branch_000 timestamptz,
  ADD COLUMN IF NOT EXISTS synced_at_branch_001 timestamptz,
  ADD COLUMN IF NOT EXISTS synced_at_branch_002 timestamptz,
  ADD COLUMN IF NOT EXISTS synced_at_branch_003 timestamptz,
  ADD COLUMN IF NOT EXISTS synced_at_branch_004 timestamptz,
  ADD COLUMN IF NOT EXISTS synced_at_branch_005 timestamptz;

COMMIT;
