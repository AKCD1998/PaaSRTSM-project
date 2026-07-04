-- Taxonomy Batch 43 — 2026-07-04
-- display_name range: สามัญน้ำมันมะพร้าวฝาสเปรย์ → สามัญบอชแอนด์ลอมบ์คอนแทคเลนส์ -1.50
-- SKUs classified: 100 | skipped: 0
-- Mix: drug(13) supplement(30) antiseptic(8) device(25) cosmetic(1) cosmeceutical(2) other(21)

BEGIN;

-- ================================================================
-- DRUG (13 รายการ)
-- ================================================================

-- น้ำมันยูคาลิปตัส (ตราจิงโจ้/ตรานกแก้ว 56ml + 8.5ml) = Eucalyptus oil (Thai traditional drug)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำมันยูคาลิปตัส (ตราจิงโจ้/ตรานกแก้ว) = ยาแผนโบราณ น้ำมันยูคาลิปตัส บรรเทาคัดจมูก/ไข้หวัด — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-001773', 'IC-000820', 'IC-000485');

-- น้ำมันละหุ่งหวาน วิทยาศรม = Sweet Castor Oil (mild laxative — OTC drug)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำมันละหุ่งหวาน วิทยาศรม 60 มล = น้ำมันละหุ่งหวาน ยาระบายอ่อนๆ (Sweet Castor Oil OTC laxative) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-002884';

-- น้ำมันสมุนไพร มงคล = Mongkol herbal oil (Thai traditional medicinal oil)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำมันสมุนไพร มงคล 5 มล = ยาน้ำมันสมุนไพรแผนโบราณ (Thai traditional medicated herbal oil) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004549';

-- น้ำมันเหลือง (กรีนเฮิร์บ 24ml/8ml + สมถวิล ตราต้นโพธิ์) = Yellow oil (Thai traditional analgesic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำมันเหลือง (กรีนเฮิร์บ/สมถวิล ตราต้นโพธิ์) = ยาแผนโบราณ น้ำมันระงับปวด/แก้คัน (Thai traditional yellow oil) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-000549', 'IC-003085', 'IC-000089');

-- โนโดเกิล สเปรย์ 15ml = Nodogel throat spray (topical anesthetic/analgesic)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โนโดเกิล สเปรย์ 15 มล = สเปรย์บรรเทาเจ็บคอ (Nodogel throat analgesic spray) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000175';

-- โนรอยด์ 5g = Noroid (topical drug for hemorrhoids/skin)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'โนรอยด์ 5 กรัม = ยาทาภายนอก (topical preparation — infer hemorrhoid/dermatology) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-000538';

-- ไนโซรัล เดอร์ม่า เดลลี่ แชมพู = Nizoral Derma Daily Shampoo (Ketoconazole anti-dandruff OTC)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'ไนโซรัล เดอร์ม่า เดลลี่ แชมพู 200 มล = แชมพู Ketoconazole 1% ยาแก้รังแค/เชื้อรา — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-004684';

-- บรรเทาปวดเมื่อย ตราน้ำมันมวย = Boxer Oil (Thai traditional pain relief oil)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'น้ำมันมวย 60 มล = ยาแผนโบราณ น้ำมันนวดบรรเทาปวดเมื่อย (Muay Oil traditional liniment) — ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-001942';

-- บลูเจล 15g = Blue Gel (topical analgesic/cooling gel)
UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'บลูเจล 15 กรัม = เจลทาบรรเทาปวด (topical analgesic gel) — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510; ยืนยัน API'
WHERE company_code = 'IC-004850';

-- ================================================================
-- SUPPLEMENT (30 รายการ)
-- ================================================================

-- น้ำมันมะพร้าวสกัดเย็นในแคปซูล = Coconut oil capsules (supplement form)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'น้ำมันมะพร้าวสกัดเย็น วังหลัง 1000 มก 30 แคปซูล = อาหารเสริมน้ำมันมะพร้าวสกัดเย็น (capsule form) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-004124';

-- น้ำมันเมล็ดงาดำ + น้ำมันเมล็ดแฟลกซ์ = Black seed oil + Flaxseed oil capsules
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'น้ำมันเมล็ดงาดำ/เมล็ดแฟลกซ์ 1000 มก 30 เม็ด = อาหารเสริม (Black Seed Oil / Flaxseed Oil capsule) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-005026', 'IC-002316');

