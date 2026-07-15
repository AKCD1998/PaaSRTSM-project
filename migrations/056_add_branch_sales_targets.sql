BEGIN;

-- Monthly sales-target tracking, 3 escalating tiers per branch per month
-- (admin-configured — staff previously tracked this by hand in a shared
-- spreadsheet alongside the focus-products tab). Daily pacing, month-to-date
-- actuals, and remaining-target math are all computed on read from
-- ada.sales_headers, not stored here — this table only holds the targets
-- an admin sets, which change rarely (monthly).
CREATE TABLE IF NOT EXISTS ordering.branch_sales_targets (
  target_id bigserial PRIMARY KEY,
  branch_code text NOT NULL REFERENCES core.branches(branch_code),
  target_month date NOT NULL, -- always the 1st of the month, e.g. 2026-07-01
  tier smallint NOT NULL CHECK (tier IN (1, 2, 3)),
  monthly_target numeric(14, 2) NOT NULL CHECK (monthly_target >= 0),
  created_by text NULL,
  updated_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_sales_targets_branch_month_tier_key
    UNIQUE (branch_code, target_month, tier)
);

CREATE INDEX IF NOT EXISTS idx_branch_sales_targets_branch_month
  ON ordering.branch_sales_targets (branch_code, target_month DESC);

COMMIT;
