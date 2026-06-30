-- Taxonomy Batch 13 — 2026-06-28
-- display_name range: พาราฟาสต์แอคทีฟ 500 มก 10 เม็ด → มิวโคติก เอชดี 600 มก 1 ซอง
-- SKUs classified: 100 | skipped (UNCERTAIN): 0

BEGIN;

-- ================================================================
-- DRUG (73 รายการ)
-- ================================================================

-- พาราฟาสต์ + ไพราคอน + ไพรานา + ฟีฮามอล + มายมอล = พาราเซตามอล
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'พาราเซตามอลชนิดเม็ดหรือยาน้ำสำหรับลดไข้และบรรเทาปวด — ยาสามัญประจำบ้าน OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-004188',
  'IC-005275',
  'IC-004275',
  'IC-002065',
  'IC-003169',
  'IC-002538'
);

-- กลุ่มเจล/ครีมบรรเทาปวด
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยาทาภายนอกบรรเทาปวด เคล็ดขัดยอก หรืออักเสบของกล้ามเนื้อและข้อ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-003688',
  'IC-002593',
  'IC-001961',
  'IC-000275',
  'IC-004085',
  'IC-002526',
  'IC-000702',
  'IC-000511',
  '630020329',
  'IC-000789',
  'IC-000172',
  'IC-005569'
);

-- Poly Off + Fresh Clear = ยาหยอดตา/ยาล้างตา
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยาหยอดตาหรือยาล้างตาสำหรับชะล้างและบรรเทาการระคายเคืองตา — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-004265', 'IC-005321', 'IC-005058', 'IC-005443');

-- Fluimucil / Fluifort / Flemmex / Mysoven / MuClear / Mucolytic cluster
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยาละลายเสมหะหรือยาแก้ไอชนิดเม็ด ซอง หรือน้ำเชื่อม — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-002079',
  'IC-002064',
  '630030083',
  'IC-004817',
  '630020255',
  'IC-003365',
  'IC-002670',
  '630020250',
  '630020252',
  '630020251',
  'IC-002738',
  'IC-003044',
  'IC-000135',
  'IC-003836',
  '630020267',
  'IC-002363',
  'IC-002155',
  'IC-002945',
  'IC-000564'
);

-- Fotagel + Forlax + Fibogel = ยาระบบทางเดินอาหาร/ระบาย
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยาระบบทางเดินอาหาร เช่น ยาเคลือบกระเพาะ ยาระบาย หรือไฟเบอร์รักษาอาการท้องผูก ขึ้นทะเบียนยา — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-004991', 'IC-003287', 'IC-002726');

-- กลุ่มยาต้านเชื้อรา/ยาปฏิชีวนะ/ยาฆ่าเชื้อเฉพาะที่
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยาต้านเชื้อรา ยาปฏิชีวนะ หรือยาฆ่าเชื้อเฉพาะที่สำหรับผิวหนัง/ตา — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกรตามความเหมาะสม'
WHERE company_code IN (
  'IC-002741',
  'IC-005239',
  'IC-005238',
  'IC-005615',
  'IC-002235',
  'IC-002868',
  '630030075',
  '630030074',
  'IC-005568',
  'IC-005293',
  'IC-004413',
  '630020188'
);

-- ยาเสริมธาตุเหล็ก/โฟลิก/ยาบำรุงที่ขึ้นทะเบียนยา
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยาเสริมธาตุเหล็ก โฟลิก หรือวิตามินบำรุงร่างกายที่ขึ้นทะเบียนยา — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-005098',
  'IC-005326',
  'IC-002846',
  'IC-004305',
  '630020310',
  'IC-002304',
  '630020268',
  'IC-000805'
);

-- Pharmaton line
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ฟาร์มาตอน = วิตามินรวมผสมโสมสำหรับบำรุงร่างกาย ขึ้นทะเบียนยา ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-001530', 'IC-001529');

-- Feclora = Loratadine chewable
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เฟคลอรา 10 มก = Loratadine ยาแก้แพ้ชนิดไม่ง่วง ขึ้นทะเบียนยา ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005028';

-- Fenazine syrup
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยาน้ำบรรเทาอาการหวัดหรือไอสำหรับใช้ตามฉลาก ขึ้นทะเบียนยา ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยันตัวยาจากฉลาก'
WHERE company_code = 'IC-005427';

