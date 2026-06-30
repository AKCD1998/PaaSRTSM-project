-- Taxonomy Batch 12 — 2026-06-28
-- display_name range: โคเปอร์มิ้น → พาราเซตามอล ไซรัป นิวไลพ์ 120 มก 60 มล
-- SKUs classified: 100 | skipped (UNCERTAIN): 0

BEGIN;

-- ================================================================
-- DRUG (50 รายการ)
-- ================================================================

-- โคเปอร์มิ้น = Colpermin peppermint oil softgel
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โคเปอร์มิ้น 187 มก (Colpermin) = Peppermint oil capsule บรรเทาอาการลำไส้แปรปรวน/ท้องอืด ขึ้นทะเบียนยา — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-002972';

-- บาคามอล + เบลลา พารา + พาร์นอกซ์ + พาราแคพ + พาราเซตามอลซีมอล + พาราเซตามอลเม็ด + พาราเซตามอลไซรัป
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'พาราเซตามอลชนิดเม็ด/ไซรัป — ยาแก้ปวดลดไข้ ยาสามัญประจำบ้าน OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-002203',
  'IC-003668',
  'IC-004411',
  '630020260',
  'IC-000083',
  'IC-001569',
  'IC-003509'
);

-- บาซิน่า TM = ยาอมแก้เจ็บคอ antiseptic lozenge
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'บาซิน่า ทีเอ็ม = ยาอมแก้เจ็บคอ/ฆ่าเชื้อในคอ (throat antiseptic lozenge) ขึ้นทะเบียนยา — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-003872', 'IC-003886');

-- บีแก็ส = ยาน้ำขับลม/ลดกรด
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'บีแก็ส 240 มล = ยาน้ำบรรเทาท้องอืดท้องเฟ้อ/ขับลม ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยันตัวยาจากฉลาก'
WHERE company_code = 'IC-003159';

-- B CO-ED + B FORT + B6 + Biotaplex BC = กลุ่มวิตามินบีขึ้นทะเบียนยา
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'วิตามินบีรวม/วิตามินบี6 ขนาดรักษา ขึ้นทะเบียนยา ใช้บำรุงระบบประสาทหรือรักษาภาวะขาดวิตามิน — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-002265',
  'IC-004480',
  'IC-005076',
  'IC-003620',
  'IC-004879'
);

-- บีจีสิค + บูฟีแนคเจล + โปรบูเฟนเจล + พลานิลเจล = ยาทาภายนอกบรรเทาปวด
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยาทาภายนอกบรรเทาปวด/ต้านอักเสบสำหรับกล้ามเนื้อและข้อ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-004037', 'IC-003081', 'IC-004824', 'IC-004984');

-- บีรอคคา = multivitamin effervescent registered as drug
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'บีรอคคา (Berocca) = วิตามินบีรวมและวิตามินซีชนิดฟู่ ขึ้นทะเบียนยา ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-002201', 'IC-005489', 'IC-002757', 'IC-002797');

-- เบบี้คอฟ + เบอร์โคลมีน + พรอสแพน = ยาแก้ไอ
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยาแก้ไอ/ขับเสมหะสำหรับเด็กหรือผู้ใหญ่ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-005160', 'IC-003754', 'IC-004814');

-- เบลซิด + เบลสิด + เบสมอล = ยาลดกรด/บรรเทาท้องเสีย
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยาระบบทางเดินอาหารสำหรับลดกรด บรรเทาจุกเสียด หรือท้องเสีย — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('630020263', 'IC-000701', 'IC-003516');

-- Bactagen + Bactex + Banbac = ยาปฏิชีวนะทาผิวหนัง
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยาปฏิชีวนะทาผิวหนัง เช่น Gentamicin หรือ Mupirocin — ยาอันตราย ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-003775', 'IC-005108', 'IC-003590', 'IC-002565', 'IC-004887');

-- Blackmores vitamin lines registered as drug
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ผลิตภัณฑ์วิตามิน/แร่ธาตุ Blackmores รายการนี้ขึ้นทะเบียนยา ใช้เสริมวิตามินหรือรักษาภาวะขาดสารอาหาร — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-001936',
  'IC-001954',
  'IC-000753',
  'IC-002356',
  'IC-002196',
  'IC-004098',
  'IC-001549',
  'IC-000558',
  'IC-001548',
  'IC-000696'
);

-- ไบโซลวอน = Bromhexine mucolytic
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไบโซลวอน 8 มก (Bisolvon) = Bromhexine ยาละลายเสมหะ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-003626', '630020253');

-- Bioflor = Saccharomyces boulardii registered drug
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไบโอฟลอร์ 250 มก = โพรไบโอติกชนิดขึ้นทะเบียนยา ใช้บรรเทาท้องเสียและปรับสมดุลลำไส้ — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005020';

-- Protemp = Paracetamol suppository/capsule brand
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โปรเทมป์ 325 มก = พาราเซตามอลชนิดแคปซูล ยาแก้ปวดลดไข้ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-004671', 'IC-004861');

-- ================================================================
-- SUPPLEMENT (2 รายการ)
-- ================================================================

-- B12 Angerman + BioGaia = อาหารเสริม
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'ผลิตภัณฑ์เสริมอาหารวิตามินบี12หรือโพรไบโอติก ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-003210', 'IC-003218');

