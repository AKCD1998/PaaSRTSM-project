BEGIN;

-- CP2 (observability). ingest.sync_runs already supported a 'running'
-- status in its CHECK constraint from the start, but the code never used
-- it — a run only ever got INSERTed once, at the very end, with a single
-- free-text message. A run that crashed mid-way (e.g. the 2026-07-16
-- self-update bug on branch 004) left zero rows anywhere, in any table —
-- the only way to notice was absence of expected activity, cross-checked
-- by hand across three different systems (Render logs, this table, and
-- the branch machine's own log files).
--
-- This table adds the missing per-dataset breakdown. A run now gets one
-- ingest.sync_runs row created at START (status='running'), and each
-- dataset within that run gets its own row here as it completes — so a
-- crash mid-run leaves a run stuck 'running' past when it should have
-- finished (visible), plus a partial trail of which datasets did land
-- before the crash (also visible), instead of nothing at all.
CREATE TABLE IF NOT EXISTS ingest.sync_run_datasets (
  sync_run_dataset_id bigserial PRIMARY KEY,
  sync_run_id bigint NOT NULL REFERENCES ingest.sync_runs(sync_run_id) ON DELETE CASCADE,
  dataset_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  records_sent integer,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_run_datasets_run_id
  ON ingest.sync_run_datasets (sync_run_id);

COMMIT;
