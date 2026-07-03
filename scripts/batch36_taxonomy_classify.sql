-- Taxonomy Batch 36 — 2026-07-01
-- display_name range: เภสัช แอนเตอแกน → เภสัช ไฮแกน
-- prefix "เภสัช" = company/wholesaler convention (ไม่ใช่ส่วนหนึ่งของชื่อสินค้า)
-- SKUs classified: 100 | skipped: 0

BEGIN;

-- ================================================================
-- DRUG (98 รายการ)
-- ================================================================

-- แอนเตอแกน/แอนเทอเจน ครีม = anti-inflammatory topical (Antegan/Antrogen)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอนเตอแกน/แอนเทอเจน ครีม = ยาทาภายนอกต้านอักเสบ (topical anti-inflammatory/corticosteroid) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code IN ('IC-003481', '630030226');

-- แอนทาซาลเลอร์ก = antiallergic eye/nasal drops
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอนทาซาลเลอร์ก 10 มล = ยาแก้แพ้ชนิดหยอดตา/จมูก (antiallergic drops) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000570';

-- แอนนาพริล = Enalapril (ACE inhibitor antihypertensive)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอนนาพริล (Enalapril) = ยาลดความดันโลหิต ACE inhibitor ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-000503', 'IC-000264', 'IC-003205');

-- แอนนี = oral contraceptive pill (21 tablets/pack)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอนนี 21 เม็ด = ยาคุมกำเนิดชนิดเม็ด (oral contraceptive pill) ยาควบคุมพิเศษ — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-004080';

-- แอนโนเซน เอส = Naproxen Sodium 275mg (NSAID)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอนโนเซน เอส 275 มก = Naproxen Sodium ยาแก้ปวด/ลดอักเสบ NSAID — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-002043';

-- แอนพัส = antacid combination (Antaplus)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอนพัส 520 = ยาลดกรด antacid combination (Aluminium/Magnesium) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-003161';

