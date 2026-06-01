BEGIN;

-- Rename 6 categories that were physically moved from shelf 6 to shelf 9.
-- Affects 41 products total across: ยาต่อมลูกหมาก(24), ยาปลูกผม(8),
-- ยาบำรุงตับ(3), ยาลดยูริค(2), ยาละลายนิ่ว(2), ยาฆ่าเหา(2).
UPDATE ada.product_category_states
SET previous_category_name = category_name,
    category_name = '9' || SUBSTRING(category_name FROM 2),
    updated_at = NOW()
WHERE category_name IN (
  '6ยาต่อมลูกหมาก',
  '6ยาปลูกผม',
  '6ยาบำรุงตับ',
  '6ยาลดยูริค',
  '6ยาละลายนิ่ว',
  '6ยาฆ่าเหา'
);

INSERT INTO public.category_shelf_rules (clean_category, allowed_shelves, allowed_unprefixed, is_cold_chain_possible, is_controlled, always_human_confirm)
VALUES
  ('ยาต่อมลูกหมาก', ARRAY[9], FALSE, FALSE, FALSE, FALSE),
  ('ยาปลูกผม',      ARRAY[9], FALSE, FALSE, FALSE, FALSE),
  ('ยาบำรุงตับ',     ARRAY[9], FALSE, FALSE, FALSE, FALSE),
  ('ยาลดยูริค',      ARRAY[9], FALSE, FALSE, FALSE, FALSE),
  ('ยาละลายนิ่ว',    ARRAY[9], FALSE, FALSE, FALSE, FALSE),
  ('ยาฆ่าเหา',       ARRAY[9], FALSE, FALSE, FALSE, FALSE)
ON CONFLICT (clean_category) DO UPDATE SET
  allowed_shelves = EXCLUDED.allowed_shelves,
  updated_at = NOW();

COMMIT;