-- น้ำมันรำข้าว (แกมมาโอริซานอล + อภัยภูเบศร) = Rice bran oil supplements
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'น้ำมันรำข้าว (แกมมาโอริซานอล/อภัยภูเบศร) = อาหารเสริม Rice Bran Oil/Gamma-Oryzanol ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-001718', 'IC-005274');

-- นิวเทรน จูเนียร์ = Nutren Junior (Nestle pediatric nutritional formula)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'นิวเทรน จูเนียร์ 400 กรัม (Nestle Nutren Junior) = อาหารทางการแพทย์สำหรับเด็ก (pediatric nutritional formula) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-004561';

-- นิวโทรเพล็กซ์ + นูโทรเพล็กซ์ โอลิโกพลัส = Nutroplex Oligoplus (liquid nutritional supplement)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'นิวโทรเพล็กซ์/นูโทรเพล็กซ์ โอลิโกพลัส = อาหารเสริมสำหรับเด็ก Nutroplex (liquid supplement) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-003542', 'IC-003613');

-- นีโอก้า series = Neoga brand supplements
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'นีโอก้า (Neoga) = อาหารเสริม (Garcinia/Garlic/Cal Plus/Oryzanol/Astaxanthin) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN (
  'IC-004377',  -- นีโอก้า การ์ซินิน (Garcinia)
  'IC-005777',  -- นีโอก้า การ์ลิค 10 เม็ด
  'IC-005904',  -- นีโอก้า การ์ลิค 30 แคปซูล
  'IC-004264',  -- นีโอก้า แคล พลัส
  'IC-002923',  -- นีโอก้า ออไรซอล ทีเอส
  'IC-004880'   -- นีโอก้า แอสธิน (Astaxanthin)
);

-- นีโอมูน = Neomune (medical nutritional formula)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'นีโอมูน กลิ่นวนิลา 400 กรัม = อาหารทางการแพทย์ (Neomune medical nutritional formula) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-001049';

-- เนเจอร์ ไบท์ วิตามินซี = Nature Bite Vitamin C chewable tablets
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'เนเจอร์ ไบท์ วิตามินซี 60 มก 20 เม็ด (กลิ่นส้ม/องุ่น) = อาหารเสริมวิตามินซีเคี้ยว ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-005697', 'IC-005698');

-- เนบโปร เอชพี = Nepro HP (Abbott renal nutritional formula)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'เนบโปร เอชพี (Nepro HP) = อาหารทางการแพทย์สำหรับผู้ป่วยโรคไต (renal nutritional formula) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-001105', 'IC-005231');

-- เนสท์เล่ บูสท์ = Nestle Boost series (adult/elderly nutritional supplement)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'เนสท์เล่ บูสท์ (Nestle Boost Care/Fibre/Optimum/Collagen) = อาหารเสริมโปรตีนสำหรับผู้ใหญ่/ผู้สูงอายุ ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN (
  'IC-001667',  -- บูสท์ แคร์ วานิลลา 800g
  'IC-001841',  -- บูสท์ ไฟเบอร์ 800g
  'IC-002954',  -- บูสท์ ออปติมัม วนิลา 400g
  'IC-001612',  -- บูสท์ ออปติมัม วนิลา 800g
  'IC-002955',  -- บูสท์ แอด คอลลาเจน ชอค 157.5g
  'IC-001614',  -- บูสท์ แอด คอลลาเจน ชอค 400g
  'IC-005188'   -- บูสท์ ออปติมัม กลิ่นธัญพืช 800g
);

-- แนทซีเมกกะ/แนทซีเมกะ = NatSea Mega Vitamin C 1000mg
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'แนทซีเมกกะ/แนทซีเมกะ 1000 มก = อาหารเสริมวิตามินซี 1000mg ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-000109', 'IC-005852');

-- แนทซี ยัมมี กัมมีซ = Natsi Yummy Gummies Vitamin C
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'แนทซี ยัมมี กัมมีซ กลิ่นส้ม 25 ชิ้น = อาหารเสริมวิตามินซีรูปแบบกัมมี่ ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-004090';

-- แนท แมก = Nat Mag (Magnesium supplement)
UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'แนท แมก 350 มก 30 เม็ด = อาหารเสริมแมกนีเซียม (Magnesium supplement) ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code = 'IC-003977';

