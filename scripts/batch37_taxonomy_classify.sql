-- Taxonomy Batch 37 — 2026-07-01
-- display_name range: ปกติ แจนแจน → เภสัช เอ็กซิบ 90
-- SKUs classified: 100 | skipped: 0
-- Notes: "ปกติ" = wholesaler prefix (32 items), "เภสัช" = pharmacy prefix (68 items)

BEGIN;

-- ================================================================
-- DRUG (86 รายการ)
-- ================================================================

-- -- "ปกติ" prefix drugs --

-- แจนแจน 500mg = analgesic/antipyretic (Paracetamol/Ibuprofen inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แจนแจน 500 มก = ยาแก้ปวดลดไข้ (infer Paracetamol/analgesic 500mg) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-005861';

-- ซีม่า โปร ครีม = Seema Pro cream (dermatological drug — Urea/corticosteroid)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซีม่า โปร ครีม 15 กรัม = ยาทาผิวหนัง (Seema Pro cream — Urea/corticosteroid) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005745';

-- เซลลอน แชมพู 2.5% = Selenium Sulfide medicated shampoo
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เซลลอน (Selenium Sulfide) แชมพู 2.5% = แชมพูยา รักษาเชื้อราบนหนังศีรษะ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005719';

-- แซดเฟรช = Z-Fresh unit-dose ampoules (artificial tears/saline — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แซดเฟรช 10 หลอด = ยา unit-dose ampoule (infer น้ำตาเทียมหรือน้ำเกลือ) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-005823';

-- ดูฟาแลค 1000 มล = Duphalac Lactulose (laxative)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ดูฟาแลค 1000 มล (Duphalac) = Lactulose ยาระบาย/รักษาโรคตับ (laxative/hepatic encephalopathy) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005735';

-- ดูราเทียรส์ = Duratears lubricant eye ointment
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ดูราเทียรส์ 3.5 กรัม = ยาขี้ผึ้งหล่อลื่นตา (lubricant eye ointment) รักษาตาแห้ง — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005831';

-- นิโคเร็ทท์ = Nicorette Invisipatch 15mg (nicotine replacement therapy)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'นิโคเร็ทท์ อินวิสิแพทช์ 15 มก = แผ่นแปะนิโคตินทดแทน (Nicotine Replacement Therapy) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005819';

-- บรองโก = Broncho mucolytic syrup (Ambroxol/Bromhexine)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'บรองโก 90 มก รสผลไม้ 40 มล = ยาน้ำละลายเสมหะ (Bromhexine/Ambroxol) สำหรับเด็ก — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005672';

-- เฟลเจสิค เจล = Felgesic gel (topical NSAID — Diclofenac/Piroxicam)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เฟลเจสิค เจล 30 กรัม = ยาเจลแก้ปวด/ต้านอักเสบ topical NSAID (Diclofenac/Piroxicam) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005924';

-- มายพารา ไซรัพ = My Para Paracetamol syrup (paediatric)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'มายพารา ไซรัพ รสราสเบอรี่ 60 มล = ยาน้ำเชื่อม Paracetamol สำหรับเด็ก — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005716';

-- มิวเทียร์ = MuTear artificial tears unit-dose
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'มิวเทียร์ 10 หลอด = น้ำตาเทียม unit-dose (artificial tears) รักษาตาแห้ง — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005821';

-- เมโคบิน = Mecobin (Methylcobalamin/Mecobalamin — neuropathy)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เมโคบิน = Methylcobalamin (Mecobalamin) ยาบำรุงระบบประสาท ใช้รักษาโรคเส้นประสาทส่วนปลาย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005812';

-- ยาน้ำแก้ไอ เนเจอร์ คอฟ = Nature Cough syrup
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยาน้ำแก้ไอ เนเจอร์ คอฟ 60 มล = ยาน้ำแก้ไอ (antitussive syrup) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005906';

-- ยาหยอดตาวิสลูบ = Vislube lubricant eye drops
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยาหยอดตาวิสลูบ 10 มล = น้ำตาเทียมหยอดตา (Vislube lubricant eye drops) รักษาตาแห้ง — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005787';

-- ยาอมสเตร็ปซิลเชสตี้ส้ม = Strepsils Chesty Orange (antiseptic throat lozenge)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ยาอมสเตร็ปซิลเชสตี้ส้ม 24 เม็ด (Strepsils Chesty) = ยาอมคอ antiseptic lozenge (Dichlorobenzyl alcohol + Amylmetacresol) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005762';

-- ลามิซิล ครีม 1% = Lamisil (Terbinafine) antifungal cream
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ลามิซิล ครีม 1% 15 กรัม (Lamisil) = Terbinafine ยาต้านเชื้อรา topical — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005658';

-- อ๊อกซิโนส 5% = topical solution (Minoxidil 5% inferred — hair loss)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'อ๊อกซิโนส 5% 10 มล = ยาสารละลายทาภายนอก (infer Minoxidil 5% รักษาผมร่วง) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-005793';

-- เอ็ดเวิร์ด คาลาไมน์ โลชั่น = Calamine lotion (skin protectant)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เอ็ดเวิร์ด คาลาไมน์ โลชั่น 55 มล = Calamine โลชั่นบรรเทาคัน/ปกป้องผิว — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005864';

-- แอร์ เอ็กซ์ โก เลม่อน = aromatic nasal inhaler (ยาดม)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แอร์ เอ็กซ์ โก เลม่อน 10 มล = ยาดมสูดอโรมา (nasal inhaler) กลิ่นมะนาว — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005920';

-- -- "เภสัช" prefix drugs --

-- โกเอ็มป้า 10 = Empagliflozin 10mg (SGLT2 inhibitor for diabetes)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โกเอ็มป้า 10 (Empagliflozin) 10 มก = ยาลดน้ำตาลเลือด SGLT2 inhibitor ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005772';

-- ไกโนเจนน่า 500mg = Gynogenna (Metronidazole vaginal 500mg)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไกโนเจนน่า 500 มก 4 เม็ด = Metronidazole ยาปฏิชีวนะ/ยาต้านพยาธิ (vaginal tablets) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005671';

-- คล็อกซ์ซาลิน = Cloxacillin suspension 60ml (antibiotic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คล็อกซ์ซาลิน 60 มล = Cloxacillin ยาปฏิชีวนะ penicillin group ชนิดน้ำ ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005678';

-- คลาซิด เอ็มอาร์ 500mg = Klaricid MR (Clarithromycin 500mg MR)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คลาซิด เอ็มอาร์ (Klaricid MR) 500 มก = Clarithromycin MR ยาปฏิชีวนะ macrolide ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005662';

-- ควานเทีย 200mg = Quetiapine 200mg (antipsychotic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ควานเทีย (Quetiapine) 200 มก = ยาต้านโรคจิต (antipsychotic) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005867';

-- คาร์ดอกซ่า 2mg = Cardoxa (Doxazosin 2mg alpha-blocker)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คาร์ดอกซ่า 2 มก = Doxazosin ยา alpha-1 blocker ลดความดัน/รักษาต่อมลูกหมากโต ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005640';

-- คาวินตัน ฟอร์ท = Cavinton Forte (Vinpocetine — cerebrovascular)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'คาวินตัน ฟอร์ท (Cavinton Forte) = Vinpocetine ยาเพิ่มการไหลเวียนเลือดสมอง — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005788';

-- เค ชุวา10 = K-Chua 10 (Potassium supplement/drug — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เค ชุวา10 30 เม็ด = ยาเสริมโพแทสเซียม (Potassium supplement/KCl preparation) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-005806';

-- แคนดาคอร์ท ครีม = Candacort (Clotrimazole + Hydrocortisone combination cream)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แคนดาคอร์ท ครีม 15 กรัม = Clotrimazole + Hydrocortisone ยาต้านเชื้อรา+คอร์ติโคสเตียรอยด์ ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005689';

-- จานูเมท เอ็กซ์อาร์ = Janumet XR (Sitagliptin + Metformin XR for diabetes)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'จานูเมท เอ็กซ์อาร์ 100/1000 มก (Janumet XR) = Sitagliptin + Metformin XR ยาลดน้ำตาลเลือด ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005775';

-- ซาชา 21, โมนาส 21, ยาคุมโซเนีย 28, ยาคุมเดอราเรซ 21 = OCP (oral contraceptives)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซาชา/โมนาส/โซเนีย/เดอราเรซ = ยาคุมกำเนิดชนิดเม็ด (Oral Contraceptive Pill) ยาควบคุมพิเศษ — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-005643', 'IC-005646', 'IC-005693', 'IC-005808');

-- ซาเรียส = Sareyas (pharmaceutical tablet — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซาเรียส 10 เม็ด = ยาเม็ด (infer จากบริบทร้านยา) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-005921';

-- ซิมบิคอร์ท เทอร์บูเฮเล่อร์ = Symbicort Turbuhaler (Budesonide + Formoterol ICS+LABA)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซิมบิคอร์ท เทอร์บูเฮเล่อร์ (Symbicort Turbuhaler) = Budesonide + Formoterol ICS+LABA ยาสูดพ่นรักษาหอบหืด/COPD ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005786';

-- ซีโซลีน วาย 10mg = Cisoline Y (antihistamine — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซีโซลีน วาย 10 มก = ยาเม็ด (infer antihistamine/Cetirizine 10mg) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-005840';

-- เซฟฟูรอกซึม = Cefuroxime 250mg (cephalosporin antibiotic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เซฟฟูรอกซึม BLC 250 มก = Cefuroxime Axetil ยาปฏิชีวนะ cephalosporin 2nd gen ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005828';

-- ไซทิซีน = Cytisine 1.5mg (smoking cessation)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไซทิซีน 1.5 มก = Cytisine ยาเลิกบุหรี่ (smoking cessation) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005647';

-- ด๊อกซิน ด๊อกซิไซคลิน = Doxycycline 100mg (antibiotic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ด๊อกซิน Doxycycline 100 มก = ยาปฏิชีวนะ tetracycline group ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005664';

-- ดาพาซ็อกซ์ 10mg = Dapagliflozin (SGLT2 inhibitor for diabetes)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ดาพาซ็อกซ์ (Dapagliflozin) 10 มก = ยาลดน้ำตาลเลือด SGLT2 inhibitor ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005634';

-- ดูแรน 600mg = mucolytic/NSAID 600mg (inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ดูแรน 600 มก = ยาเม็ด 600 มก (infer NAC 600mg mucolytic หรือ Ibuprofen 600mg) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-005811';

-- ดูโอแก๊ส 20mg = Duo-Gas (PPI + Simethicone or PPI 20mg)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ดูโอแก๊ส 20 มก = ยาลดกรด PPI (Omeprazole) ± Simethicone ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005790';

-- เดกซ์โทรเพคท์ = Dextropect (Dextromethorphan + Pectin cough medicine)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เดกซ์โทรเพคท์ = Dextromethorphan + Pectin ยาแก้ไอ (antitussive) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005622';

-- เดอฟาลอน 500mg = Daflon/Diosmin 500mg (venotonic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เดอฟาลอน 500 มก = Diosmin/Hesperidin (Daflon) ยาบำรุงหลอดเลือดดำ/รักษาริดสีดวงทวาร ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005708';

-- โดเมอดอน ซัสเพนชั่น = Domedon/Domperidone suspension
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โดเมอดอน suspension 30 มล = Domperidone ยาแก้คลื่นไส้/กระตุ้นการเคลื่อนไหวกระเพาะ ชนิดน้ำ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005696';

-- ทรูสอพท์ 2% = Trusopt (Dorzolamide 2% eye drops for glaucoma)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ทรูสอพท์ 2% 5 มล (Trusopt) = Dorzolamide 2% ยาหยอดตารักษาต้อหิน (carbonic anhydrase inhibitor) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005854';

-- ทิกรีเลอร์ 60mg = Ticagrelor 60mg (antiplatelet — Brilique)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ทิกรีเลอร์ (Ticagrelor/Brilique) 60 มก = ยาต้านเกล็ดเลือด P2Y12 inhibitor ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005857';

-- ทิโมแมค = Timomac (Timolol 1mg/ml ophthalmic — glaucoma)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ทิโมแมค 5 มก/5 มล = Timolol eye drops (beta-blocker ophthalmic) รักษาต้อหิน ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005637';

-- แทรมซีโลน ครีม 0.02% = Triamcinolone cream (topical corticosteroid)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แทรมซีโลน ครีม 0.02% 5 กรัม = Triamcinolone Acetonide ยาทาผิวหนัง corticosteroid ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005669';

-- น้อกซ่า 20 = Nokxa (Omeprazole 20mg — inferred PPI)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้อกซ่า 20 = ยาลดกรด (infer Omeprazole 20mg PPI) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-005785';

-- นิวริก้า 75mg = Neurica (Pregabalin 75mg — neuropathic pain)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'นิวริก้า (Pregabalin) 75 มก = ยารักษาอาการปวดเส้นประสาท/ลมชัก ยาควบคุมพิเศษ — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005849';

-- ไนโตรฟูรานโตอีน 100mg = Nitrofurantoin (urinary tract antibiotic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไนโตรฟูรานโตอีน 100 มก = ยาปฏิชีวนะรักษากระเพาะปัสสาวะอักเสบ ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005796';

-- บี ค็อกสิบ 90mg = B-Coxib (Etoricoxib 90mg COX-2 inhibitor)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'บี ค็อกสิบ 90 มก = Etoricoxib 90mg COX-2 selective NSAID ยาแก้ปวด/ต้านอักเสบ ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005641';

-- บูโชเนส 64mcg = Budesonide nasal spray (corticosteroid)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'บูโชเนส 64 มคก (Budesonide nasal spray) = ยาพ่นจมูก corticosteroid รักษาโรคจมูกอักเสบภูมิแพ้ ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005789';

-- เบนนาโรน 100mg = Benzbromarone 100mg (uricosuric for gout)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เบนนาโรน (Benzbromarone) 100 มก = ยาขับกรดยูริก รักษาโรคเกาต์ ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005866';

-- ไบลาโนส = Bilanose (Bilastine 20mg antihistamine — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไบลาโนส = Bilastine ยาแก้แพ้ 2nd generation antihistamine — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005791';

-- แผ่นแปะโลควา 40mg = Loqua patch (transdermal drug patch — NSAID/Lidocaine)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แผ่นแปะโลควา 40 มก = แผ่นแปะยาผ่านผิวหนัง transdermal patch (NSAID/Lidocaine) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-005835';

-- ฟีมีน30 = Feme-30 (OCP 28-day pack — oral contraceptive)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ฟีมีน30 28 เม็ด = ยาคุมกำเนิดชนิดเม็ด 28 วัน (Oral Contraceptive Pill) ยาควบคุมพิเศษ — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005642';

-- มอกซิลิน 500mg = Moxilin (Amoxicillin 500mg 500-cap hospital pack)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'มอกซิลิน 500 มก 500 แคปซูล = Amoxicillin ยาปฏิชีวนะ penicillin group (bulk pack) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005653';

-- มิวโซแลกซ์ = Musolarax (muscle relaxant — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'มิวโซแลกซ์ 10 เม็ด = ยาคลายกล้ามเนื้อ (muscle relaxant — infer Methocarbamol) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-005922';

-- เมซิล แคป = Mecil Cap (Ampicillin/Mecillinam or similar — inferred antibiotic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เมซิล แคป 10 แคป = ยาปฏิชีวนะแคปซูล (infer Mecillinam/Ampicillin) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-005677';

-- เมดิเซท 5mg = Mediset (Cetirizine 5mg antihistamine — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เมดิเซท 5 มก = ยาแก้แพ้ antihistamine (infer Cetirizine 5mg) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-005810';

-- เมทฟอร์ 500mg = Metfor (Metformin 500mg for diabetes)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เมทฟอร์ (Metformin) 500 มก = ยาลดน้ำตาลเลือด biguanide ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005648';

-- เมวาโลทิน โปรเทค 40mg = Mevalotin Protect (Pravastatin 40mg — statin)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เมวาโลทิน โปรเทค (Mevalotin) 40 มก = Pravastatin ยาลดไขมันในเลือด statin ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005814';

-- เมอซัน 16mg = Mersan (Betahistine 16mg for vertigo — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เมอซัน 16 มก = ยารักษาอาการวิงเวียน (infer Betahistine 16mg) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-005670';

-- ไรโซเดก เฟล็กทัช = Ryzodeg FlexTouch (Insulin Degludec/Aspart combination)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไรโซเดก เฟล็กทัช (Ryzodeg FlexTouch) = Insulin Degludec/Aspart ปากกาฉีดอินซูลิน ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005903';

-- ลิกเซียนา 30mg = Lixiana (Edoxaban 30mg anticoagulant NOAC)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ลิกเซียนา (Lixiana/Edoxaban) 30 มก = ยาต้านการแข็งตัวของเลือด NOAC ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005896';

-- ลิกาลอน 140 = Legalon 140 (Silymarin 140mg milk thistle — liver drug)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ลิกาลอน 140 (Legalon) = Silymarin 140 มก ยาบำรุง/ปกป้องตับ — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005778';

-- ลิฟตาติน 2 = Liftatine 2mg (pharmaceutical tablet — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ลิฟตาติน 2 10 เม็ด = ยาเม็ด 2 มก (infer antihypertensive/ACE inhibitor) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-005817';

-- ลูมอนท์ 10mg = Lumont (Montelukast 10mg — asthma/allergy)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ลูมอนท์ (Montelukast) 10 มก = ยาต้านลิวโคไตรอีน รักษาหอบหืด/ภูมิแพ้ ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005824';

-- เลปปา 250mg + 500mg = Leppa (Levofloxacin antibiotic — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เลปปา 250/500 มก = ยาปฏิชีวนะ (infer Levofloxacin fluoroquinolone) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-005850', 'IC-005851');

-- เลอคาดิพ 20mg = Lercanidipine 20mg (calcium channel blocker)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เลอคาดิพ (Lercanidipine) 20 มก = ยาลดความดันโลหิต calcium channel blocker (dihydropyridine) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005733';

-- โลดอส 2.5/6.25mg = Lodos (Bisoprolol + HCTZ combination)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โลดอส 2.5/6.25 มก = Bisoprolol + Hydrochlorothiazide ยาลดความดันโลหิต beta-blocker+diuretic ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005863';

-- ไลพริเคน 1g = Lipricane/Prilocaine+Lidocaine 1g cream (topical anesthetic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไลพริเคน 1 กรัม = Prilocaine + Lidocaine ครีม (EMLA equivalent) ยาชาเฉพาะที่ ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005781';

-- วัน แอลฟ่า 0.25mcg = One-Alpha (Alfacalcidol 0.25mcg — active Vitamin D)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'วัน แอลฟ่า 0.25 มคก (One-Alpha) = Alfacalcidol วิตามินดีที่ออกฤทธิ์ ใช้รักษาโรคไต/กระดูก ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005660';

-- วาโลเวียร์ 500mg = Valovir (Valacyclovir 500mg antiviral)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'วาโลเวียร์ (Valacyclovir) 500 มก = ยาต้านไวรัส Herpes (prodrug of Acyclovir) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005865';

-- เวสโกแนค 50 = Vescorna 50 (Diclofenac 50mg NSAID — 1000 tablet bulk)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เวสโกแนค 50 1000 เม็ด = ยาแก้ปวด/ต้านอักเสบ NSAID (infer Diclofenac Sodium 50mg bulk pack) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005800';

-- สไปออลโต เรสพิเมท = Spiolto Respimat (Tiotropium + Olodaterol LAMA+LABA for COPD)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'สไปออลโต เรสพิเมท (Spiolto Respimat) = Tiotropium + Olodaterol LAMA+LABA ยาสูดพ่นรักษา COPD ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005651';

-- อะซิแท็บ 250mg = Acitab (Azithromycin 250mg Z-Pak 6 tablets)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'อะซิแท็บ (Azithromycin) 250 มก 6 เม็ด = ยาปฏิชีวนะ macrolide (Z-Pak) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005633';

-- อะโทเซท 10/40mg = Atoset (Atorvastatin ± Ezetimibe — statin combination)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'อะโทเซท 10/40 มก = ยาลดไขมัน (Atorvastatin + Ezetimibe หรือ Atorvastatin 40mg) statin ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005673';

-- อะพิซ่า ซีซีพี 5mg = Apisa CCP (Apixaban 5mg anticoagulant — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'อะพิซ่า ซีซีพี 5 มก = ยาต้านการแข็งตัวของเลือด (infer Apixaban 5mg NOAC) ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005675';

-- อัลเลอร์นิค ไซรัป 5mg = Allernic Syrup (Cetirizine/Loratadine antihistamine syrup)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'อัลเลอร์นิค ไซรัป 5 มก 60 มล = ยาน้ำแก้แพ้ antihistamine (Cetirizine/Loratadine) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005635';

-- อาโซบรอม 8mg = Azobrom (Bromhexine 8mg mucolytic — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'อาโซบรอม 8 มก = ยาละลายเสมหะ (infer Bromhexine 8mg mucolytic) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005652';

-- อาโมจิน โคเมด = Amogyn Komed (pharmaceutical combination — inferred)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'อาโมจิน โคเมด 10 แคปซูล = ยาแคปซูล (infer Amoxicillin combination) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-005822';

-- เอ็กซิบ 90 = Exib (Etoricoxib 90mg COX-2 inhibitor — Arcoxia)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เอ็กซิบ 90 5 เม็ด = Etoricoxib 90mg COX-2 selective NSAID (Arcoxia) ยาแก้ปวด/ต้านอักเสบ ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-005795';

-- ================================================================
-- ANTISEPTIC (4 รายการ)
-- ================================================================

-- น้ำยาบ้วนปาก C-20 = Chlorhexidine 0.2% mouthwash (3 sizes/colours)
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'น้ำยาบ้วนปาก C-20 (Chlorhexidine 0.2%) = น้ำยาฆ่าเชื้อในช่องปาก antiseptic mouthwash — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-005782', 'IC-005700', 'IC-005757');

-- เฮ็กซ์ซีน สกิน เคลนเซอร์ 4% = Hexene Skin Cleanser (Chlorhexidine 4%)
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'เฮ็กซ์ซีน สกิน เคลนเซอร์ 4% 450 มล = Chlorhexidine Gluconate 4% ผลิตภัณฑ์ล้างมือ/ผิวหนังฆ่าเชื้อ antiseptic skin cleanser — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005816';

-- ================================================================
-- SUPPLEMENT (6 รายการ)
-- ================================================================

-- ซีดีอาร์ ฟอร์โทส = CDR Fortis (Calcium + Vitamin D effervescent tablet)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'ซีดีอาร์ ฟอร์โทส เม็ดฟู่ รสส้ม = อาหารเสริม Calcium + Vitamin D effervescent ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-005815';

-- ซีพลัส 5% = C-Plus Vitamin C 5% solution
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'ซีพลัส 5% 30 มล = อาหารเสริมวิตามินซี (Ascorbic Acid 5% solution) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522; ยืนยัน API'
WHERE company_code = 'IC-005792';

-- เซอร์เบค-ซิงค์ = Cerbec-Zinc (Zinc supplement)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'เซอร์เบค-ซิงค์ 28 เม็ด = อาหารเสริมสังกะสี (Zinc supplement) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-005734';

-- รี-บี ฟอร์ท = Re-B Fort (Vitamin B complex)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'รี-บี ฟอร์ท 10 เม็ด = อาหารเสริมวิตามินบีรวม (Vitamin B complex) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-005718';

-- อะลินามิน เอ็กพลัส = Alinamin Ex Plus (active Thiamine/Vit B1 supplement)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'อะลินามิน เอ็กพลัส 120 เม็ด = อาหารเสริม Fursultiamine (active Vitamin B1) + Vit B complex ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-005841';

-- เฟอโร-วิต = Ferro-Vit (Iron + Vitamins supplement)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'เฟอโร-วิต 100 เม็ด = อาหารเสริมธาตุเหล็กผสมวิตามิน (Iron + Vitamins supplement) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-005885';

-- ================================================================
-- HERB (2 รายการ)
-- ================================================================

-- บอระเพ็ด = Tinospora crispa (registered Thai traditional herbal medicine)
UPDATE public.skus SET
  product_type      = 'herb',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'บอระเพ็ด (Tinospora crispa) 400 มก 70 แคปซูล = ผลิตภัณฑ์สมุนไพรแผนไทย บรรเทาไข้/เบาหวาน ขึ้นทะเบียน อย. — ภายใต้ พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562'
WHERE company_code = 'IC-005869';

-- เห็ดหลินจือสกัด เฮอร์บัลวัน = Ganoderma lucidum extract capsules
UPDATE public.skus SET
  product_type      = 'herb',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เห็ดหลินจือสกัด เฮอร์บัลวัน 100 แคปซูล = ผลิตภัณฑ์สมุนไพร Ganoderma lucidum extract เสริมภูมิคุ้มกัน — ภายใต้ พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562'
WHERE company_code = 'IC-005765';

-- ================================================================
-- DEVICE (2 รายการ)
-- ================================================================

UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'Accu-Chek (ไกด์/อินสแตนท์) 50 ชิ้น = แถบทดสอบน้ำตาลในเลือด (Blood Glucose Test Strips) เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-005667', 'IC-005668');

COMMIT;
