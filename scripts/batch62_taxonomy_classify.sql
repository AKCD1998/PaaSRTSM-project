-- batch62_taxonomy_classify.sql
-- Batch 62: สเปรย์ระงับกลิ่นรองเท้าสกอลล์ → สายให้ออกซิเจนทางจมูกไซส์ XS
-- 99 SKUs: supplement(13) cosmeceutical(44) device(29) antiseptic(6) cosmetic(1) other(6)
-- NOTE: 630010251 สเปรย์พระยาแรด — intentional skip, keep NULL

BEGIN;

-- antiseptic (6): สเปรย์ล้างมือ / hand sanitizer sprays
UPDATE public.skus SET
  product_type = 'antiseptic',
  taxonomy_note = 'สเปรย์ทำความสะอาดและฆ่าเชื้อมือ จัดเป็นวัตถุอันตรายชนิดที่ 1 ตามพ.ร.บ.วัตถุอันตราย 2535 (แอลกอฮอล์ฆ่าเชื้อ)'
WHERE company_code IN (
  'IC-001439',
  'IC-001791',
  'IC-001792',
  'IC-002062',
  'IC-002242',
  'IC-002101'
);

-- cosmetic (1): สเปรย์ระงับกลิ่นรองเท้า
UPDATE public.skus SET
  product_type = 'cosmetic',
  taxonomy_note = 'ผลิตภัณฑ์ระงับกลิ่นรองเท้า ไม่มีส่วนผสมยา จัดเป็นเครื่องสำอางตามพ.ร.บ.เครื่องสำอาง 2558'
WHERE company_code IN (
  'IC-002338'
);

-- other (6): Sprite beverages + Sleep Easy aromatherapy spray
UPDATE public.skus SET
  product_type = 'other',
  taxonomy_note = 'สินค้าทั่วไป ไม่ใช่ผลิตภัณฑ์สุขภาพ (เครื่องดื่มน้ำอัดลม/สเปรย์อโรมาเทอราปี)',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-000028',
  'IC-000030',
  'IC-000784',
  'IC-000772',
  'IC-000779',
  'IC-005043'
);

-- supplement (13): Smooth E oral caps + Spirulina + Slenda + Swisse series + สามก๊กดราฟท์
UPDATE public.skus SET
  product_type = 'supplement',
  taxonomy_note = 'ผลิตภัณฑ์เสริมอาหาร ขึ้นทะเบียนภายใต้พ.ร.บ.อาหาร 2522'
WHERE company_code IN (
  'IC-000254',
  'IC-000186',
  'IC-003260',
  'IC-003453',
  'IC-005255',
  'IC-005261',
  'IC-005339',
  'IC-005481',
  'IC-005340',
  'IC-004777',
  'IC-005594',
  'IC-005260',
  'IC-003360'
);

-- cosmeceutical (44): Smooth E topical line (creams, foams, gels, serums, shampoos, conditioners, cleansers)
UPDATE public.skus SET
  product_type = 'cosmeceutical',
  taxonomy_note = 'ผลิตภัณฑ์ cosmeceutical สมูทอี มีส่วนผสมออกฤทธิ์ทางผิวหนัง/เส้นผม จัดเป็นเครื่องสำอางตามพ.ร.บ.เครื่องสำอาง 2558'
WHERE company_code IN (
  'IC-002133',
  'IC-002134',
  'IC-002135',
  'IC-001848',
  'IC-002153',
  'IC-000730',
  'IC-000728',
  'IC-000729',
  'IC-000727',
  'IC-003449',
  'IC-003125',
  'IC-001819',
  'IC-003450',
  'IC-000653',
  'IC-000726',
  'IC-000725',
  'IC-000654',
  'IC-000948',
  'IC-000949',
  'IC-000950',
  'IC-002668',
  'IC-001846',
  'IC-000187',
  'IC-000807',
  'IC-000766',
  'IC-000748',
  'IC-000808',
  'IC-001820',
  'IC-003123',
  'IC-001803',
  'IC-001818',
  'IC-002591',
  'IC-000329',
  'IC-000723',
  'IC-000724',
  'IC-001821',
  'IC-002758',
  'IC-003124',
  'IC-002646',
  'IC-001316',
  'IC-003054',
  'IC-002248',
  'IC-002245',
  'IC-001817'
);

-- device (29): suction catheters, feeding tube sets, arm slings, wrist brace, tourniquet, Foley catheters, nasal O2 cannulas
UPDATE public.skus SET
  product_type = 'device',
  taxonomy_note = 'เครื่องมือแพทย์ตามพ.ร.บ.เครื่องมือแพทย์ 2562',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-004177',
  'IC-003206',
  'IC-004103',
  'IC-005064',
  'IC-001928',
  'IC-003035',
  'IC-002944',
  'IC-003036',
  'IC-001131',
  'IC-001132',
  'IC-000687',
  'IC-001565',
  'IC-000686',
  'IC-001564',
  'IC-000685',
  'IC-000688',
  'IC-000691',
  'IC-000690',
  'IC-000689',
  'IC-000692',
  'IC-003518',
  'IC-001752',
  'IC-001137',
  'IC-001138',
  'IC-001139',
  'IC-001140',
  'IC-002976',
  'IC-003248',
  'IC-002859'
);

COMMIT;