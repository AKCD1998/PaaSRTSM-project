-- Taxonomy Batch 8 — 2026-06-26
-- display_name range: DEMO เครื่องช่วยฟัง → กาวติดฟันปลอมโพลิเดนท์
-- SKUs classified: 99 | skipped (UNCERTAIN): 1 (IC-003747 กัททูร์ ดูอัล)
-- หมายเหตุ: prefix "สามัญ" ในชื่อเป็น convention ของบริษัท ไม่ใช่ส่วนชื่อสินค้าจริง

BEGIN;

-- ================================================================
-- DEVICE (52 รายการ) — enrichment_status = not_applicable
-- ================================================================

-- เครื่องช่วยฟัง (hearing aids — DEMO units ยังคงเป็น device ตามประเภทสินค้า)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เครื่องช่วยฟัง (hearing aid) — เครื่องมือแพทย์ประเภทที่ 2 ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-001951', 'IC-001952');

-- 3M Cavilon wound care series (barrier cream/film/skin cleanser)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = '3M Cavilon (barrier cream/barrier film/skin cleanser) — เครื่องมือแพทย์ประเภทที่ 1 ผลิตภัณฑ์ดูแลผิวหนังทางการแพทย์ ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-002423', 'IC-002629', 'IC-002399', 'IC-002416');

-- 3M Steri-Strip wound closure
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = '3M Steri-Strip (wound closure strips) — เครื่องมือแพทย์ปิดแผลทดแทนการเย็บ ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-005448';

-- กรรไกรทางการแพทย์ / ก๊อซ (medical scissors, KTD brand)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'กรรไกรทางการแพทย์ (medical scissors) — เครื่องมือแพทย์ประเภทที่ 1 ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN (
  'IC-003441', 'IC-003586', 'IC-003587',
  'IC-004450', 'IC-003710', 'IC-004617',
  'IC-003444', 'IC-005190'
);

-- กระบอกฉีดยา / กระบอกฉีดอินซูลิน (syringes — Nipro, Terumo, BD, Yesomed, INI)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'กระบอกฉีดยา/กระบอกฉีดอินซูลิน (syringe) — เครื่องมือแพทย์ประเภทที่ 2 ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN (
  'IC-000635', 'IC-000050', 'IC-000051', 'IC-000208', 'IC-000052',
  'IC-000209', 'IC-000574', 'IC-000332', 'IC-000573', 'IC-002494',
  'IC-002564', 'IC-002821', 'IC-002636', 'IC-002752', 'IC-002766',
  'IC-002860', 'IC-002980', 'IC-000817', 'IC-000289', 'IC-002497',
  'IC-000333', 'IC-004900'
);

-- กระบอกตวง / กระบอกน้ำปรับความชื้น / กระบอกปัสสาวะ
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'กระบอกตวง/กระบอกน้ำปรับความชื้น/กระบอกปัสสาวะ — อุปกรณ์ทางการแพทย์ประเภทที่ 1 ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-003226', 'IC-003602', 'IC-004258', 'IC-003224');

-- กระเป๋าน้ำร้อน / กระเป๋าน้ำร้อนไฟฟ้า (hot water bottles / electric heating pads)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'กระเป๋าน้ำร้อน/กระเป๋าน้ำร้อนไฟฟ้า (hot water bottle/electric heating pad) — เครื่องมือแพทย์ประเภทที่ 1 บรรเทาปวด ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-004772', 'IC-004771', 'IC-001238', 'IC-004944', 'IC-001639');

-- ก๊อซเดรน (gauze drain — wound care consumable)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ก๊อซเดรน ไบโอคอททอน (gauze drain) — วัสดุสิ้นเปลืองทางการแพทย์/วัสดุดูดซับ ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-004091';

-- กางเกงผ้าอ้อมผู้ใหญ่ (adult pull-up diapers — Romson brand)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'กางเกงผ้าอ้อมผู้ใหญ่ (adult pull-up diaper) — เครื่องมือแพทย์ประเภทที่ 1 อุปกรณ์ดูแลผู้ป่วยกลั้นไม่ได้ ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-003903', 'IC-003902', 'IC-003904');

-- กล้องยานัตถ์ (nasal snuff bottle — traditional medicine accessory)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'กล้องยานัตถ์/ขวดยาดม (nasal snuff bottle) — อุปกรณ์ส่งยาแผนโบราณแบบดั้งเดิม จัดเป็นอุปกรณ์ทางการแพทย์ ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-002136', 'IC-005035');

