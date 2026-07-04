-- Taxonomy Batch 42 — 2026-07-04
-- display_name range: เภสัช โซมาซินา → สามัญ น้ำมันมะพร้าวฝาเกลียว
-- SKUs classified: 100 | skipped: 0
-- Mix: drug(11) supplement(10) device(29) cosmetic(9) cosmeceutical(2) herb(2) other(37)

BEGIN;

-- ================================================================
-- DRUG (11 รายการ)
-- ================================================================

-- โซมาซินา 30ml = Somazina (Citicoline syrup)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โซมาซินา 30 มล = Citicoline (CDP-Choline) ยาบำรุงสมอง/รักษาโรคหลอดเลือดสมอง ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005925';

-- คาร์โยพิน เอฟ 10 เม็ด (pharmaceutical tablet — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คาร์โยพิน เอฟ 10 เม็ด = ยาเม็ด (infer จากบริบทร้านยา) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-005754';

-- คูลเทมป์ ซูทติ้ง โรลเลอร์บอล = topical analgesic roller
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คูลเทมป์ ซูทติ้ง โรลเลอร์บอล 5 มล = โรลเลอร์บอลบรรเทาปวด (menthol/camphor topical) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005752';

-- ซาลอนพาส + ซาลอนพาสเจล = Salonpas patches/gel
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซาลอนพาส/ซาลอนพาสเจล = Salonpas ยาแผ่นแปะ/เจลบรรเทาปวด (Methyl Salicylate + Menthol) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-005919', 'IC-005902');

-- เซียงเพียว รีลีฟ ครีม เอชอาร์ = Siang Pure Relief Cream
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เซียงเพียว รีลีฟ ครีม เอชอาร์ = ครีมบรรเทาปวด (Methyl Salicylate/Menthol) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-005741', 'IC-005742');

-- น้ำเกลือ แอลพีซาไลน์ 120ml = LP-Saline 0.9%
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำเกลือ แอลพีซาไลน์ ตราเสือดาว 120 มล = Normal Saline 0.9% ล้างจมูก/แผล — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005292';

-- น้ำมันเขียวโพธิ์ทอง = Thai traditional medicated oil
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำมันเขียวโพธิ์ทอง = ยาแผนโบราณ น้ำมันสมุนไพรระงับปวด/แก้คัน (Camphor + Eucalyptus + Menthol) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-000548', 'IC-000547', 'IC-002194');

-- ================================================================
-- SUPPLEMENT (10 รายการ)
-- ================================================================

-- คอลลาเจน (แคล์ + แคล-จี)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'แคล์/แคล-จี คอลลาเจน = อาหารเสริมคอลลาเจน (Collagen peptide supplement) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-005694', 'IC-005926');

-- ซีน โอ วิท ฟอร์ท = L-Lysine + Multivitamin syrup
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'ซีน โอ วิท ฟอร์ท แอล ไลซีน พลัส มัลติวิตามิน 60 มล = อาหารเสริม L-Lysine + Multivitamin ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-005798';

-- ดีเดย์ (ขมิ้น + เจลลี่เวจจี้)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'ดีเดย์ = อาหารเสริม (สารสกัดขมิ้นชัน Curcumin/เจลลี่ผัก) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-005887', 'IC-005886');

-- น้ำมันตับปลา + น้ำมันปลา
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'น้ำมันตับปลา/น้ำมันปลา (สก๊อต/แบลคมอร์ส/เมกกะ) = อาหารเสริม Omega-3/Cod Liver Oil ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-002000', 'IC-000108', 'IC-001233', 'IC-000107', 'IC-003868');

-- ================================================================
-- DEVICE (29 รายการ)
-- ================================================================

-- เข็มฉีดยา โนโวฟายน์ 32G = NovoFine insulin pen needle
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เข็มฉีดยา โนโวฟายน์ 32G 4mm = เข็มปากกาฉีดอินซูลิน (insulin pen needle) เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-005691';

-- เคทีดีกริบ ข้อเท้า/ฝ่ามือ/เฝือกอ่อนพยุงคอ = KTD Grip orthotic supports
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เคทีดีกริบ (ข้อเท้า S/M/L/XL / ฝ่ามือ S/M/L/XL / เฝือกอ่อนพยุงคอ) = อุปกรณ์พยุง/ดามข้อ (orthotic brace/cervical collar) เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN (
  'IC-005730','IC-005729','IC-005728','IC-005731',
  'IC-005726','IC-005725','IC-005724','IC-005727',
  'IC-005732'
);

