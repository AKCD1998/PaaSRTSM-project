BEGIN;

-- Commercial product metadata (backward-compatible; no existing columns removed/renamed).
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS source_company_code text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS category_name text,
  ADD COLUMN IF NOT EXISTS supplier_code text,
  ADD COLUMN IF NOT EXISTS product_kind text,
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_updated_by text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_items_source_company_code
  ON public.items (source_company_code)
  WHERE source_company_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_items_category_name
  ON public.items (category_name);

CREATE INDEX IF NOT EXISTS idx_items_supplier_code
  ON public.items (supplier_code);

ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS category_name text,
  ADD COLUMN IF NOT EXISTS supplier_code text,
  ADD COLUMN IF NOT EXISTS avg_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_updated_by text;

CREATE INDEX IF NOT EXISTS idx_skus_category_name
  ON public.skus (category_name);

CREATE INDEX IF NOT EXISTS idx_skus_supplier_code
  ON public.skus (supplier_code);

COMMIT;
