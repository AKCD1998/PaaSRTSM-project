-- Taxonomy Batch 11 — 2026-06-27
-- display_name range: โคเปอร์มิ้น(ข้าม) → บอนเจลา
-- SKUs classified: 99 | skipped (UNCERTAIN): 1 (IC-002972)

BEGIN;

-- ================================================================
-- DRUG (68 รายการ)
-- ================================================================

-- ทรานเซลเทียร์ = Transtear (CMC artificial tears)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ทรานเซลเทียร์ (Transtear) = Carboxymethylcellulose น้ำตาเทียม OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-003324', 'IC-005466');

-- ทราโวเจน = Travogen (Isoconazole antifungal cream)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ทราโวเจน ครีม (Travogen) = Isoconazole ยาต้านเชื้อรา ทาภายนอก — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-001800', 'IC-002727');

-- ทอไกลโคโล่ = Toglyco Lo (glycerol/guaiacol cough syrup)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ทอไกลโคโล่ (Toglyco Lo) = น้ำเชื่อมแก้ไอ/ละลายเสมหะ (glycerol-based cough syrup) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-005165', 'IC-003766', 'IC-005409');

-- ทัมใจ = Tumjai (ORS/antacid sachet)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ทัมใจ = ยาซอง ORS หรือยาลดกรด (infer จากรูปแบบซอง + บริบทร้านยา) ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = '630020242';

