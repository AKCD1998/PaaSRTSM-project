-- Taxonomy Batch 41 — 2026-07-01
-- display_name range: วัสดุยางลบดินสอ → สามัญ เก้าอี้นั่งถ่ายสีขาวชุบโครเมี่ยม
-- SKUs classified: 100 | skipped: 0
-- Mix: วัสดุ(52) + สมอ/ส่วน/ของแถม(7) + สาธารณูปโภค service(5) + ยา(11) + supplement(9) + device(16)

BEGIN;

-- ================================================================
-- DRUG (11 รายการ)
-- ================================================================

-- กัททูร์ ดูอัล รสเปปเปอร์มินท์ = Catur Dual throat antiseptic spray
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'กัททูร์ ดูอัล รสเปปเปอร์มินท์ 10 มล = สเปรย์ฆ่าเชื้อในลำคอ (throat antiseptic spray) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API (ก่อนหน้าจัดเป็น UNCERTAIN)'
WHERE company_code = 'IC-003747';

-- กาวิสคอน = Gaviscon Suspension (antireflux alginate)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'กาวิสคอน (Gaviscon) = Sodium Alginate + Sodium Bicarbonate ยาลดกรด/ป้องกัน GERD รูปแบบน้ำ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-001048', 'IC-003778');

-- เกร๊ทเตอร์ มายพารา 500mg = Greater My Para (Paracetamol)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เกร๊ทเตอร์ มายพารา 500 มก = Paracetamol (Acetaminophen) ยาแก้ปวดลดไข้ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004030';

-- เกลือแร่ (ORS) — Oral Rehydration Salts หลายยี่ห้อ
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เกลือแร่ ORS (ดีแชมป์/ดีไลท์/นีโอไลต์/รอแยล ดี/ออสร่า/เอ๊กซ์-แอล) = ผงเกลือแร่ละลายน้ำ Oral Rehydration Salts แก้ท้องเสีย — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-003214', 'IC-005805', 'IC-001691',
  'IC-002865', 'IC-005091', 'IC-001197', 'IC-001194'
);

-- ================================================================
-- SUPPLEMENT (9 รายการ)
-- ================================================================

-- กระชายดำพลัส แอล-อาร์จินีน = Black ginger + L-Arginine supplement
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'กระชายดำพลัส แอล-อาร์จินีน 60 แคปซูล = อาหารเสริมกระชายดำ (Kaempferia parviflora) + L-Arginine ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-005907';

-- กลูเซอนา แอดวานซ์ 1600g = Glucerna Advance diabetic nutritional supplement
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'กลูเซอนา แอดวานซ์ กลิ่นธัญพืช 1600 กรัม = อาหารทางการแพทย์สำหรับผู้เป็นเบาหวาน (diabetic nutritional supplement) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-005784';

-- กิงโกใบแป๊ะก๊วยสกัด = Ginkgo biloba extract supplement
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'กิงโกใบแป๊ะก๊วยสกัด 246 มก 30 เม็ด = อาหารเสริม Ginkgo biloba extract บำรุงสมอง/การไหลเวียนโลหิต ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-000593';

-- เกร๊ทเตอร์ series supplements
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'เกร๊ทเตอร์ (Greater) = อาหารเสริมซีรีส์ (Zinc/Night Essentials/Zinc lozenge/Vit D3/Lutein/Avencina) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN (
  'IC-005288',  -- ซิงค์ 15mg
  'IC-004128',  -- ไนท์เซนเชียล
  'IC-004321',  -- มายเซพติค Zinc+Lutein+Bilberry lozenge
  'IC-004127',  -- มายมิน ดี3
  'IC-004028',  -- ลูทีน พลัส
  'IC-004022'   -- อเวนซีน่า
);

-- ================================================================
-- DEVICE (16 รายการ)
-- ================================================================

-- เครื่องวัดอุณหภูมิอินฟราเรด = Infrared thermometer (medical device)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'สมัญ เครื่องวัดอุณหภูมิอินฟราเรด เอาฟาร์เมด = Infrared Thermometer เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-002837';

