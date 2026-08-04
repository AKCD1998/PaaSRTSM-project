BEGIN;

-- Shadow-only evidence for one complete CP4 branch_stock generation.
-- A row is created atomically with finalize, survives worker restarts, and is
-- processed only after every staged batch has applied. PASS/FAIL is evidence;
-- neither outcome rewrites stock or blocks the existing branch-stock reader.
CREATE TABLE IF NOT EXISTS ingest.branch_stock_reconciliations (
  sync_run_id       bigint PRIMARY KEY REFERENCES ingest.sync_runs(sync_run_id) ON DELETE CASCADE,
  branch_code       text NOT NULL,
  contract_version  text NOT NULL,
  expected_manifest jsonb NOT NULL,
  payload_manifest  jsonb,
  normalized_manifest jsonb,
  wide_manifest     jsonb,
  status            text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry_wait', 'pass', 'fail', 'dead_letter')),
  attempts          integer NOT NULL DEFAULT 0,
  max_attempts      integer NOT NULL DEFAULT 5,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  claimed_at        timestamptz,
  reconciled_at     timestamptz,
  last_error        text,
  mismatch_summary  jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branch_stock_reconciliations_claimable
  ON ingest.branch_stock_reconciliations (next_attempt_at)
  WHERE status IN ('pending', 'retry_wait');

CREATE INDEX IF NOT EXISTS idx_branch_stock_reconciliations_branch_created
  ON ingest.branch_stock_reconciliations (branch_code, created_at DESC);

COMMIT;
