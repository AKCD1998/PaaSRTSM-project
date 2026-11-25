BEGIN;

-- Prevent a legacy final write slipping between backfill and trigger installation.
LOCK TABLE ordering.scpda_annual_pages IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS ordering.scpda_annual_submissions (
  receipt_id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  category text NOT NULL,
  page_no integer NOT NULL,
  revision integer NOT NULL,
  submission_no integer NOT NULL CHECK(submission_no > 0),
  previous_receipt_id uuid,
  mutation_id uuid NOT NULL,
  operator_code text NOT NULL,
  actor_name text,
  counts jsonb,
  counts_sha256 text NOT NULL CHECK(counts_sha256 ~ '^[a-f0-9]{64}$'),
  submitted_at timestamptz NOT NULL,
  FOREIGN KEY(event_id,category,page_no) REFERENCES ordering.scpda_annual_pages(event_id,category,page_no),
  UNIQUE(event_id,category,page_no,revision),
  UNIQUE(event_id,category,page_no,mutation_id),
  UNIQUE(event_id,category,page_no,submission_no)
);
COMMENT ON COLUMN ordering.scpda_annual_submissions.counts IS 'Only the latest three full submissions per page are retained. Older receipts retain small idempotency metadata and a digest, not a full count snapshot.';

INSERT INTO ordering.scpda_annual_submissions
  (receipt_id,event_id,category,page_no,revision,submission_no,mutation_id,operator_code,actor_name,counts,counts_sha256,submitted_at)
SELECT p.receipt_id,p.event_id,p.category,p.page_no,p.revision,1,p.mutation_id,p.assignee,n.display_name,p.counts,
  encode(sha256(convert_to(p.counts::text,'UTF8')),'hex'),p.submitted_at
FROM ordering.scpda_annual_pages p
LEFT JOIN ordering.scpda_annual_participants n ON n.event_id=p.event_id AND n.operator_code=p.assignee
WHERE p.receipt_id IS NOT NULL
ON CONFLICT(receipt_id) DO NOTHING;

CREATE OR REPLACE FUNCTION ordering.scpda_annual_keep_submission()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_id uuid;
BEGIN
  IF NEW.receipt_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.receipt_id IS NOT DISTINCT FROM OLD.receipt_id THEN RETURN NEW; END IF;
    previous_id := OLD.receipt_id;
  END IF;
  INSERT INTO ordering.scpda_annual_submissions
    (receipt_id,event_id,category,page_no,revision,submission_no,previous_receipt_id,mutation_id,operator_code,actor_name,counts,counts_sha256,submitted_at)
  VALUES (NEW.receipt_id,NEW.event_id,NEW.category,NEW.page_no,NEW.revision,
    (SELECT COALESCE(max(submission_no),0)+1 FROM ordering.scpda_annual_submissions WHERE event_id=NEW.event_id AND category=NEW.category AND page_no=NEW.page_no),
    previous_id,NEW.mutation_id,NEW.assignee,
    (SELECT display_name FROM ordering.scpda_annual_participants WHERE event_id=NEW.event_id AND operator_code=NEW.assignee),
    NEW.counts,encode(sha256(convert_to(NEW.counts::text,'UTF8')),'hex'),NEW.submitted_at)
  ON CONFLICT(receipt_id) DO NOTHING;
  UPDATE ordering.scpda_annual_submissions SET counts=NULL
  WHERE event_id=NEW.event_id AND category=NEW.category AND page_no=NEW.page_no AND counts IS NOT NULL
    AND receipt_id NOT IN (SELECT receipt_id FROM ordering.scpda_annual_submissions
      WHERE event_id=NEW.event_id AND category=NEW.category AND page_no=NEW.page_no ORDER BY submission_no DESC LIMIT 3);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS scpda_annual_submission_snapshot ON ordering.scpda_annual_pages;
CREATE TRIGGER scpda_annual_submission_snapshot AFTER INSERT OR UPDATE OF receipt_id ON ordering.scpda_annual_pages
  FOR EACH ROW EXECUTE FUNCTION ordering.scpda_annual_keep_submission();

COMMIT;
