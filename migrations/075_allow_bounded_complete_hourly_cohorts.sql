BEGIN;

-- Existing writers remain valid. Only the separately marked 004 Hourly
-- envelope can exceed the legacy 500-record bound; no Sync/Delta tables change.
ALTER TABLE evidence.hourly_stock_capture_runs
  DROP CONSTRAINT IF EXISTS hourly_stock_capture_record_count_check;
ALTER TABLE evidence.hourly_stock_capture_runs
  ADD CONSTRAINT hourly_stock_capture_record_count_check CHECK (
    record_count > 0 AND (
      record_count <= 500 OR (
        record_count <= 10000 AND branch_code = '004'
        AND jsonb_typeof(client_meta->'cohortCoverage') = 'object'
        AND COALESCE(client_meta->'cohortCoverage'->>'schemaVersion', '') = 'hourly-cohort-coverage-v1'
      )
    )
  );

COMMIT;
