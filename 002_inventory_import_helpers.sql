-- 002_inventory_import_helpers.sql
-- Helper examples for CSV imports, safe upserts, and post-import checks.

-- =========================================================
-- A) CSV import examples (psql client-side \copy)
-- =========================================================
-- Replace file paths with your own CSV locations.
-- Keep table order to satisfy foreign keys: items -> skus -> barcodes/prices -> item_components

-- \copy public.items (item_id, generic_name, strength, form, route, is_active)
--   FROM 'C:/path/items.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

-- \copy public.skus (sku_id, item_id, uom, qty_in_base, pack_level, display_name, status, company_code, updated_at, uom_th)
--   FROM 'C:/path/skus.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

-- \copy public.barcodes (barcode, sku_id, is_primary, updated_at)
--   FROM 'C:/path/barcodes.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

-- \copy public.prices (price_id, sku_id, price, currency, effective_start, effective_end, updated_at)
--   FROM 'C:/path/prices.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

-- \copy public.item_components (component_id, item_id, generic_name, strength, unit, seq)
--   FROM 'C:/path/item_components.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');


-- =========================================================
-- B) Identity import note (when CSV/INSERT already has IDs)
-- =========================================================
-- For identity columns, include OVERRIDING SYSTEM VALUE when you want to keep source IDs.
-- Example:
-- INSERT INTO public.items (item_id, generic_name, strength, form, route, is_active)
-- OVERRIDING SYSTEM VALUE
-- VALUES (101, 'Paracetamol', '500 mg', 'tablet', 'oral', true);


-- =========================================================
-- C) UPSERT examples (safe ON CONFLICT)
-- =========================================================

-- 1) Upsert for public.barcodes by barcode (PK)
-- INSERT INTO public.barcodes (barcode, sku_id, is_primary, updated_at)
-- VALUES ('8850000000001', 1001, true, now())
-- ON CONFLICT (barcode) DO UPDATE
-- SET
--   sku_id = EXCLUDED.sku_id,
--   is_primary = EXCLUDED.is_primary,
--   updated_at = now();

-- 2) Upsert for public.skus by sku_id (PK), preserving incoming ID
-- INSERT INTO public.skus (
--   sku_id, item_id, uom, qty_in_base, pack_level, display_name, status, company_code, updated_at, uom_th
-- )
-- OVERRIDING SYSTEM VALUE
-- VALUES (1001, 101, 'box', 10, 'retail', 'Paracetamol 500mg Box10', 'active', 'SKU-TH-1001', now(), 'box_th')
-- ON CONFLICT (sku_id) DO UPDATE
-- SET
--   item_id = EXCLUDED.item_id,
--   uom = EXCLUDED.uom,
--   qty_in_base = EXCLUDED.qty_in_base,
--   pack_level = EXCLUDED.pack_level,
--   display_name = EXCLUDED.display_name,
--   status = EXCLUDED.status,
--   company_code = EXCLUDED.company_code,
--   updated_at = now(),
--   uom_th = EXCLUDED.uom_th;

-- 3) Optional upsert for public.skus by non-null company_code (partial unique index)
-- INSERT INTO public.skus (item_id, uom, qty_in_base, pack_level, display_name, status, company_code, updated_at, uom_th)
-- VALUES (101, 'box', 10, 'retail', 'Paracetamol 500mg Box10', 'active', 'SKU-TH-1001', now(), 'box_th')
-- ON CONFLICT (company_code) WHERE company_code IS NOT NULL DO UPDATE
-- SET
--   item_id = EXCLUDED.item_id,
--   uom = EXCLUDED.uom,
--   qty_in_base = EXCLUDED.qty_in_base,
--   pack_level = EXCLUDED.pack_level,
--   display_name = EXCLUDED.display_name,
--   status = EXCLUDED.status,
--   updated_at = now(),
--   uom_th = EXCLUDED.uom_th;


-- =========================================================
-- D) Post-import consistency checks
-- =========================================================

