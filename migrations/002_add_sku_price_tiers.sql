BEGIN;

CREATE TABLE IF NOT EXISTS public.sku_price_tiers (
  id bigserial PRIMARY KEY,
  sku_id integer NOT NULL REFERENCES public.skus(sku_id) ON DELETE CASCADE,
  price_kind text NOT NULL CHECK (price_kind IN ('wholesale')),
  tier smallint NOT NULL CHECK (tier BETWEEN 1 AND 5),
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  currency text NOT NULL DEFAULT 'THB',
  is_active boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sku_price_tiers_sku_kind_tier_key UNIQUE (sku_id, price_kind, tier)
);

CREATE INDEX IF NOT EXISTS idx_sku_price_tiers_sku_id
  ON public.sku_price_tiers (sku_id);

COMMIT;
