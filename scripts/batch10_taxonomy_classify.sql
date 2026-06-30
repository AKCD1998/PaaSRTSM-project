-- Taxonomy Batch 10 — 2026-06-27
-- display_name range: โคเปอร์มิ้น(ข้าม) → ถ่านพานาโซนิค
-- SKUs classified: 99 | skipped (UNCERTAIN): 1 (IC-002972 โคเปอร์มิ้น)

BEGIN;

-- ================================================================
-- DRUG (69 รายการ) — ไม่เปลี่ยน enrichment_status
-- ================================================================

-- ซาโตเจสิค = Satogesic topical NSAID gel (Diclofenac/Ketoprofen)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซาโตเจสิค เจล (Satogesic) = ยาทาภายนอก NSAID gel ลดอักเสบ/บรรเทาปวด — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-002016';

-- ซาร่า = Sara (Ibuprofen) ทุก strength/dosage form
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซาร่า (Sara) = Ibuprofen ยาแก้ปวด/ลดไข้ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-003321',   -- 160 มก รสองุ่น 60 มล
  'IC-000311',   -- 250 มก รสส้ม 60 มล
  'IC-004667',   -- 500 มก เม็ดกลม 50 เม็ด
  'IC-004820',   -- 500 มก เม็ดรี 50 เม็ด
  '630020216',   -- 500 มก เม็ดกลม 100 เม็ด
  'IC-000952',   -- 500 มก เม็ดรี 100 เม็ด
  'IC-004841'    -- สำหรับเด็ก 250 มก รสสตรอเบอรี่ 60 มล
);

-- ซาลอนพาส = Salonpas topical analgesic patch
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซาลอนพาส (Salonpas) = แผ่นแปะบรรเทาปวด (Methyl Salicylate + Menthol patch) โดย Hisamitsu — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = '630020320';

-- ซาเลน = Zalen vaginal/topical preparation
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซาเลน = ยาทาภายนอก/ยาเหน็บช่องคลอด (topical/vaginal preparation) — ยาสามัญ/ยาอันตราย ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code IN ('IC-004816', 'IC-004815');

-- ซิก้า เจล = antacid alginate gel (Ziga gel)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซิก้า เจล รสมิ้นต์ = ยาลดกรด/แก้อาการแน่นท้อง (antacid alginate gel) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004309';

-- ซิสทราล = Cisteral topical cream (dermatological preparation)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซิสทราล ครีม (Cisteral) = ยาทาผิวหนัง (dermatological preparation) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code IN ('630020193', '630020192');

-- ซิสทาลีน = Cystalene (N-Acetylcysteine หรือ mucolytic 600mg)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซิสทาลีน 600 มก = mucolytic (น่าจะ N-Acetylcysteine หรือ Carbocisteine) ยาละลายเสมหะ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-004376';

-- ซิสทีน/ซิสแทน = Systane eye drops (artificial tears by Alcon)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'Systane (ซิสทีน/ซิสแทน) โดย Alcon = น้ำตาเทียม (Polyethylene Glycol + Propylene Glycol) OTC ยาหยอดตา — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-004571', 'IC-001220', 'IC-004791', 'IC-004976');

-- ซี ดีน = Cedin/Sedin (antihistamine 10mg — น่าจะ Cetirizine)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซี ดีน 10 มก = ยาแก้แพ้ antihistamine (น่าจะ Cetirizine 10mg) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-003968';

-- ซีมอล = Ceemol (Paracetamol brand)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซีมอล (Ceemol) = Paracetamol 500mg ยาแก้ปวด/ลดไข้ — ยาสามัญประจำบ้าน OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-004826', 'IC-000231');

-- ซีม่า = Seema topical cream/lotion (dermatological)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซีม่า ครีม/โลชั่น (Seema) = ยาทาผิวหนัง (topical preparation) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code IN (
  '630020179', '630020178',   -- ซีม่าครีม 5g, 10g
  'IC-005454',                 -- ซีม่า โปร ครีม 1% 15g
  '630020215', 'IC-003801'    -- ซีม่าโลชั่น 15ml, 30ml
);

-- ซูบิล = Zubil (ยาเม็ด/น้ำ oral preparation ในบริบทร้านยา)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ซูบิล 90 มล = ยาน้ำ oral preparation (infer จากขนาดและบริบทร้านยา) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-002409';

