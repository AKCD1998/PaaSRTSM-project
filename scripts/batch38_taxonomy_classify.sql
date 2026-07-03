-- Taxonomy Batch 38 — 2026-07-01
-- display_name range: เภสัช เอดาร์บีคลอร์ → วัสดุ ค่าสร้างบล็อกปัก
-- SKUs classified: 100 | skipped: 0
-- Notes:
--   "เภสัช" (22) = pharmacy drugs; IC-005804 = cosmetic shampoo (exception)
--   "ไม่ใช้" (2) = discontinued products — still classify for taxonomy
--   "วัสดุ" (76) = store supplies/stationery/promotional items → other/service

BEGIN;

-- ================================================================
-- DRUG (23 รายการ)
-- ================================================================

-- เอดาร์บีคลอร์ 40/12.5mg = Edarclor (Azilsartan + Chlorthalidone ARB+diuretic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เอดาร์บีคลอร์ 40/12.5 มก (Edarclor) = Azilsartan + Chlorthalidone ยาลดความดัน ARB+diuretic ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005825';

-- เอพาเมท 25 = Epamet (pharmaceutical 25mg tablet — inferred cardiac/antihypertensive)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เอพาเมท 25 60 เม็ด = ยาเม็ด 25 มก (infer Eplerenone/antihypertensive) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-005799';

-- เอมพาบิท 10mg = Empabid (Empagliflozin SGLT2 inhibitor — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เอมพาบิท 10 มก (Empagliflozin) = ยาลดน้ำตาลเลือด SGLT2 inhibitor ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005901';

-- แอควิท เอ 0.05% = Acwit-A (Tretinoin 0.05% topical — retinoid)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอควิท เอ 0.05% 10 กรัม = Tretinoin (Retinoic Acid) 0.05% ยาทาแก้สิว/ฟื้นฟูผิว ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005803';

-- แอมคาร์เดีย 5mg = Amcardia (Amlodipine 5mg CCB antihypertensive)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอมคาร์เดีย (Amlodipine) 5 มก = ยาลดความดัน calcium channel blocker ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005630';

-- โอ ดอท วัน 1 เม็ด = O.D.1 (once-daily OCP or emergency contraception)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โอ ดอท วัน 1 เม็ด = ยาคุมกำเนิด (OCP once-daily หรือ emergency contraception) ยาควบคุมพิเศษ — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005809';

-- โอลิเจส 2mg = Oligase (Glimepiride 2mg sulfonylurea — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โอลิเจส 2 มก 28 เม็ด = ยาลดน้ำตาลเลือด (infer Glimepiride sulfonylurea) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-005855';

-- ไอนอล ไซรัป = Inol syrup 60ml (antibiotic/anti-infective syrup — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไอนอล ไซรัป 60 มล = ยาน้ำ (infer syrup preparation ยาต้านเชื้อ) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-005695';

-- ไฮดรอก 25mg + ไฮดร็อกซี่ซิน + ไฮดร็อกซีนเอฟซี = Hydroxyzine (antihistamine/anxiolytic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไฮดรอก/ไฮดร็อกซี่ซิน/ไฮดร็อกซีน = Hydroxyzine ยาแก้แพ้/คลายกังวล (antihistamine/anxiolytic) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-001552', 'IC-000445', '630030181');

-- ไฮดราเซค = Hidrasec/Racecadotril (antidiarrheal — enkephalinase inhibitor)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไฮดราเซค (Hidrasec/Racecadotril) = ยาแก้ท้องเสีย enkephalinase inhibitor ยาสามัญ OTC — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-000239', 'IC-004669', 'IC-004688');

-- ไฮดิล 300mg/600mg = Hydil (Gabapentin/Carbamazepine/Allopurinol — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไฮดิล 300/600 มก = ยาเม็ด (infer Gabapentin หรือ Carbamazepine) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code IN ('630030180', '630030179');

-- ไฮเปอคอร์ 2.5mg/5mg = Hypercor (Bisoprolol beta-blocker antihypertensive)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไฮเปอคอร์ (Bisoprolol) 2.5/5 มก = ยาลดความดัน beta-blocker ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-005279', 'IC-005559');

-- ไฮเลส 25mg = Hyles (antihypertensive 25mg — inferred HCTZ or Losartan)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไฮเลส 25 มก = ยาลดความดันโลหิต 25 มก (infer HCTZ หรือ Losartan) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-000595';

-- ไฮออสพาน 10mg = Hyospasin (Hyoscine Butylbromide/Buscopan 10mg antispasmodic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไฮออสพาน (Hyoscine Butylbromide/Buscopan) 10 มก = ยาบรรเทาอาการปวดเกร็งกระเพาะ antispasmodic — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004256';

-- แคลซิเฟอรอล วิตามินดี2 = Calciferol/Ergocalciferol (Vitamin D2 — drug registration)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แคลซิเฟอรอล วิตามินดี2 = Ergocalciferol (Vitamin D2) ยาบำรุงสำหรับภาวะพร่องวิตามินดี — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-001628';

-- ไม่ใช้ เภสัชแซนเดส 300mg = discontinued drug (classified for taxonomy record)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เภสัชแซนเดส 300 มก = ยาเม็ด (discontinued/ไม่ใช้แล้ว) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = '630030233';

-- ไม่ใช้ เภสัช ไดเมนไฮดรีเนท = Dimenhydrinate (discontinued, motion sickness drug)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไดเมนไฮดรีเนท (Dimenhydrinate) 50 มก = ยาแก้เมารถ/เมาเรือ antiemetic (discontinued/ไม่ใช้แล้ว) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000546';

-- ================================================================
-- COSMETIC (1 รายการ)
-- ================================================================

-- ฮาฟิฟ เฮอร์บัล 2in1 Conditioning Shampoo = cosmetic shampoo (not medicated)
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'ฮาฟิฟ เฮอร์บัล 2 อิน 1 Conditioning Shampoo 50 มล = แชมพูสระผม/ครีมนวดรวมกัน (ไม่ใช่ยา) เครื่องสำอาง — ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-005804';

-- ================================================================
-- SERVICE (3 รายการ)
-- ================================================================

-- ค่าปัก + ค่าสร้างบล็อก = uniform embroidery service charges
UPDATE public.skus SET
  product_type      = 'service',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ค่าปัก/ค่าสร้างบล็อกปักเสื้อพนักงาน = ค่าบริการงานปักเสื้อโปโล (service charge) ไม่ใช่สินค้า — จัดเป็น service'
WHERE company_code IN ('IC-002395', 'IC-002394', 'IC-002396');

-- ================================================================
-- OTHER (73 รายการ) — วัสดุสำนักงาน / ของแถม / สิ่งของอื่นๆ
-- ================================================================

UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'วัสดุ = อุปกรณ์สำนักงาน/ของแถมส่งเสริมการขาย/สิ่งของที่ไม่ใช่ยาหรืออาหาร — ไม่อยู่ในขอบเขต พ.ร.บ.ยา/อาหาร/เครื่องสำอาง/เครื่องมือแพทย์'
WHERE company_code IN (
  -- counter displays / misc supplies
  'IC-001816', 'IC-002876', 'IC-000990', 'IC-001815',
  -- scissors, paper
  'IC-001004', 'IC-001294', 'IC-001201', 'IC-001293',
  -- card paper, label paper
  'IC-002381', 'IC-001298', 'IC-002601',
  -- thermal paper
  'IC-000976', 'IC-002240', 'IC-002610',
  -- tissue paper, sticky notes
  'IC-002344', 'IC-001322', 'IC-002279', 'IC-001720', 'IC-002419',
  -- receipt/photo paper
  'IC-001279', 'IC-002523', 'IC-001308', 'IC-001306', 'IC-001307',
  'IC-002262', 'IC-002239',
  -- sticker paper, price tag paper
  'IC-002183', 'IC-002370', 'IC-001739', 'IC-000977',
  -- water bottles / tumblers
  'IC-001776', 'IC-001177', 'IC-000809', 'IC-002442', 'IC-002438',
  'IC-001696',
  -- display trays, bags
  'IC-000938', 'IC-001924', 'IC-002916', 'IC-001945',
  'IC-002676', 'IC-002616', 'IC-000810', 'IC-001182',
  'IC-001180', 'IC-001179', 'IC-001950', 'IC-001786',
  -- Actimuv bags
  'IC-002792', 'IC-002790', 'IC-002791',
  -- camera, food box, air freshener, basin
  'IC-001164', 'IC-001240', 'IC-002587', 'IC-001466',
  -- cups/glasses
  'IC-002863', 'IC-002819', 'IC-002902', 'IC-002936',
  'IC-002355', 'IC-002749', 'IC-001985', 'IC-002904',
  -- thermometer stand, wax, sticker rolls
  'IC-002810', 'IC-001044', 'IC-001452',
  -- clipboards, clips, cutters
  'IC-002222', 'IC-002221', 'IC-001003', 'IC-001042',
  'IC-002225', 'IC-001040', 'IC-001002'
);

COMMIT;
