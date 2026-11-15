BEGIN;

ALTER TABLE customer_relations.preorder_hq_receipt_batches
  ADD COLUMN IF NOT EXISTS lot_no text,
  ADD COLUMN IF NOT EXISTS manufactured_date date,
  ADD COLUMN IF NOT EXISTS expiry_date date;

CREATE TABLE IF NOT EXISTS customer_relations.preorder_hq_receipt_photos (
  photo_id uuid PRIMARY KEY,
  photo_public_id text NOT NULL UNIQUE,
  batch_id uuid NOT NULL REFERENCES customer_relations.preorder_hq_receipt_batches(batch_id) ON DELETE RESTRICT,
  original_filename text,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bucket_name text NOT NULL,
  object_key text NOT NULL UNIQUE,
  etag text,
  object_version text,
  upload_state text NOT NULL DEFAULT 'pending' CHECK (upload_state IN ('pending','ready','cleanup_pending','deleted')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  cleanup_after timestamptz
);

CREATE INDEX IF NOT EXISTS idx_preorder_hq_receipt_photos_batch
  ON customer_relations.preorder_hq_receipt_photos(batch_id, created_at)
  WHERE upload_state = 'ready';

COMMIT;
