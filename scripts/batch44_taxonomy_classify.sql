-- Taxonomy Batch 44 — 2026-07-04
-- display_name range: สามัญบอชแอนด์ลอมบ์ -1.75 → สามัญแบนเนอร์วิตามิน&แร่ธาตุ
-- SKUs classified: 100 | skipped: 0
-- Mix: device(32) drug(22) supplement(17) antiseptic(4) cosmetic(9) cosmeceutical(12) herb(1) other(3)

BEGIN;

-- ================================================================
-- DEVICE (32 รายการ)
-- ================================================================

-- บอชแอนด์ลอมบ์ คอนแทคเลนส์ -1.75 ถึง -9.00 (24 ขนาด) = Bausch & Lomb corrective contact lenses
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'บอชแอนด์ลอมบ์ คอนแทคเลนส์ (Bausch & Lomb) สีใส = คอนแทคเลนส์แก้ไขสายตา เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN (
  'IC-004518','IC-004519','IC-004520','IC-004521','IC-004522','IC-004523',
  'IC-004524','IC-004525','IC-004526','IC-004527','IC-004528','IC-004529',
  'IC-004530','IC-004531','IC-004532','IC-004533','IC-004534','IC-004535',
  'IC-004536','IC-004537','IC-004538','IC-004539','IC-004540','IC-004541'
);

-- บอยเร่อร์ ชุดอุปกรณ์เสริมเครื่องพ่นละอองยา = Beurer nebulizer accessory kit (IH18)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'บอยเร่อร์ ชุดอุปกรณ์เสริมเครื่องพ่นละอองยา รุ่น IH18 = อุปกรณ์เสริมเครื่องพ่นยา (nebulizer accessory) เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-005222';

-- บอลบริหารข้อมือ = hand exercise/rehabilitation ball
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'บอลบริหารข้อมือ (รุ่น H-05 / I-08) = อุปกรณ์ฟื้นฟูสมรรถภาพข้อมือ (hand exercise/rehab ball) เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-003701', 'IC-005118');

-- บีโพซิทีฟ พลาสเตอร์ผ้า + ไฮโดรคอลลอยด์ = B-Positive wound care products
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'บีโพซิทีฟ (พลาสเตอร์ผ้า 20 ชิ้น / แผ่นปิดแผลไฮโดรคอลลอยด์ 5x5cm) = พลาสเตอร์/แผ่นปิดแผลทางการแพทย์ เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-005625', 'IC-005624');

-- บีเเซทเอ หน้ากาก KN95 = KN95 respiratory mask
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'บีเเซทเอ หน้ากาก KN95 5 ชั้น = หน้ากากกรองอนุภาค (KN95 respirator) เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-001859';

-- เบาะรองนั่งป้องกันแผลกดทับ + เบาะรองหลัง = medical support cushions
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เบาะรองนั่งป้องกันแผลกดทับ (สบายดีแคร์) / เบาะรองหลัง I46 = อุปกรณ์ช่วยป้องกันแผลกดทับ/บรรเทาปวดหลัง เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-002034', 'IC-003470');

-- ================================================================
-- DRUG (22 รายการ)
-- ================================================================

-- บาคามอล = Bacamol (Paracetamol syrup + tablet — OTC antipyretic/analgesic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'บาคามอล (Bacamol) ไซรัฟ 60 มล / พาราเซตามอล 10 เม็ด = ยาพาราเซตามอล (Paracetamol) แก้ปวดลดไข้ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-002979', 'IC-002039');

-- บานาโกะ 10 เม็ด = Banaacol (pharmaceutical tablet — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'บานาโกะ 10 เม็ด = ยาเม็ด (infer จากบริบทร้านยา) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-004895';

-- บาร์มเด็กบวมคันจีราฟ = Giraffe children topical antipruritic balm
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'บาร์มเด็กบวมคันจีราฟ 15 กรัม = ยาทาสำหรับเด็ก บรรเทาคัน/บวม (topical antipruritic balm) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000160';

-- บาลานซ์แอคทีฟ = Balance Active (vaginal pH gel — medical treatment)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'บาลานซ์แอคทีฟ 5 มล 7 ชิ้น = เจลปรับสมดุล pH ช่องคลอด (vaginal pH balancing gel) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-003816';

-- บีแพนเธน ออยเมนต์ = Bepanthen Ointment (Dexpanthenol 5% wound healing)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'บีแพนเธน ออยเมนต์ (Bepanthen Ointment) 50/100 กรัม = Dexpanthenol 5% ยาช่วยสมานแผล/ฟื้นฟูผิว — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-004429', 'IC-000481');