-- ================================================================
-- OTHER (26 รายการ) — enrichment_status = not_applicable
-- ================================================================

-- กระดาษทิชชู่ / กระดาษเช็ดหน้า (consumer tissue paper)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'กระดาษทิชชู่/กระดาษเช็ดหน้า — ของใช้ทั่วไปในชีวิตประจำวัน ไม่อยู่ภายใต้กฎหมายสินค้าสุขภาพ'
WHERE company_code IN (
  'IC-003298', 'IC-003513', 'IC-005042',
  'IC-000986', 'IC-000987', 'IC-001111'
);

-- ทิชชู่เปียก (promotional wet wipes)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'จีราฟทิชชู่เปียก (wet wipes) — ของใช้ทั่วไป/ของแถมโปรโมชั่น ไม่อยู่ภายใต้กฎหมายสินค้าสุขภาพ'
WHERE company_code = 'IC-000490';

-- กรรไกรตัดเล็บ (nail clippers — not registered as medical device in TH)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'กรรไกรตัดเล็บ (nail clipper) — ของใช้ส่วนตัวทั่วไป ไม่มีทะเบียนเครื่องมือแพทย์ในไทย'
WHERE company_code IN ('IC-003251', 'IC-003111');

-- กระทิงแดงเอ็กซ์ตร้า (energy drink)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'กระทิงแดงเอ็กซ์ตร้า (energy drink) — เครื่องดื่มอาหาร กำกับโดย อย.อาหาร ไม่ใช่ผลิตภัณฑ์ยา/สมุนไพร'
WHERE company_code = 'IC-003272';

-- กระเป๋า EMS + กระเป๋าปฐมพยาบาล (bags — container only, not medical device)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'กระเป๋า EMS/ปฐมพยาบาล — กระเป๋าบรรจุอุปกรณ์; ตัวกระเป๋าเองไม่ใช่เครื่องมือแพทย์'
WHERE company_code IN ('IC-003715', 'IC-001967');

-- กล่องพลาสติก
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'กล่องพลาสติกคละสี — บรรจุภัณฑ์/อุปกรณ์จัดเก็บทั่วไป ไม่ใช่ผลิตภัณฑ์สุขภาพ'
WHERE company_code = 'IC-002123';

-- กล่องใส่ยา / pill organizer (consumer goods)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'กล่องใส่ยาพกพา/pill organizer พร้อมใบมีดแบ่งยา — ของใช้ทั่วไปช่วยจัดยา ไม่มีทะเบียนเครื่องมือแพทย์'
WHERE company_code IN ('IC-003222', 'IC-000591');

-- กะทิ (coconut milk — food)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'กะทิ 100% — เครื่องปรุงรส/อาหาร กำกับโดย อย.อาหาร ไม่ใช่ผลิตภัณฑ์ยา/สมุนไพร'
WHERE company_code IN ('IC-000882', 'IC-000883');

-- กาแฟ (all coffee — food/beverage; coffee+ginseng/lingzhi = food-level additives ไม่ถึง HERBAL_PRODUCT)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'กาแฟสำเร็จรูป/กาแฟผสม — เครื่องดื่มอาหาร กำกับโดย อย.อาหาร; โสม/เห็ดหลินจือในระดับ flavor ไม่ถึงระดับ HERBAL_PRODUCT'
WHERE company_code IN (
  'IC-000851', 'IC-000850', 'IC-000900', 'IC-002839',
  'IC-000872', 'IC-003507', 'IC-003508', 'IC-002325', 'IC-002326'
);

-- ================================================================
-- SUPPLEMENT (13 รายการ) — ไม่เปลี่ยน enrichment_status
-- ================================================================

-- 9 Berry's
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = '9เบอร์รี่ส์ (9 Berrys) — อาหารเสริมสารสกัดจากผลไม้ตระกูลเบอร์รี่ ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-000515';

-- กลูโคลิน (Glucolin = glucose/dextrose energy powder by Beiersdorf)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'กลูโคลิน (Glucolin) = ผงกลูโคส/เดกซ์โทรส — อาหารเสริมพลังงาน ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = '630020308';