-- ทาวิเปค = Tavipec (Erdosteine 150mg mucolytic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ทาวิเปค 150 มก (Tavipec) = Erdosteine ยาละลายเสมหะ (mucolytic) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004664';

-- เทมปร้าฟอร์ท = Tempra Forte (Paracetamol syrup)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เทมปร้าฟอร์ท (Tempra Forte) = Paracetamol น้ำเชื่อม ยาแก้ปวด/ลดไข้ OTC — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-003511';

-- เทอรามายซิน = Terramycin (Oxytetracycline 3% eye ointment)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เทอรามายซิน 3.5 กรัม (Terramycin) = Oxytetracycline 3% ยาขี้ผึ้งป้ายตาปฏิชีวนะ ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = '630020190';

-- เทียร์นาทุรอลฟรี = Tears Naturale Free (preservative-free artificial tears)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เทียร์นาทุรอลฟรี (Tears Naturale Free) = น้ำตาเทียมแบบปลอดสารกันเสีย (CMC unit dose) OTC — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000153';

-- โทนาฟ = Tonaftate (Tolnaftate/Miconazole antifungal cream)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โทนาฟ 1%/2% ครีม = ยาต้านเชื้อรา (Tolnaftate 1% หรือ Miconazole 2%) ทาภายนอก — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('630020187', '630020186', '630020185', '630020184');

-- โทเบร็กซ์ = Tobrex (Tobramycin 0.3% eye drops)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โทเบร็กซ์ 0.3% (Tobrex) = Tobramycin ยาหยอดตาปฏิชีวนะ ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = 'IC-000385';

-- โทรทซิล = Throatcil (antiseptic throat lozenges)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โทรทซิล (Throatcil) = ยาอมรักษาและป้องกันเจ็บคอ (antiseptic throat lozenge) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-005143', 'IC-005478');

-- ไทยนคร NSS = Normal Saline Solution 0.9% sterile
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำเกลือปราศจากเชื้อ NSS 0.9% (ไทยนคร) = Normal Saline ยาชำระล้างแผล/ทำความสะอาด — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004157';

-- ไทลินอล = Tylenol (Paracetamol 500mg)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไทลินอล (Tylenol) = Paracetamol 500mg ยาแก้ปวด/ลดไข้ — ยาสามัญประจำบ้าน OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-003707';

-- น๊อค เพน ครีม = Knock Pain Cream (counterirritant topical analgesic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น๊อค เพน ครีม = ครีมบรรเทาปวดชนิดสร้างความร้อน (counterirritant topical analgesic) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-005390';

-- นอร์มากัต = Normagut (laxative/prokinetic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'นอร์มากัต (Normagut) = ยาระบาย/ยาเพิ่มการบีบตัวของลำไส้ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API จากฉลาก'
WHERE company_code = 'IC-002611';

-- นาซาไลน์ ไอโซ = Nasaline Isotonic nasal saline spray
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'นาซาไลน์ ไอโซ (Nasaline Isotonic) = น้ำเกลือไอโซโทนิกพ่นล้างจมูก — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-003386';

-- น้ำกลั่นปราศจากเชื้อ = Sterile distilled water (for medical use)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำกลั่นปราศจากเชื้อ (Sterile Water for Injection/Irrigation) — ยาสามัญ ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-001769', 'IC-003238');

-- น้ำเกลือ brands = Normal Saline/Saline Solution for wound irrigation/nasal
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำเกลือ (Normal Saline / Sodium Chloride 0.9%) สำหรับล้างแผล/ล้างจมูก — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  '630020297',   -- คลีนแอนด์แคร์ 1000 มล
  '630020296',   -- คลีนแอนด์แคร์ 500 มล
  'IC-004753',   -- GHP NSS 1000 มล
  'IC-005584',   -- ซอฟคลีน 100 มล
  '630020299',   -- ไทยโอซูกะ 1000 มล
  'IC-002302',   -- อิลิอาดิน ซาไลน์พ่นจมูก 30 มล
  'IC-003436',   -- ซอฟคลีนล้างจมูก 1000 มล
  '630020295'    -- ANB ดัมเบล 1000 มล
);

-- น้ำตาเทียมออฟซิล เทียร์ = Offsil Tear (artificial tears)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ออฟซิล เทียร์ (Offsil Tear) = น้ำตาเทียม (artificial tears) OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000128';

-- น้ำเต้าทอง = Nam Tao Thong (ยาไทย traditional fever/cold remedy)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำเต้าทอง = ยาไทยแผนโบราณสำหรับบรรเทาไข้/หวัด DRUG_TRADITIONAL — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510 (ยาแผนโบราณ); ยืนยันเลขทะเบียน อย.'
WHERE company_code IN ('630020225', '630020222', 'IC-000278', '630020039');

-- น้ำปราศจากเชื้อ = Sterile water for external irrigation
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำปราศจากเชื้อ สำหรับล้างภายนอก (Sterile Water for External Irrigation) — ยาสามัญ ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000607';

-- น้ำมันกวางลุ้ง = traditional Chinese deer oil liniment
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำมันกวางลุ้ง = ยาทาถูนวด (liniment) ยาแผนโบราณจีน DRUG_TRADITIONAL — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยันเลขทะเบียน'
WHERE company_code = 'IC-003633';

-- น้ำมันตรากุ้งคู่ = Double Shrimp brand traditional Chinese oil liniment
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำมันตรากุ้งคู่ = ยาทาถูนวด (liniment) ยาแผนโบราณจีน DRUG_TRADITIONAL — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004357';

-- น้ำมันมวย + น้ำมันมวยครีม = Muay oil/cream (traditional Thai sport analgesic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำมันมวย/น้ำมันมวยครีม = ยาทาถูนวด ยาแผนโบราณไทย (traditional Thai topical analgesic with camphor/menthol) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-000912', '630020292', '630020291', 'IC-001943');

-- น้ำมันละหุ่งหวาน วทศ. = Sweet/Light Castor Oil (laxative/emollient)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำมันละหุ่งหวาน (Sweet Castor Oil) วทศ. = น้ำมันละหุ่งสำหรับถ่ายระบาย/เป็นส่วนผสมยา — ยาสามัญ ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = '630020288';

-- น้ำยาบ้วนปากดิฟแฟลม = Difflam (Benzydamine HCl anti-inflammatory mouthwash)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำยาบ้วนปากดิฟแฟลม (Difflam) = Benzydamine HCl ยาบ้วนปากต้านอักเสบ/ระงับปวด — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-001860';

-- นินาซอลครีม = Ninazol cream (Ketoconazole)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'นินาซอล ครีม = Ketoconazole ยาต้านเชื้อรา ทาภายนอก ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code = '630020175';

-- นิวโรเบียน = Neurobion (Vitamin B1+B6+B12 registered drug)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'นิวโรเบียน (Neurobion) = Vitamin B1+B6+B12 ขนาดสูง ยาบำรุงระบบประสาท ขึ้นทะเบียนเป็นยา — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000151';

-- นิสิงเหจอมทอง = Nisihe Jomthong (traditional Thai tonic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'นิสิงเหจอมทอง = ยาไทยแผนโบราณ ยาบำรุง DRUG_TRADITIONAL — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510 (ยาแผนโบราณ); ยืนยันเลขทะเบียน อย.'
WHERE company_code = 'IC-000314';

-- นีโอติก้าคูล = Neotica Cool (cooling topical analgesic/muscle relaxant)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'นีโอติก้าคูล (Neotica Cool) = ยาทาภายนอกบรรเทาปวดชนิดเย็น (cooling topical analgesic) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000660';

-- เน็ค แอนด์ โชวล์เดอร์ รับ ตราเสือ = Tiger Balm Neck & Shoulder Rub
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'เน็ค แอนด์ โชวล์เดอร์ รับ ตราเสือ (Tiger Balm) = ครีมบรรเทาปวดคอ/ไหล่ (topical analgesic) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('630020336', '630020335');

-- แนคลอง 600 = N-Acetylcysteine (NAC) 600mg
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แนคลอง 600 มก = N-Acetylcysteine (NAC) 600mg ยาละลายเสมหะ/antioxidant ขึ้นทะเบียนเป็นยา — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = '630020322';

-- แนทเทียร์ = Natear (Sodium Hyaluronate/CMC artificial tears)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แนทเทียร์ (Natear) = น้ำตาเทียม (artificial tears) OTC ยาหยอดตาบรรเทาตาแห้ง — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('630020294', 'IC-000155', 'IC-000154');

-- แนปปี้ฮิปโป = Nappy Hippo (Zinc Oxide baby diaper rash cream)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'แนปปี้ฮิปโป (Nappy Hippo) = Zinc Oxide ครีมป้องกัน/รักษาผื่นผ้าอ้อม (therapeutic zinc oxide cream) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('630020174', '630020173');

-- ไนโซรัล ครีม/แชมพู (additional sizes) = Nizoral Ketoconazole
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไนโซรัล ครีม/แชมพู (Nizoral) = Ketoconazole ยาต้านเชื้อรา ยาอันตราย — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; จ่ายโดยเภสัชกร'
WHERE company_code IN ('630020182', 'IC-002379', 'IC-003954', 'IC-005084');

-- บรรเทาท้องอืด ดีแก๊ส = D-Gas (Simethicone antiflatulent)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ดีแก๊ส (D-Gas) = Simethicone ยาแก้ท้องอืดท้องเฟ้อ OTC — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-003137';

-- ไรนาแลกซ์ บี = Rinalax B (cough/expectorant syrup)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไรนาแลกซ์ บี (Rinalax B) = น้ำเชื่อมบรรเทาไอละลายเสมหะ (cough/expectorant syrup) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-003066';

-- บอช แอนด์ ลอมบ์ รีนิว = Bausch & Lomb ReNu lubricating eye/lens drops
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'บอช แอนด์ ลอมบ์ รีนิว มัลติพลัส (B&L ReNu) = น้ำยาหล่อลื่นเลนส์สัมผัส (contact lens rewetting drops) OTC — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004734';

-- บอนเจลา = Bonjela (Choline Salicylate + Cetalkonium Chloride oral gel)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'บอนเจลา (Bonjela) = Choline Salicylate + Cetalkonium Chloride ยาเจลทาแผลในปาก/aphthous ulcer OTC — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000641';

-- ================================================================
-- SUPPLEMENT (10 รายการ)
-- ================================================================

-- เท็ดดี้ ออเรนจ์ ซี = Teddy Orange Vitamin C 1000mg
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'เท็ดดี้ ออเรนจ์ ซี 1000 มก = อาหารเสริมวิตามินซี ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-004059';

-- นิวฟาร์วิตแดง = New Farmvit (multivitamin supplement)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'นิวฟาร์วิตแดง = อาหารเสริมมัลติวิตามิน ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-000814';

-- นิวโรเมท = Neuromet (Methylcobalamin/B12 supplement)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'นิวโรเมท 500 = อาหารเสริม Methylcobalamin (B12 active form) บำรุงระบบประสาท ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-003698';

-- นิวไวเพล็กซ์ = New Viplex (multivitamin supplement)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'นิวไวเพล็กซ์ = อาหารเสริมวิตามินรวม ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-001988';

-- นีโอก้า ซี = Neo-Q Vitamin C 1000mg supplement
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'นีโอก้า ซี 1000 มก = อาหารเสริมวิตามินซี ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-003907', 'IC-004269');

-- แนทซีเมกกะ + แนทซีเอสเทอร์ = NatC Mega/Ester-C Vitamin C 1000mg
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'แนทซีเมกกะ/แนทซีเอสเทอร์ = Ester-C / Vitamin C 1000mg อาหารเสริม ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-002040', 'IC-000249', 'IC-003782');

-- แนทบีเมกกะ = NatB Mega (Vitamin B complex supplement)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'แนทบีเมกกะ (NatB Mega) = อาหารเสริมวิตามินบีรวม (Vitamin B complex) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-001599';

-- ================================================================
-- ANTISEPTIC (9 รายการ)
-- ================================================================

-- ทิงค์เจอร์ไอโอดีน = Tincture of Iodine (wound antiseptic)
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'ทิงค์เจอร์ไอโอดีน (Tincture of Iodine) = ไอโอดีน 2% ในแอลกอฮอล์ ยาฆ่าเชื้อแผล antiseptic — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('630020301', '630020300');

-- นาโนไนน์ ซิลเวอร์ = Nano9 Silver antimicrobial hand spray
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'นาโนไนน์ ซิลเวอร์ แฮนด์ สเปรย์ = สเปรย์ฆ่าเชื้อโรคด้วยนาโนซิลเวอร์ — antiseptic ยาฆ่าเชื้อ ภายใต้ พ.ร.บ.ยา พ.ศ. 2510 หรือ พ.ร.บ.วัตถุอันตราย'
WHERE company_code = 'IC-004169';

-- น้ำยา C 20 = C-20 antiseptic mouthwash (Cetylpyridinium Chloride)
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'น้ำยาฆ่าเชื้อในช่องปาก C 20 (Cetylpyridinium Chloride) = ยาบ้วนปากฆ่าเชื้อ antiseptic mouthwash — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-004001', 'IC-003802', '630020287', 'IC-000206');

-- น้ำยาบ้วนปาก คลอร์เฮกซิดีน = Chlorhexidine mouthwash (Mabazin)
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'น้ำยาบ้วนปาก คลอร์เฮกซิดีน มายบาซิน = Chlorhexidine 0.2% mouthwash ฆ่าเชื้อในช่องปาก antiseptic — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004070';

-- นีโอพลาสท์ แอลกอฮอล์ แพด = Neoplast alcohol swab pad
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'นีโอพลาสท์ แอลกอฮอล์ แพด = แผ่นสำลีชุบแอลกอฮอล์ 70% ฆ่าเชื้อก่อนฉีดยา — antiseptic ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-001187';

-- ================================================================
-- HERB (6 รายการ) — ไม่เปลี่ยน enrichment_status
-- ================================================================

-- น้ำมันเขียวเสลดพังพอน = Clinacanthus nutans herbal oil (ตราแม่กุหลาบ)
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'น้ำมันเขียวเสลดพังพอน ตราแม่กุหลาบ = ผลิตภัณฑ์สมุนไพรจากเสลดพังพอน (Clinacanthus nutans) บรรเทาปวด/ผื่น ภายใต้ พ.ร.บ.สมุนไพร พ.ศ. 2562'
WHERE company_code IN ('IC-002115', 'IC-003258');

-- น้ำมันยูคาลิปตัส วทศ. = Eucalyptus oil (government herbal product)
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'น้ำมันยูคาลิปตัส วทศ. (Eucalyptus Oil) = ผลิตภัณฑ์สมุนไพรยูคาลิปตัส ช่วยบรรเทาคัดจมูก ภายใต้ พ.ร.บ.สมุนไพร พ.ศ. 2562'
WHERE company_code IN ('630020290', '630020289');

-- น้ำมันระกำ = Salacca palm herbal liniment
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'น้ำมันระกำ = ผลิตภัณฑ์สมุนไพรจากระกำ (Salacca) ใช้ทาภายนอกบรรเทาปวด ภายใต้ พ.ร.บ.สมุนไพร พ.ศ. 2562; ยืนยันทะเบียน อย.'
WHERE company_code = 'IC-002877';

-- น้ำมันเหลืองกรีนเฮิร์บ = Green Herb yellow herbal oil
UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'น้ำมันเหลืองกรีนเฮิร์บ (Green Herb yellow oil) = ผลิตภัณฑ์สมุนไพรทาภายนอก ภายใต้ พ.ร.บ.สมุนไพร พ.ศ. 2562; ยืนยันทะเบียน อย.'
WHERE company_code = 'IC-002745';

-- ================================================================
-- COSMETIC (1 รายการ)
-- ================================================================

-- ลิสเตอรีน คูลมินต์ = Listerine Cool Mint (cosmetic mouthwash)
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'ลิสเตอรีน คูลมินต์ (Listerine Cool Mint) = น้ำยาบ้วนปากดูแลช่องปาก ขึ้นทะเบียนเป็นเครื่องสำอาง ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-004014';

-- ================================================================
-- OTHER (5 รายการ) — enrichment_status = not_applicable
-- ================================================================

-- ถุงเท้า = socks (consumer clothing)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ถุงเท้า — เครื่องนุ่งห่มทั่วไป ไม่ใช่ผลิตภัณฑ์สุขภาพ'
WHERE company_code IN ('IC-000792', 'IC-000791', 'IC-001100');

-- ทิชชู่สก๊อตต์ = Scott tissue paper roll
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ทิชชู่สก๊อตต์เอ็กซ์ตร้า = กระดาษทิชชู่ทั่วไป ไม่ใช่ผลิตภัณฑ์สุขภาพ'
WHERE company_code = 'IC-001381';

-- ที่ตัดเม็ดยา = pill cutter (consumer healthcare accessory)
UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'ที่ตัดเม็ดยา อีซี่โดส = อุปกรณ์ช่วยตัดยาเม็ด ของใช้ทั่วไป ไม่มีทะเบียนเครื่องมือแพทย์'
WHERE company_code = 'IC-001611';

COMMIT;

-- ================================================================
-- UNCERTAIN (ข้าม):
-- IC-002972: โคเปอร์มิ้น 187 มก — ยังไม่ระบุ API ได้
-- ================================================================
