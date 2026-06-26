-- ============================================================
-- Taxonomy Batch 1 — classify 57 SKUs (display_name A–ค)
-- วันที่: 2026-06-26
-- ข้ามรายการ: IC-002817 (แก้วเซนทรัม) ยังไม่ชัดเจน
-- วิธีรัน:
--   psql "postgresql://sc_drug_db_user:<pass>@<host>/sc_drug_db" -f scripts/batch1_taxonomy_classify.sql
-- ============================================================

BEGIN;

-- ----------------------------------------------------------
-- กลุ่ม 1: Service codes + test records (9 รายการ)
-- เหตุผล: ชื่อระบุชัดว่าเป็นรายการค่าใช้จ่ายหรือ test record
--         ไม่ใช่สินค้าจำหน่าย → ไม่อยู่ภายใต้กฎหมายสินค้าสุขภาพ
-- ----------------------------------------------------------
UPDATE public.skus
SET
  product_type       = 'service',
  enrichment_status  = 'not_applicable',
  taxonomy_note      = 'รายการบริการ/ค่าใช้จ่ายดำเนินการหรือ test record — ไม่ใช่สินค้าจำหน่าย ไม่อยู่ภายใต้กฎหมายสินค้าสุขภาพใดๆ'
WHERE company_code IN (
  'ADA-DRY-001',   -- ADA Dry Run Product 001 (test)
  'TEST-001',       -- Test Product (test)
  'IC-002623',      -- ค่าส่งเสริมการขาย
  'IC-000631',      -- ตัวแทน
  'IC-001191',      -- บริการ-ค่าขนส่งสินค้า
  'IC-002071',      -- บริการ ค่าส่งพัสดุ
  'IC-001443',      -- บริการ-ค่าสาธารณูปโภค
  'IC-002664',      -- บริการแจกชุดตรวจเฟส 1
  'IC-001422'       -- บริการ-ด้านเอกสาร
);

-- ----------------------------------------------------------
-- กลุ่ม 2: ผลิตภัณฑ์ยาสูบ (2 รายการ)
-- เหตุผล: ยาสูบกำกับโดย พ.ร.บ.ควบคุมผลิตภัณฑ์ยาสูบ
--         ไม่อยู่ภายใต้ พ.ร.บ.ยา/อาหาร/เครื่องสำอาง → other
-- ----------------------------------------------------------
UPDATE public.skus
SET
  product_type       = 'other',
  enrichment_status  = 'not_applicable',
  taxonomy_note      = 'ผลิตภัณฑ์ยาสูบ — กำกับโดย พ.ร.บ.ควบคุมผลิตภัณฑ์ยาสูบ พ.ศ. 2560 ไม่ใช่ พ.ร.บ.ยา/อาหาร/เครื่องสำอาง; enrichment ไม่จำเป็น'
WHERE company_code IN (
  'IC-001406',   -- บุหรี่ ยาเส้นตราสมอลูกโลก 42 กรัม
  'IC-001383'    -- บุหรี่วันเดอร์ เอส เขียว
);

-- ----------------------------------------------------------
-- กลุ่ม 3: ของใช้ทั่วไป / อุปกรณ์ไม่มีทะเบียนสุขภาพ (3 รายการ)
-- เหตุผล: สินค้ากลุ่มเดียวกันในตลาดไม่มีการขึ้นทะเบียนเป็น
--         ผลิตภัณฑ์สุขภาพหรือเครื่องมือแพทย์
-- ----------------------------------------------------------
UPDATE public.skus
SET
  product_type       = 'other',
  enrichment_status  = 'not_applicable',
  taxonomy_note      = 'กระบอกเชคไดเอโตะ — บรรจุภัณฑ์/ของแถมสินค้าลดน้ำหนักไดเอโตะ; สินค้ากลุ่มนี้ไม่ใช่ผลิตภัณฑ์สุขภาพที่กำกับ'
WHERE company_code = 'IC-001241';

UPDATE public.skus
SET
  product_type       = 'other',
  enrichment_status  = 'not_applicable',
  taxonomy_note      = 'กล่องตัดยา ดร.ฟิลลิป (pill organizer/cutter) — สินค้ากลุ่มนี้ในตลาดไทยไม่มีทะเบียนเครื่องมือแพทย์ → GENERAL_CONSUMER_GOOD'
