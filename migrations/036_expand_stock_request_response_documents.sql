BEGIN;

CREATE SCHEMA IF NOT EXISTS ordering;

ALTER TABLE ordering.stock_requests
  ADD COLUMN IF NOT EXISTS response_result text,
  ADD COLUMN IF NOT EXISTS response_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_requests_response_result_check'
      AND conrelid = 'ordering.stock_requests'::regclass
  ) THEN
    ALTER TABLE ordering.stock_requests
      ADD CONSTRAINT stock_requests_response_result_check
      CHECK (
        response_result IS NULL
        OR response_result IN ('FULLY_APPROVED', 'PARTIALLY_APPROVED', 'FULLY_REJECTED')
      );
  END IF;
END $$;

UPDATE ordering.stock_request_lines
SET status = 'CUSTOM'
WHERE status = 'APPROVED_PARTIAL';

UPDATE ordering.stock_request_line_responses
SET response_status = 'CUSTOM'
WHERE response_status = 'APPROVED_PARTIAL';

ALTER TABLE ordering.stock_request_lines
  DROP CONSTRAINT IF EXISTS stock_request_lines_status_check;

ALTER TABLE ordering.stock_request_lines
  ADD CONSTRAINT stock_request_lines_status_check
  CHECK (status IN ('PENDING', 'APPROVED_FULL', 'CUSTOM', 'REJECTED'));

ALTER TABLE ordering.stock_request_line_responses
  DROP CONSTRAINT IF EXISTS stock_request_line_responses_response_status_check;

ALTER TABLE ordering.stock_request_line_responses
  ADD CONSTRAINT stock_request_line_responses_response_status_check
  CHECK (response_status IN ('APPROVED_FULL', 'CUSTOM', 'REJECTED'));

ALTER TABLE ordering.stock_request_documents
  ADD COLUMN IF NOT EXISTS document_type text;

UPDATE ordering.stock_request_documents
SET document_type = COALESCE(document_type, 'PACKING_SLIP');

ALTER TABLE ordering.stock_request_documents
  ALTER COLUMN document_type SET NOT NULL;

ALTER TABLE ordering.stock_request_documents
  DROP CONSTRAINT IF EXISTS stock_request_documents_document_type_check;

ALTER TABLE ordering.stock_request_documents
  ADD CONSTRAINT stock_request_documents_document_type_check
  CHECK (document_type IN ('RESPONSE_SUMMARY', 'PACKING_SLIP'));

ALTER TABLE ordering.stock_request_documents
  DROP CONSTRAINT IF EXISTS stock_request_documents_request_version_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_request_documents_request_type_version_key'
      AND conrelid = 'ordering.stock_request_documents'::regclass
  ) THEN
    ALTER TABLE ordering.stock_request_documents
      ADD CONSTRAINT stock_request_documents_request_type_version_key
      UNIQUE (request_id, document_type, version);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_request_documents_request_type
  ON ordering.stock_request_documents (request_id, document_type, version DESC);

WITH latest_submitted_responses AS (
  SELECT DISTINCT ON (line_id)
    line_id,
    response_status,
    approved_qty
  FROM ordering.stock_request_line_responses
  WHERE is_submitted = TRUE
  ORDER BY line_id ASC, created_at DESC, response_id DESC
),
request_line_rollup AS (
  SELECT
    l.request_id,
    COUNT(*) AS total_lines,
    COUNT(*) FILTER (WHERE COALESCE(r.response_status, 'PENDING') = 'REJECTED') AS rejected_lines,
    COUNT(*) FILTER (
      WHERE COALESCE(r.response_status, 'PENDING') = 'APPROVED_FULL'
    ) AS full_lines,
    COUNT(*) FILTER (
      WHERE COALESCE(r.response_status, 'PENDING') = 'CUSTOM'
    ) AS custom_lines
  FROM ordering.stock_request_lines l
  LEFT JOIN latest_submitted_responses r
    ON r.line_id = l.line_id
  GROUP BY l.request_id
)
UPDATE ordering.stock_requests sr
SET response_result = CASE
  WHEN rollup.total_lines > 0 AND rollup.rejected_lines = rollup.total_lines
    THEN 'FULLY_REJECTED'
  WHEN rollup.total_lines > 0 AND rollup.full_lines = rollup.total_lines
    THEN 'FULLY_APPROVED'
  WHEN sr.status IN ('RESPONDED', 'ACKNOWLEDGED', 'READY_TO_DISPATCH', 'DISPATCHED', 'RECEIVED', 'COMPLETED')
    THEN 'PARTIALLY_APPROVED'
  ELSE sr.response_result
END
FROM request_line_rollup rollup
WHERE sr.request_id = rollup.request_id
  AND (
    sr.response_result IS NULL
    OR sr.status IN ('RESPONDED', 'ACKNOWLEDGED', 'READY_TO_DISPATCH', 'DISPATCHED', 'RECEIVED', 'COMPLETED')
  );

COMMIT;
