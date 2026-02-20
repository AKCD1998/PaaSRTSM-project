# SC Drug DB Diary (Render + PostgreSQL)

วันที่บันทึก: 2026-02-18

## 1) เป้าหมาย
ย้ายโครงสร้างฐานข้อมูล inventory (5 ตาราง) ไปไว้บน Render PostgreSQL และเตรียมไฟล์ช่วย import/check เพื่อใช้เรียนและต่อยอดระบบ Real-Time Stock Management

## 2) ไฟล์ที่ใช้
- `001_inventory_schema.sql` (สร้างตาราง + FK + indexes + constraints)
- `002_inventory_import_helpers.sql` (ตัวอย่าง import/upsert + query ตรวจสอบหลัง import)

## 3) สิ่งที่ทำไปแล้ว (รันจริงสำเร็จ)
- สร้างตารางใน `public` ครบ 5 ตาราง:
  - `items`
  - `skus`
  - `barcodes`
  - `prices`
  - `item_components`
- สร้าง FK ครบ:
  - `skus.item_id -> items.item_id`
  - `barcodes.sku_id -> skus.sku_id`
  - `prices.sku_id -> skus.sku_id`
  - `item_components.item_id -> items.item_id`
- สร้าง indexes/unique constraints ตาม schema จริงจาก Supabase
- รัน query ตรวจความสอดคล้องแล้วผลเป็น 0 orphan และ 0 duplicate group

## 4) คำสั่ง deploy บน Render (PowerShell)
> แนะนำใช้ตัวแปรแทนรหัสผ่าน และหลีกเลี่ยงแปะ password ตรงๆ ลงไฟล์

```powershell
cd "c:\Users\scgro\Desktop\Webapp training project\PaaSRTSM-project"

$env:PGSSLMODE = "require"
$env:RENDER_DB_URL = "postgresql://sc_drug_db_user:<YOUR_PASSWORD>@dpg-d6apu9i4d50c73c7sas0-a.virginia-postgres.render.com/sc_drug_db"

psql --version
psql $env:RENDER_DB_URL -v ON_ERROR_STOP=1 -f ".\001_inventory_schema.sql"
psql $env:RENDER_DB_URL -v ON_ERROR_STOP=1 -f ".\002_inventory_import_helpers.sql"
```

## 5) คำสั่งตรวจผลหลัง deploy
```powershell
# ดูตารางทั้งหมดใน schema public
psql $env:RENDER_DB_URL -c "\dt public.*"

# ดู schema ทั้งหมด
psql $env:RENDER_DB_URL -c "\dn"

# ดูโครงสร้างตารางละเอียด
psql $env:RENDER_DB_URL -c "\d+ public.items"
psql $env:RENDER_DB_URL -c "\d+ public.skus"
psql $env:RENDER_DB_URL -c "\d+ public.barcodes"
psql $env:RENDER_DB_URL -c "\d+ public.prices"
psql $env:RENDER_DB_URL -c "\d+ public.item_components"
```

## 6) คำสั่ง import CSV พื้นฐาน (ตัวอย่างจริง)
> รันใน `psql` session หรือใส่เป็นไฟล์ `.sql` แล้ว `-f` ก็ได้

```sql
\copy public.items (item_id, generic_name, strength, form, route, is_active)
  FROM 'C:/path/items.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

\copy public.skus (sku_id, item_id, uom, qty_in_base, pack_level, display_name, status, company_code, updated_at, uom_th)
  FROM 'C:/path/skus.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

\copy public.barcodes (barcode, sku_id, is_primary, updated_at)
  FROM 'C:/path/barcodes.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

\copy public.prices (price_id, sku_id, price, currency, effective_start, effective_end, updated_at)
  FROM 'C:/path/prices.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

\copy public.item_components (component_id, item_id, generic_name, strength, unit, seq)
  FROM 'C:/path/item_components.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
```

## 7) คำสั่ง UPSERT พื้นฐาน (ตัวอย่างจริง)
```sql
-- barcodes: upsert by PK (barcode)
INSERT INTO public.barcodes (barcode, sku_id, is_primary, updated_at)
VALUES ('8850000000001', 1001, true, now())
ON CONFLICT (barcode) DO UPDATE
SET
  sku_id = EXCLUDED.sku_id,
  is_primary = EXCLUDED.is_primary,
  updated_at = now();

-- skus: upsert by PK (sku_id) + preserve incoming ID
INSERT INTO public.skus (
  sku_id, item_id, uom, qty_in_base, pack_level, display_name, status, company_code, updated_at, uom_th
)
OVERRIDING SYSTEM VALUE
VALUES (1001, 101, 'box', 10, 'retail', 'Paracetamol 500mg Box10', 'active', 'SKU-TH-1001', now(), 'box_th')
ON CONFLICT (sku_id) DO UPDATE
SET
  item_id = EXCLUDED.item_id,
  uom = EXCLUDED.uom,
  qty_in_base = EXCLUDED.qty_in_base,
  pack_level = EXCLUDED.pack_level,
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status,
  company_code = EXCLUDED.company_code,
  updated_at = now(),
  uom_th = EXCLUDED.uom_th;
```

## 8) Query ตรวจคุณภาพข้อมูลหลัง import
```sql
-- orphan check
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
```

```sql
-- duplicate groups check
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
```

## 9) Quick notes ที่ควรจำ
- ถ้า import มาแล้วมี ID เอง ให้ใช้ `OVERRIDING SYSTEM VALUE`
- ถ้าตั้ง ID เป็น identity แล้ว import ID เองบ่อยๆ อาจต้อง set sequence ใหม่
- Render ต้องใช้ SSL (`sslmode=require`)
- ถ้าเคยเผลอแชร์ password ให้ rotate password ใน Render ทันที

```sql
-- ตัวอย่าง resync identity sequence
SELECT setval(pg_get_serial_sequence('public.items', 'item_id'), COALESCE(MAX(item_id), 1), true) FROM public.items;
SELECT setval(pg_get_serial_sequence('public.skus', 'sku_id'), COALESCE(MAX(sku_id), 1), true) FROM public.skus;
SELECT setval(pg_get_serial_sequence('public.prices', 'price_id'), COALESCE(MAX(price_id), 1), true) FROM public.prices;
SELECT setval(pg_get_serial_sequence('public.item_components', 'component_id'), COALESCE(MAX(component_id), 1), true) FROM public.item_components;
```

