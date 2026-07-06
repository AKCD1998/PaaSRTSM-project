-- batch67_taxonomy_classify.sql
-- Batch 67: เออบาท๊อป 25 กรัม → ไอ คิดส์ ป๊อปส์ ฮันนี่เอลเดอร์เบอร์รี่
-- 99 SKUs: antiseptic(28) cosmeceutical(22) device(21) supplement(17) other(7) drug(4)
-- NOTE: 630010251 สเปรย์พระยาแรด — intentional skip, keep NULL

BEGIN;

-- drug (4): Antacil antacid x2, Air-X simethicone anti-gas x2
UPDATE public.skus SET
  product_type = 'drug',
  taxonomy_note = 'ยาบรรเทาอาการทางระบบทางเดินอาหาร จัดเป็นยาตามพ.ร.บ.ยา 2510'
WHERE company_code IN (
  'IC-005345',
  'IC-005590',
  'IC-003345',
  'IC-000023'
);

-- antiseptic (28): isopropyl/ethyl alcohol products — gels, sprays, pads, hand sanitizers
UPDATE public.skus SET
  product_type = 'antiseptic',
  taxonomy_note = 'ผลิตภัณฑ์แอลกอฮอล์ฆ่าเชื้อ/ทำความสะอาด จัดเป็นวัตถุอันตรายชนิดที่ 1 ตามพ.ร.บ.วัตถุอันตราย 2535'
WHERE company_code IN (
  'IC-002849',
  'IC-000104',
  'IC-002553',
  'IC-000047',
  'IC-003426',
  'IC-001440',
  'IC-003182',
  'IC-000042',
  'IC-000169',
  'IC-000455',
  'IC-000270',
  'IC-005114',
  'IC-003627',
  'IC-003228',
  'IC-003711',
  'IC-003073',
  'IC-001834',
  'IC-003982',
  'IC-004695',
  'IC-002866',
  'IC-003410',
  'IC-005468',
  'IC-003661',
  'IC-004696',
  'IC-002306',
  'IC-001758',
  'IC-001451',
  'IC-001268'
);

-- supplement (17): ActacEasy, ACV x2, L-Glutamine, As-C vitamin C, Astaxanthin, Ococberry, Ocean Gold omega, Obimin prenatal, iKids Pops/Pobs x8
UPDATE public.skus SET
  product_type = 'supplement',
  taxonomy_note = 'ผลิตภัณฑ์เสริมอาหาร ขึ้นทะเบียนภายใต้พ.ร.บ.อาหาร 2522'
WHERE company_code IN (
  'IC-001454',
  'IC-004456',
  'IC-005610',
  'IC-003425',
  'IC-003517',
  'IC-005471',
  'IC-003452',
  'IC-000430',
  'IC-000928',
  'IC-004665',
  'IC-004672',
  'IC-004813',
  'IC-004812',
  'IC-003112',
  'IC-003094',
  'IC-003055',
  'IC-003056'
);

-- cosmeceutical (22): Eubatopp urea cream series, Outeum shampoo, Active anti-hairloss, Acne-Aid/Acne Clear full line, Abhai dark-spot serum, Algy+ cracked-heel series
UPDATE public.skus SET
  product_type = 'cosmeceutical',
  taxonomy_note = 'ผลิตภัณฑ์ cosmeceutical มีส่วนผสมออกฤทธิ์ดูแลผิว/เส้นผม จัดเป็นเครื่องสำอางตามพ.ร.บ.เครื่องสำอาง 2558'
WHERE company_code IN (
  'IC-005030',
  'IC-000537',
  'IC-004055',
  'IC-005600',
  'IC-005480',
  'IC-005469',
  'IC-005415',
  'IC-002856',
  'IC-002590',
  'IC-000536',
  'IC-004769',
  'IC-002857',
  'IC-002535',
  'IC-004768',
  'IC-004320',
  'IC-002534',
  'IC-002493',
  'IC-000364',
  'IC-003318',
  'IC-000181',
  'IC-002699',
  'IC-003418'
);

-- other (7): Olein vegetable oil x3, Ovaltine malt drink x4
UPDATE public.skus SET
  product_type = 'other',
  taxonomy_note = 'สินค้าทั่วไป (อาหาร/เครื่องดื่ม) ไม่ใช่ผลิตภัณฑ์สุขภาพที่ต้องขึ้นทะเบียน',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-001432',
  'IC-001430',
  'IC-001431',
  'IC-000849',
  'IC-002439',
  'IC-000855',
  'IC-001482'
);

-- device (21): AoSept lens solution, Accu-Chek glucometer, Actimove braces (wrist x2 + ankle x7), Activon silicone scar x6, adult diapers x3, tampons
UPDATE public.skus SET
  product_type = 'device',
  taxonomy_note = 'เครื่องมือแพทย์ตามพ.ร.บ.เครื่องมือแพทย์ 2562',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-005156',
  'IC-002885',
  'IC-002789',
  'IC-002788',
  'IC-004394',
  'IC-004393',
  'IC-004431',
  'IC-001732',
  'IC-001731',
  'IC-001730',
  'IC-001733',
  'IC-003713',
  'IC-004138',
  'IC-002503',
  'IC-004449',
  'IC-005475',
  'IC-000535',
  'IC-005530',
  'IC-005529',
  'IC-005531',
  'IC-000584'
);

COMMIT;