-- Glucerna (Abbott medical nutrition for diabetes — all sizes/flavors)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'Glucerna โดย Abbott — อาหารทางการแพทย์ (medical nutrition) สำหรับผู้ป่วยเบาหวาน ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522; จัดเป็น supplement ในบริบท ERP ร้านยา'
WHERE company_code IN (
  'IC-003909', 'IC-003774', 'IC-003589',
  'IC-003495', 'IC-000803', 'IC-000545'
);

-- กลูต้า (glutathione supplements)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'กลูต้า คอมพ์/กลูต้าคอล (Glutathione supplement) — อาหารเสริมกลูต้าไธโอน ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-005154', 'IC-003174');

-- กัมมี่ชูผสมไฟเบอร์ (fiber gummies)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'กัมมี่ชูผสมไฟเบอร์ (fiber chewable gummies) — อาหารเสริมใยอาหาร ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-002638';

-- กาโนลิน พลัส (Ganoderma + Ginseng + Cordyceps complex)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'กาโนลิน พลัส (เห็ดหลินจือ + โสม + ถังเช่า) — อาหารเสริมสมุนไพรรวม ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522; หากฉลากมีสรรพคุณทางยา ต้องขึ้นทะเบียน อย.สมุนไพรเพิ่มเติม'
WHERE company_code = 'IC-000057';

-- กาลิแคป กระเทียมสกัด (Garlic extract capsules)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'กาลิแคป กระเทียมสกัด 10 มก (Garlic extract capsules) — อาหารเสริมสกัดกระเทียม ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-001361';

-- ================================================================
-- HERB (2 รายการ) — ไม่เปลี่ยน enrichment_status
-- ================================================================

-- กระชายโพรโพลิซเมาท์สเปรย์ (Fingerroot + Propolis oral spray)
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'กระชายโพรโพลิซเมาท์สเปรย์ — สมุนไพรกระชาย (Boesenbergia rotunda) + โพรโพลิซ; สินค้ากลุ่มนี้ขึ้นทะเบียน HERBAL_PRODUCT ช่วงโควิด ภายใต้ พ.ร.บ.สมุนไพร พ.ศ. 2562; ยืนยันเลขทะเบียน'
WHERE company_code = 'IC-002067';

-- กรีนเฮิร์บเขียว 2 ทาง (Green Herb nasal+throat spray — same brand as batch 1)
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'กรีนเฮิร์บเขียว 2 ทาง (สเปรย์พ่นจมูก+คอ) — ยี่ห้อเดียวกับเสลดพังพอน batch 1; สินค้ากลุ่ม Green Herb ขึ้นทะเบียน HERBAL_PRODUCT ภายใต้ พ.ร.บ.สมุนไพร พ.ศ. 2562; ยืนยันฉลาก'
WHERE company_code = 'IC-000554';

-- ================================================================
-- DRUG (4 รายการ) — ไม่เปลี่ยน enrichment_status
-- ================================================================

-- การบูร / Camphor (ตราพัด, โบโทเบล, อันอัน, plain)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'การบูร (Camphor) — DRUG_MODERN ยาทาภายนอก บรรเทาปวด/คัน; หลายยี่ห้อมีทะเบียนยา ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; สอดคล้องกับ batch 1 (IC-003156)'
WHERE company_code IN ('IC-002932', 'IC-003785', 'IC-001234', 'IC-005218');

-- ================================================================
-- COSMETIC (2 รายการ) — ไม่เปลี่ยน enrichment_status
-- ================================================================

-- GUM Ortho เมาธ์รินส์ (fluoride mouthwash)
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'GUM Ortho เมาธ์รินส์ น้ำยาบ้วนปากผสมฟลูออไรด์ — เครื่องสำอางช่องปาก ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558; ไม่มีส่วนผสมยารักษาโรค'
WHERE company_code = 'IC-004732';

-- โพลิเดนท์ กาวติดฟันปลอม (Polident denture adhesive)
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'โพลิเดนท์ กาวติดฟันปลอม (Polident denture adhesive) — ผลิตภัณฑ์สุขอนามัยช่องปาก ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-000219';

COMMIT;

-- ================================================================
-- UNCERTAIN (ข้าม ไม่ update):
-- IC-003747: กัททูร์ ดูอัล รสเปปเปอร์มินท์ 10 มล.
--   เหตุผล: ไม่ชัดเจนว่าเป็น drug (throat antiseptic spray) หรือ cosmetic
--   (mouth freshener); ต้องยืนยันส่วนผสมจากฉลากสินค้าจริงก่อน update
-- ================================================================
