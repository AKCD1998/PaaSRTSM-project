BEGIN;

-- Stock recommendation workflow
-- Additive, phase-1 recommendation persistence domain.
-- Deliberately separate from ordering.stock_request_* until the recommendation
-- lifecycle is proven compatible with the fulfillment workflow.

CREATE SCHEMA IF NOT EXISTS ordering;

CREATE TABLE IF NOT EXISTS ordering.stock_recommendation_drafts (
  draft_id bigserial PRIMARY KEY,
  draft_public_id text NOT NULL UNIQUE,
  owner_user_id bigint NULL,
  owner_username text NOT NULL,
  branch_code text NOT NULL REFERENCES core.branches(branch_code),
  target_days integer NOT NULL DEFAULT 90 CHECK (target_days > 0),
  incoming_allocation_mode text NOT NULL DEFAULT 'EQUAL_SPLIT'
    CHECK (incoming_allocation_mode IN ('EQUAL_SPLIT', 'BRANCH_SPECIFIC')),
  incoming_source_mode text NOT NULL DEFAULT 'PENDING_AND_APPROVED'
    CHECK (incoming_source_mode IN ('PENDING_ONLY', 'APPROVED_ONLY', 'PENDING_AND_APPROVED')),
  recommendation_generated_at timestamptz NULL,
  recommendation_basis_date_from date NULL,
  recommendation_basis_date_to date NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUBMITTED', 'DISCARDED')),
  version integer NOT NULL DEFAULT 1,
  submitted_request_public_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_recommendation_drafts_active_owner_branch
  ON ordering.stock_recommendation_drafts (owner_username, branch_code)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_drafts_branch_status
  ON ordering.stock_recommendation_drafts (branch_code, status);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_drafts_owner_status_updated
  ON ordering.stock_recommendation_drafts (owner_username, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS ordering.stock_recommendation_draft_lines (
  draft_line_id bigserial PRIMARY KEY,
  draft_id bigint NOT NULL
    REFERENCES ordering.stock_recommendation_drafts(draft_id) ON DELETE CASCADE,
  line_key text NOT NULL,
  product_code text NOT NULL,
  product_name_thai text NOT NULL DEFAULT '',
  product_name_eng text NOT NULL DEFAULT '',
  barcode text NOT NULL DEFAULT '',
  unit text NOT NULL,
  current_stock numeric(14,4) NULL,
  unit_cost_avg numeric(14,4) NULL,
  sold_qty_30d numeric(14,4) NULL,
  sold_qty_90d numeric(14,4) NULL,
  incoming_po_allocation_qty numeric(14,4) NULL,
  effective_stock numeric(14,4) NULL,
  adjusted_adu numeric(14,6) NULL,
  target_qty numeric(14,4) NULL,
  shortage_qty numeric(14,4) NULL,
  surplus_qty numeric(14,4) NULL,
  recommended_action text NOT NULL
    CHECK (recommended_action IN (
      'NO_ACTION',
      'TRANSFER_IN',
      'PURCHASE',
      'TRANSFER_AND_PURCHASE',
      'NO_PURCHASE_SLOW_MOVING'
    )),
  recommended_transfer_qty numeric(14,4) NOT NULL DEFAULT 0 CHECK (recommended_transfer_qty >= 0),
  recommended_purchase_qty numeric(14,4) NOT NULL DEFAULT 0 CHECK (recommended_purchase_qty >= 0),
  requested_action text NOT NULL
    CHECK (requested_action IN (
      'NO_ACTION',
      'TRANSFER_IN',
      'PURCHASE',
      'TRANSFER_AND_PURCHASE'
    )),
  requested_transfer_qty numeric(14,4) NOT NULL DEFAULT 0 CHECK (requested_transfer_qty >= 0),
  requested_purchase_qty numeric(14,4) NOT NULL DEFAULT 0 CHECK (requested_purchase_qty >= 0),
  suggested_donor_branch_code text NULL REFERENCES core.branches(branch_code),
  request_reason text NOT NULL DEFAULT '',
  recommendation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_recommendation_draft_lines_draft_line_key_key
    UNIQUE (draft_id, line_key),
  CONSTRAINT stock_recommendation_draft_lines_requested_qty_chk
    CHECK (
      requested_action = 'NO_ACTION'
      OR requested_transfer_qty > 0
      OR requested_purchase_qty > 0
    )
);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_draft_lines_draft_id
  ON ordering.stock_recommendation_draft_lines (draft_id);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_draft_lines_product_code
  ON ordering.stock_recommendation_draft_lines (product_code);

CREATE TABLE IF NOT EXISTS ordering.stock_recommendation_requests (
  recommendation_request_id bigserial PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  requesting_branch_code text NOT NULL REFERENCES core.branches(branch_code),
  status text NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN (
      'SUBMITTED',
      'UNDER_REVIEW',
      'APPROVED',
      'PARTIALLY_APPROVED',
      'REJECTED',
      'CANCELLED'
    )),
  created_by text NOT NULL,
  submitted_by text NOT NULL,
  submitted_by_role text NOT NULL,
  target_days integer NOT NULL DEFAULT 90 CHECK (target_days > 0),
  incoming_allocation_mode text NOT NULL
    CHECK (incoming_allocation_mode IN ('EQUAL_SPLIT', 'BRANCH_SPECIFIC')),
  incoming_source_mode text NOT NULL
    CHECK (incoming_source_mode IN ('PENDING_ONLY', 'APPROVED_ONLY', 'PENDING_AND_APPROVED')),
  recommendation_generated_at timestamptz NULL,
  recommendation_basis_date_from date NULL,
  recommendation_basis_date_to date NULL,
  matches_recommendation boolean NOT NULL DEFAULT true,
  request_note text NULL,
  idempotency_key text NULL UNIQUE,
  version integer NOT NULL DEFAULT 1,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz NULL,
  reviewed_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_requests_branch_status_submitted
  ON ordering.stock_recommendation_requests (requesting_branch_code, status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_requests_status_submitted
  ON ordering.stock_recommendation_requests (status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_requests_reviewed
  ON ordering.stock_recommendation_requests (reviewed_by, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS ordering.stock_recommendation_request_items (
  request_item_id bigserial PRIMARY KEY,
  recommendation_request_id bigint NOT NULL
    REFERENCES ordering.stock_recommendation_requests(recommendation_request_id) ON DELETE CASCADE,
  line_no integer NOT NULL CHECK (line_no > 0),
  product_code text NOT NULL,
  product_name_thai text NULL,
  product_name_eng text NULL,
  barcode text NULL,
  unit text NOT NULL,
  current_stock numeric(14,4) NULL,
  unit_cost_avg numeric(14,4) NULL,
  inventory_value numeric(14,4) NULL,
  sold_qty_30d numeric(14,4) NULL,
  sold_qty_90d numeric(14,4) NULL,
  adu_30 numeric(14,6) NULL,
  adu_90 numeric(14,6) NULL,
  adjusted_adu numeric(14,6) NULL,
  incoming_po_qty_total numeric(14,4) NULL,
  incoming_po_allocation_qty numeric(14,4) NULL,
  effective_stock numeric(14,4) NULL,
  current_days_cover numeric(14,4) NULL,
  effective_days_cover numeric(14,4) NULL,
  target_qty numeric(14,4) NULL,
  surplus_qty numeric(14,4) NOT NULL DEFAULT 0,
  shortage_qty numeric(14,4) NOT NULL DEFAULT 0,
  recommended_action text NOT NULL
    CHECK (recommended_action IN (
      'NO_ACTION',
      'TRANSFER_IN',
      'PURCHASE',
      'TRANSFER_AND_PURCHASE',
      'NO_PURCHASE_SLOW_MOVING'
    )),
  recommended_transfer_qty numeric(14,4) NOT NULL DEFAULT 0 CHECK (recommended_transfer_qty >= 0),
  recommended_purchase_qty numeric(14,4) NOT NULL DEFAULT 0 CHECK (recommended_purchase_qty >= 0),
  requested_action text NOT NULL
    CHECK (requested_action IN (
      'NO_ACTION',
      'TRANSFER_IN',
      'PURCHASE',
      'TRANSFER_AND_PURCHASE'
    )),
  requested_transfer_qty numeric(14,4) NOT NULL DEFAULT 0 CHECK (requested_transfer_qty >= 0),
  requested_purchase_qty numeric(14,4) NOT NULL DEFAULT 0 CHECK (requested_purchase_qty >= 0),
  request_matches_recommendation boolean NOT NULL DEFAULT true,
  primary_suggested_donor_branch_code text NULL REFERENCES core.branches(branch_code),
  request_reason text NULL,
  recommendation_reason text NULL,
  recommendation_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  donor_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_recommendation_request_items_request_line_no_key
    UNIQUE (recommendation_request_id, line_no),
  CONSTRAINT stock_recommendation_request_items_request_product_unit_key
    UNIQUE (recommendation_request_id, product_code, unit)
);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_request_items_request_id
  ON ordering.stock_recommendation_request_items (recommendation_request_id);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_request_items_product_code
  ON ordering.stock_recommendation_request_items (product_code);

CREATE TABLE IF NOT EXISTS ordering.stock_recommendation_decisions (
  decision_id bigserial PRIMARY KEY,
  request_item_id bigint NOT NULL
    REFERENCES ordering.stock_recommendation_request_items(request_item_id) ON DELETE CASCADE,
  decision_status text NOT NULL
    CHECK (decision_status IN ('APPROVED', 'MODIFIED', 'REJECTED')),
  approved_action text NULL
    CHECK (approved_action IS NULL OR approved_action IN (
      'NO_ACTION',
      'TRANSFER_IN',
      'PURCHASE',
      'TRANSFER_AND_PURCHASE'
    )),
  approved_transfer_qty numeric(14,4) NOT NULL DEFAULT 0 CHECK (approved_transfer_qty >= 0),
  approved_purchase_qty numeric(14,4) NOT NULL DEFAULT 0 CHECK (approved_purchase_qty >= 0),
  matches_branch_request boolean NOT NULL DEFAULT true,
  matches_system_recommendation boolean NOT NULL DEFAULT true,
  override_reason text NULL,
  decision_note text NULL,
  decided_by text NOT NULL,
  decided_by_role text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  superseded_by bigint NULL REFERENCES ordering.stock_recommendation_decisions(decision_id),
  is_current boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_recommendation_decisions_current_item
  ON ordering.stock_recommendation_decisions (request_item_id)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_decisions_item_id
  ON ordering.stock_recommendation_decisions (request_item_id, decided_at DESC);

CREATE TABLE IF NOT EXISTS ordering.stock_recommendation_events (
  event_id bigserial PRIMARY KEY,
  recommendation_request_id bigint NULL
    REFERENCES ordering.stock_recommendation_requests(recommendation_request_id) ON DELETE CASCADE,
  request_item_id bigint NULL
    REFERENCES ordering.stock_recommendation_request_items(request_item_id) ON DELETE CASCADE,
  decision_id bigint NULL
    REFERENCES ordering.stock_recommendation_decisions(decision_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user text NULL,
  actor_role text NULL,
  actor_branch_code text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text NULL,
  request_correlation_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_events_request_id
  ON ordering.stock_recommendation_events (recommendation_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_events_item_id
  ON ordering.stock_recommendation_events (request_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_recommendation_events_event_type
  ON ordering.stock_recommendation_events (event_type, created_at DESC);

COMMIT;
