-- Taxonomy Batch 9 — 2026-06-27
-- display_name range: แก้วเซนทรัม → ซอฟเทียร์อายดรอป
-- prefix "ปกติ" = company convention เหมือน "สามัญ"
-- SKUs classified: 99 | skipped (UNCERTAIN): 1 (IC-002972 โคเปอร์มิ้น)

BEGIN;

-- ================================================================
-- DRUG (64 รายการ) — ไม่เปลี่ยน enrichment_status
-- ================================================================

-- คลออ๊อฟ = Chloramphenicol eye ointment (antibiotic ยาอันตราย)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คลออ๊อฟ ขี้ผึ้งป้ายตา = Chloramphenicol eye ointment — ยาอันตราย ยาปฏิชีวนะใช้ตา ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-003770';

-- คลาริเคลียร์ 0.05% = Oxymetazoline nasal spray (decongestant)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คลาริเคลียร์ สเปรย์พ่นจมูก 0.05% = Oxymetazoline nasal decongestant — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004473';

-- คลาริด = Antihistamine (น่าจะ Loratadine หรือ Chlorpheniramine)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คลาริด — ยาแก้แพ้/antihistamine; สินค้ากลุ่มนี้ขึ้นทะเบียนเป็นยาสามัญ ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-002937';

-- คลินายด์ = Clindamycin topical cream (antibiotic ยาอันตราย)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คลินายด์ ครีม = Clindamycin topical 1% (ยาอันตราย antibiotic) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-004894';

-- คลินิเพค = Cefalexin 250mg/5ml syrup (antibiotic ยาอันตราย)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คลินิเพค ไซรัป 250 มก = น่าจะ Cefalexin 250mg/5ml antibiotic syrup (ยาอันตราย) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API และทะเบียน'
WHERE company_code = 'IC-004503';

-- คอน คอน = ยาหยอดตา/จมูก (inferred from 15ml size + pharmacy context)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คอน คอน 15 มล = ยาหยอดตาหรือยาพ่นจมูก (infer จากขนาด 15ml + บริบทร้านยา) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยันส่วนผสมจากฉลาก'
WHERE company_code = '630020166';

-- คอมบิซิมย์ = Combizyme digestive enzyme combination
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คอมบิซิมย์ = Combizyme (combination digestive enzyme) — ยาสามัญ OTC ช่วยย่อยอาหาร ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000735';

-- คาดราไมน์ วี = antihistamine+decongestant syrup
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คาดราไมน์ วี = น้ำเชื่อมแก้แพ้+แก้คัดจมูก (antihistamine + decongestant combination syrup) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('630020204', '630020203');

-- คาเนสเทน = Clotrimazole antifungal (all sizes/concentrations)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คาเนสเทน (Canesten) = Clotrimazole ยาต้านเชื้อรา ทาภายนอก — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  '630020181', '630020180', 'IC-003380',
  'IC-000699', 'IC-004352'
);

-- คามิลโลซานเอ็ม = Kamillosan (Chamomile extract oral/topical solution)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คามิลโลซานเอ็ม (Kamillosan M) = ผลิตภัณฑ์สารสกัดคาโมมาย (bisabolol) ยาสำหรับช่องปาก/แผล — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-000265', 'IC-002107');

-- คาร์โบติน = Carbocisteine 500mg mucolytic
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คาร์โบติน แคปซูล 500 มก = Carbocisteine mucolytic ยาละลายเสมหะ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004204';

-- คาลาไมน์ชั่นศิริบัญชา = Calamine lotion OTC
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คาลาไมน์ชั่นศิริบัญชา (Calamine lotion) = ยาสามัญ OTC บรรเทาอาการคัน ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = '630020202';

-- คา อา บอน ชาร์โคล = Activated Charcoal (Carbon) capsules
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คา อา บอน ชาร์โคล (Activated Charcoal capsules) — ยาสามัญ OTC ดูดซับแก๊ส/พิษในระบบทางเดินอาหาร ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004324';

-- คีตาซอน/คีตาซอล/คีโตนาโซล = Ketoconazole antifungal (cream/shampoo)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คีตาซอน/คีตาซอล/คีโตนาโซล = Ketoconazole ยาต้านเชื้อรา (cream 2% / shampoo 2%) — ยาอันตราย ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-003767', 'IC-004252', 'IC-002030', 'IC-003690');

