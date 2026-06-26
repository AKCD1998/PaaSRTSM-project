BEGIN;

ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS product_type text
  CHECK (product_type IN (
    'drug',
    'supplement',
    'herb',
    'antiseptic',
    'cosmeceutical',
    'cosmetic',
    'device',
    'service',
    'other'
  ));

CREATE INDEX IF NOT EXISTS idx_skus_product_type
  ON public.skus (product_type);

ALTER TABLE public.skus
  DROP CONSTRAINT IF EXISTS skus_enrichment_status_check;

ALTER TABLE public.skus
  ADD CONSTRAINT skus_enrichment_status_check
  CHECK (enrichment_status IN ('missing', 'partial', 'verified', 'not_applicable'));

UPDATE public.skus
SET product_type = 'device',
    enrichment_status = 'not_applicable'
WHERE product_kind = 'device_or_general_goods'
  AND product_type IS NULL;

UPDATE public.skus
SET product_type = 'service',
    enrichment_status = 'not_applicable'
WHERE company_code LIKE 'IS-%'
  AND product_type IS NULL;

COMMIT;