-- ================================================================
-- ANTISEPTIC (8 รายการ)
-- ================================================================

-- น้ำยาฆ่าเชื้อ (คีนน์ อัลติม่า + แชมป์) = commercial disinfectants
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'น้ำยาฆ่าเชื้อไวรัส/อเนกประสงค์ (คีนน์ อัลติม่า/แชมป์) = ผลิตภัณฑ์ฆ่าเชื้อโรค — ยาสามัญ ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-001450', 'IC-002581');

-- น้ำยาบ้วนปาก = mouthwash (antiseptic category in Thai law)
UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'น้ำยาบ้วนปาก (โพรโพลิซ/ฟ้าทลายโจร มายเซพติค/ลิสเตอรีน/มายเซนทีพ) = น้ำยาบ้วนปากฆ่าเชื้อ — ยาสามัญ OTC ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN (
  'IC-001886',  -- โพรโพลิซ เมาท์วอช 150ml
  'IC-004119',  -- ฟ้าทลายโจร มายเซพติค มายบาซิน 95ml
  'IC-002301',  -- ลิสเตอรีน โทเทิลแคร์ 250ml
  'IC-001585',  -- ลิสเตอรีนคูลมินต์ 750ml ฟรี 250ml
  'IC-004115',  -- ลิสเตอรีนคูลมินต์ ซีโร่ แอลกอฮอล์ 750ml ฟรี 250ml
  'IC-005737'   -- มายเซนทีพ มายบาซิน สูตรเกลือ พลัสฟลูออไรด์ 240ml
);

-- ================================================================
-- DEVICE (25 รายการ)
-- ================================================================

-- น้ำยาล้างคอนแทคเลนส์ = contact lens solutions (medical device)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'น้ำยาล้างคอนแทคเลนส์ (เซ็นซิพลัส/ไบโอทรู/รีนิว/ออฟติฟรี/ซีแอนด์ซี) = น้ำยาดูแลคอนแทคเลนส์ เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN (
  'IC-000869','IC-000868',   -- เซ็นซิพลัส 100/500ml
  'IC-003048','IC-004514',   -- ไบโอทรู 300/60ml
  '630020286','630020285',   -- รีนิว 120ml+ตลับ / 355ml
  'IC-002432',               -- รีนิว 60ml
  'IC-004168',               -- ออฟติ ฟรี เพียวมอยซ์ 90ml
  'IC-005839'                -- ซีแอนด์ซี 60ml
);

-- นิโปร เซฟเล็ตแคท = Nipro SafeLetCat (IV catheter/cannula)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'นิโปร เซฟเล็ตแคท 18G/20G/22G/24G = สายสวนเส้นเลือดดำ (IV cannula/catheter) เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-003876', 'IC-003874', 'IC-003447', 'IC-003875');

-- นีโอเทป = Neotape breathable plaster tape (medical wound dressing)
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'นีโอเทป เทปผ้าปิดแผลแบบรูพรุน (0.5"/1"/2"x10yd) + ผ้ายางปิดแผลจิ๋ว = พลาสเตอร์/ผ้าก๊อซปิดแผล เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-004751', 'IC-004625', 'IC-004627', 'IC-000582');

-- เน็กซ์แคร์ พลาสเตอร์ (ใส + กันน้ำ) = Nexcare waterproof/clear plaster
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เน็กซ์แคร์ พลาสเตอร์พลาสติกใส/กันน้ำ 25x72mm 50 ชิ้น (Nexcare) = พลาสเตอร์ปิดแผล เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-005562', 'IC-005561');

-- เนเจอร์ (เครื่องปั๊มนม + ชุดโยก + ที่ดูดน้ำมูก) = baby care medical devices
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'เนเจอร์ (เครื่องปั๊มนมไฟฟ้าคู่ D-5 / ชุดปั๊มนมโยก MN-2 / ที่ดูดน้ำมูกหัวซิลิโคน) = อุปกรณ์ทารกทางการแพทย์ เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-005636', 'IC-005146', 'IC-005135');

-- บอชแอนด์ลอมบ์ คอนแทคเลนส์ = Bausch & Lomb contact lenses
UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'บอชแอนด์ลอมบ์ คอนแทคเลนส์ -1.00/-1.25/-1.50 สีใส = คอนแทคเลนส์ทางการแพทย์ เครื่องมือแพทย์ — ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN ('IC-004515', 'IC-004516', 'IC-004517');

