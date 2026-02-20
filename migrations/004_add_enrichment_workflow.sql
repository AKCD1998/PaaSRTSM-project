BEGIN;

ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS generic_name text,
  ADD COLUMN IF NOT EXISTS strength_text text,
  ADD COLUMN IF NOT EXISTS form text,
  ADD COLUMN IF NOT EXISTS route text,
  ADD COLUMN IF NOT EXISTS product_kind text,
  ADD COLUMN IF NOT EXISTS enrichment_status text NOT NULL DEFAULT 'missing'
    CHECK (enrichment_status IN ('missing', 'partial', 'verified')),
  ADD COLUMN IF NOT EXISTS enrichment_notes text,
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz,
  ADD COLUMN IF NOT EXISTS enriched_by text;

CREATE INDEX IF NOT EXISTS idx_skus_enrichment_status
  ON public.skus (enrichment_status);

CREATE TABLE IF NOT EXISTS public.enrichment_rules (
  rule_id bigserial PRIMARY KEY,
  is_enabled boolean NOT NULL DEFAULT TRUE,
  priority integer NOT NULL DEFAULT 100,
  match_name_regex text,
  match_category_regex text,
  match_supplier_regex text,
  set_generic_name text,
  set_strength_text text,
  set_form text,
  set_route text,
  set_product_kind text,
  set_status text NOT NULL DEFAULT 'partial'
    CHECK (set_status IN ('missing', 'partial', 'verified')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enrichment_rules_enabled_priority
  ON public.enrichment_rules (is_enabled, priority, rule_id);

COMMIT;
