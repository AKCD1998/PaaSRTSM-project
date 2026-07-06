-- batch65_taxonomy_classify.sql
-- Batch 65: ออซ พี สติ๊กเกอร์หัวหอมกระชาย → อุปกรณ์พยุงหลังยูเอ็ม A-03 L
-- 99 SKUs: device(57) supplement(23) drug(7) cosmeceutical(6) other(5) cosmetic(1)
-- NOTE: 630010251 สเปรย์พระยาแรด — intentional skip, keep NULL

BEGIN;

-- drug (7): Apache throat syrup/lozenge, Amocin OTC tab, Emorlon hemorrhoid x2, Uthaitip Thai traditional x2
UPDATE public.skus SET
  product_type = 'drug',
  taxonomy_note = 'ยาทาภายนอก/ยาระงับอาการ จัดเป็นยาตามพ.ร.บ.ยา 2510'
WHERE company_code IN (
  '630020108',
  'IC-002816',
  'IC-004881',
  'IC-004097',
  'IC-004096',
  'IC-003880',
  'IC-002275'
);

-- supplement (23): eye supplements, elderberry spray, Aminoleban, albumin, dialysis patient foods, Blackmores/Vistra/ginseng series, Ensure, Bacopa, Interfarm, ImmuplexX, Amocin Effe
UPDATE public.skus SET
  product_type = 'supplement',
  taxonomy_note = 'ผลิตภัณฑ์เสริมอาหาร ขึ้นทะเบียนภายใต้พ.ร.บ.อาหาร 2522'
WHERE company_code IN (
  'IC-000514',
  'IC-004860',
  'IC-005246',
  'IC-003317',
  'IC-001356',
  'IC-003348',
  'IC-002099',
  'IC-002100',
  'IC-000114',
  'IC-000131',
  'IC-001863',
  'IC-000112',
  'IC-000123',
  'IC-000113',
  'IC-000116',
  'IC-000374',
  'IC-000985',
  'IC-003994',
  'IC-003768',
  'IC-003831',
  'IC-004708',
  'IC-005350',
  'IC-005328'
);

-- cosmeceutical (6): Oilatum baby bath, Aveeno body lotion, Eezerra cream/cleanser series
UPDATE public.skus SET
  product_type = 'cosmeceutical',
  taxonomy_note = 'ผลิตภัณฑ์ cosmeceutical มีส่วนผสมออกฤทธิ์บำรุงผิว จัดเป็นเครื่องสำอางตามพ.ร.บ.เครื่องสำอาง 2558'
WHERE company_code IN (
  'IC-003267',
  'IC-002835',
  'IC-000073',
  'IC-004652',
  'IC-003201',
  'IC-003202'
);

-- cosmetic (1): Oreda R.O. hair colorant
UPDATE public.skus SET
  product_type = 'cosmetic',
  taxonomy_note = 'ผลิตภัณฑ์ระบายสีผม จัดเป็นเครื่องสำอางตามพ.ร.บ.เครื่องสำอาง 2558'
WHERE company_code IN (
  'IC-004371'
);

-- other (5): folk remedy sticker, instant coffee, Equal sweeteners
UPDATE public.skus SET
  product_type = 'other',
  taxonomy_note = 'สินค้าทั่วไป (อาหาร/เครื่องดื่ม/ผลิตภัณฑ์พื้นบ้าน) ไม่ใช่ผลิตภัณฑ์สุขภาพที่ต้องขึ้นทะเบียน',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-005516',
  'IC-004123',
  'IC-001124',
  'IC-001123',
  'IC-001125'
);

-- device (57): OpSite dressings, Omron thermometers, test kits, medical equipment spare parts, Allevyn foam, IntraSite gel, ElastoFix tape, medical forceps, walking aids, hot/cold packs, wrist/knee/arm/neck/back/finger supports and braces
UPDATE public.skus SET
  product_type = 'device',
  taxonomy_note = 'เครื่องมือแพทย์ตามพ.ร.บ.เครื่องมือแพทย์ 2562',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-004565',
  'IC-003147',
  'IC-000319',
  'IC-000318',
  'IC-004442',
  'IC-001603',
  'IC-004977',
  'IC-005094',
  'IC-004593',
  'IC-003604',
  'IC-004436',
  'IC-004567',
  'IC-003807',
  'IC-004121',
  'IC-003621',
  'IC-004929',
  'IC-005223',
  'IC-004120',
  'IC-003793',
  'IC-000330',
  'IC-005095',
  'IC-003336',
  'IC-004304',
  'IC-003669',
  'IC-003114',
  'IC-005495',
  'IC-003308',
  'IC-000822',
  'IC-003676',
  'IC-003780',
  'IC-004750',
  'IC-001740',
  'IC-002433',
  'IC-003286',
  'IC-003285',
  'IC-000457',
  'IC-000458',
  'IC-003924',
  'IC-003923',
  'IC-003922',
  'IC-003732',
  'IC-003893',
  'IC-005264',
  'IC-003892',
  'IC-004171',
  'IC-004170',
  'IC-004921',
  'IC-004920',
  'IC-003889',
  'IC-003888',
  'IC-003887',
  'IC-004146',
  'IC-004501',
  'IC-003890',
  'IC-003891',
  'IC-004916',
  'IC-005086'
);

COMMIT;