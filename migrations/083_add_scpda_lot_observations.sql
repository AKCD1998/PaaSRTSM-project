BEGIN;
-- Activation review candidate. Dedicated SCPDA evidence only; no stock mutation.
-- Captured catalog identity is historical: no FK to replaceable sync catalog.
CREATE TABLE IF NOT EXISTS ordering.scpda_observations (
 event_id uuid PRIMARY KEY,
 receipt_id uuid NOT NULL UNIQUE,
 branch_code text NOT NULL CHECK(branch_code='001'),
 sku_id bigint NOT NULL,
 product_code text NOT NULL,
 barcode text NOT NULL,
 unit_label text NOT NULL,
 operator_code text NOT NULL CHECK(operator_code IN('01001','02001','03001')),
 device_ref text NOT NULL CHECK(length(device_ref)=64),
 payload_hash text NOT NULL CHECK(length(payload_hash)=64),
 request_payload jsonb NOT NULL,
 evidence jsonb NOT NULL,
 category text NOT NULL CHECK(category IN('pharma','common','normal')),
 round_no integer NOT NULL CHECK(round_no BETWEEN 1 AND 3),
 complete_product boolean NOT NULL,
 observed_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 correction_of uuid REFERENCES ordering.scpda_observations(event_id),
 CHECK(correction_of IS NULL OR correction_of<>event_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS scpda_one_successor ON ordering.scpda_observations(correction_of) WHERE correction_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS scpda_observation_product ON ordering.scpda_observations(branch_code,product_code,observed_at DESC,received_at DESC,event_id);
CREATE INDEX IF NOT EXISTS scpda_observation_actor ON ordering.scpda_observations(branch_code,operator_code,received_at DESC,event_id);
CREATE TABLE IF NOT EXISTS ordering.scpda_lot_observations (
 event_id uuid NOT NULL REFERENCES ordering.scpda_observations(event_id),
 ordinal integer NOT NULL CHECK(ordinal>=0),
 lot_code text,
 quantity numeric(12,3) NOT NULL CHECK(quantity>=0),
 manufactured_on date,
 expires_on date,
 PRIMARY KEY(event_id,ordinal),
 CHECK(manufactured_on IS NULL OR expires_on IS NULL OR manufactured_on<=expires_on)
);
CREATE TABLE IF NOT EXISTS ordering.scpda_review_events (
 review_id uuid PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES ordering.scpda_observations(event_id),
 revision integer NOT NULL CHECK(revision>0),
 action text NOT NULL CHECK(action IN('received','needs-review','accepted-observation','recount-requested','dismissed','reopened')),
 actor_id text NOT NULL,
 actor_role text NOT NULL CHECK(actor_role IN('system','admin')),
 reason text NOT NULL,
 evidence jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(event_id,revision)
);
CREATE INDEX IF NOT EXISTS scpda_review_queue ON ordering.scpda_review_events(recorded_at DESC,event_id,revision DESC);
CREATE TABLE IF NOT EXISTS ordering.scpda_fefo_projections (
 projection_id uuid PRIMARY KEY,
 baseline_event_id uuid NOT NULL REFERENCES ordering.scpda_observations(event_id),
 branch_code text NOT NULL CHECK(branch_code='001'),
 product_code text NOT NULL,
 unit_label text NOT NULL,
 computed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 valid_through timestamptz NOT NULL,
 policy_version text NOT NULL,
 source_revision text NOT NULL,
 evidence jsonb NOT NULL,
 result jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS scpda_projection_product ON ordering.scpda_fefo_projections(branch_code,product_code,computed_at DESC,projection_id);
CREATE OR REPLACE FUNCTION ordering.scpda_reject_evidence_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'SCPDA evidence is append-only' USING ERRCODE='55000';END;
$$;
DROP TRIGGER IF EXISTS scpda_observations_immutable ON ordering.scpda_observations;
CREATE TRIGGER scpda_observations_immutable BEFORE UPDATE OR DELETE ON ordering.scpda_observations FOR EACH ROW EXECUTE FUNCTION ordering.scpda_reject_evidence_change();
DROP TRIGGER IF EXISTS scpda_lots_immutable ON ordering.scpda_lot_observations;
CREATE TRIGGER scpda_lots_immutable BEFORE UPDATE OR DELETE ON ordering.scpda_lot_observations FOR EACH ROW EXECUTE FUNCTION ordering.scpda_reject_evidence_change();
DROP TRIGGER IF EXISTS scpda_reviews_immutable ON ordering.scpda_review_events;
CREATE TRIGGER scpda_reviews_immutable BEFORE UPDATE OR DELETE ON ordering.scpda_review_events FOR EACH ROW EXECUTE FUNCTION ordering.scpda_reject_evidence_change();
DROP TRIGGER IF EXISTS scpda_projections_immutable ON ordering.scpda_fefo_projections;
CREATE TRIGGER scpda_projections_immutable BEFORE UPDATE OR DELETE ON ordering.scpda_fefo_projections FOR EACH ROW EXECUTE FUNCTION ordering.scpda_reject_evidence_change();
DROP TRIGGER IF EXISTS scpda_observations_no_truncate ON ordering.scpda_observations;
CREATE TRIGGER scpda_observations_no_truncate BEFORE TRUNCATE ON ordering.scpda_observations FOR EACH STATEMENT EXECUTE FUNCTION ordering.scpda_reject_evidence_change();

DROP TRIGGER IF EXISTS scpda_lot_observations_no_truncate ON ordering.scpda_lot_observations;
CREATE TRIGGER scpda_lot_observations_no_truncate BEFORE TRUNCATE ON ordering.scpda_lot_observations FOR EACH STATEMENT EXECUTE FUNCTION ordering.scpda_reject_evidence_change();

DROP TRIGGER IF EXISTS scpda_review_events_no_truncate ON ordering.scpda_review_events;
CREATE TRIGGER scpda_review_events_no_truncate BEFORE TRUNCATE ON ordering.scpda_review_events FOR EACH STATEMENT EXECUTE FUNCTION ordering.scpda_reject_evidence_change();

DROP TRIGGER IF EXISTS scpda_fefo_projections_no_truncate ON ordering.scpda_fefo_projections;
CREATE TRIGGER scpda_fefo_projections_no_truncate BEFORE TRUNCATE ON ordering.scpda_fefo_projections FOR EACH STATEMENT EXECUTE FUNCTION ordering.scpda_reject_evidence_change();

COMMIT;
