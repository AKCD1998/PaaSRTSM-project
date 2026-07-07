BEGIN;

ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS taxonomy_review_status text
  CHECK (taxonomy_review_status IN ('auto', 'confirmed', 'needs_review'));

COMMENT ON COLUMN public.skus.taxonomy_review_status IS
  'สถานะการตรวจสอบ product_type โดยคน: auto = AI จัดประเภทไว้ ยังไม่ได้ยืนยัน | confirmed = admin/เภสัชกรยืนยันแล้ว | needs_review = ต้องการการตัดสินใจจากคนก่อนนำไปใช้';

CREATE INDEX IF NOT EXISTS idx_skus_taxonomy_review_status
  ON public.skus (taxonomy_review_status);

-- SKUs that were AI-classified → auto
UPDATE public.skus
SET taxonomy_review_status = 'auto'
WHERE product_type IS NOT NULL
  AND taxonomy_review_status IS NULL;

-- The intentional permanent skip → needs_review
UPDATE public.skus
SET taxonomy_review_status = 'needs_review'
WHERE company_code = '630010251';

COMMIT;