-- Motar = hyoscine + paracetamol
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'มอต้าร์ = Hyoscine-N-butylbromide + Paracetamol ใช้บรรเทาปวดเกร็งท้อง ขึ้นทะเบียนยา ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005505';

-- Mar / Marimer = nasal saline spray
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'สเปรย์น้ำเกลือพ่นจมูกหรือสเปรย์ล้างจมูกเพื่อชะล้างสารคัดหลั่งและบรรเทาคัดจมูก — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-000158', 'IC-000695', 'IC-000911');

-- Femosa = กรด/กระเพาะ line
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยารักษาอาการกรดไหลย้อนหรือโรคกระเพาะชนิดแคปซูล 40 มก — ขึ้นทะเบียนยา ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยันตัวยาจากฉลาก'
WHERE company_code = 'IC-003772';

-- Marvin spray = topical analgesic spray
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'สเปรย์ทาภายนอกบรรเทาปวดเมื่อยหรือเคล็ดขัดยอก — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยันฉลาก'
WHERE company_code = 'IC-000274';

-- ================================================================
-- SUPPLEMENT (8 รายการ)
-- ================================================================

-- Soy isoflavone / vitamin C / multivitamin supplement lines
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'ผลิตภัณฑ์เสริมอาหารกลุ่มวิตามินรวม วิตามินซี หรือสารสกัดถั่วเหลือง ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN (
  'IC-004105',
  'IC-003320',
  'IC-004038',
  'IC-003381',
  'IC-003763',
  'IC-004027',
  'IC-004106',
  'IC-000815'
);

-- ================================================================
-- HERB (12 รายการ)
-- ================================================================

-- Pudin Hara = Ayurvedic mint capsules
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'พูดินฮาร่า = แคปซูลสมุนไพรกลุ่มมิ้นต์ ใช้บรรเทาท้องอืดและจุกเสียด ภายใต้ พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562'
WHERE company_code = '630020221';

-- โพธิ์ทอง + ไพลจีซาล = สมุนไพรทาภายนอก
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'ผลิตภัณฑ์สมุนไพรทาภายนอกหรือยาหม่องสมุนไพร ใช้บรรเทาปวดเมื่อยหรือคันผิวหนัง ภายใต้ พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562'
WHERE company_code IN ('IC-000552', 'IC-000553', 'IC-003567');

-- Propolis/herbal throat sprays
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'สเปรย์พ่นคอหรือพ่นปากจากโพรโพลิสและสมุนไพร ใช้บรรเทาระคายคอและให้ความสดชื่น ภายใต้ พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562'
WHERE company_code IN ('IC-000711', 'IC-002747', 'IC-002942');

-- มหาหิงค์ + มะระขี้นก
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'ผลิตภัณฑ์สมุนไพรไทยที่ใช้บรรเทาอาการทางท้องหรือดูแลสุขภาพตามตำรับสมุนไพร ภายใต้ พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562'
WHERE company_code IN ('630020201', '630020200', 'IC-003448', 'IC-000268');

-- My Herbal spray
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'สเปรย์พ่นปากสมุนไพรผสมซิงค์สำหรับระงับกลิ่นปากและดูแลช่องปาก ภายใต้ พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562'
WHERE company_code = 'IC-004765';

-- ================================================================
-- ANTISEPTIC (2 รายการ)
-- ================================================================

-- Pyrad Violet + Flulex ointment
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'ยาฆ่าเชื้อหรือยาทาแผลเฉพาะที่สำหรับลดการติดเชื้อบนผิวหนัง — antiseptic ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-001224', 'IC-003246');

-- ================================================================
-- DEVICE (2 รายการ) — enrichment_status = not_applicable
-- ================================================================

-- Fetas pain relief patches
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'แผ่นแปะแก้ปวดใช้บรรเทาอาการเฉพาะที่ จัดเป็นอุปกรณ์/แผ่นแปะช่วยบรรเทาใน taxonomy นี้'
WHERE company_code IN ('IC-004656', 'IC-005485');

-- ================================================================
-- OTHER (2 รายการ) — enrichment_status = not_applicable
-- ================================================================

-- Lighter gas + liquor
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'สินค้าอุปโภคทั่วไปหรือเครื่องดื่มแอลกอฮอล์ ไม่อยู่ในหมวดผลิตภัณฑ์สุขภาพตาม taxonomy นี้'
WHERE company_code IN ('IC-000881', 'IC-000975');

COMMIT;
