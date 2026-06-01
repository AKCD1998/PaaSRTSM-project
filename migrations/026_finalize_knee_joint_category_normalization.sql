BEGIN;

-- Target model in this repo:
-- - ada.product_category_states.category_name stores the display label used by the UI
-- - public.category_shelf_rules.clean_category stores canonical category names
--
-- Preview before apply:
-- SELECT category_name, COUNT(*)::int AS count
-- FROM ada.product_category_states
-- WHERE category_name IN (
--   '6ยาเสริมน้ำข้อเข่า',
--   '6ยาบำรุงข้อเข่า',
--   '4ยาเสริมน้ำข้อเข่า',
--   '10ข้อเข่า',
--   '9ยาข้อเข่า'
-- )
-- GROUP BY category_name
-- ORDER BY category_name;
--
-- SELECT clean_category, allowed_shelves
-- FROM public.category_shelf_rules
-- WHERE clean_category IN (
--   'ยาเสริมน้ำข้อเข่า',
--   'ยาบำรุงข้อเข่า',
--   'ข้อเข่า',
--   'ยาข้อเข่า'
-- )
-- ORDER BY clean_category;

-- 1. Normalize category state display labels that the admin UI reads.
UPDATE ada.product_category_states
SET previous_category_name = category_name,
    category_name = '9ยาข้อเข่า',
    updated_at = NOW()
WHERE category_name IN (
  '6ยาเสริมน้ำข้อเข่า',
  '6ยาบำรุงข้อเข่า',
  '4ยาเสริมน้ำข้อเข่า',
  '10ข้อเข่า'
);

-- 2. Retire old canonical rule entries and replace with the single canonical rule.
DELETE FROM public.category_shelf_rules
WHERE clean_category IN ('ยาเสริมน้ำข้อเข่า', 'ยาบำรุงข้อเข่า', 'ข้อเข่า', '10ข้อเข่า');

INSERT INTO public.category_shelf_rules (
  clean_category,
  allowed_shelves,
  allowed_unprefixed,
  is_cold_chain_possible,
  is_controlled,
  always_human_confirm
)
VALUES (
  'ยาข้อเข่า',
  ARRAY[9],
  FALSE,
  FALSE,
  TRUE,
  TRUE
)
ON CONFLICT (clean_category) DO UPDATE SET
  allowed_shelves = EXCLUDED.allowed_shelves,
  allowed_unprefixed = EXCLUDED.allowed_unprefixed,
  is_cold_chain_possible = EXCLUDED.is_cold_chain_possible,
  is_controlled = EXCLUDED.is_controlled,
  always_human_confirm = EXCLUDED.always_human_confirm,
  updated_at = NOW();

COMMIT;

-- Post-run verification:
-- SELECT category_name, COUNT(*)::int AS count
-- FROM ada.product_category_states
-- WHERE category_name IN (
--   '6ยาเสริมน้ำข้อเข่า',
--   '6ยาบำรุงข้อเข่า',
--   '4ยาเสริมน้ำข้อเข่า',
--   '10ข้อเข่า',
--   '9ยาข้อเข่า'
-- )
-- GROUP BY category_name
-- ORDER BY category_name;
--
-- SELECT clean_category, allowed_shelves
-- FROM public.category_shelf_rules
-- WHERE clean_category IN (
--   'ยาเสริมน้ำข้อเข่า',
--   'ยาบำรุงข้อเข่า',
--   'ข้อเข่า',
--   'ยาข้อเข่า'
-- )
-- ORDER BY clean_category;