WHERE company_code = 'IC-000592';

UPDATE public.skus
SET
  product_type       = 'other',
  enrichment_status  = 'not_applicable',
  taxonomy_note      = 'ขี้ผึ้งจัดฟัน (orthodontic wax) — ของใช้ส่วนตัว; สินค้ากลุ่มนี้ (GUM, 3M Unitek) ไม่ขึ้นทะเบียนเครื่องมือแพทย์ใน TH'
WHERE company_code = 'IC-000750';

-- ----------------------------------------------------------
-- กลุ่ม 4: ยาแผนปัจจุบัน (DRUG_MODERN) → product_type = 'drug'
-- หมายเหตุ: ไม่เปลี่ยน enrichment_status (ยังต้องการ ingredient mapping)
-- ----------------------------------------------------------

-- MOM (Milk of Magnesia) องค์การเภสัชกรรม
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'Milk of Magnesia (Magnesium Hydroxide) ผลิตโดยองค์การเภสัชกรรม (GPO) — ยาสามัญ OTC ยาระบาย ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('630020083', '630020082');

-- กระต่ายบิน โททรอล (Bismuth Subsalicylate)
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'กระต่ายบิน โททรอล = Bismuth Subsalicylate 262mg/15ml — ยาสามัญ OTC แก้ท้องเสีย/ท้องอืด; พบทะเบียนบน NDI (rcno=2900479); กลิ่นสตรอเบอร์รี่ = version สำหรับเด็ก ยืนยัน SKU เฉพาะ'
WHERE company_code = 'IC-005208';

-- กลีเซอรีนโบแรกซ์ (Glycerin + Borax) ทุกยี่ห้อ
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'กลีเซอรีนโบแรกซ์ (Glycerin + Borax) — ยาสามัญ OTC ยาทาปากรักษาแผลในปาก ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('630020309', 'IC-001544', 'IC-004690', 'IC-004691');

-- กลีเซอรีนยาเหน็บ
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'กลีเซอรีนยาเหน็บ (Glycerin suppository) — ยาสามัญ OTC แก้ท้องผูก ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('630030178', 'IC-000201');

-- Gaviscon ทุก SKU / รสชาติ / ขนาด
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'Gaviscon (Sodium Alginate ± Calcium Carbonate) by Reckitt Benckiser — ยาสามัญ OTC ยาแก้กรดไหลย้อน ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-003926',   -- กาวิสคอน 250mg เม็ดเคี้ยว เปปเปอร์มิ้นต์ 16 เม็ด
  'IC-000398',   -- กาวิสคอนเขียว (Original) 150ml
  'IC-000399',   -- กาวิสคอนชมพู (Advance) 150ml
  'IC-003777',   -- กาวิสคอนชมพู 300ml
  'IC-002869',   -- กาวิสคอน Dual Action เม็ด 250mg 16 เม็ด
  'IC-001923',   -- กาวิสคอน Advance รสมินท์ 150ml
  '630020262',   -- กาวิสคอล Dual ชมพู 10ml (sachet)
  'IC-001767'    -- กาวิสคอล Advance 10ml (sachet)
);

-- Simethicone ทุก SKU (แก๊สซีม, แก็สซีม, แก๊สแทบ, โกแกซ)
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'Simethicone — ยาสามัญประจำบ้าน OTC แก้ท้องอืดท้องเฟ้อ ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; โกแกซ 200mg ยืนยันจากเว็บ Mega We Care'
WHERE company_code IN (
  'IC-003341',   -- แก๊สซีม 100 เม็ด
  'IC-003562',   -- แก็สซีม 10 เม็ด
  'IC-001386',   -- แก๊สซีม 10 เม็ด
  'IC-003905',   -- แก๊สแทบ 1 เม็ด
  'IC-003570'    -- โกแกซ 200mg 10 แคปซูล (Simethicone by Mega We Care)
);

-- Gastro Bismol (Bismuth Subsalicylate)
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'Gastro Bismol = Bismuth Subsalicylate — ยาสามัญ OTC แก้ท้องเสีย ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-000237', 'IC-000238');

-- Activated Charcoal
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'เกร๊ทเตอร์ คาร์บอน = Activated Charcoal (ผงถ่านกัมมันต์) — ยาสามัญ OTC ดูดซับพิษ/แก้ท้องเสีย ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004023';

