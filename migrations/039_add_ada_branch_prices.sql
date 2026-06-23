BEGIN;

CREATE TABLE IF NOT EXISTS ada.product_price_defaults (
  ada_product_price_default_id bigserial PRIMARY KEY,
  product_code text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('retail', 'wholesale')),
  unit_size text NOT NULL CHECK (unit_size IN ('S', 'M', 'L')),
  price_level smallint NOT NULL CHECK (
    (channel = 'retail' AND price_level BETWEEN 1 AND 3)
    OR
    (channel = 'wholesale' AND price_level BETWEEN 1 AND 5)
  ),
  price_amount numeric(18,4) NOT NULL CHECK (price_amount >= 0),
  unit_name text,
  factor numeric(14,4),
  allow_branch_override boolean NOT NULL DEFAULT false,
  snapshot_id text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TCNMPdt',
  source_updated_at timestamptz,
  source_synced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_product_price_defaults_product_key
    UNIQUE (product_code, channel, unit_size, price_level)
);

CREATE INDEX IF NOT EXISTS idx_ada_product_price_defaults_product_code
  ON ada.product_price_defaults (product_code);

CREATE INDEX IF NOT EXISTS idx_ada_product_price_defaults_snapshot
  ON ada.product_price_defaults (snapshot_id);

CREATE INDEX IF NOT EXISTS idx_ada_product_price_defaults_source_synced_at
  ON ada.product_price_defaults (source_synced_at DESC);

CREATE TABLE IF NOT EXISTS ada.product_branch_price_overrides (
  ada_product_branch_price_override_id bigserial PRIMARY KEY,
  branch_code text NOT NULL,
  product_code text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('retail', 'wholesale')),
  unit_size text NOT NULL CHECK (unit_size IN ('S', 'M', 'L')),
  price_level smallint NOT NULL CHECK (
    (channel = 'retail' AND price_level BETWEEN 1 AND 3)
    OR
    (channel = 'wholesale' AND price_level BETWEEN 1 AND 5)
  ),
  price_amount numeric(18,4) NOT NULL CHECK (price_amount >= 0),
  unit_name text,
  factor numeric(14,4),
  snapshot_id text,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL DEFAULT 'TCNTPdtBchPrice',
  source_updated_at timestamptz,
  source_synced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_product_branch_price_overrides_product_key
    UNIQUE (branch_code, product_code, channel, unit_size, price_level)
);

CREATE INDEX IF NOT EXISTS idx_ada_product_branch_price_overrides_branch_product
  ON ada.product_branch_price_overrides (branch_code, product_code);

CREATE INDEX IF NOT EXISTS idx_ada_product_branch_price_overrides_snapshot
  ON ada.product_branch_price_overrides (branch_code, snapshot_id);

CREATE INDEX IF NOT EXISTS idx_ada_product_branch_price_overrides_source_synced_at
  ON ada.product_branch_price_overrides (source_synced_at DESC);

CREATE TABLE IF NOT EXISTS ada.product_effective_branch_prices (
  ada_product_effective_branch_price_id bigserial PRIMARY KEY,
  branch_code text NOT NULL,
  product_code text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('retail', 'wholesale')),
  unit_size text NOT NULL CHECK (unit_size IN ('S', 'M', 'L')),
  price_level smallint NOT NULL CHECK (
    (channel = 'retail' AND price_level BETWEEN 1 AND 3)
    OR
    (channel = 'wholesale' AND price_level BETWEEN 1 AND 5)
  ),
  price_amount numeric(18,4) NOT NULL CHECK (price_amount >= 0),
  price_source text NOT NULL CHECK (price_source IN ('master', 'override')),
  unit_name text,
  factor numeric(14,4),
  allow_branch_override boolean NOT NULL DEFAULT false,
  source_system text NOT NULL DEFAULT 'AdaAcc',
  source_table text NOT NULL,
  source_updated_at timestamptz,
  source_synced_at timestamptz NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ada_product_effective_branch_prices_product_key
    UNIQUE (branch_code, product_code, channel, unit_size, price_level)
);

CREATE INDEX IF NOT EXISTS idx_ada_product_effective_branch_prices_branch_product
  ON ada.product_effective_branch_prices (branch_code, product_code);

CREATE INDEX IF NOT EXISTS idx_ada_product_effective_branch_prices_branch_channel_level
  ON ada.product_effective_branch_prices (branch_code, channel, price_level);

CREATE INDEX IF NOT EXISTS idx_ada_product_effective_branch_prices_source_synced_at
  ON ada.product_effective_branch_prices (source_synced_at DESC);

COMMIT;