-- ================================================================
-- HERB (3 รายการ)
-- ================================================================

-- ฟ้าขาว = ฟ้าทะลายโจร
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'ฟ้าขาว = ผลิตภัณฑ์สมุนไพรฟ้าทะลายโจร ใช้บรรเทาอาการหวัดหรือเจ็บคอ ภายใต้ พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562'
WHERE company_code = '630020066';

-- เบลเฟช = ยาสมุนไพรขับลม
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'เบลเฟช = ยาสมุนไพรกลุ่มเปปเปอร์มินต์/ขับลม ใช้บรรเทาท้องอืด ภายใต้ พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562'
WHERE company_code = 'IC-001991';

-- Hyperifort = St. John''s Wort herbal product
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'แบลคมอร์ส ไฮเปอริฟอร์ท = ผลิตภัณฑ์สมุนไพร St. John''s Wort สำหรับอารมณ์/ความเครียด ภายใต้ พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562'
WHERE company_code = 'IC-004716';

-- ================================================================
-- ANTISEPTIC (8 รายการ)
-- ================================================================

-- Bepanthen First Aid = chlorhexidine wound antiseptic cream
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'บีแพนเธน เฟิร์สเอด = ครีมปฐมพยาบาลมี chlorhexidine สำหรับทำแผลตื้นและลดการติดเชื้อ — antiseptic ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('630020283', 'IC-004108');

-- Betadine classic lines = povidone-iodine antiseptic
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'เบตาดีน = ผลิตภัณฑ์ Povidone-Iodine ใช้ฆ่าเชื้อแผล ช่องปาก หรือคอ — antiseptic ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-000375', 'IC-000174', 'IC-000376', 'IC-000377', 'IC-000379');

-- Bactigras = chlorhexidine antiseptic dressing
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'แบคติกราส = ผ้าก๊อซชุบ chlorhexidine paraffin สำหรับปิดแผลและลดการติดเชื้อ — antiseptic dressing ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000295';

-- ================================================================
-- COSMETIC (4 รายการ)
-- ================================================================

-- Bepanthen skin-care lines
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'ผลิตภัณฑ์บำรุงและปกป้องผิวสำหรับผิวแห้งหรือแพ้ง่าย ขึ้นทะเบียนเป็นเครื่องสำอาง ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code IN ('IC-004100', 'IC-002783');

-- Babydoll + Plulis mouth spray = cosmetic/personal care
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'ผลิตภัณฑ์ดูแลร่างกายหรือดูแลช่องปากเพื่อความสะอาดและความหอมสดชื่น ขึ้นทะเบียนเป็นเครื่องสำอาง ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code IN ('630020245', 'IC-004089');

-- ================================================================
-- DEVICE (19 รายการ) — enrichment_status = not_applicable
-- ================================================================

-- Betadine Cold Defence = barrier nasal spray/device
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'สเปรย์พ่นจมูกชนิดสร้างฟิล์มป้องกันหรือบรรเทาหวัด ไม่มีตัวยาเชิงระบบ — จัดเป็นอุปกรณ์/ผลิตภัณฑ์ช่วยใช้ใน taxonomy นี้'
WHERE company_code IN ('IC-000381', 'IC-000380');

-- Accu-Chek Softclix = lancing device
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ปากกาเจาะเลือดหรืออุปกรณ์สำหรับการตรวจน้ำตาล — เครื่องมือแพทย์/อุปกรณ์ ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-000472';

-- Pain relief patches and heating patches
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'แผ่นแปะแก้ปวดหรือแผ่นประคบร้อนใช้บรรเทาอาการเฉพาะที่ จัดเป็นอุปกรณ์/แผ่นแปะช่วยบรรเทาใน taxonomy นี้'
WHERE company_code IN (
  'IC-000644',
  'IC-002346',
  '630020317',
  'IC-002148',
  'IC-002147',
  '630020318',
  '630020314',
  '630020321',
  'IC-001688',
  'IC-002635',
  '630020316',
  '630020319',
  'IC-002151',
  'IC-003736',
  '630020315'
);

-- Electric heating pad
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'แผ่นให้ความอบอุ่นไฟฟ้าเป็นอุปกรณ์บรรเทาปวดด้วยความร้อน ไม่ใช่ยา — จัดเป็น device'
WHERE company_code = 'IC-003970';

-- ================================================================
-- OTHER (14 รายการ) — enrichment_status = not_applicable
-- ================================================================

-- Alcoholic beverages
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'สุรา/เบียร์ เป็นเครื่องดื่มแอลกอฮอล์ ไม่อยู่ในหมวดผลิตภัณฑ์สุขภาพตาม taxonomy นี้'
WHERE company_code IN (
  'IC-000970',
  'IC-000972',
  'IC-000974',
  'IC-000971',
  'IC-000895',
  'IC-001360',
  'IC-000892',
  'IC-000894',
  'IC-000896',
  'IC-000967'
);

-- Consumer goods and household items
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ของใช้ทั่วไปหรือสินค้าอุปโภคบริโภคที่ไม่ใช่ผลิตภัณฑ์สุขภาพ'
WHERE company_code IN ('IC-000749', 'IC-003991', 'IC-001523', 'IC-001670');

COMMIT;