-- ORS (Oral Rehydration Salts)
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'เกลือแร่ออรีด้า = ORS (Oral Rehydration Salts) — ยาสามัญประจำบ้าน OTC แก้ท้องเสีย/ภาวะขาดน้ำ ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = '630020338';

-- Fucidin (ยาอันตราย — ปกติสำหรับ ขย.1)
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'ขี้ผึ้งฟิวซิดิน = Fusidic acid ointment — ยาอันตราย ยาปฏิชีวนะทาภายนอก ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ปกติสำหรับร้านยา ขย.1 ที่มีเภสัชกร'
WHERE company_code = 'IC-001579';

-- ครีมฆ่าเหาเฮซิน (Pediculocide)
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'เฮซิน ครีมฆ่าเหา (pediculocide) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = '630030172';

-- Delanin ครีมรักษาฝ้า (ยาอันตราย — ปกติสำหรับ ขย.1)
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'ดีลานิน ครีม = Hydroquinone 4% w/w ทะเบียน 1A 1317/27 — ยาอันตราย รักษาฝ้า ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ปกติสำหรับร้านยา ขย.1 ที่มีเภสัชกร'
WHERE company_code = 'IC-002803';

-- มายจีซาล บาล์ม (Topical analgesic)
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'มายจีซาล บาล์ม = ครีมบรรเทาปวดทาภายนอก (topical analgesic น่าจะมี Methyl Salicylate/Menthol) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005870';

-- คลอร์ไพแร็ด (Antiseptic ointment)
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'คลอร์ไพแร็ด ยาทาแผล (antiseptic/wound ointment) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยันทะเบียนจาก NDI'
WHERE company_code = 'IC-003361';

-- การบูร (Camphor) — infer จากสินค้ากลุ่มเดียวกัน
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'การบูร (Camphor) เกรด A — ชื่อบริษัทตั้งเอง; สินค้า Camphor ในร้านยาจัดเป็น DRUG_MODERN ยาทาภายนอก ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; infer จากกลุ่มสินค้า ยืนยันฉลากด้วย'
WHERE company_code = 'IC-003156';

-- กำมะถัน (Sulfur) — infer จากสินค้ากลุ่มเดียวกัน
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'กำมะถัน ตราโบโทเบล (Sulfur) — ชื่อบริษัทตั้งเอง; Sulfur ในร้านยาจัดเป็น DRUG_MODERN ยาทาภายนอก (กลาก/หิด) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; infer จากกลุ่มสินค้า ยืนยันฉลาก'
WHERE company_code = 'IC-001236';

-- ----------------------------------------------------------
-- กลุ่ม 5: ยาแผนโบราณ (DRUG_TRADITIONAL) → product_type = 'drug'
-- หมายเหตุ: ในระบบ ERP นี้ใช้ 'drug' ครอบทั้งยาแผนปัจจุบันและโบราณ
--           taxonomy_note อธิบายว่าเป็นแผนโบราณ
-- ----------------------------------------------------------

-- ยากฤษณากลั่น ตรากิเลน
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'ยากฤษณากลั่น ตรากิเลน โดยโอสถสภา (132+ ปี) — ยาแผนโบราณ สรรพคุณแก้ท้องเสีย/ปวดท้อง/ขับลม ภายใต้ พ.ร.บ.ยา พ.ศ. 2510 (ยาแผนโบราณ); ยืนยันเลขทะเบียน'
WHERE company_code = '630020230';

-- กอเอี๊ยะปิดฝี ตราแมวกงจักร
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'กอเอี๊ยะปิดฝี ตราแมวกงจักร (Chin An Teung) = ยาพอกจีนแผนโบราณสำหรับดูดหนองฝี (อ้างอิง G138/2 จากแหล่งรอง) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยันเลขทะเบียน NDI'
WHERE company_code = '630020226';

-- ขี้ผึ้ง 29A
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'ขี้ผึ้ง 29A ทะเบียน 2A 44/41 (ยืนยันจาก NDI) — ยาแผนโบราณ ส่วนผสม: Salicylic+Benzoic Acid+Sulphur+Camphor ยาทากลาก/หิด/ชันนะตุ ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = '630020305';

