-- batch68_taxonomy_classify.sql
-- Batch 68 (FINAL): ไอคิดส์ เมาท์สเปรย์ → เสื้อยืด โป๊ยเซียน
-- 45 SKUs: other(11) antiseptic(8) cosmeceutical(8) supplement(7) device(5) cosmetic(3) drug(3)
-- NOTE: 630010251 สเปรย์พระยาแรด — intentional skip, keep NULL

BEGIN;

-- drug (3): Hashi nasal saline drops/spray (registered isotonic saline nasal drug)
UPDATE public.skus SET
  product_type = 'drug',
  taxonomy_note = 'น้ำเกลือหยดจมูก/สเปรย์พ่นจมูก (Isotonic NaCl) จัดเป็นยาตามพ.ร.บ.ยา 2510'
WHERE company_code IN (
  'IC-004661',
  'IC-004805',
  'IC-004662'
);

-- antiseptic (8): Hortha organic mouthwash, Health Hand spray, Prong hand cleaning solutions x4, Haiter bleach x2
UPDATE public.skus SET
  product_type = 'antiseptic',
  taxonomy_note = 'ผลิตภัณฑ์ฆ่าเชื้อ/ทำความสะอาด จัดเป็นวัตถุอันตรายชนิดที่ 1 ตามพ.ร.บ.วัตถุอันตราย 2535'
WHERE company_code IN (
  'IC-002387',
  'IC-002122',
  'IC-002556',
  'IC-002557',
  'IC-002552',
  'IC-002551',
  'IC-002780',
  'IC-002121'
);

-- supplement (7): iKids mouth spray, II Care iodine x2, Himmed zinc, Hemovit ginseng, Herbasid, Caltrate chewable calcium
UPDATE public.skus SET
  product_type = 'supplement',
  taxonomy_note = 'ผลิตภัณฑ์เสริมอาหาร ขึ้นทะเบียนภายใต้พ.ร.บ.อาหาร 2522'
WHERE company_code IN (
  'IC-005384',
  'IC-004457',
  'IC-004985',
  'IC-002093',
  'IC-004241',
  'IC-004029',
  'IC-001809'
);

-- cosmeceutical (8): Himalaya moisturizing cream, Heera SPF30+ sunscreen, Hiruscar Ultra scar gel, Herbaseutic CBD calming lotion x3 + UV lotion x2
UPDATE public.skus SET
  product_type = 'cosmeceutical',
  taxonomy_note = 'ผลิตภัณฑ์ cosmeceutical มีส่วนผสมออกฤทธิ์ดูแลผิว จัดเป็นเครื่องสำอางตามพ.ร.บ.เครื่องสำอาง 2558'
WHERE company_code IN (
  'IC-000190',
  'IC-001873',
  'IC-005257',
  'IC-004211',
  'IC-004210',
  'IC-004209',
  'IC-004212',
  'IC-004213'
);

-- cosmetic (3): Snake brand herbal body sprays (nighttime, rescue, extra fresh)
UPDATE public.skus SET
  product_type = 'cosmetic',
  taxonomy_note = 'สเปรย์บำรุงร่างกายสูตรสมุนไพร จัดเป็นเครื่องสำอางตามพ.ร.บ.เครื่องสำอาง 2558'
WHERE company_code IN (
  'IC-002722',
  'IC-002721',
  'IC-002724'
);

-- other (11): Haze Blue Boy syrup x3, liquor/beer x4, clothing items x3, Lactasoy soy milk
UPDATE public.skus SET
  product_type = 'other',
  taxonomy_note = 'สินค้าทั่วไป (อาหาร/เครื่องดื่ม/เครื่องแต่งกาย) ไม่ใช่ผลิตภัณฑ์สุขภาพ',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-000834',
  'IC-003999',
  'IC-000833',
  'IC-000964',
  'IC-001441',
  'IC-000893',
  'IC-000960',
  'IC-002799',
  'IC-002864',
  'IC-002800',
  'IC-000856'
);

-- device (5): blood lancets, medical gloves, glass syringe, empty capsule shells x2
UPDATE public.skus SET
  product_type = 'device',
  taxonomy_note = 'เครื่องมือแพทย์/อุปกรณ์เภสัชกรรมตามพ.ร.บ.เครื่องมือแพทย์ 2562',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-003693',
  'IC-003984',
  'IC-003624',
  'IC-001083',
  'IC-001084'
);

COMMIT;