-- คูลมัสเซิล + คูลลิ่งสเปร์ย ตรางู = topical analgesic (Methyl Salicylate/Menthol)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คูลมัสเซิล/คูลลิ่งสเปร์ย ตรางู = ครีม/สเปรย์บรรเทาปวดกล้ามเนื้อ (topical analgesic) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-003548', 'IC-003149');

-- เครสมอล = Cresomol cough syrup (guaifenesin/expectorant)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เครสมอล ไซรัป = น้ำเชื่อมแก้ไอ/ละลายเสมหะ (cough/expectorant syrup) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-002617', 'IC-002522');

-- เคาน์เตอร์เพน ทุกสูตร (แดง/ทอง/ฟ้า)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'Counterpain (เคาน์เตอร์เพน) = ครีมบรรเทาปวด (Methyl Salicylate + Menthol + Camphor) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  '630020199', '630020198', '630020197',  -- แดง
  '630020157', 'IC-000471',              -- ทอง
  '630020196', '630020195', '630020194'  -- ฟ้า
);

-- แคนดิกซ์ น้ำ = antifungal oral solution (Nystatin/Clotrimazole สำหรับเชื้อราในปาก)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แคนดิกซ์ น้ำ = สารละลายยาต้านเชื้อราในปาก (oral antifungal solution น่าจะ Nystatin) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-000450';

-- แคปซิกา + แคปไพลซิน = Capsaicin topical gel
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แคปซิกา/แคปไพลซิน เจล = Capsaicin topical analgesic gel บรรเทาปวดข้อ/กล้ามเนื้อ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-002232', 'IC-000914', 'IC-004599');

-- ชอล์คแค็ป 1000 = Calcium Carbonate antacid
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ชอล์คแค็ป 1000 = Calcium Carbonate 1000mg ยาลดกรด/antacid — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-003326';

