BEGIN;

-- Durable retirement queue for one complete full-snapshot generation
-- (branch-stock generation remediation round; _ledger/claude.md CLAIM-X-046,
-- CLAIM-X-047, fixed by CLAIM-C-051/C-052/C-053). Mirrors
-- ingest.branch_stock_reconciliations (migration 067) deliberately: same
-- pending/processing/retry_wait/terminal shape, same SKIP LOCKED claim
-- pattern, same lease-reap + retention story — reusing an already-proven
-- design rather than inventing a second one.
--
-- A row is registered ATOMICALLY with the run's own completion signal (same
-- SQL statement as the status flip in routes/sync.js for v1, same
-- transaction as recomputeRunStatus in worker.js for v2) so there is no
-- fire-and-forget gap between "run succeeded" and "retirement job exists."
--
-- 'refused' is a distinct terminal state from 'dead_letter': it means the
-- membership-proof check (see worker.js processRetirementJob) found that
-- fewer rows carry this generation's id than the run's own registered
-- manifest says it should have touched -- the deterministic signature of an
-- agent that completed a normal, successful sync without ever stamping the
-- new generation-tracking columns (CLAIM-X-046). Refused generations are
-- never retried (retrying cannot fix a writer that will never re-run) and
-- never sweep anything.
CREATE TABLE IF NOT EXISTS ingest.branch_stock_retirements (
  sync_run_id       bigint PRIMARY KEY REFERENCES ingest.sync_runs(sync_run_id) ON DELETE CASCADE,
  branch_code       text NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry_wait', 'done', 'refused', 'dead_letter')),
  attempts          integer NOT NULL DEFAULT 0,
  max_attempts      integer NOT NULL DEFAULT 5,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  claimed_at        timestamptz,
  completed_at      timestamptz,
  last_error        text,
  expected_membership_count integer,
  actual_membership_count   integer,
  retired_normalized_count  integer,
  retired_wide_count        integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branch_stock_retirements_claimable
  ON ingest.branch_stock_retirements (next_attempt_at)
  WHERE status IN ('pending', 'retry_wait');

CREATE INDEX IF NOT EXISTS idx_branch_stock_retirements_branch_created
  ON ingest.branch_stock_retirements (branch_code, created_at DESC);

COMMIT;
