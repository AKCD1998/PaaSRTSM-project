BEGIN;

CREATE SCHEMA IF NOT EXISTS ordering;

ALTER TABLE ordering.stock_requests
  ADD COLUMN IF NOT EXISTS request_mode text;

UPDATE ordering.stock_requests
SET request_mode = COALESCE(request_mode, 'STANDARD');

ALTER TABLE ordering.stock_requests
  ALTER COLUMN request_mode SET DEFAULT 'STANDARD';

ALTER TABLE ordering.stock_requests
  ALTER COLUMN request_mode SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_requests_request_mode_check'
      AND conrelid = 'ordering.stock_requests'::regclass
  ) THEN
    ALTER TABLE ordering.stock_requests
      ADD CONSTRAINT stock_requests_request_mode_check
      CHECK (request_mode IN ('STANDARD', 'ADMIN_ALERT'));
  END IF;
END $$;

COMMIT;
