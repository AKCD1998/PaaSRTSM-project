BEGIN;

CREATE SCHEMA IF NOT EXISTS customer_relations;

CREATE TABLE IF NOT EXISTS customer_relations.preorder_unavailable_reasons (
  reason_code text PRIMARY KEY,
  label_th text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  requires_note boolean NOT NULL DEFAULT false
);
INSERT INTO customer_relations.preorder_unavailable_reasons(reason_code,label_th,requires_note) VALUES
 ('SUPPLIER_OUT_OF_STOCK','ผู้จำหน่ายไม่มีสินค้า',false),('DISCONTINUED','ยกเลิกการผลิต',false),
 ('NOT_FOUND','ไม่พบสินค้า',false),('MINIMUM_ORDER_NOT_MET','ไม่ถึงจำนวนสั่งขั้นต่ำ',false),
 ('REGULATORY_OR_POLICY','ข้อกำหนดหรือเงื่อนไขนโยบาย',false),('OTHER','อื่น ๆ',true)
ON CONFLICT (reason_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS customer_relations.branch_delivery_schedules (
  branch_code text NOT NULL REFERENCES core.branches(branch_code),
  iso_weekday smallint NOT NULL CHECK (iso_weekday BETWEEN 1 AND 7),
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(branch_code,iso_weekday)
);
INSERT INTO customer_relations.branch_delivery_schedules(branch_code,iso_weekday)
SELECT v.branch_code,v.iso_weekday FROM (VALUES
 ('001',1),('001',3),('001',5),('003',1),('003',3),('003',5),
 ('004',1),('004',3),('004',5),('005',2),('005',4),('005',6)
) v(branch_code,iso_weekday)
WHERE EXISTS (SELECT 1 FROM core.branches b WHERE b.branch_code=v.branch_code)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS customer_relations.preorder_cases (
  case_id bigserial PRIMARY KEY, public_id text NOT NULL UNIQUE,
  branch_code text NOT NULL REFERENCES core.branches(branch_code),
  intent text NOT NULL CHECK(intent IN ('PRICE_INQUIRY','ORDER_REQUEST')),
  status text NOT NULL CHECK(status IN ('SUBMITTED','IN_REVIEW','NEEDS_INFO','WAITING_CUSTOMER_DECISION','PROCUREMENT_PENDING','ORDERED','RECEIVED_AT_HQ','IN_TRANSIT_TO_BRANCH','ARRIVED_AT_BRANCH','CUSTOMER_NOTIFIED','COMPLETED','CUSTOMER_DECLINED','UNAVAILABLE','CANCELLED')),
  customer_name text NOT NULL, customer_phone text NOT NULL,
  customer_phone_normalized text NOT NULL, customer_phone_last4 text NOT NULL,
  staff_note text, created_by text NOT NULL, assigned_admin_user text,
  first_admin_viewed_at timestamptz, first_admin_viewed_by text,
  last_activity_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0),
  idempotency_key text NOT NULL UNIQUE, prior_status text,
  closed_at timestamptz, closed_by text, close_reason_code text REFERENCES customer_relations.preorder_unavailable_reasons(reason_code),
  close_note text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_preorder_cases_branch_activity ON customer_relations.preorder_cases(branch_code,last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_preorder_cases_status_activity ON customer_relations.preorder_cases(status,last_activity_at DESC);

CREATE TABLE IF NOT EXISTS customer_relations.preorder_items (
  item_id bigserial PRIMARY KEY, case_id bigint NOT NULL REFERENCES customer_relations.preorder_cases(case_id) ON DELETE CASCADE,
  position integer NOT NULL CHECK(position>0), item_kind text NOT NULL CHECK(item_kind IN ('CATALOG','FREEFORM')),
  sku_id integer REFERENCES public.skus(sku_id), product_code_snapshot text, display_name_snapshot text,
  generic_name_snapshot text, barcode_snapshot text, unit_snapshot text, original_description text,
  requested_qty numeric(14,4) NOT NULL CHECK(requested_qty>0), confirmed_qty numeric(14,4) CHECK(confirmed_qty>0),
  matched_sku_id integer REFERENCES public.skus(sku_id), matched_by text, matched_at timestamptz,
  UNIQUE(case_id,position), CHECK((item_kind='CATALOG' AND sku_id IS NOT NULL) OR (item_kind='FREEFORM' AND length(trim(original_description))>0))
);

CREATE TABLE IF NOT EXISTS customer_relations.preorder_attachments (
  attachment_id bigserial PRIMARY KEY, attachment_public_id text NOT NULL UNIQUE,
  case_id bigint NOT NULL REFERENCES customer_relations.preorder_cases(case_id) ON DELETE CASCADE,
  item_id bigint REFERENCES customer_relations.preorder_items(item_id) ON DELETE SET NULL,
  original_filename text, mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes bigint NOT NULL CHECK(size_bytes>0 AND size_bytes<=5242880), sha256 text NOT NULL,
  storage_provider text NOT NULL DEFAULT 'R2' CHECK(storage_provider='R2'), bucket_name text NOT NULL,
  object_key text NOT NULL UNIQUE, etag text, object_version text,
  upload_state text NOT NULL DEFAULT 'pending' CHECK(upload_state IN ('pending','ready','cleanup_pending','deleted')),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz, cleanup_after timestamptz
);
CREATE INDEX IF NOT EXISTS idx_preorder_attachments_cleanup ON customer_relations.preorder_attachments(upload_state,cleanup_after);

CREATE TABLE IF NOT EXISTS customer_relations.preorder_messages (
  message_id bigserial PRIMARY KEY, case_id bigint NOT NULL REFERENCES customer_relations.preorder_cases(case_id) ON DELETE CASCADE,
  visibility text NOT NULL CHECK(visibility IN ('PUBLIC','ADMIN_INTERNAL')), body text NOT NULL CHECK(length(trim(body))>0),
  author_user_id text NOT NULL, author_role text NOT NULL CHECK(author_role IN ('admin','staff')),
  author_branch_code text, activity_seq bigint NOT NULL, idempotency_key text NOT NULL UNIQUE,
  is_ready boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(case_id,activity_seq)
);
ALTER TABLE customer_relations.preorder_messages ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE customer_relations.preorder_messages ADD COLUMN IF NOT EXISTS is_ready boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS ux_preorder_messages_idempotency_key ON customer_relations.preorder_messages(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE customer_relations.preorder_attachments ADD COLUMN IF NOT EXISTS message_id bigint;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='preorder_attachments_message_id_fkey') THEN
    ALTER TABLE customer_relations.preorder_attachments ADD CONSTRAINT preorder_attachments_message_id_fkey FOREIGN KEY(message_id) REFERENCES customer_relations.preorder_messages(message_id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS customer_relations.preorder_read_cursors (
  case_id bigint NOT NULL REFERENCES customer_relations.preorder_cases(case_id) ON DELETE CASCADE,
  user_id text NOT NULL, last_read_activity_seq bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(case_id,user_id)
);
CREATE TABLE IF NOT EXISTS customer_relations.preorder_events (
  event_id bigserial PRIMARY KEY, case_id bigint NOT NULL REFERENCES customer_relations.preorder_cases(case_id) ON DELETE CASCADE,
  activity_seq bigint NOT NULL, event_type text NOT NULL, actor_user_id text, actor_role text,
  from_status text, to_status text, payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(case_id,activity_seq)
);
CREATE TABLE IF NOT EXISTS customer_relations.preorder_notifications (
  notification_id bigserial PRIMARY KEY,
  case_id bigint NOT NULL REFERENCES customer_relations.preorder_cases(case_id) ON DELETE CASCADE,
  recipient_role text NOT NULL CHECK(recipient_role IN ('admin','staff')),
  recipient_branch_code text,
  activity_seq bigint NOT NULL,
  notification_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id,recipient_role,activity_seq)
);
CREATE INDEX IF NOT EXISTS idx_preorder_notifications_recipient ON customer_relations.preorder_notifications(recipient_role,recipient_branch_code,created_at DESC);

CREATE TABLE IF NOT EXISTS customer_relations.preorder_quotes (
  quote_id bigserial PRIMARY KEY, case_id bigint NOT NULL REFERENCES customer_relations.preorder_cases(case_id), quote_version integer NOT NULL,
  valid_until date, public_note text, admin_internal_note text, published_by text NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
  supersedes_quote_id bigint REFERENCES customer_relations.preorder_quotes(quote_id), UNIQUE(case_id,quote_version)
);
CREATE TABLE IF NOT EXISTS customer_relations.preorder_quote_lines (
  quote_line_id bigserial PRIMARY KEY, quote_id bigint NOT NULL REFERENCES customer_relations.preorder_quotes(quote_id) ON DELETE CASCADE,
  item_id bigint NOT NULL REFERENCES customer_relations.preorder_items(item_id), offered_qty numeric(14,4) NOT NULL CHECK(offered_qty>0),
  unit_price numeric(14,2) NOT NULL CHECK(unit_price>=0), unit text, UNIQUE(quote_id,item_id)
);
CREATE TABLE IF NOT EXISTS customer_relations.preorder_customer_decisions (
  decision_id bigserial PRIMARY KEY, case_id bigint NOT NULL REFERENCES customer_relations.preorder_cases(case_id), quote_id bigint REFERENCES customer_relations.preorder_quotes(quote_id),
  decision text NOT NULL CHECK(decision IN ('ACCEPTED','DECLINED')), reason text, recorded_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customer_relations.preorder_decision_lines (
  decision_line_id bigserial PRIMARY KEY, decision_id bigint NOT NULL REFERENCES customer_relations.preorder_customer_decisions(decision_id) ON DELETE CASCADE,
  item_id bigint NOT NULL REFERENCES customer_relations.preorder_items(item_id), final_qty numeric(14,4) NOT NULL CHECK(final_qty>0), UNIQUE(decision_id,item_id)
);
CREATE TABLE IF NOT EXISTS customer_relations.preorder_procurement_outcomes (
  outcome_id bigserial PRIMARY KEY,
  case_id bigint NOT NULL REFERENCES customer_relations.preorder_cases(case_id),
  outcome_type text NOT NULL CHECK(outcome_type IN ('ORDERED','UNAVAILABLE')),
  supplier_reference text, public_note text, admin_internal_note text,
  reason_code text REFERENCES customer_relations.preorder_unavailable_reasons(reason_code),
  recorded_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_relations.preorder_evidence_links (
  evidence_link_id bigserial PRIMARY KEY, case_id bigint NOT NULL REFERENCES customer_relations.preorder_cases(case_id), item_id bigint NOT NULL REFERENCES customer_relations.preorder_items(item_id),
  evidence_type text NOT NULL CHECK(evidence_type IN ('HQ_RECEIPT','TRANSFER_OUTBOUND','TRANSFER_INBOUND','MANUAL_ARRIVAL')),
  source_key text NOT NULL, allocated_qty numeric(14,4) NOT NULL CHECK(allocated_qty>0), unit text, snapshot_json jsonb NOT NULL,
  source_synced_at timestamptz, linked_by text NOT NULL, linked_at timestamptz NOT NULL DEFAULT now(), unlinked_at timestamptz, unlink_reason text
);
ALTER TABLE customer_relations.preorder_evidence_links ADD COLUMN IF NOT EXISTS source_allocated_qty numeric(14,4);
ALTER TABLE customer_relations.preorder_evidence_links ADD COLUMN IF NOT EXISTS source_unit text;
ALTER TABLE customer_relations.preorder_evidence_links ADD COLUMN IF NOT EXISTS target_unit text;
ALTER TABLE customer_relations.preorder_evidence_links ADD COLUMN IF NOT EXISTS allocation_note text;
CREATE UNIQUE INDEX IF NOT EXISTS ux_preorder_active_evidence ON customer_relations.preorder_evidence_links(evidence_type,source_key,item_id) WHERE unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_preorder_active_evidence_source ON customer_relations.preorder_evidence_links(evidence_type,source_key) WHERE unlinked_at IS NULL;
CREATE TABLE IF NOT EXISTS customer_relations.preorder_eta_projections (
  eta_id bigserial PRIMARY KEY, case_id bigint NOT NULL REFERENCES customer_relations.preorder_cases(case_id), version integer NOT NULL,
  estimated_date date NOT NULL, basis text NOT NULL, source_evidence_date date, is_override boolean NOT NULL DEFAULT false,
  override_reason text, calculated_at timestamptz NOT NULL DEFAULT now(), calculated_by text NOT NULL, UNIQUE(case_id,version)
);

COMMIT;
