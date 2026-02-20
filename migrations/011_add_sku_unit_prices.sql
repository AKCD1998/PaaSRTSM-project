BEGIN;

CREATE TABLE IF NOT EXISTS public.sku_unit_prices (
  id bigserial PRIMARY KEY,
  sku_id integer NOT NULL REFERENCES public.skus(sku_id) ON DELETE CASCADE,
  unit text NOT NULL,
  retail_price numeric(12,2),
  currency text NOT NULL DEFAULT 'THB',
  is_active boolean NOT NULL DEFAULT TRUE,
  source text,
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sku_unit_prices_sku_unit_currency_key UNIQUE (sku_id, unit, currency),
  CONSTRAINT sku_unit_prices_retail_non_negative_chk CHECK (retail_price IS NULL OR retail_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sku_unit_prices_sku_id
  ON public.sku_unit_prices (sku_id);

CREATE INDEX IF NOT EXISTS idx_sku_unit_prices_unit
  ON public.sku_unit_prices (unit);

CREATE TABLE IF NOT EXISTS public.sku_unit_price_tiers (
  id bigserial PRIMARY KEY,
  sku_unit_price_id bigint NOT NULL REFERENCES public.sku_unit_prices(id) ON DELETE CASCADE,
  tier smallint NOT NULL CHECK (tier BETWEEN 2 AND 8),
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  is_active boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sku_unit_price_tiers_unit_price_tier_key UNIQUE (sku_unit_price_id, tier)
);

CREATE INDEX IF NOT EXISTS idx_sku_unit_price_tiers_unit_price_id
  ON public.sku_unit_price_tiers (sku_unit_price_id);

COMMIT;