-- เครื่องตรวจน้ำตาลแบบต่อเนื่อง ไอแคน ไอ6 = CGM device
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เครื่องตรวจน้ำตาลแบบต่อเนื่อง ไอแคน ไอ6 (iCan I6 CGM) = เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-005860';

-- โคแบน เทปพัน = Coban self-adherent wrap
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'โคแบน (Coban) เทปพัน 2 นิ้ว 5 หลา = ผ้าพันแผลยืดหยุ่นติดตัวเอง (self-adherent bandage) เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-005910';

-- ชุดอุปกรณ์ล้างจมูก นาซาลคิท
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ชุดอุปกรณ์ล้างจมูก คลีนแอนด์แคร์ นาซาลคิท = อุปกรณ์ล้างจมูก (nasal irrigation kit) เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-005845';

-- ผ้าเทปพันเขาวัว = athletic zinc oxide tape
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ผ้าเทปพันเขาวัว 1"x10yd (ซูปเปอร์ แชมเปี้ยน) = ผ้าเทปพยุงข้อ (athletic tape) เครื่องมือแพทย์/กายภาพบำบัด — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-005710';

-- เซอร์เทนตี้ กางเกง/แผ่นรองซับ/แผ่นเสริม = Certainty incontinence products
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เซอร์เทนตี้ (กางเกงซึมซับ XL / แผ่นรองซับ L / แผ่นเสริมซึมซับ) = ผลิตภัณฑ์ดูดซับสำหรับผู้มีปัญหากลั้นปัสสาวะ (incontinence products) เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-005740', 'IC-005722', 'IC-005908');

-- ถุงเก็บปัสสาวะ + ถุงบรรจุอาหารเหลว + ถุงใส่อาหาร
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ถุงเก็บปัสสาวะ เอ็มบี / ถุงบรรจุอาหารเหลว เพอร์แม็กซ์ / ถุงใส่อาหาร บีเอ็มทู = อุปกรณ์ทางการแพทย์ (urine/enteral feeding bag) เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-005780', 'IC-005900', 'IC-005899');

-- ถุงมือยาง (SafeDrug + LongMed) = medical exam gloves
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ถุงมือยางตรวจโรค (เซฟดรัก ไม่มีแป้ง S/M/L / ลองเมด มีแป้ง S/M) = ถุงมือยางทางการแพทย์ เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-005844','IC-005843','IC-005842','IC-005770','IC-005769');

-- เทปแต่งแผล (Nexcare + 3M) = surgical paper tape
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เทปแต่งแผลเยื่อกระดาษ (เน็กซ์แคร์/3M) 1 นิ้ว 10 หลา = เทปพยาบาล (surgical paper tape) เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-005918', 'IC-005706');

-- นาโน เพร็คเทสต์ = pregnancy test kit
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'นาโน เพร็คเทสต์ 1 ชุด = ชุดทดสอบการตั้งครรภ์ (pregnancy test kit) เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-005744';

-- น้ำเกลือฮาชิพลัส ลูกโป่ง = saline + bulb syringe ear/nasal kit
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'น้ำเกลือฮาชิพลัส สีชมพู่ ลูกโป่ง = ชุดกระบอกฉีดน้ำเกลือล้างหู/จมูก (bulb syringe + saline kit) เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-003142';

-- ================================================================
-- COSMETIC (9 รายการ)
-- ================================================================

-- คลีน่า ซัน = Cleana Sun sunscreen
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'คลีน่า ซัน 30 กรัม = ครีมกันแดด (sunscreen) เครื่องสำอาง — ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-005679';

-- คูลลิ่ง มิสท์ ตรางู (Soft&Smooth + Refreshing)
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'คูลลิ่ง มิสท์ ตรางู (Soft&Smooth/Refreshing) 30 มล = สเปรย์บำรุงผิวให้ความเย็น เครื่องสำอาง — ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code IN ('IC-005712', 'IC-005713');

