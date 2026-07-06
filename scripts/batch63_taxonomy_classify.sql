-- batch63_taxonomy_classify.sql
-- Batch 63: สายให้ออกซิเจนทางจมูก เบอร์ S → หน้ากากอนามัยคลีนมาส์ก LF99 สีดำ
-- 99 SKUs: device(80) supplement(12) antiseptic(3) drug(2) other(2)
-- NOTE: 630010251 สเปรย์พระยาแรด — intentional skip, keep NULL

BEGIN;

-- drug (2): eucalyptus oil spray Nokkaew brand (traditional drug)
UPDATE public.skus SET
  product_type = 'drug',
  taxonomy_note = 'น้ำมันยูคาลิปตัสสเปรย์ ตรานกแก้ว จัดเป็นยาสามัญประจำบ้านตามพ.ร.บ.ยา 2510 (ยาแผนโบราณ)'
WHERE company_code IN (
  '630020332',
  '630020331'
);

-- antiseptic (3): alcohol-impregnated cotton
UPDATE public.skus SET
  product_type = 'antiseptic',
  taxonomy_note = 'สำลีชุบแอลกอฮอล์ ใช้ทำความสะอาดและฆ่าเชื้อผิวหนัง จัดเป็นวัตถุอันตรายชนิดที่ 1 ตามพ.ร.บ.วัตถุอันตราย 2535'
WHERE company_code IN (
  'IC-000424',
  'IC-002628',
  'IC-003646'
);

-- supplement (12): ginseng/cordyceps, Royal-D gel, Caliblue, I-Cal calcium, grape seed, 100UP SKN, coconut oil gelatin, royal jelly, omega-3
UPDATE public.skus SET
  product_type = 'supplement',
  taxonomy_note = 'ผลิตภัณฑ์เสริมอาหาร ขึ้นทะเบียนภายใต้พ.ร.บ.อาหาร 2522'
WHERE company_code IN (
  'IC-000056',
  'IC-002619',
  'IC-002620',
  'IC-002172',
  'IC-002173',
  'IC-001857',
  'IC-001856',
  'IC-000307',
  'IC-001799',
  'IC-001504',
  'IC-001516',
  'IC-000092'
);

-- other (2): Singha lemon soda beverages
UPDATE public.skus SET
  product_type = 'other',
  taxonomy_note = 'เครื่องดื่มน้ำอัดลม ไม่ใช่ผลิตภัณฑ์สุขภาพ จัดเป็นสินค้าทั่วไป',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-003299',
  'IC-003300'
);

-- device (80): nasal O2 cannulas, feeding tubes (NG tubes), oxygen tubing, IV pole, plain cotton products, face masks
UPDATE public.skus SET
  product_type = 'device',
  taxonomy_note = 'เครื่องมือแพทย์ตามพ.ร.บ.เครื่องมือแพทย์ 2562',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-001126',
  'IC-001782',
  'IC-001129',
  'IC-001130',
  'IC-003262',
  'IC-003263',
  'IC-003294',
  'IC-004871',
  'IC-004872',
  'IC-005493',
  'IC-005283',
  'IC-004639',
  'IC-003282',
  'IC-003283',
  'IC-003284',
  'IC-003603',
  'IC-002491',
  'IC-003004',
  'IC-002492',
  'IC-004032',
  'IC-002886',
  'IC-004689',
  'IC-004056',
  'IC-003820',
  'IC-004485',
  'IC-003819',
  'IC-003414',
  'IC-000454',
  'IC-002490',
  'IC-001550',
  'IC-003823',
  'IC-003822',
  'IC-003821',
  'IC-001789',
  'IC-003642',
  'IC-003440',
  'IC-001314',
  'IC-003084',
  'IC-003679',
  'IC-000615',
  'IC-002165',
  'IC-002634',
  'IC-003067',
  'IC-000413',
  'IC-000742',
  'IC-000632',
  'IC-001930',
  'IC-001931',
  'IC-002695',
  'IC-002598',
  'IC-002597',
  'IC-002596',
  'IC-003395',
  'IC-001207',
  'IC-001932',
  'IC-003108',
  'IC-004798',
  'IC-000043',
  'IC-000044',
  'IC-003076',
  'IC-003075',
  'IC-004033',
  'IC-002777',
  'IC-002015',
  'IC-002327',
  'IC-003921',
  'IC-001331',
  'IC-004086',
  'IC-000656',
  'IC-003377',
  'IC-003413',
  'IC-003376',
  'IC-004176',
  'IC-003375',
  'IC-001080',
  'IC-002659',
  'IC-000916',
  'IC-004793',
  'IC-004660',
  'IC-004745'
);

COMMIT;