-- เบลลา พารา = Bella Para 500mg (Paracetamol tablet)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เบลลา พารา 500 มก 10 เม็ด = ยาพาราเซตามอล (Paracetamol 500mg) แก้ปวดลดไข้ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004545';

-- เบลสิด ฟอร์ท = Belcid Fort (antacid suspension)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เบลสิด ฟอร์ท 240 มล / ซอง 15 มล = ยาลดกรด (antacid suspension) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-000513', 'IC-002210');

-- เบสิด เกิร์ด ซัสเพนชั่น = Besid GERD Suspension (anti-GERD antacid)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เบสิด เกิร์ด ซัสเพนชั่น รสราสเบอรี่ 10/150 มล = ยาลดกรด/รักษา GERD (antacid suspension) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-003092', 'IC-003093');

-- เบนซิล เบนโซเอต = Benzyl Benzoate (scabicide drug for scabies/lice)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เบนซิล เบนโซเอต ตราเสือดาว 30 มล = Benzyl Benzoate ยากำจัดไรเหา/หิด (scabicide) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004955';

-- เบนแซค สปอตส์ เฟเซียล โฟม = Benzac Spots Daily Facial Foam (Benzoyl Peroxide)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เบนแซค (Benzac) สปอตส์ เดย์ลี่ เฟเซียล โฟมคลีนเซอร์ 130 มล = Benzoyl Peroxide ยารักษาสิว — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-002687';

-- เบน ไซรัป = Ben Syrup 150ml (pediatric pharmaceutical syrup — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เบน ไซรัป 150 มล = ยาน้ำเด็ก (infer pediatric pharmaceutical syrup) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-004010';

-- เบอร์นโนว่า/เบิร์นโนว่า เจล = Burnova wound/burn care gel
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เบอร์นโนว่า/เบิร์นโนว่า เจล (100g/70g/35g/10g + พลัส เพปไทด์/แพลงก์ตอน/สโนว์แอลจี้) = เจลรักษาแผลไฟไหม้/แผลพุพอง (burn/wound care gel) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-005310',  -- เบอร์นโนว่า เจล 100g
  'IC-005308',  -- เบอร์นโนว่า เจล 35g
  'IC-005307',  -- เบอร์นโนว่า เจล พลัส เพปไทด์ 25g
  'IC-005306',  -- เบอร์นโนว่า เจล พลัส แพลงก์ตอน 25g
  'IC-005163',  -- เบอร์นโนว่า เจล พลัส สโนว์ แอลจี้ 25g
  'IC-005682',  -- เบอร์โนว่า เจลพลัส 10g
  'IC-000304'   -- เบิร์นโนว่าเจล 70g
);

-- ================================================================
-- SUPPLEMENT (17 รายการ)
-- ================================================================

-- บี คอมเพล็กซ์ ตราฮอฟ = Hof B-Complex supplement
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'บี คอมเพล็กซ์ ตราฮอฟ 500 มก 30 เม็ด = อาหารเสริมวิตามินบีรวม (B-Complex supplement) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-004946';

-- บีรอคคา = Berocca (effervescent Vitamin B + C supplement)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'บีรอคคา (Berocca) = อาหารเสริมวิตามิน B+C (เพอร์ฟอร์มานซ์/อิมมูดี พลัส/เอลเดอร์เบอร์รี่) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-005605', 'IC-005490', 'IC-004430', 'IC-005209');

-- บูสท์ กลูโคส คอนโทรล = Boost Glucose Control (diabetic nutritional supplement)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'บูสท์ กลูโคส คอนโทรล (Boost Glucose Control) กลิ่นวานิลลา 800g = อาหารทางการแพทย์สำหรับผู้เป็นเบาหวาน ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-004562';