-- เซทิลาร์ = Cetilal (topical/ophthalmic preparation)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เซทิลาร์ 50 มล = ยาหยอดตา/ยาทาภายนอก (infer จากขนาดและบริบทร้านยา) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-004104';

-- เซโนแลค = Xenolax (ยาระบายจากมะขามแขก = Senna laxative)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เซโนแลค (Xenolax) ยาระบายมะขามแขก = Senna (Sennoside) ยาระบาย — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-003650';

-- เซลลอน/เซลีเดอร์ม แชมพู 2.5% = Selenium sulfide 2.5% shampoo
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เซลลอน/เซลีเดอร์ม แชมพู 2.5% = Selenium Sulfide 2.5% ยาแชมพูรักษารังแค — ยาอันตราย ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-005335', 'IC-005201', 'IC-004291');

-- เซลลูเฟส = Cellufresh (CMC eye drops — Carboxymethylcellulose artificial tears)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เซลลูเฟส (Cellufresh) = Carboxymethylcellulose (CMC) น้ำตาเทียม OTC ยาหยอดตาบรรเทาตาแห้ง — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-000575', 'IC-000156', 'IC-002950');

-- โซดาผง NaHCO3 = Sodium Bicarbonate (antacid)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โซดาผงอ๊าค (Sodium Bicarbonate) สหการ = ยาลดกรด/antacid OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยังใช้เป็นส่วนผสมปรุงยาด้วย'
WHERE company_code = '630020311';

-- โซดามินท์ = Soda Mint tablets (Sodium Bicarbonate + Mint antacid)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โซดามินท์ ตราถ้วยทอง 300 มก = Sodium Bicarbonate เม็ดยาลดกรด OTC — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004876';

-- โซเดียม คลอไรด์ เม็ด = Sodium Chloride tablets (electrolyte supplement/drug)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โซเดียม คลอไรด์ ชนิดเม็ด 300 มก = Salt supplement/electrolyte replacement — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004784';

-- โซลแมกซ์ = Solmax 500mg (Ibuprofen/NSAID analgesic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โซลแมกซ์ 500 มก = ยาแก้ปวด NSAID (น่าจะ Ibuprofen 500mg) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = '630020254';

-- ไซโดแล็กซ์ = Cydolax laxative
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไซโดแล็กซ์ 250 มก = ยาระบาย (laxative) OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005001';

-- ไซเฟล็กซ์ = Cefalexin (antibiotic ยาอันตราย)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไซเฟล็กซ์ (Cefalexin/Cephalexin) = ยาปฏิชีวนะ cephalosporin ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('IC-003221', 'IC-003996', 'IC-003827');

-- ไซมิวซิน = Zimucin/Mupirocin 2% ointment (antibiotic ยาอันตราย)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไซมิวซิน 100 มก/5 กรัม = Mupirocin 2% ointment ยาปฏิชีวนะทาภายนอก (ยาอันตราย) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-004254';

-- ดอคูเสต = Docusate (stool softener)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ดอคูเสต ดีแวค (Docusate) = stool softener ยาทำให้อุจจาระนุ่ม OTC — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000693';

-- ดัลโคแล็กซ์ = Dulcolax (Bisacodyl laxative)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ดัลโคแล็กซ์ (Dulcolax) = Bisacodyl ยาระบาย/ยาเหน็บทวาร — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-004364', 'IC-005337');

-- ดิฟคอฟ = Diffcough cough syrup
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ดิฟคอฟ (Diffcough) = น้ำเชื่อมแก้ไอ (cough syrup) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-003947', 'IC-003946');

-- ดีน๊อก 0.1% = Xylometazoline/Oxymetazoline 0.1% adult nasal spray
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ดีน๊อก 0.1% ชนิดพ่น = nasal decongestant spray ความเข้มข้นสำหรับผู้ใหญ่ (Oxymetazoline/Xylometazoline 0.1%) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005325';

-- ดีโฟเจล = Defomel (Simethicone soft gel capsule)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ดีโฟเจล (Defomel) = Simethicone ยาแก้ท้องอืดท้องเฟ้อ soft gel — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-004683', 'IC-003551');

-- ดูฟาแคร์ + ดูฟาพลัส + ดูฟาแลค = Duphalac/Duphacare (Lactulose laxative)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ดูฟาแลค/ดูฟาแคร์/ดูฟาพลัส (Duphalac) = Lactulose ยาระบาย/แก้ท้องผูก OTC — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-004668',   -- ดูฟาแคร์ 66.7 กรัม 200 มล
  'IC-004358',   -- ดูฟาพลัส 3000 มก 13 มล
  'IC-001122',   -- ดูฟาแลค 100 มล
  'IC-005251',   -- ดูฟาแลค 15 มล
  'IC-005055'    -- ดูฟาแลค 200 มล
);