-- เขากุยน้ำตาล
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'เขากุยน้ำตาล (Cassia obtusifolia / Jue Ming Zi) — ยาจีนแผนโบราณ; สินค้ากลุ่มยาจีนโบราณ ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยันเลขทะเบียน'
WHERE company_code = '630020130';

-- เขากุยอ้วยอัน
UPDATE public.skus
SET
  product_type  = 'drug',
  taxonomy_note = 'เขากุยอ้วยอัน (Cassia obtusifolia) โดยอ้วยอันโอสถ — ยาจีนแผนโบราณ; อ้วยอันโอสถผลิตยาจีนที่ขึ้นทะเบียนไทย ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยันเลขทะเบียน'
WHERE company_code = '630020129';

-- ----------------------------------------------------------
-- กลุ่ม 6: ผลิตภัณฑ์สมุนไพร (HERBAL_PRODUCT) → product_type = 'herb'
-- ----------------------------------------------------------

-- กรีนเฮิร์บ เสลดพังพอน (ชื่อบริษัทตั้งเอง)
UPDATE public.skus
SET
  product_type  = 'herb',
  taxonomy_note = 'เสลดพังพอน (Clinacanthus nutans) ยี่ห้อกรีนเฮิร์บ — ชื่อบริษัทตั้งเอง; สินค้ากลุ่มเสลดพังพอนในตลาด (อภัยภูเบศร ฯลฯ) ขึ้นทะเบียน HERBAL_PRODUCT ภายใต้ พ.ร.บ.สมุนไพร พ.ศ. 2562; ยืนยันฉลากจริง'
WHERE company_code IN ('IC-000551', 'IC-000550');

-- เกร็กคู (ขึ้นทะเบียนใหม่)
UPDATE public.skus
SET
  product_type  = 'herb',
  taxonomy_note = 'เกร็กคู (Grakcu) — ผลิตภัณฑ์สมุนไพร ขึ้นทะเบียนใหม่หลังเพิกถอน G481/53 (ม.ค. 2568); ภายใต้ พ.ร.บ.สมุนไพร พ.ศ. 2562; ยืนยันเลขทะเบียนใหม่จาก อย. ก่อน approve'
WHERE company_code = '630010153';

-- ขมิ้นชันโบโทเบล (ชื่อบริษัทตั้งเอง)
UPDATE public.skus
SET
  product_type  = 'herb',
  taxonomy_note = 'ขมิ้นชัน 200g ยี่ห้อโบโทเบล (Curcuma longa) — ชื่อบริษัทตั้งเอง; สินค้าขมิ้นชันในร้านยาขึ้นทะเบียน HERBAL_PRODUCT ภายใต้ พ.ร.บ.สมุนไพร พ.ศ. 2562; ยืนยันฉลากว่ามีสรรพคุณทางยา'
WHERE company_code = 'IC-001235';

-- ขมิ้นชันอ้วยอันโอสถ
UPDATE public.skus
SET
  product_type  = 'herb',
  taxonomy_note = 'ขมิ้นชันแคปซูล อ้วยอันโอสถ (Curcuma longa 500mg) — ผลิตภัณฑ์สมุนไพร อ้างอิงเลข G19/41 จากเว็บแบรนด์; ภายใต้ พ.ร.บ.สมุนไพร พ.ศ. 2562; ยืนยัน G19/41 จาก NDI'
WHERE company_code IN ('630020307', '630020306');

-- ครีมพญายอ อภัยภูเบศร
UPDATE public.skus
SET
  product_type  = 'herb',
  taxonomy_note = 'ครีมพญายอ (Clinacanthus nutans) โดยโรงพยาบาลอภัยภูเบศร จ.ปราจีนบุรี — ผลิตภัณฑ์สมุนไพรจากสถาบันที่น่าเชื่อถือ ภายใต้ พ.ร.บ.สมุนไพร พ.ศ. 2562; ยืนยันเลขทะเบียน'
WHERE company_code = '630020304';

COMMIT;

-- ============================================================
-- สรุปรายการที่ข้าม (ไม่อัปเดตในไฟล์นี้):
--   IC-002817 — แก้วเซนทรัม (ยังไม่แน่ใจว่าเป็นแก้ว/วิตามิน)
-- ============================================================
