BEGIN;
-- 089 is reserved by the separate inactive daily/Drive candidate.
-- Preserve immutable legacy observations with NULL scope; do not infer an area.
ALTER TABLE ordering.scpda_observations ADD COLUMN IF NOT EXISTS count_scope text;
ALTER TABLE ordering.scpda_observations DROP CONSTRAINT IF EXISTS scpda_observations_scope_check;
ALTER TABLE ordering.scpda_observations ADD CONSTRAINT scpda_observations_scope_check
 CHECK(count_scope IS NULL OR (branch_code='004' AND count_scope IN ('004-front','004-shopee')));
ALTER TABLE ordering.scpda_observations DROP CONSTRAINT IF EXISTS scpda_observations_operator_code_check;
ALTER TABLE ordering.scpda_observations ADD CONSTRAINT scpda_observations_operator_code_check
 CHECK(operator_code IN ('01001','02001','03001','01004','01004SHPEE','01005','02005'));
ALTER TABLE ordering.scpda_observations DROP CONSTRAINT IF EXISTS scpda_observations_operator_branch_check;
ALTER TABLE ordering.scpda_observations ADD CONSTRAINT scpda_observations_operator_branch_check
 CHECK((branch_code='001' AND operator_code IN ('01001','02001','03001')) OR
 (branch_code='004' AND operator_code IN ('01004','01004SHPEE')) OR
 (branch_code='005' AND operator_code IN ('01005','02005')));
ALTER TABLE ordering.scpda_fefo_projections ADD COLUMN IF NOT EXISTS count_scope text;
ALTER TABLE ordering.scpda_fefo_projections DROP CONSTRAINT IF EXISTS scpda_fefo_scope_check;
ALTER TABLE ordering.scpda_fefo_projections ADD CONSTRAINT scpda_fefo_scope_check
 CHECK(count_scope IS NULL OR (branch_code='004' AND count_scope IN ('004-front','004-shopee')));
CREATE INDEX IF NOT EXISTS scpda004_scope_latest ON ordering.scpda_observations(branch_code,product_code,count_scope,received_at DESC,event_id);
CREATE TABLE IF NOT EXISTS ordering.scpda004_internal_picks (
 event_id uuid PRIMARY KEY,receipt_id uuid NOT NULL UNIQUE,
 branch_code text NOT NULL DEFAULT '004' CHECK(branch_code='004'),
 operator_code text NOT NULL CHECK(operator_code IN ('01004','01004SHPEE')),
 device_ref text NOT NULL CHECK(device_ref ~ '^[a-f0-9]{64}$'),
 product_code text NOT NULL,sku_id bigint NOT NULL,barcode text NOT NULL,
 quantity integer NOT NULL CHECK(quantity>0),unit_label text NOT NULL,
 from_scope text NOT NULL CHECK(from_scope='004-front'),
 from_location text NOT NULL CHECK(from_location='front-store'),
 to_scope text NOT NULL CHECK(to_scope='004-shopee'),
 destination text NOT NULL CHECK(destination IN ('order-packed','shopee-shelf')),
 order_reference text,lot_code text,observed_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 payload_hash text NOT NULL,request_payload jsonb NOT NULL,
 CHECK(destination='order-packed' OR order_reference IS NULL)
);
CREATE INDEX IF NOT EXISTS scpda004_pick_product_time ON ordering.scpda004_internal_picks(product_code,observed_at,event_id);
DROP TRIGGER IF EXISTS scpda004_picks_immutable ON ordering.scpda004_internal_picks;
CREATE TRIGGER scpda004_picks_immutable BEFORE UPDATE OR DELETE ON ordering.scpda004_internal_picks FOR EACH ROW EXECUTE FUNCTION ordering.scpda_reject_evidence_change();
DROP TRIGGER IF EXISTS scpda004_picks_no_truncate ON ordering.scpda004_internal_picks;
CREATE TRIGGER scpda004_picks_no_truncate BEFORE TRUNCATE ON ordering.scpda004_internal_picks FOR EACH STATEMENT EXECUTE FUNCTION ordering.scpda_reject_evidence_change();
COMMIT;