-- เดลต้าคาร์บอน ชาร์โคล = Activated Charcoal (medicinal)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เดลต้าคาร์บอน เมดิซินนอล ชาร์โคล = Activated Charcoal 10 เม็ด ยาดูดซับแก๊ส — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-003303';

-- เดลมาซิน ครีม 1% = Clindamycin 1% cream (antibiotic acne treatment ยาอันตราย)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เดลมาซิน ครีม 1% = Clindamycin 1% topical ยาปฏิชีวนะทาสิว (ยาอันตราย) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-003415';

-- โดซาแนค = Dosanac (Diclofenac emulgel)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โดซาแนค อีมัลชั่นเจล (Dosanac) = Diclofenac Sodium emulgel ยาต้านอักเสบ NSAID ทาภายนอก — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-002483', 'IC-001622');

-- ไดโคลเจล = Diclogel (Diclofenac gel)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไดโคลเจล (Diclogel) = Diclofenac gel ยาต้านอักเสบ NSAID ทาภายนอก — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004077';

-- ไดโซล ฟอร์ท = Dysol Fort (antihistamine elixir/syrup)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไดโซล ฟอร์ท อิลิกเซอร์ 8 มก = ยาแก้แพ้ antihistamine elixir (น่าจะ Dexchlorpheniramine) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004666';

-- ไดฟาสต์ + ไดฟีลีนเจล = Diclofenac topical gel variants
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไดฟาสต์/ไดฟีลีนเจล = ยาทาภายนอก NSAID gel ลดอักเสบ/บรรเทาปวด — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code IN ('IC-005425', 'IC-000659');

-- ไดอ๊อกตอล = Dioctel (Trimebutine antispasmodic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไดอ๊อกตอล 100 มก = Trimebutine ยาแก้ปวดท้อง/ลำไส้ (antispasmodic) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004649';

-- ไดแอสเจสท์ = Diasgest (digestive enzyme preparation)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไดแอสเจสท์ (Diasgest) = ยาช่วยย่อย digestive enzyme combination — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-004609', 'IC-002487');

-- ================================================================
-- SUPPLEMENT (12 รายการ) — ไม่เปลี่ยน enrichment_status
-- ================================================================

-- ซินโคมิน = Zincomin (Zinc supplement)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'ซินโคมิน (Zincomin) 60 แคปซูล = อาหารเสริมสังกะสี (Zinc supplement) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-003971';

-- ซี 1000 + ซี 500 = Vitamin C supplements
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'วิตามินซี (Vitamin C) 500/1000 มก = อาหารเสริม ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-005116', 'IC-001397');

-- ซีดีอาร์ = CDR (Calcium + D3 + C effervescent)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'ซีดีอาร์ (CDR) เม็ดฟู่ = Calcium + Vitamin D3 + Vitamin C effervescent อาหารเสริม ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-000177', 'IC-004483');

-- ซีต้า แคป วิตามินซี = Zeta Cap Vitamin C 500mg
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'ซีต้า แคป วิตามินซี 500 มก = อาหารเสริมวิตามินซี ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-002653';

-- เซนทรัม = Centrum (multivitamin + mineral supplement)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'Centrum (เซนทรัม) = อาหารเสริมมัลติวิตามิน + แร่ธาตุรวม ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN (
  'IC-001350',   -- เซนทรัมขาว 100 เม็ด
  'IC-000118',   -- เซนทรัมขาว 30 เม็ด
  'IC-004295',   -- สเตร็สแทปส์ 600+ซิงค์ 30 เม็ด
  'IC-004294'    -- สเตร็สแทปส์ 600+เหล็ก 30 เม็ด
);

-- เซเว่นซี + ไลซีน = Vitamin C + Lysine supplement
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'เซเว่นซี ผสมไลซีน (Seven-C + Lysine) = อาหารเสริมวิตามินซีผสมกรดอะมิโน ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-002161';