-- ================================================================
-- COSMETIC (1 รายการ)
-- ================================================================

-- นูแฮร์ แอนตี้ แฮร์ฟอล แชมพู = NuHair anti-hairfall nourishing shampoo
UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'นูแฮร์ แอนตี้ แฮร์ฟอล นอริชชิ่ง แชมพู 200 มล = แชมพูลดผมร่วง เครื่องสำอาง — ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-003929';

-- ================================================================
-- COSMECEUTICAL (2 รายการ)
-- ================================================================

-- เน็กแคร์ แผ่นซับสิว = Nexcare acne absorbing cover (pimple patch)
UPDATE public.skus SET
  product_type  = 'cosmeceutical',
  taxonomy_note = 'เน็กแคร์ แผ่นซับสิว 12 ชิ้น (Nexcare Acne Cover) = แผ่นดูดซับสิว (acne pimple patch cosmeceutical) ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-002996';

-- ไนท์เจล บัวไผ่ข้าว = Night Gel lotus bamboo rice (skin night gel)
UPDATE public.skus SET
  product_type  = 'cosmeceutical',
  taxonomy_note = 'ไนท์เจล บัวไผ่ข้าว 30 กรัม = เจลบำรุงผิวกลางคืน (skin night gel cosmeceutical) ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code = 'IC-000368';

-- ================================================================
-- OTHER (21 รายการ) — อาหาร/เครื่องดื่ม/ผลิตภัณฑ์ทำความสะอาด
-- ================================================================

UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'สินค้าประเภทอื่น (อาหาร/เครื่องดื่ม/ผลิตภัณฑ์ทำความสะอาด) — ไม่อยู่ในขอบเขต พ.ร.บ.ยา/อาหารเสริม/เครื่องสำอาง/เครื่องมือแพทย์'
WHERE company_code IN (
  -- น้ำมันมะพร้าวอาหาร (ขวด — ไม่ใช่แคปซูล)
  'IC-001490',  -- น้ำมันมะพร้าวฝาสเปรย์ไทยเพียว 100ml
  'IC-000470',  -- น้ำมันมะพร้าวสกัดเย็นรูท 100ml
  'IC-000145',  -- น้ำมันมะพร้าวสกัดเย็นรูท 200ml
  -- น้ำยาล้างจาน
  'IC-000844',  -- ซันไลต์ 150ml
  'IC-000845',  -- ไลปอนเอฟ 150ml
  -- น้ำผลไม้ ดีโด้
  'IC-000885',  -- น้ำสตรอเบอรี่ ดีโด้ 300ml x6
  'IC-000884',  -- น้ำส้ม ดีโด้ 300ml x6
  'IC-000886',  -- น้ำส้ม ดีโด้ 450ml x6
  -- เนสกาแฟ (กาแฟสำเร็จรูป — อาหาร)
  'IC-001521',  -- เนสกาแฟ 3in1 ริชอโรมา 40 ซอง
  'IC-000898',  -- เนสกาแฟ ลาเต้กระป๋อง 180ml x30
  'IC-000897',  -- เนสกาแฟ เอสเปรสโซเขียว 180ml
  'IC-000852',  -- เนสกาแฟ เบลนด์แอนด์บรู ริชอโรมา
  'IC-000853',  -- เนสกาแฟ เบลนด์แอนด์บรู เอสเปรสโซโรสต์
  'IC-001372',  -- เนสกาแฟ เรดคัพ 380g
  'IC-001382',  -- เนสกาแฟ เรดคัพ 45g
  -- ผงซักฟอก บรีส
  'IC-001421',  -- บรีสพาวเวอร์ 120g
  'IC-001434',  -- บรีสเอกเซล 90g
  -- เครื่องดื่มอื่น
  'IC-001374',  -- บลูไดมอนด์รสจืด 946ml (almond milk)
  -- ลูกบ๊วย/ของขบเคี้ยว
  'IC-002935',  -- บ๊วยเค็มอบแห้ง 50g
  'IC-004574',  -- บ๊วยสดแช่อิ่ม 90g
  'IC-002934'   -- บ๊วยหวาน 60g
);

COMMIT;