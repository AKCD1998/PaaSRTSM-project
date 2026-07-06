-- batch64_taxonomy_classify.sql
-- Batch 64: หน้ากากอนามัยคลีนมาส์ก LF99 สีพีช → ออซ พี นูริช ออยล์ 5 มล
-- 99 SKUs: device(62) cosmeceutical(17) supplement(8) other(5) drug(4) herb(2) cosmetic(1)
-- NOTE: 630010251 สเปรย์พระยาแรด — intentional skip, keep NULL

BEGIN;

-- drug (4): Arotica pain/cool/bug sprays + Aqua Maris Baby nasal spray
UPDATE public.skus SET
  product_type = 'drug',
  taxonomy_note = 'ยาทาภายนอก/สเปรย์บรรเทาอาการทางกาย จัดเป็นยาตามพ.ร.บ.ยา 2510'
WHERE company_code IN (
  'IC-004319',
  'IC-005437',
  'IC-004810',
  'IC-003699'
);

-- supplement (8): Lingzhi series, garlic extract, avocado oil mix, Abhai Livewell
UPDATE public.skus SET
  product_type = 'supplement',
  taxonomy_note = 'ผลิตภัณฑ์เสริมอาหาร ขึ้นทะเบียนภายใต้พ.ร.บ.อาหาร 2522'
WHERE company_code IN (
  'IC-001468',
  'IC-002939',
  'IC-001467',
  'IC-003354',
  'IC-003949',
  'IC-004997',
  'IC-004846',
  'IC-005358'
);

-- herb (2): Abhaibhubejhr Thai traditional herbal medicines
UPDATE public.skus SET
  product_type = 'herb',
  taxonomy_note = 'ยาสมุนไพรแผนไทย ผลิตโดยโรงพยาบาลเจ้าพระยาอภัยภูเบศร จัดเป็นยาสมุนไพรตามพ.ร.บ.ผลิตภัณฑ์สมุนไพร 2562',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-004983',
  'IC-004726'
);

-- cosmetic (1): Himalaya lip balm
UPDATE public.skus SET
  product_type = 'cosmetic',
  taxonomy_note = 'ผลิตภัณฑ์เครื่องสำอาง (ลิปบาล์ม) จัดเป็นเครื่องสำอางตามพ.ร.บ.เครื่องสำอาง 2558'
WHERE company_code IN (
  'IC-001644'
);

-- cosmeceutical (17): Ocusoft lid scrub, OxyCure acne series, Alo Derma gel, Atoparm, Himalaya face washes, Abhai cucumber cream, Oz-P oil
UPDATE public.skus SET
  product_type = 'cosmeceutical',
  taxonomy_note = 'ผลิตภัณฑ์ cosmeceutical มีส่วนผสมออกฤทธิ์ดูแลผิว จัดเป็นเครื่องสำอางตามพ.ร.บ.เครื่องสำอาง 2558'
WHERE company_code IN (
  'IC-004679',
  'IC-004405',
  'IC-003686',
  'IC-000189',
  'IC-002914',
  'IC-001265',
  'IC-001266',
  'IC-001850',
  'IC-000539',
  'IC-000540',
  'IC-003534',
  'IC-003533',
  'IC-001189',
  'IC-001188',
  'IC-005359',
  'IC-005385',
  'IC-005122'
);

-- other (5): chrysanthemum/ginger instant beverages, areca nut chewing product, dried grapes
UPDATE public.skus SET
  product_type = 'other',
  taxonomy_note = 'สินค้าทั่วไป (อาหาร/เครื่องดื่ม) ไม่ใช่ผลิตภัณฑ์สุขภาพที่ต้องขึ้นทะเบียน',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-005408',
  'IC-004678',
  'IC-004677',
  'IC-003485',
  'IC-003622'
);

-- device (62): face masks (surgical/KF94/KN95/PM2.5/cloth/oxygen), surgical caps, bedpans, pillows, insulin needles, knee brace, hearing device, acne extractor, tweezers, condom, sterile gel, dental floss, canned O2
UPDATE public.skus SET
  product_type = 'device',
  taxonomy_note = 'เครื่องมือแพทย์ตามพ.ร.บ.เครื่องมือแพทย์ 2562',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-004797',
  'IC-004796',
  'IC-004795',
  'IC-004794',
  'IC-002303',
  'IC-001763',
  'IC-002968',
  'IC-002967',
  'IC-004583',
  'IC-000913',
  'IC-002657',
  'IC-004230',
  'IC-005144',
  'IC-001742',
  'IC-004915',
  'IC-004914',
  'IC-004913',
  'IC-002594',
  'IC-002595',
  'IC-003978',
  'IC-003979',
  'IC-003980',
  'IC-004192',
  'IC-005383',
  'IC-005181',
  'IC-002658',
  'IC-002952',
  'IC-002951',
  'IC-000419',
  'IC-003037',
  'IC-002521',
  'IC-003601',
  'IC-004513',
  'IC-002520',
  'IC-003764',
  'IC-002417',
  'IC-003385',
  'IC-004746',
  'IC-004747',
  'IC-004748',
  'IC-003427',
  'IC-001779',
  'IC-002530',
  'IC-003223',
  'IC-004500',
  'IC-003471',
  'IC-002978',
  'IC-005514',
  'IC-001707',
  'IC-004912',
  'IC-004460',
  'IC-003110',
  'IC-003553',
  'IC-004568',
  'IC-002750',
  'IC-005533',
  'IC-002843',
  'IC-001679',
  'IC-001678',
  'IC-002329',
  'IC-005534',
  'IC-003368'
);

COMMIT;