-- เซตาฟิล 118ml = Cetaphil gentle cleanser
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'เซตาฟิล 118 มล (Cetaphil) = ผลิตภัณฑ์ทำความสะอาดผิวอ่อนโยน เครื่องสำอาง — ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-005783';

-- เซราวี โฟมมิ่ง คลีนเซอร์ = CeraVe Foaming Cleanser
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'เซราวี โฟมมิ่ง คลีนเซอร์ สูตรผิวมัน 88 มล (CeraVe) = โฟมทำความสะอาดหน้า เครื่องสำอาง — ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-005801';

-- เซอร์เทนตี้ บอดี้คลีนซิ่ง = Certainty body wash
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'เซอร์เทนตี้ บอดี้คลีนซิ่ง 350 มล = ผลิตภัณฑ์ทำความสะอาดร่างกาย เครื่องสำอาง — ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-005721';

-- น้ำตบวานีก้า 3 variants = Vanica toner/essence
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'น้ำตบวานีก้า 500 มล = ผลิตภัณฑ์บำรุงผิวหน้า (toner/essence) เครื่องสำอาง — ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code IN ('IC-001871', 'IC-001869', 'IC-001870');

-- ================================================================
-- COSMECEUTICAL (2 รายการ)
-- ================================================================

-- คลีน่า เอ็กซ์ อัลตร้า แอนตี้ เมลาสม่า = anti-melasma cream
UPDATE public.skus SET
  product_type  = 'cosmeceutical',
  taxonomy_note = 'คลีน่า เอ็กซ์ อัลตร้า แอนตี้ เมลาสม่า 15 กรัม = ผลิตภัณฑ์ลดฝ้า/จุดด่างดำ (anti-melasma cosmeceutical) ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-005759';

-- เดอร์โมดาซิน เอกซีมา แคร์ เจล = Dermadacin eczema gel
UPDATE public.skus SET
  product_type  = 'cosmeceutical',
  taxonomy_note = 'เดอร์โมดาซิน เอกซีมา แคร์ เจล 15 กรัม = เจลดูแลผิวแพ้ง่าย/eczema (dermatological cosmeceutical) ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-005832';

-- ================================================================
-- HERB (2 รายการ)
-- ================================================================

-- ทับทิมแก้วครีมสมุนไพร = Thai herbal pain cream
UPDATE public.skus SET
  product_type      = 'herb',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ทับทิมแก้วครีมสมุนไพร 60 กรัม = ผลิตภัณฑ์สมุนไพรทาภายนอก บรรเทาปวดเมื่อย — ภายใต้ พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562'
WHERE company_code = 'IC-005753';

-- จีเคเค 24 ตรา เกร็กคู 400mg = GKK 24 Thai herbal capsule
UPDATE public.skus SET
  product_type      = 'herb',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'จีเคเค 24 ตรา เกร็กคู 400 มก 4 แคปซูล = ผลิตภัณฑ์สมุนไพรแผนไทย (GKK 24 herbal brand) — ภายใต้ พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562; ยืนยัน API'
WHERE company_code = 'IC-005773';

-- ================================================================
-- OTHER (37 รายการ) — เครื่องดื่ม/น้ำมันอาหาร/ของแถม/ทิชชู่
-- ================================================================

UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'สินค้าประเภทอื่น (เครื่องดื่ม/น้ำมันปรุงอาหาร/ของแถม/ทิชชู่/ของใช้) — ไม่อยู่ในขอบเขต พ.ร.บ.ยา/อาหารเสริม/เครื่องสำอาง/เครื่องมือแพทย์'
WHERE company_code IN (
  'IC-005743','IC-005923','IC-005659','IC-005888','IC-005858',
  'IC-005890','IC-005895',
  'IC-000907','IC-001348','IC-000031',
  'IC-000769','IC-000627','IC-003934','IC-000802','IC-000026',
  'IC-002798','IC-003859','IC-003933',
  'IC-000082','IC-000081','IC-001835','IC-001948','IC-001947',
  'IC-000025','IC-003356',
  '630010192','630010191','IC-001713',
  'IC-001373',
  'IC-001493','IC-001491','IC-001488','IC-001492',
  'IC-001494','IC-001495','IC-001489',
  'IC-003834'
);

COMMIT;