BEGIN;

-- Publication workflow for focus products. Existing rows remain visible by
-- default so deploying this migration cannot hide the current live targets.
ALTER TABLE focus.focus_products
  ADD COLUMN IF NOT EXISTS publication_status text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS scheduled_publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by text;

UPDATE focus.focus_products
SET published_at = COALESCE(published_at, created_at)
WHERE publication_status = 'published';

ALTER TABLE focus.focus_products
  DROP CONSTRAINT IF EXISTS focus_products_publication_status_check;

ALTER TABLE focus.focus_products
  ADD CONSTRAINT focus_products_publication_status_check
  CHECK (publication_status IN ('draft', 'published', 'scheduled'));

ALTER TABLE focus.focus_products
  DROP CONSTRAINT IF EXISTS focus_products_publication_schedule_check;

ALTER TABLE focus.focus_products
  ADD CONSTRAINT focus_products_publication_schedule_check
  CHECK (
    (publication_status = 'scheduled' AND scheduled_publish_at IS NOT NULL)
    OR (publication_status <> 'scheduled' AND scheduled_publish_at IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_focus_products_publication
  ON focus.focus_products (is_active, publication_status, scheduled_publish_at);

COMMIT;