-- จับเลี้ยง ตราปลาเบ็ด = ยาจีนแผนโบราณ (Chinese traditional tonic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'จับเลี้ยง ตราปลาเบ็ด = ยาจีนแผนโบราณ (Chinese herbal tonic mixture) — DRUG_TRADITIONAL ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยันเลขทะเบียน'
WHERE company_code IN ('IC-000013', 'IC-005147');

-- จิ่วเจิ้ง = ยาจีนแผนโบราณ (Jiuzheng Chinese traditional medicine)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'จิ่วเจิ้ง (九症) = ยาจีนแผนโบราณบำรุงร่างกาย/ไต DRUG_TRADITIONAL ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยันเลขทะเบียน อย.'
WHERE company_code IN ('630020303', 'IC-005005');

-- เจนทีล + ซอฟเทียร์ = Artificial tears eye drops
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เจนทีล/ซอฟเทียร์ อายดรอป = น้ำตาเทียม (artificial tears) OTC ยาหยอดตาบรรเทาอาการตาแห้ง — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-005123', 'IC-003839');

-- เจลวิดิสซิค = Vidisic (Carbomer ophthalmic gel/artificial tears gel)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เจลวิดิสซิค (Vidisic) = Carbomer 0.2% ophthalmic gel น้ำตาเทียมชนิดเจล OTC — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000224';

-- เจสทอล 0.05% = Xylometazoline/Oxymetazoline nasal spray
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เจสทอล 0.05% ชนิดพ่น = nasal decongestant spray (น่าจะ Xylometazoline/Oxymetazoline 0.05%) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-004206';

-- ชวนป๋วยปี่แปกอ/แป่โหล่ว = Chinese traditional cough medicine
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ชวนป๋วยปี่ (川貝枇) = ยาจีนแผนโบราณแก้ไอ (Chinese herbal cough remedy) DRUG_TRADITIONAL — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยันเลขทะเบียน'
WHERE company_code IN ('IC-002705', 'IC-004113');

-- ชุโดเครม = Sudocrem zinc oxide therapeutic cream
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ชุโดเครม (Sudocrem) = Zinc Oxide 15.25% therapeutic skin cream บรรเทาผื่นผ้าอ้อม/แผลถลอก — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000588';

-- เช็งอิมอี้ = Chinese traditional medicine pills
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เช็งอิมอี้ = ยาจีนแผนโบราณชนิดเม็ด DRUG_TRADITIONAL — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยันเลขทะเบียน'
WHERE company_code = 'IC-004202';

-- แชมพูเซลซัน = Selsun (Selenium sulfide 2.5% shampoo)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แชมพูเซลซัน (Selsun) = Selenium Sulfide 2.5% ยาแชมพูรักษารังแค/seborrhea — ยาอันตราย ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('630020324', '630020240', '630020239');

-- แชมพูนอร่า + แชมพูนินาซอล = Ketoconazole shampoo (generic brands)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แชมพูนอร่า/แชมพูนินาซอล (Ketoconazole shampoo) = ยาต้านเชื้อรา ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('630020326', '630020325', '630020323');

-- แชมพูยาไนโซรัล = Nizoral (Ketoconazole 2% shampoo, original brand)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แชมพูยาไนโซรัล (Nizoral) = Ketoconazole 2% shampoo ยาต้านเชื้อรา ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-000054', 'IC-002407', 'IC-000053');

-- โคจีติน 1% = Clioquinol/Ciclopirox topical antifungal
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โคจีติน 1% = ยาทาภายนอกต้านเชื้อรา (น่าจะ Ciclopirox หรือ Clioquinol 1%) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-005199';

-- โคเทรน = topical pharmaceutical (inferred from small 5g size + pharmacy context)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โคเทรน 5 ก. = ยาทาภายนอก (infer จากขนาด 5g + บริบทร้านยา) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API และทะเบียนจากฉลาก'
WHERE company_code = 'IC-000667';

-- โคลไพร็อกซ์ = Ciclopirox nail solution
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โคลไพร็อกซ์ โซลูชั่น (Ciclopirox solution) = ยาทาเล็บต้านเชื้อรา — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-003486';

-- ================================================================
-- SUPPLEMENT (17 รายการ) — ไม่เปลี่ยน enrichment_status
-- ================================================================

-- คาร์เนค = L-Carnitine 500mg supplement
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'คาร์เนค (Carnec) 500 มก = L-Carnitine อาหารเสริมช่วยเผาผลาญไขมัน ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-005183';

-- เครส วิตามินซี 1000 ไบโอ = Vitamin C 1000mg supplement
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'เครส วิตามินซี 1000 ไบโอ = Vitamin C 1000mg อาหารเสริม ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-002108';

-- แค็ล ซี = Calcium + Vitamin C supplement
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'แค็ล ซี (Cal-C) = Calcium + Vitamin C effervescent tablet อาหารเสริม ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-000180';

-- Caltrate (แคลเทรต/แคลเทรท) ทุกสูตร = Calcium + Vitamin D supplements
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'Caltrate (แคลเทรต/แคลเทรท) = Calcium Carbonate + Vitamin D3 อาหารเสริมบำรุงกระดูก ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN (
  'IC-004648',   -- ซิลเวอร์ 50+ 600 มก 120 เม็ด
  'IC-001446',   -- พลัส 120 เม็ด
  '630020328',   -- พลัส 60 เม็ด
  'IC-000121',   -- พลัสซิลเวอร์ 30 เม็ด
  'IC-000218'    -- พลัสซิลเวอร์ 60 เม็ด
);

-- แคลแทบ = Calcium supplement (various strengths)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'แคลแทบ (Caltab) = Calcium supplement (Calcium Carbonate ± Vitamin D) อาหารเสริมบำรุงกระดูก ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-002682', 'IC-002681', 'IC-003374', 'IC-000308');

-- แคลวินพลัส = Calcium + Vitamin D supplement
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'แคลวินพลัส (Calvin Plus) = Calcium + Vitamin D supplement อาหารเสริมบำรุงกระดูก ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-002096', 'IC-005195');

-- แคลออส = Calcium chewable tablets
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'แคลออส ชนิดเม็ดเคี้ยว 500 มก = Calcium Carbonate chewable อาหารเสริมบำรุงกระดูก ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-002867', 'IC-003745');

-- จีพีโอ วิตามินซี = GPO Vitamin C 500mg supplement
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'จีพีโอ วิตามินซี 500 มก (GPO Vitamin C) = อาหารเสริมวิตามินซีจากองค์การเภสัชกรรม ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-002908';

-- ================================================================
-- DEVICE (7 รายการ) — enrichment_status = not_applicable
-- ================================================================

-- เครื่องชั่งน้ำหนักดิจิตอล (digital weighing scales)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เครื่องชั่งน้ำหนักดิจิตอล (digital bathroom scale) — เครื่องมือแพทย์ประเภทที่ 1 ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-001528', 'IC-000811', 'IC-000994');

