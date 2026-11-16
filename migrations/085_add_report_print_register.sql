BEGIN;
-- Document and paper-print history only. Never writes stock, Ada or dispensing.
CREATE SCHEMA IF NOT EXISTS report_print_register;
CREATE TABLE IF NOT EXISTS report_print_register.documents (
 id UUID PRIMARY KEY,
 source_key TEXT NOT NULL UNIQUE CHECK(length(source_key) BETWEEN 1 AND 240),
 report_kind TEXT NOT NULL CHECK(report_kind IN ('KY9','KY10','KY11')),
 branch_code TEXT NOT NULL CHECK(branch_code IN ('000','001','003','004','005')),
 period_start DATE NOT NULL,
 period_end DATE NOT NULL CHECK(period_end >= period_start),
 version_label TEXT NOT NULL CHECK(length(version_label) BETWEEN 1 AND 300),
 filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 500),
 page_count INTEGER CHECK(page_count BETWEEN 1 AND 20000),
 sha256 TEXT CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 source_reference TEXT NOT NULL,
 sections JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(sections)='array'),
 provenance JSONB NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(provenance)='object'),
 supersedes UUID REFERENCES report_print_register.documents(id),
 registered_by TEXT NOT NULL,
 registration_reason TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_print_documents_scope_idx ON report_print_register.documents(report_kind,branch_code,period_start,period_end);
CREATE TABLE IF NOT EXISTS report_print_register.events (
 id UUID PRIMARY KEY,
 document_id UUID NOT NULL REFERENCES report_print_register.documents(id),
 source_key TEXT UNIQUE,
 action TEXT NOT NULL CHECK(action IN ('confirmed','voided')),
 page_ranges JSONB CHECK(page_ranges IS NULL OR jsonb_typeof(page_ranges)='array'),
 printed_on DATE,
 copies INTEGER CHECK(copies BETWEEN 1 AND 1000),
 printer_name TEXT,
 evidence_type TEXT CHECK(evidence_type IN ('user_confirmation','printer_receipt','photo')),
 evidence_reference TEXT NOT NULL,
 reason TEXT NOT NULL,
 voids_event_id UUID UNIQUE REFERENCES report_print_register.events(id),
 recorded_by TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((action='confirmed' AND evidence_type IS NOT NULL AND voids_event_id IS NULL)
    OR (action='voided' AND voids_event_id IS NOT NULL AND page_ranges IS NULL AND printed_on IS NULL AND copies IS NULL))
);
CREATE INDEX IF NOT EXISTS report_print_events_document_idx ON report_print_register.events(document_id,recorded_at,id);
CREATE TABLE IF NOT EXISTS report_print_register.unmapped_evidence (
 id UUID PRIMARY KEY,
 source_key TEXT NOT NULL UNIQUE,
 report_kind TEXT NOT NULL CHECK(report_kind IN ('KY9','KY10','KY11')),
 branch_code TEXT NOT NULL CHECK(branch_code IN ('000','001','003','004','005')),
 month TEXT NOT NULL CHECK(month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 summary TEXT NOT NULL,
 evidence_reference TEXT NOT NULL,
 recorded_by TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION report_print_register.keep_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Print registry history is append-only; record a correction or a new document version'; END;
$$;
DROP TRIGGER IF EXISTS print_documents_immutable ON report_print_register.documents;
CREATE TRIGGER print_documents_immutable BEFORE UPDATE OR DELETE ON report_print_register.documents FOR EACH ROW EXECUTE FUNCTION report_print_register.keep_history();
DROP TRIGGER IF EXISTS print_events_immutable ON report_print_register.events;
CREATE TRIGGER print_events_immutable BEFORE UPDATE OR DELETE ON report_print_register.events FOR EACH ROW EXECUTE FUNCTION report_print_register.keep_history();
DROP TRIGGER IF EXISTS print_unmapped_immutable ON report_print_register.unmapped_evidence;
CREATE TRIGGER print_unmapped_immutable BEFORE UPDATE OR DELETE ON report_print_register.unmapped_evidence FOR EACH ROW EXECUTE FUNCTION report_print_register.keep_history();
COMMIT;