-- เบนิ กัมมี่ = Beny Gummy (vitamin supplement gummy)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'เบนิ กัมมี่ รสส้มและมิกซ์เบอร์รี่ 40.5g = อาหารเสริมวิตามินรูปแบบกัมมี่ ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-004439';

-- เบลนเดอร่า เอ็มเอฟ = Blenderma MF (medical nutritional formula)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'เบลนเดอร่า เอ็มเอฟ 2.5 กก = อาหารทางการแพทย์สำหรับผู้ป่วย (enteral/medical nutritional formula) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-000804';

-- แบนเนอร์ series = Banner brand supplements (soy protein + vitamins)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'แบนเนอร์ (Banner) = อาหารเสริม (Gold Plus/Soy Protein/Bright/Protein/Soybean Protein/Vitamin & Minerals) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN (
  'IC-003011',  -- แบนเนอร์โกลด์พลัส 30 แคปซูล
  'IC-002509',  -- แบนเนอร์ ซอยโปรตีน 100 แคปซูล
  'IC-003388',  -- แบนเนอร์ซอยโปรตีน 30 แคปซูล
  'IC-003812',  -- แบนเนอร์ซอยโปรตีน 4 แคปซูล
  'IC-001649',  -- แบนเนอร์ไบรท์ 100 แคปซูล
  'IC-001019',  -- แบนเนอร์โปรตีน 100 แคปซูล
  'IC-002357',  -- แบนเนอร์โปรตีน 30 แคปซูล
  'IC-004743',  -- แบนเนอร์ โปรตีนจากถั่วเหลือง 60 แคปซูล
  'IC-001020'   -- แบนเนอร์วิตามิน & แร่ธาตุ 100 แคปซูล
);

-- ================================================================
-- ANTISEPTIC (4 รายการ)
-- ================================================================

-- เบตาดีน = Betadine (Povidone-iodine antiseptic — all formats)
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'เบตาดีน (Betadine) = Povidone-iodine น้ำยาฆ่าเชื้อ (15ml/30ml/เจล 5ml/เนเซอรัลดีเฟนส์) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('630020232', '630020231', 'IC-000393', 'IC-000335');

-- ================================================================
-- COSMETIC (9 รายการ)
-- ================================================================

-- บอดี้โลชั่นจีราฟ = Giraffe baby body lotion
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'บอดี้โลชั่นจีราฟ 100 มล = โลชั่นบำรุงผิวสำหรับเด็ก (baby body lotion) เครื่องสำอาง — ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-000161';

-- เบบินี่ ซูธติ้ง ครีม + เบบี้ ซีบาเมด + เบบี้ แนชเชอร์เริล + เบบี้มายด์ = baby cosmetics
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'ผลิตภัณฑ์ดูแลเด็ก (เบบินี่/เบบี้ ซีบาเมด/เบบี้ แนชเชอร์เริล/เบบี้มายด์) = เครื่องสำอางสำหรับทารก/เด็กเล็ก — ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code IN ('IC-005699', 'IC-004045', 'IC-005277', 'IC-003332');

-- เบบี้ออย น่ารัก (คาโมมายล์ + เซียบัตเตอร์) = baby oil
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'เบบี้ออย น่ารัก (คาโมมายล์/เซียบัตเตอร์) 90 มล = เบบี้ออยล์บำรุงผิว เครื่องสำอาง — ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code IN ('IC-003504', 'IC-003503');

-- เบอกาม็อท เดลิเคท + เอ็กซ์ตร้า เดลิเคท แชมพู = Bergamot shampoo
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'เบอกาม็อท (Bergamot) เดลิเคท/เอ็กซ์ตร้า เดลิเคท แชมพู 200 มล = แชมพูสระผม เครื่องสำอาง — ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code IN ('IC-003371', 'IC-003372');

-- ================================================================
-- COSMECEUTICAL (12 รายการ)
-- ================================================================

