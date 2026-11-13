BEGIN;
CREATE SCHEMA IF NOT EXISTS pjk_documents;
CREATE TABLE IF NOT EXISTS pjk_documents.assets (
 id TEXT PRIMARY KEY,
 mime_type TEXT NOT NULL CHECK (mime_type='image/png'),
 content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 content BYTEA NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 1048576),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pjk_documents.records (
 id TEXT PRIMARY KEY CHECK(id ~ '^[a-zA-Z0-9-]{1,100}$'),
 month TEXT NOT NULL CHECK(month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 branch TEXT NOT NULL CHECK(branch IN ('001','003','004','005')),
 template_version TEXT NOT NULL DEFAULT 'form_gor_gor_1-v1',
 signature_asset_id TEXT NOT NULL REFERENCES pjk_documents.assets(id),
 metadata JSONB NOT NULL CHECK(jsonb_typeof(metadata)='object'),
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object' AND jsonb_typeof(payload->'subPharmacistSlots')='array' AND jsonb_array_length(payload->'subPharmacistSlots') BETWEEN 1 AND 3),
 source_pdf_sha256 TEXT NOT NULL CHECK(source_pdf_sha256 ~ '^[a-f0-9]{64}$'),
 imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pjk_records_month_branch_idx ON pjk_documents.records(month,branch,id);
COMMENT ON SCHEMA pjk_documents IS 'Private immutable PJK snapshots and a single private signature asset. PDF bytes are generated on demand and not retained.';
COMMIT;
