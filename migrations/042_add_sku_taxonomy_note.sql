BEGIN;

ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS taxonomy_note text;

COMMENT ON COLUMN public.skus.taxonomy_note IS
  'หมายเหตุประกอบการจัดประเภทสินค้า (product_type): อ้างอิงกฎหมาย หลักฐาน และเหตุผลที่เลือก product_type นี้ เพื่อประกอบการตรวจยืนยันของ admin/เภสัชกร';

COMMIT;
