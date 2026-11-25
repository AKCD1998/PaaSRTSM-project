BEGIN;

CREATE TABLE IF NOT EXISTS ordering.scpda_annual_events (
  id uuid PRIMARY KEY,
  branch_code text NOT NULL CHECK (branch_code ~ '^[0-9]{3}$'),
  warehouse_code text NOT NULL CHECK (warehouse_code ~ '^[0-9]{3}$'),
  label text NOT NULL,
  source_files jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS scpda_annual_open_event_per_branch
  ON ordering.scpda_annual_events (branch_code) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS ordering.scpda_annual_pages (
  event_id uuid NOT NULL REFERENCES ordering.scpda_annual_events (id),
  category text NOT NULL CHECK (category IN ('common', 'normal', 'pharma')),
  page_no integer NOT NULL CHECK (page_no > 0),
  items jsonb NOT NULL,
  assignee text,
  counts jsonb NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  mutation_id uuid,
  receipt_id uuid,
  submitted_at timestamptz,
  PRIMARY KEY (event_id, category, page_no),
  CHECK ((receipt_id IS NULL) = (submitted_at IS NULL)),
  CHECK (submitted_at IS NULL OR assignee IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS scpda_annual_active_page_per_operator
  ON ordering.scpda_annual_pages (event_id, assignee)
  WHERE assignee IS NOT NULL AND submitted_at IS NULL;

CREATE TABLE IF NOT EXISTS ordering.scpda_annual_requests (
  event_id uuid NOT NULL,
  category text NOT NULL,
  page_no integer NOT NULL,
  operator_code text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, operator_code),
  FOREIGN KEY (event_id, category, page_no)
    REFERENCES ordering.scpda_annual_pages (event_id, category, page_no)
);

CREATE TABLE IF NOT EXISTS ordering.scpda_annual_count_audit (
  event_id uuid NOT NULL,
  category text NOT NULL,
  page_no integer NOT NULL,
  revision integer NOT NULL,
  operator_code text NOT NULL,
  changes jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, category, page_no, revision),
  FOREIGN KEY (event_id, category, page_no)
    REFERENCES ordering.scpda_annual_pages (event_id, category, page_no)
);
CREATE INDEX IF NOT EXISTS scpda_annual_count_audit_retention
  ON ordering.scpda_annual_count_audit (recorded_at);

COMMIT;