-- แอมบร็อก + แอมโบรซิน = Ambroxol (mucolytic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอมบร็อก/แอมโบรซิน = Ambroxol ยาละลายเสมหะ (mucolytic) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-002818', 'IC-002714');

-- แอมเบส = Amlodipine Besylate (calcium channel blocker)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอมเบส (Amlodipine Besylate) = ยาลดความดันโลหิต calcium channel blocker ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-003009', 'IC-003008');

-- แอมปิเพน + แอมพิ + แอมพิซิลิน = Ampicillin (antibiotic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอมปิเพน/แอมพิ/แอมพิซิลิน = Ampicillin 500mg ยาปฏิชีวนะ penicillin group ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-005235', 'IC-002665', 'IC-002257', 'IC-002209');

-- แอมพาวิท = Vitamin B12 1000mcg (high-dose injectable/oral)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอมพาวิท 1000 ไมโครกรัม วิตามินบี 12 = Cyanocobalamin ขนาดสูง ขึ้นทะเบียนเป็นยาบำรุงระบบประสาท — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-003244';

-- แอมโลพีน + แอมโลเพรส = Amlodipine variants
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอมโลพีน/แอมโลเพรส = Amlodipine ยาลดความดันโลหิต calcium channel blocker ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-000147', 'IC-000146', 'IC-004397');

-- แอเรียส = Aerius (Desloratadine — 2nd gen antihistamine)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอเรียส (Aerius) = Desloratadine ยาแก้แพ้ 2nd generation antihistamine — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('630030228', '630030227', 'IC-004779');

-- แอโรทามอล = Salbutamol 100mcg MDI inhaler (bronchodilator)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอโรทามอล 100 มคก (Salbutamol MDI) = ยาพ่นขยายหลอดลม SABA ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-001478';

-- แอโรไทด์ = Fluticasone/Salmeterol 25/125mcg MDI (ICS+LABA)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอโรไทด์ 25/125 มคก = Fluticasone Propionate + Salmeterol MDI inhaler (ICS+LABA) ยาอันตราย ใช้รักษาหอบหืด — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-003794';

-- แอโรบิดอล = corticosteroid inhaler (Budesonide/Beclomethasone)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอโรบิดอล อินฮาเลอร์ = ยาสูดพ่นคอร์ติโคสเตียรอยด์ ICS ยาอันตราย ใช้รักษาหอบหืด — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-001477';

-- แอลไซม์ = Alzyme (pharmaceutical tablet — inferred drug context)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอลไซม์ 10 มก = ยาเม็ด (infer จากขนาด 10mg + บริบทร้านยา) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-002289';

-- แอสแต = Montelukast (leukotriene receptor antagonist for asthma/allergy)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอสแต (Montelukast) = ยาต้านลิวโคไตรอีน ใช้รักษาหอบหืด/ภูมิแพ้ ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-003635', 'IC-003634');

-- แอสพิเลทส์ + แอสเพนท์ + แอสไพริน = Aspirin 81mg (antiplatelet)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'Aspirin 81 มก EC (แอสพิเลทส์/แอสเพนท์/แอสไพริน) = ยาต้านเกล็ดเลือด antiplatelet ยาสามัญ — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-001288', 'IC-001712', 'IC-000474', 'IC-002918');

-- แอสมาซาล SDU = Salbutamol 2.5mg/2.5ml nebulizer solution
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอสมาซาล เอสดียู = Salbutamol 2.5mg/2.5ml unit dose nebulizer solution ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-002985';

-- แอสมาโซลอน = Theophylline/bronchodilator (oral)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอสมาโซลอน = ยาขยายหลอดลม (Theophylline หรือ Prednisolone) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-001097';

-- โอตริวิน เด็ก = Otrivin (Xylometazoline 0.05% paediatric nasal spray)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โอตริวิน 0.05% เด็ก (Otrivin) = Xylometazoline 0.05% nasal decongestant สำหรับเด็ก — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = '630030211';

-- โอทากิล = Domperidone (antiemetic/prokinetic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โอทากิล (Domperidone) = ยาแก้คลื่นไส้/กระตุ้นการเคลื่อนไหวกระเพาะ (antiemetic/prokinetic) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-001291', 'IC-001290');

-- โอปาซ = Omeprazole 20mg (PPI)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โอปาซ (Omeprazole) 20 มก = ยาลดกรดชนิด PPI (Proton Pump Inhibitor) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005595';

-- โอพอลมอล = micronutrient pharmaceutical preparation
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โอพอลมอล 5 ไมโครกรัม 210 เม็ด = ยาเม็ดไมโครนิวเทรียนท์ (infer จากหน่วย mcg + รูปแบบยา) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-004198';

-- โอพาดอฟ อายดรอป = ophthalmic solution
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โอพาดอฟ อายดรอป 5 มล = ยาหยอดตา (ophthalmic solution) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-004259';

-- โอฟล็อกซิน + โอฟล็อกซิล = Ofloxacin 200mg (fluoroquinolone antibiotic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โอฟล็อกซิน/โอฟล็อกซิล (Ofloxacin) 200 มก = ยาปฏิชีวนะ fluoroquinolone ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-000649', 'IC-000788');

-- โอ-ม็อก เหลือง-แดง = Amoxicillin 500mg (antibiotic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โอ-ม็อก เหลือง-แดง 500 มก = Amoxicillin 500mg ยาปฏิชีวนะ penicillin group ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-001858';

-- โอมาคอร์ = Omacor (Omega-3 ethyl esters — registered drug for hypertriglyceridemia)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โอมาคอร์ 1000 มก (Omacor) = Omega-3 Acid Ethyl Esters ขึ้นทะเบียนเป็นยารักษาไขมันไตรกลีเซอไรด์สูง ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-003605';

-- โอมิพรอล + โอเมปราโซล + โอสิด = Omeprazole (PPI)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โอมิพรอล/โอเมปราโซล/โอสิด = Omeprazole ยาลดกรดชนิด PPI ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-002940', 'IC-000136', 'IC-001618');

-- โอโรเฟอร์ = Orofer (Ferrous/Iron supplement registered as drug)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โอโรเฟอร์ (Orofer) 100 มก = Ferrous Fumarate/Iron capsule ขึ้นทะเบียนเป็นยาบำรุงเลือด — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004823';

-- โอล์มีเทค = Olmetec (Olmesartan ARB antihypertensive)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โอล์มีเทค (Olmetec) = Olmesartan Medoxomil ยาลดความดันโลหิต ARB ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-000763', 'IC-000764');

-- โอวา มิท = Ovamit (Clomiphene Citrate 50mg — fertility drug)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โอวา มิท (Clomiphene Citrate) 50 มก = ยากระตุ้นการตกไข่ (ovulation induction) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-004375';

-- ไอโคริน syrup = antibiotic/anti-infective suspension
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไอโคริน 60 มล = ยาน้ำ/suspension ประเภทยาต้านเชื้อ (infer จากรูปแบบน้ำ 60ml + บริบทร้านยา) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = '630030183';

-- ไอโคลิด = Icold (antihistamine tablet)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไอโคลิด 15 มก = ยาแก้แพ้ antihistamine (infer จากขนาด 15mg) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-005159';

-- ไอซ้อปโต อโทรปีน 1% = Isopto Atropine 1% eye drops (mydriatic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไอซ้อปโต อโทรปีน 1% (Isopto Atropine) = Atropine Sulphate 1% ยาหยอดตาขยายม่านตา/cycloplegic ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-003563';

-- ไอซอพติน เอสอาร์ = Isoptin SR (Verapamil 240mg CCB)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไอซอพติน เอสอาร์ (Isoptin SR) = Verapamil 240mg SR ยาลดความดัน/หัวใจ calcium channel blocker ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-001401';

-- ไอโซเทรต = Isotretinoin 10mg (retinoid, severe acne)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไอโซเทรต (Isotretinoin) 10 มก = ยารักษาสิวรุนแรง retinoid ยาอันตราย (teratogenic — ห้ามใช้ในหญิงมีครรภ์) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-002268';

-- ไอทราคอน + ไอทราโซล + ไอทราฟังกอล = Itraconazole 100mg (antifungal)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไอทราคอน/ไอทราโซล/ไอทราฟังกอล = Itraconazole 100mg ยาต้านเชื้อราชนิดรับประทาน ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-005233', 'IC-002146', 'IC-003735');

-- ไอบีอาม็อกซ์ = Amoxicillin suspension (paediatric)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไอบีอาม็อกซ์ (Amoxicillin syrup) = Amoxicillin 125/250mg/5ml น้ำเชื่อมยาปฏิชีวนะสำหรับเด็ก ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-003829', 'IC-003307');

-- ไอบู.../ไอโบร.../ไอ โปรเฟน/ไอเบียมอกซ์ = Ibuprofen various brands/strengths
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'Ibuprofen (ไอบูแคป/ไอบูซิน/ไอบูแมน/ไอเบียมอกซ์/ไอโบรเฟน/ไอ โปรเฟน) = ยาแก้ปวด/ลดอักเสบ NSAID ยาสามัญ — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-003986', 'IC-003419', 'IC-000321',
  '630030184', '630030182', 'IC-001623',
  'IC-003629', 'IC-004763'
);

-- ไอยาฟิน = cold/allergy medicine (Ayaphin)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไอยาฟิน (Ayaphin) = ยาแก้หวัด/แก้แพ้ (antiallergic/cold medicine) ยาสามัญ — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-001159', 'IC-003212', 'IC-000663');

-- ไอวอริน = oral syrup pharmaceutical preparation
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไอวอริน 60 มล = ยาน้ำ (oral syrup preparation) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-003128';

-- ไอโอทิม 0.5% = Timolol 0.5% eye drops (glaucoma)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไอโอทิม 0.5% (Timolol) = ยาหยอดตารักษาต้อหิน (beta-blocker ophthalmic) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-003755';

-- ฮอม เทสโทแคป = Testosterone Undecanoate 40mg (hormone)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ฮอม เทสโทแคป (Testosterone Undecanoate) 40 มก = ยาฮอร์โมนเพศชาย ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-003501';

-- ฮัยโดรคลอโรไธเอไซด์ = Hydrochlorothiazide (diuretic antihypertensive)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ฮัยโดรคลอโรไธเอไซด์ GPO (Hydrochlorothiazide) = ยาขับปัสสาวะ/ลดความดันโลหิต ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-000199', 'IC-000924');

-- ฮาร์ทซอร์บ = Isosorbide Dinitrate 5mg sublingual (antianginal)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ฮาร์ทซอร์บ (Isosorbide Dinitrate) 5 มก ชนิดอมใต้ลิ้น = ยาขยายหลอดเลือดหัวใจ nitrate ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-001206';

-- ฮาร์นาล โอคาส = Harnal OCAS (Tamsulosin 0.4mg — BPH)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ฮาร์นาล โอคาส (Tamsulosin) 0.4 มก = ยา alpha-blocker รักษาต่อมลูกหมากโต ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-001445';

-- ฮิวมูลิน + ฮูมูลิน = Humulin insulin (all formulations)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ฮิวมูลิน/ฮูมูลิน (Humulin) = Insulin (70/30 / R / N) ยาอันตราย ใช้รักษาเบาหวาน — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN (
  'IC-003884', 'IC-003883',   -- ฮิวมูลิน 70/30 + N (3ml)
  'IC-004550', 'IC-004971', 'IC-005449'  -- ฮูมูลิน 70/30 + R + N (10ml)
);

-- ฮิสต้า อ๊อฟ + ฮิสแต + ฮิสแตน = antihistamine (Hista-Off/Histate/Histaen)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ฮิสต้า อ๊อฟ/ฮิสแต/ฮิสแตน = ยาแก้แพ้ antihistamine (ชนิดน้ำ/ไซรัป) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-000488', 'IC-000127', 'IC-003069', 'IC-004898');

-- ฮีโร่มัยซิน = Heromy cin (antibiotic -mycin group, น่าจะ Erythromycin)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ฮีโร่มัยซิน 250 มก = ยาปฏิชีวนะ macrolide (น่าจะ Erythromycin) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = '630030001';

-- เฮกซิน = Hexin (Cephalexin/Methenamine 500mg)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เฮกซิน 0.5 กรัม = ยาปฏิชีวนะหรือยาฆ่าเชื้อทางเดินปัสสาวะ (Cephalexin 500mg หรือ Methenamine) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = '630030242';

-- เฮดีซัสเพนชั่น = Hedy suspension (antibiotic/anti-infective)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เฮดี suspension 60 มล = ยาน้ำ/suspension ยาต้านเชื้อ (infer จากรูปแบบ) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-002272';

-- เฮอพินอน = Herfinon (Acyclovir — antiviral)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เฮอพินอน (Acyclovir) = ยาต้านไวรัส Herpes ทั้งชนิดเม็ด 800mg และครีม ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-003817', 'IC-003851');

-- เฮอร์เบสเซอร์ = Herbesser (Diltiazem CCB)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เฮอร์เบสเซอร์ (Herbesser/Diltiazem) = ยาลดความดัน/หัวใจ calcium channel blocker ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-003588', 'IC-003135');

-- ไฮแกน = Hygan (antihistamine 10mg)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไฮแกน 10 มก = ยาแก้แพ้ antihistamine (Hydroxyzine/Cetirizine — infer จากขนาด 10mg) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-004735';

-- ================================================================
-- SUPPLEMENT (2 รายการ)
-- ================================================================

-- โอซามิน เอส = Glucosamine Sulfate 1500mg supplement
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'โอซามิน เอส (Osamin S) 1500 มก = อาหารเสริม Glucosamine Sulfate บำรุงข้อกระดูก ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-005115';

-- ฮัลโหล ดี = Vitamin D3 2000 IU supplement
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'ฮัลโหล ดี (Hallow D) 2000 IU = อาหารเสริมวิตามินดี 3 ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-002802';

COMMIT;