-- เกจ์ออกซิเจน = Oxygen regulator/gauge sets (medical device)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เกจ์ออกซิเจน (JH905A/M-YR-86/M-YR-88) = เกจ์วัดความดันออกซิเจน เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-001413', 'IC-003392', 'IC-002244');

-- เก้าอี้นั่งถ่าย = Shower/commode chairs (medical rehabilitation device)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เก้าอี้นั่งถ่าย/อาบน้ำ = เก้าอี้นั่งสำหรับผู้ป่วย/ผู้สูงอายุ (commode/shower chair) เครื่องมือแพทย์ประเภทอุปกรณ์ช่วยเหลือ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN (
  'IC-001162', 'IC-003314', 'IC-003315', 'IC-004908',
  'IC-003758', 'IC-004877', 'IC-002440', 'IC-005522',
  'IC-004932', 'IC-001657', 'IC-001661', 'IC-002258'
);

-- ================================================================
-- SERVICE (5 รายการ)
-- ================================================================

-- สาธารณูปโภค = utility/operating costs (internal accounting entries)
UPDATE public.skus SET
  product_type      = 'service',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'สาธารณูปโภค (ค่าไฟ/ประปา/น้ำมัน/ซ่อมบำรุง) = รายการค่าใช้จ่ายสาธารณูปโภคภายในร้าน บันทึกในระบบ POS — จัดเป็น service'
WHERE company_code IN (
  'IC-002074',  -- ค่าซ่อมแซม
  'IC-002082',  -- ค่าน้ำมัน 80-5230
  'IC-002075',  -- ค่าน้ำมันรถบริษัท
  'IC-002073',  -- ค่าประปา
  'IC-002072'   -- ค่าไฟฟ้า
);

-- ================================================================
-- OTHER (59 รายการ) — วัสดุ + ของแถม/กระเป๋า + ส่วนเพิ่ม/ลด + ไม้กวาด
-- ================================================================

UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'วัสดุ/ของแถม/สิ่งของไม่ใช่ยา = อุปกรณ์สำนักงาน/เสื้อผ้า/บรรจุภัณฑ์/ของแถม/รายการปรับราคา — ไม่อยู่ในขอบเขต พ.ร.บ.ยา/อาหาร/เครื่องสำอาง/เครื่องมือแพทย์'
WHERE company_code IN (
  -- วัสดุ (52 items)
  'IC-002224','IC-002010','IC-002420','IC-000999','IC-001721',
  'IC-002429','IC-002160','IC-001009','IC-001283','IC-002474',
  'IC-002422','IC-001295','IC-002425','IC-001005','IC-002541',
  'IC-001368','IC-002261','IC-002380','IC-002850','IC-002851',
  'IC-001542','IC-001365','IC-001366','IC-002586','IC-002287',
  'IC-001719','IC-001364','IC-001362','IC-002278','IC-002393',
  'IC-002392','IC-002390','IC-002389','IC-002388','IC-002391',
  'IC-001181','IC-001281','IC-001957','IC-001312','IC-001349',
  'IC-002540','IC-001069','IC-002579','IC-001321','IC-002195',
  'IC-001689','IC-001165','IC-002575','IC-002576','IC-001520',
  'IC-001166','IC-001001',
  -- สมอ / ส่วนเพิ่ม / ส่วนลด
  'IC-001367',  -- ไม้กวาดบรูมใหญ่
  'IC-002733',  -- ส่วนเพิ่ม (price add-on entry)
  'IC-002732',  -- ส่วนลด (discount entry)
  -- กระเช้า/กระเป๋าของแถม (สามัญ prefix)
  'IC-005747',  -- กระเช้าสก๊อตรังนก
  'IC-005894',  -- กระเป๋าแนคลอง
  'IC-005892',  -- กระเป๋าผ้านอสเมน
  'IC-005893'   -- กระเป๋าลายคิตตี้
);

COMMIT;
