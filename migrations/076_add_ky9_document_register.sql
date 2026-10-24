BEGIN;

-- A document register only. No stock, Ada, OCR or pharmacist approval writes.
CREATE SCHEMA IF NOT EXISTS ky9_documents;

-- Real evidence is seeded privately after deploy, never bundled in public source.
CREATE TABLE IF NOT EXISTS ky9_documents.prepared_cases (
  period TEXT NOT NULL CHECK (period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 100),
  evidence_as_of DATE NOT NULL,
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (period, source_key)
);

CREATE TABLE IF NOT EXISTS ky9_documents.periods (
  period TEXT PRIMARY KEY CHECK (period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  branches JSONB NOT NULL CHECK (jsonb_typeof(branches) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ky9_documents.incidents (
  id UUID PRIMARY KEY,
  period TEXT NOT NULL REFERENCES ky9_documents.periods(period),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  closed_at TIMESTAMPTZ,
  closed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ky9_incidents_period_idx ON ky9_documents.incidents(period, created_at);
ALTER TABLE ky9_documents.incidents ADD COLUMN IF NOT EXISTS source_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ky9_incidents_source_key_idx ON ky9_documents.incidents(period, source_key);

CREATE TABLE IF NOT EXISTS ky9_documents.notes (
  id UUID PRIMARY KEY,
  period TEXT NOT NULL REFERENCES ky9_documents.periods(period),
  incident_id UUID REFERENCES ky9_documents.incidents(id),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 12000),
  recorded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ky9_notes_period_idx ON ky9_documents.notes(period, created_at);

CREATE TABLE IF NOT EXISTS ky9_documents.drafts (
  id UUID PRIMARY KEY,
  period TEXT NOT NULL REFERENCES ky9_documents.periods(period),
  branch_code TEXT NOT NULL CHECK (branch_code IN ('000','001','003','004','005')),
  label TEXT NOT NULL,
  reference TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  supersedes UUID REFERENCES ky9_documents.drafts(id),
  recorded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supersedes)
);
CREATE INDEX IF NOT EXISTS ky9_drafts_period_idx ON ky9_documents.drafts(period, branch_code);

CREATE TABLE IF NOT EXISTS ky9_documents.events (
  id BIGSERIAL PRIMARY KEY,
  period TEXT NOT NULL REFERENCES ky9_documents.periods(period),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('period','incident','note','draft')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ky9_events_period_idx ON ky9_documents.events(period, id DESC);

CREATE OR REPLACE FUNCTION ky9_documents.prevent_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'KY9 document history is append-only';
END;
$$;
DROP TRIGGER IF EXISTS ky9_events_append_only ON ky9_documents.events;
DROP TRIGGER IF EXISTS ky9_prepared_cases_append_only ON ky9_documents.prepared_cases;
CREATE TRIGGER ky9_prepared_cases_append_only BEFORE UPDATE OR DELETE ON ky9_documents.prepared_cases
FOR EACH ROW EXECUTE FUNCTION ky9_documents.prevent_history_change();
CREATE TRIGGER ky9_events_append_only BEFORE UPDATE OR DELETE ON ky9_documents.events
FOR EACH ROW EXECUTE FUNCTION ky9_documents.prevent_history_change();
DROP TRIGGER IF EXISTS ky9_notes_append_only ON ky9_documents.notes;
CREATE TRIGGER ky9_notes_append_only BEFORE UPDATE OR DELETE ON ky9_documents.notes
FOR EACH ROW EXECUTE FUNCTION ky9_documents.prevent_history_change();
DROP TRIGGER IF EXISTS ky9_drafts_append_only ON ky9_documents.drafts;
CREATE TRIGGER ky9_drafts_append_only BEFORE UPDATE OR DELETE ON ky9_documents.drafts
FOR EACH ROW EXECUTE FUNCTION ky9_documents.prevent_history_change();

COMMIT;
