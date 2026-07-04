-- Taxonomy Batch 54 — 2026-07-04
-- display_name range: สามัญแผ่นยางปูกันเปื้อน H-DS03 → สามัญ พลาสเตอร์ใสปิดแผลกันน้ำ เอสโอเอส พลัส รุ่น ที ซีรีส์ T 2x2 3 ชิ้น
-- SKUs classified: 100 | skipped (UNCERTAIN): 0

BEGIN;

UPDATE public.skus SET
  product_type      = 'device',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'รายการนี้เป็นเครื่องมือแพทย์หรืออุปกรณ์การแพทย์ เช่น แผ่นรองซับ แผ่นรองเท้า แผ่นประคบ ชุดตรวจ เฝือก อุปกรณ์พยุง และพลาสเตอร์/วัสดุปิดแผล จัดเป็น device ภายใต้ พ.ร.บ.เครื่องมือแพทย์ พ.ศ. 2562'
WHERE company_code IN (
  'IC-001067','IC-001415','IC-003788','IC-001887','IC-004487',
  'IC-004488','IC-003466','IC-003464','IC-003465','IC-003467',
  'IC-003462','IC-003461','IC-003463','IC-002376','IC-001888',
  'IC-004088','IC-005524','IC-005296','IC-000887','IC-001318',
  'IC-004313','IC-004182','IC-004925','IC-004924','IC-002640',
  'IC-004196','IC-004195','IC-004438','IC-002639','IC-000800',
  'IC-000799','IC-000798','IC-000801','IC-004630','IC-001710',
  'IC-000526','IC-000098','IC-000530','IC-000525','IC-000060',
  'IC-003644','IC-002120','IC-004165','IC-004164','IC-000528',
  'IC-000527','IC-005210','IC-000522','IC-000078','IC-000077',
  'IC-000529','IC-001672','IC-002811','IC-003439','IC-001079',
  'IC-000062','IC-000521','IC-001203','IC-001204','IC-001709',
  'IC-005571','IC-002739','IC-000061','IC-005109','IC-004095',
  'IC-004742','IC-004132'
);

UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'แผลเซพทิลเป็นน้ำยาฆ่าเชื้อสำหรับผิวหนังและแผล จัดเป็น antiseptic ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-002743';

UPDATE public.skus SET
  product_type  = 'antiseptic',
  taxonomy_note = 'เพียวริดีนเป็นน้ำยาฆ่าเชื้อ povidone-iodine สำหรับผิวหนังและแผล จัดเป็น antiseptic ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code = 'IC-000636';

UPDATE public.skus SET
  product_type  = 'cosmetic',
  taxonomy_note = 'รายการนี้เป็นเครื่องสำอางหรือเวชสำอาง เช่น แชมพู ครีมบำรุงผิว โฟมล้างหน้า กันแดด สการ์เจล และผลิตภัณฑ์ทำความสะอาดผิว จัดเป็น cosmetic ภายใต้ พ.ร.บ.เครื่องสำอาง พ.ศ. 2558'
WHERE company_code IN (
  'IC-004126','IC-001227','IC-002566','IC-002374','IC-002372',
  'IC-002559','IC-002373','IC-001404','IC-001403','IC-005455',
  'IC-005456','IC-003219','IC-003404','IC-000468','IC-005441'
);

UPDATE public.skus SET
  product_type  = 'supplement',
  taxonomy_note = 'รายการนี้เป็นผลิตภัณฑ์เสริมอาหารหรืออาหารทางการแพทย์ เช่น พรีไฟโต้ น้ำมันเมล็ดฟักทอง และแพนเอ็นเทอราล จัดเป็น supplement ภายใต้ พ.ร.บ.อาหาร พ.ศ. 2522'
WHERE company_code IN ('IC-003632','IC-004847','IC-005241');

UPDATE public.skus SET
  product_type  = 'drug',
  taxonomy_note = 'รายการนี้เป็นยาแผนปัจจุบันกลุ่มพาราเซตามอล จัดเป็น drug ภายใต้ พ.ร.บ.ยา พ.ศ. 2510'
WHERE company_code IN ('IC-003216','IC-004067','IC-004238');

UPDATE public.skus SET
  product_type  = 'herb',
  taxonomy_note = 'สเปรย์พ่นคอจากโพรโพลิสและสมุนไพรสำหรับเด็ก ใช้บรรเทาระคายคอและให้ความสดชื่น จัดเป็น herb ภายใต้ พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562'
WHERE company_code IN ('IC-002706','IC-002893');

UPDATE public.skus SET
  product_type      = 'other',
  enrichment_status = 'not_applicable',
  taxonomy_note     = 'รายการนี้เป็นสินค้าอุปโภคทั่วไป เช่น แผ่นหอม แผ่นอนามัย ลูกอม บรรจุภัณฑ์ และเครื่องดื่มพร้อมชง จัดเป็น other'
WHERE company_code IN (
  'IC-004713','IC-004714','IC-004392','IC-003316','IC-005150',
  'IC-001484','IC-002841','IC-002840'
);

COMMIT;