-- เซอร์เบค ซิงค์ = Cerbec Zinc supplement
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'เซอร์เบค ซิงค์ (Cerbec Zinc) = อาหารเสริมสังกะสี ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-003798';

-- ================================================================
-- ANTISEPTIC (10 รายการ) — ไม่เปลี่ยน enrichment_status
-- ================================================================

-- ซี-สครับ น้ำยาฆ่าเชื้อ = C-Scrub antiseptic surgical scrub solution
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'ซี-สครับ น้ำยาฆ่าเชื้อ (C-Scrub) = antiseptic surgical scrub solution ล้างมือก่อนผ่าตัด/ทำหัตถการ — ยาสามัญ ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-001827';

-- ดีเฮกต้า = Dihexta (Chlorhexidine antiseptic solution)
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'ดีเฮกต้า (Dihexta) = Chlorhexidine antiseptic solution ฆ่าเชื้อแผล — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-001412';

-- เดทตอล มงกุฏ = Dettol (Chloroxylenol 4.8% antiseptic liquid — ทุกขนาด)
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'เดทตอล มงกุฏ (Dettol) = Chloroxylenol 4.8% น้ำยาฆ่าเชื้อ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-000487',   -- 1000 มล
  'IC-001271',   -- 100 มล
  'IC-002118',   -- 125 มล
  'IC-002163',   -- 250 มล
  'IC-002424',   -- 4 ลิตร
  'IC-001270',   -- 500 มล
  'IC-001272',   -- 50 มล
  'IC-002250'    -- 750 มล
);

-- ================================================================
-- COSMECEUTICAL (1 รายการ) — ไม่เปลี่ยน enrichment_status
-- ================================================================

-- ไดอะบีเดิร์ม = Diabederm 10% Urea lotion (diabetic skin care)
UPDATE public.skus SET
  product_type  = 'cosmeceutical',
  taxonomy_note = 'ไดอะบีเดิร์ม โลชั่น 10% = Urea 10% therapeutic moisturizer สำหรับผิวผู้ป่วยเบาหวาน — cosmeceutical ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558; ยืนยันทะเบียน อย.'
WHERE company_code = 'IC-004884';

-- ================================================================
-- COSMETIC (1 รายการ) — ไม่เปลี่ยน enrichment_status
-- ================================================================

-- ซอมปอย = Sompoi (Acacia concinna traditional herbal hair wash)
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'ซอมปอย (ส้มป่อย / Acacia concinna) 240 มล = ผลิตภัณฑ์ดูแลเส้นผมจากสมุนไพรดั้งเดิม — เครื่องสำอางประเภท hair care ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-002970';

-- ================================================================
-- OTHER (6 รายการ) — enrichment_status = not_applicable
-- ================================================================

-- ซันสตาร์แปรงกระจก เอนทัฟท์ = single-tuft dental brush (consumer good)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ซันสตาร์ แปรงกระจก เอนทัฟท์ (Sunstar single-tuft brush) = แปรงทำความสะอาดฟัน ของใช้ทั่วไป ไม่มีทะเบียนเครื่องมือแพทย์'
WHERE company_code = 'IC-001682';

-- เซลล็อกซ์ ซุปเปอร์เอ็กซ์ตร้า = Cellox tissue/cotton rolls (consumer tissue)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เซลล็อกซ์ ซุปเปอร์เอ็กซ์ตร้า (Cellox) = ม้วนสำลี/ทิชชู่ ของใช้ทั่วไป ไม่อยู่ภายใต้กฎหมายสินค้าสุขภาพ'
WHERE company_code = 'IC-001524';

-- ตลับใส่ยา = Pill organizers (consumer goods)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ตลับใส่ยา (pill organizer/case) — ของใช้ทั่วไปช่วยจัดยา ไม่มีทะเบียนเครื่องมือแพทย์'
WHERE company_code IN ('IC-001208', 'IC-001460');

-- ถ่านไฟฉาย Panasonic = batteries (consumer electronics)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ถ่านไฟฉาย Panasonic AA = อุปกรณ์ไฟฟ้าทั่วไป ไม่ใช่ผลิตภัณฑ์สุขภาพ'
WHERE company_code IN ('IC-001152', 'IC-001153');

COMMIT;

-- ================================================================
-- UNCERTAIN (ข้าม):
-- IC-002972: โคเปอร์มิ้น 187 มก — ยังไม่ระบุ API ได้
-- ================================================================
