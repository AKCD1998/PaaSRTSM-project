BEGIN;

CREATE TABLE IF NOT EXISTS ingest.sync_run_recovery_notes (
  branch_code text NOT NULL,
  coverage_date date NOT NULL,
  recovery_status text NOT NULL CHECK (recovery_status IN ('partial', 'complete')),
  recovered_by_sync_run_id bigint REFERENCES ingest.sync_runs(sync_run_id) ON DELETE SET NULL,
  original_failed_run_ids bigint[] NOT NULL DEFAULT '{}',
  recovered_datasets text[] NOT NULL DEFAULT '{}',
  missing_datasets text[] NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_code, coverage_date)
);

-- These two dates were re-synced by later successful branch 004 runs. Their
-- sales and transfer records are present, but no exact-date stock snapshot is
-- available, so the history grid must report partial recovery rather than a
-- successful full-day sync. The run-id join keeps this seed harmless in CI
-- databases that do not contain the production sync history.
WITH recovery_cases (
  branch_code,
  coverage_date,
  recovered_by_sync_run_id,
  original_failed_run_ids,
  recovered_datasets,
  missing_datasets,
  evidence,
  note
) AS (
  VALUES
    (
      '004',
      DATE '2026-11-13',
      2454::bigint,
      ARRAY[2443, 2448]::bigint[],
      ARRAY['sales headers', 'sales lines', 'transfer headers', 'transfer lines']::text[],
      ARRAY['branch stock snapshot']::text[],
      '{"salesHeaders":116,"salesLines":236,"transferHeaders":6,"transferLines":0,"stockSnapshots":0}'::jsonb,
      'กู้ข้อมูลขายและโอนกลับมาได้จากรอบ sync #2454 เมื่อ 14/11/2026 แต่ไม่มี snapshot สต๊อกของวันที่ 13/11/2026 จึงยืนยันยอดสต๊อกย้อนหลังของวันนั้นไม่ได้'
    ),
    (
      '004',
      DATE '2026-11-17',
      2477::bigint,
      ARRAY[2470, 2475]::bigint[],
      ARRAY['sales headers', 'sales lines', 'transfer headers', 'transfer lines']::text[],
      ARRAY['branch stock snapshot']::text[],
      '{"salesHeaders":89,"salesLines":201,"transferHeaders":3,"transferLines":0,"stockSnapshots":0}'::jsonb,
      'กู้ข้อมูลขายและโอนกลับมาได้จากรอบ sync #2477 เมื่อ 18/11/2026 แต่ไม่มี snapshot สต๊อกของวันที่ 17/11/2026 จึงยืนยันยอดสต๊อกย้อนหลังของวันนั้นไม่ได้'
    )
)
INSERT INTO ingest.sync_run_recovery_notes (
  branch_code,
  coverage_date,
  recovery_status,
  recovered_by_sync_run_id,
  original_failed_run_ids,
  recovered_datasets,
  missing_datasets,
  evidence,
  note
)
SELECT
  c.branch_code,
  c.coverage_date,
  'partial',
  recovered_run.sync_run_id,
  c.original_failed_run_ids,
  c.recovered_datasets,
  c.missing_datasets,
  c.evidence,
  c.note
FROM recovery_cases c
JOIN ingest.sync_runs recovered_run
  ON recovered_run.sync_run_id = c.recovered_by_sync_run_id
 AND recovered_run.status = 'success'
 AND substring(recovered_run.sync_type FROM 'adapos_branch_([0-9]+)') = c.branch_code
 AND (recovered_run.started_at AT TIME ZONE 'Asia/Bangkok')::date = c.coverage_date + 1
ON CONFLICT (branch_code, coverage_date) DO NOTHING;

COMMIT;