-- คาส์ท คอมฟอร์ท = Cast comfort spray (orthopedic cast care)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'คาส์ท คอมฟอร์ท (Cast Comfort) = สเปรย์ดูแลผิวหนังบริเวณเฝือก (orthopedic cast care) — เครื่องมือแพทย์/อุปกรณ์เสริมทางกระดูก ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-004229';

-- ชุดตรวจโควิด = COVID-19 Rapid Antigen Test kit
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ชุดตรวจโควิด-19 (COVID-19 Rapid Antigen Test) — เครื่องมือแพทย์วินิจฉัยโรค ประเภทที่ 3 ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code = 'IC-002055';

-- ชุดสายน้ำเกลือ = IV infusion set
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ชุดสายน้ำเกลือ (IV infusion set) — เครื่องมือแพทย์ประเภทที่ 2 ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-001912', 'IC-000870');

-- ================================================================
-- HERB (1 รายการ) — ไม่เปลี่ยน enrichment_status
-- ================================================================

-- ชาจากใบกัญชา อภัยกัญช์ = Cannabis leaf tea (Abhaibhubejhr hospital)
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'ชาจากใบกัญชา อภัยกัญช์ โรงพยาบาลอภัยภูเบศร — ผลิตภัณฑ์สมุนไพรกัญชา ภายใต้ พ.ร.บ.สมุนไพร พ.ศ. 2562 (กัญชาทางการแพทย์); ยืนยันเลขทะเบียนและความถูกต้องของผลิตภัณฑ์'
WHERE company_code = 'IC-002746';

-- ================================================================
-- COSMETIC (1 รายการ) — ไม่เปลี่ยน enrichment_status
-- ================================================================

-- คอลเกต ยาสีฟันสมุนไพร ดีท็อกซ์ = Colgate herbal toothpaste
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'คอลเกต ยาสีฟันสมุนไพร ดีท็อกซ์ = Colgate Herbal Detox toothpaste — เครื่องสำอางช่องปาก ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-002812';

-- ================================================================
-- OTHER (9 รายการ) — enrichment_status = not_applicable
-- ================================================================

-- แก้วเซนทรัม = promotional glass from Centrum brand
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'แก้วเซนทรัม = แก้ว/ของแถมโปรโมชั่น Centrum ตัวสินค้าจริงคือแก้วดื่มน้ำ ไม่ใช่ผลิตภัณฑ์สุขภาพ'
WHERE company_code = 'IC-002817';

-- โค้กซีโร่ + โคคาโคลา = carbonated beverages
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'น้ำอัดลม Coca-Cola/Coke Zero — เครื่องดื่มอาหาร กำกับโดย อย.อาหาร ไม่ใช่ผลิตภัณฑ์ยา/สมุนไพร'
WHERE company_code IN ('IC-002700', 'IC-002701');

-- เจลปรับอากาศแอร์วิค = Air Wick gel air freshener
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เจลปรับอากาศแอร์วิค (Air Wick gel air freshener) — ผลิตภัณฑ์ดับกลิ่น ไม่อยู่ภายใต้กฎหมายสินค้าสุขภาพ'
WHERE company_code IN ('IC-002456', 'IC-002457', 'IC-002458');

-- ชุดสังฆทาน = Buddhist alms-giving donation sets
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ชุดสังฆทาน = ชุดของขวัญทำบุญ ไม่ใช่ผลิตภัณฑ์สุขภาพที่กำกับ'
WHERE company_code IN ('IC-001052', 'IC-003119');

-- เชี่ยงชุน สุราผสมพิเศษ = alcoholic spirits (เหล้า)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เชี่ยงชุนสุราผสมพิเศษ 28° (สุรา/เหล้า) — เครื่องดื่มแอลกอฮอล์ กำกับโดย พ.ร.บ.สุรา ไม่ใช่ผลิตภัณฑ์ยา/สมุนไพร'
WHERE company_code = 'IC-000965';

COMMIT;

-- ================================================================
-- UNCERTAIN (ข้าม ไม่ update):
-- IC-002972: โคเปอร์มิ้น 187 มก 10 เม็ด
--   เหตุผล: ขนาด 187mg ไม่ใช่ขนาดมาตรฐานของ API ที่รู้จัก;
--   ไม่สามารถ identify ว่าเป็น Ibuprofen pediatric (187.5mg), Bromhexine, หรืออื่น;
--   ต้องดูฉลากจริงหรือ search NDI ก่อน update
-- ================================================================
