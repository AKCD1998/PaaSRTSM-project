BEGIN;

ALTER TABLE ordering.scpda_annual_pages
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_saved_at timestamptz;

-- Preserve existing work as the front of its queue. This is a migration
-- ordering value, not a claim to know its original assignment timestamp.
UPDATE ordering.scpda_annual_pages p
SET assigned_at=e.created_at
FROM ordering.scpda_annual_events e
WHERE e.id=p.event_id AND p.assignee IS NOT NULL AND p.assigned_at IS NULL;

-- Old R22 writers also keep assignment order during a rolling deploy.
CREATE OR REPLACE FUNCTION ordering.scpda_annual_stamp_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assignee IS DISTINCT FROM OLD.assignee THEN
    NEW.assigned_at := CASE WHEN NEW.assignee IS NULL THEN NULL ELSE clock_timestamp() END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS scpda_annual_assignment_stamp ON ordering.scpda_annual_pages;
CREATE TRIGGER scpda_annual_assignment_stamp
  BEFORE UPDATE OF assignee ON ordering.scpda_annual_pages
  FOR EACH ROW EXECUTE FUNCTION ordering.scpda_annual_stamp_assignment();

DROP INDEX IF EXISTS ordering.scpda_annual_active_page_per_operator;
CREATE INDEX IF NOT EXISTS scpda_annual_open_pages_by_operator
  ON ordering.scpda_annual_pages (event_id,assignee,assigned_at)
  WHERE assignee IS NOT NULL AND submitted_at IS NULL;

CREATE TABLE IF NOT EXISTS ordering.scpda_annual_participants (
  event_id uuid NOT NULL REFERENCES ordering.scpda_annual_events(id),
  operator_code text NOT NULL,
  display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 80),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(event_id,operator_code)
);
ALTER TABLE ordering.scpda_annual_count_audit ADD COLUMN IF NOT EXISTS actor_name text;

COMMIT;