-- 1) Orphan row counts by foreign key relation
SELECT 'skus.item_id -> items.item_id' AS check_name, COUNT(*) AS orphan_rows
FROM public.skus s
LEFT JOIN public.items i ON i.item_id = s.item_id
WHERE i.item_id IS NULL
UNION ALL
SELECT 'barcodes.sku_id -> skus.sku_id' AS check_name, COUNT(*) AS orphan_rows
FROM public.barcodes b
LEFT JOIN public.skus s ON s.sku_id = b.sku_id
WHERE s.sku_id IS NULL
UNION ALL
SELECT 'prices.sku_id -> skus.sku_id' AS check_name, COUNT(*) AS orphan_rows
FROM public.prices p
LEFT JOIN public.skus s ON s.sku_id = p.sku_id
WHERE s.sku_id IS NULL
UNION ALL
SELECT 'item_components.item_id -> items.item_id' AS check_name, COUNT(*) AS orphan_rows
FROM public.item_components ic
LEFT JOIN public.items i ON i.item_id = ic.item_id
WHERE i.item_id IS NULL;

-- 2) Duplicate groups in business keys (should be 0)
WITH dup_items AS (
  SELECT generic_name, strength, form, route, COUNT(*) AS cnt
  FROM public.items
  GROUP BY generic_name, strength, form, route
  HAVING COUNT(*) > 1
),
dup_skus_natural AS (
  SELECT item_id, display_name, uom, qty_in_base, pack_level, COUNT(*) AS cnt
  FROM public.skus
  GROUP BY item_id, display_name, uom, qty_in_base, pack_level
  HAVING COUNT(*) > 1
),
dup_skus_company_code AS (
  SELECT company_code, COUNT(*) AS cnt
  FROM public.skus
  WHERE company_code IS NOT NULL
  GROUP BY company_code
  HAVING COUNT(*) > 1
),
dup_barcodes AS (
  SELECT barcode, COUNT(*) AS cnt
  FROM public.barcodes
  GROUP BY barcode
  HAVING COUNT(*) > 1
)
SELECT 'items (generic_name,strength,form,route)' AS check_name, COUNT(*) AS duplicate_groups, COALESCE(SUM(cnt), 0) AS rows_in_duplicate_groups
FROM dup_items
UNION ALL
SELECT 'skus (item_id,display_name,uom,qty_in_base,pack_level)' AS check_name, COUNT(*) AS duplicate_groups, COALESCE(SUM(cnt), 0) AS rows_in_duplicate_groups
FROM dup_skus_natural
UNION ALL
SELECT 'skus (company_code non-null)' AS check_name, COUNT(*) AS duplicate_groups, COALESCE(SUM(cnt), 0) AS rows_in_duplicate_groups
FROM dup_skus_company_code
UNION ALL
SELECT 'barcodes (barcode)' AS check_name, COUNT(*) AS duplicate_groups, COALESCE(SUM(cnt), 0) AS rows_in_duplicate_groups
FROM dup_barcodes;

-- 3) Optional: ensure only one primary barcode per SKU (business rule quality check)
SELECT sku_id, COUNT(*) AS primary_barcode_count
FROM public.barcodes
WHERE is_primary IS TRUE
GROUP BY sku_id
HAVING COUNT(*) > 1;

-- 4) Optional: resync identity sequences after manual ID imports
-- SELECT setval(pg_get_serial_sequence('public.items', 'item_id'), COALESCE(MAX(item_id), 1), true) FROM public.items;
-- SELECT setval(pg_get_serial_sequence('public.skus', 'sku_id'), COALESCE(MAX(sku_id), 1), true) FROM public.skus;
-- SELECT setval(pg_get_serial_sequence('public.prices', 'price_id'), COALESCE(MAX(price_id), 1), true) FROM public.prices;
-- SELECT setval(pg_get_serial_sequence('public.item_components', 'component_id'), COALESCE(MAX(component_id), 1), true) FROM public.item_components;
