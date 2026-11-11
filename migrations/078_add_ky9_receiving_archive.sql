BEGIN;
-- A private draft-evidence archive. No stock/sales/Ada tables, triggers or jobs.
CREATE TABLE IF NOT EXISTS ky9_documents.receiving_batches (
 id UUID PRIMARY KEY,
 period TEXT NOT NULL CHECK (period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 label TEXT NOT NULL,
 content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
 manifest JSONB NOT NULL CHECK (jsonb_typeof(manifest)='object'),
 row_count INTEGER NOT NULL CHECK (row_count>=0),
 recorded_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(period,content_sha256), UNIQUE(period,id)
);
CREATE TABLE IF NOT EXISTS ky9_documents.receiving_rows (
 batch_id UUID NOT NULL REFERENCES ky9_documents.receiving_batches(id),
 row_key TEXT NOT NULL,
 event_id TEXT NOT NULL,
 branch_code TEXT NOT NULL CHECK (branch_code IN ('000','001','003','004','005')),
 received_date DATE NOT NULL,
 product_code TEXT NOT NULL,
 product_name TEXT NOT NULL,
 lot TEXT,
 document_no TEXT NOT NULL,
 invoice_no TEXT NOT NULL DEFAULT '',
 supplier TEXT NOT NULL DEFAULT '',
 movement_type TEXT NOT NULL CHECK (movement_type IN ('supplier_receipt','transfer_receipt')),
 search_key TEXT NOT NULL,
 data JSONB NOT NULL CHECK (jsonb_typeof(data)='object'),
 PRIMARY KEY(batch_id,row_key)
);
CREATE INDEX IF NOT EXISTS ky9_receiving_product_idx ON ky9_documents.receiving_rows(product_code,received_date);
CREATE INDEX IF NOT EXISTS ky9_receiving_lot_idx ON ky9_documents.receiving_rows(lot);
CREATE INDEX IF NOT EXISTS ky9_receiving_document_idx ON ky9_documents.receiving_rows(document_no);
CREATE TABLE IF NOT EXISTS ky9_documents.receiving_heads (
 period TEXT PRIMARY KEY,
 batch_id UUID NOT NULL,
 FOREIGN KEY(period,batch_id) REFERENCES ky9_documents.receiving_batches(period,id)
);
-- Revisions move only the head; old source rows/manifests remain immutable.
DROP TRIGGER IF EXISTS ky9_receiving_batches_append_only ON ky9_documents.receiving_batches;
CREATE TRIGGER ky9_receiving_batches_append_only BEFORE UPDATE OR DELETE ON ky9_documents.receiving_batches
 FOR EACH ROW EXECUTE FUNCTION ky9_documents.prevent_history_change();
DROP TRIGGER IF EXISTS ky9_receiving_rows_append_only ON ky9_documents.receiving_rows;
CREATE TRIGGER ky9_receiving_rows_append_only BEFORE UPDATE OR DELETE ON ky9_documents.receiving_rows
 FOR EACH ROW EXECUTE FUNCTION ky9_documents.prevent_history_change();
COMMIT;