-- บาล์มมี่เซรั่ม (น้ำนม + มะเขือเทศหน้าใส) = Balmy serum cosmeceuticals
UPDATE public.skus SET
  product_type  = 'cosmeceutical',
  taxonomy_note = 'บาล์มมี่เซรั่ม (น้ำนม/มะเขือเทศหน้าใส) 20 มล = เซรั่มบำรุงผิวหน้า (cosmeceutical serum) ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code IN ('IC-001880', 'IC-001879');

-- บีจู แอคเน่ ดีเฟนส์ ดีท็อกซ์ โซพ = Biju Acne Defense soap
UPDATE public.skus SET
  product_type  = 'cosmeceutical',
  taxonomy_note = 'บีจู แอคเน่ ดีเฟนส์ ดีท็อกซ์ โซพ 30g = สบู่รักษาสิว/ล้างหน้า (acne defense cleansing soap cosmeceutical) ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-005078';

-- บีแพนเธน เซนซิเดิร์ม = Bepanthen Sensiderm (sensitive/eczema skin cream)
UPDATE public.skus SET
  product_type  = 'cosmeceutical',
  taxonomy_note = 'บีแพนเธน เซนซิเดิร์ม (Bepanthen Sensiderm) 20/50 กรัม = ครีมบำรุงผิวแพ้ง่าย/ผิวแห้งอ่อนโยน (dermatological cosmeceutical) ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code IN ('IC-000482', 'IC-005488');

-- บี สกิน = B-Skin acne/UV cosmeceutical range
UPDATE public.skus SET
  product_type  = 'cosmeceutical',
  taxonomy_note = 'บี สกิน (B-Skin) = ผลิตภัณฑ์ดูแลผิว (เคลียร์แอนด์ทรีท โฟม / UV Protection SPF50+ / แอคเน่สปอต เซรั่ม) — cosmeceutical ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code IN ('IC-005162', 'IC-004899', 'IC-004897');

-- เบอกาม็อท แฮร์โทนิค = Bergamot Hair Tonic (active hair-growth tonic)
UPDATE public.skus SET
  product_type  = 'cosmeceutical',
  taxonomy_note = 'เบอกาม็อท แฮร์โทนิค 200 มล = โทนิคบำรุงเส้นผม/กระตุ้นการงอก (hair tonic cosmeceutical) ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-001522';

-- เบอร์นโนว่า เจล พลัส คลีนซิ่ง + เบิรน็อฟ = Burnova cleansing/soothing cosmeceuticals
UPDATE public.skus SET
  product_type  = 'cosmeceutical',
  taxonomy_note = 'เบอร์นโนว่า เจล พลัส เซนซิทีฟ คลีนซิ่ง เจล / พลัส คลีนซิ่ง บาร์ / เบิรน็อฟ อโลเวร่า เซนเทลล่า เจล = ผลิตภัณฑ์ดูแลผิวบอบบาง/สมาน (dermatological cleansing cosmeceutical) ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code IN ('IC-005305', 'IC-004337', 'IC-005487');

-- ================================================================
-- HERB (1 รายการ)
-- ================================================================

-- เบญจโลกวิเชียร = Benjalogwitchian (5-herb Thai traditional medicine formula)
UPDATE public.skus SET
  product_type      = 'herb',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เบญจโลกวิเชียร แคปซูล 60 แคปซูล = ยาสมุนไพรแผนไทย ตำรับเบญจโลกวิเชียร (antipyretic Thai 5-herb formula) — ภายใต้ พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562'
WHERE company_code = 'IC-002823';

-- ================================================================
-- OTHER (3 รายการ)
-- ================================================================

UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'สินค้าประเภทอื่น (ผ้าเช็ดทำความสะอาดเด็ก/กาแฟสำเร็จรูป) — ไม่อยู่ในขอบเขต พ.ร.บ.ยา/อาหารเสริม/เครื่องสำอาง/เครื่องมือแพทย์'
WHERE company_code IN (
  'IC-005723',  -- เบบี้เลิฟ เนเชอรัล แคร์ 20 ชิ้น (baby wipes)
  'IC-001346',  -- เบลนด์&บรู ริชอโรมา 17.5g x60 ซอง (Nescafe)
  'IC-001347'   -- เบลนด์&บรู เอสเปรสโซโรสต์ 17.5g x60 ซอง (Nescafe)
);

COMMIT;