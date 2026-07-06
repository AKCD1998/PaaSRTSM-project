-- batch66_taxonomy_classify.sql
-- Batch 66: อุปกรณ์พยุงหลัง ยูเอ็ม A-03 M → เอสโอเอสพลัส แอคเน่ แพทซ์
-- 99 SKUs: device(57) supplement(28) antiseptic(5) cosmeceutical(6) drug(2) other(1)
-- NOTE: 630010251 สเปรย์พระยาแรด — intentional skip, keep NULL

BEGIN;

-- drug (2): N-Series cool/hot pain relief patches
UPDATE public.skus SET
  product_type = 'drug',
  taxonomy_note = 'แผ่นแปะบรรเทาปวดชนิดสูตรเย็น/ร้อน จัดเป็นยาทาภายนอกตามพ.ร.บ.ยา 2510'
WHERE company_code IN (
  'IC-002987',
  'IC-002825'
);

-- antiseptic (5): Edward hand sanitizer, Siribuncha ethyl alcohol spray, F&C disinfectant, SOS alcohol pads
UPDATE public.skus SET
  product_type = 'antiseptic',
  taxonomy_note = 'ผลิตภัณฑ์ฆ่าเชื้อ/ทำความสะอาด จัดเป็นวัตถุอันตรายชนิดที่ 1 ตามพ.ร.บ.วัตถุอันตราย 2535'
WHERE company_code IN (
  'IC-003803',
  'IC-004415',
  'IC-004426',
  'IC-003740',
  'IC-004455'
);

-- supplement (28): Ensure/Ensure Gold series x17, X-Cess glutathione oral, Excellent C+, Entrasol x2, AB Pre&Pro, elderberry effervescent, S-26 infant/toddler formulas x5
UPDATE public.skus SET
  product_type = 'supplement',
  taxonomy_note = 'ผลิตภัณฑ์เสริมอาหาร/อาหารทางการแพทย์ ขึ้นทะเบียนภายใต้พ.ร.บ.อาหาร 2522'
WHERE company_code IN (
  'IC-005224',
  'IC-000343',
  'IC-000133',
  'IC-000988',
  'IC-001526',
  'IC-001104',
  'IC-000132',
  'IC-003477',
  'IC-003062',
  'IC-003942',
  'IC-003253',
  'IC-003118',
  'IC-003373',
  'IC-004360',
  'IC-004248',
  'IC-003536',
  'IC-005354',
  'IC-004856',
  'IC-003288',
  'IC-003143',
  'IC-005014',
  'IC-002608',
  'IC-003591',
  'IC-004558',
  'IC-004557',
  'IC-004572',
  'IC-004560',
  'IC-004559'
);

-- cosmeceutical (6): X-Cess topical line (glutathione lotion, Clearasoft acne series, Phytocell serum/cleanser)
UPDATE public.skus SET
  product_type = 'cosmeceutical',
  taxonomy_note = 'ผลิตภัณฑ์ cosmeceutical มีส่วนผสมออกฤทธิ์ดูแลผิว จัดเป็นเครื่องสำอางตามพ.ร.บ.เครื่องสำอาง 2558'
WHERE company_code IN (
  'IC-005510',
  'IC-005550',
  'IC-005548',
  'IC-005549',
  'IC-005546',
  'IC-005547'
);

-- other (1): M-150 energy drink with B6/B12 vitamins
UPDATE public.skus SET
  product_type = 'other',
  taxonomy_note = 'เครื่องดื่มชูกำลัง/เครื่องดื่มบำรุงร่างกาย จัดเป็นสินค้าทั่วไป ไม่ใช่ผลิตภัณฑ์สุขภาพที่ต้องขึ้นทะเบียนยา',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-001344'
);

-- device (57): back supports, knee supports, abdominal binders, ACE thermometer, ACM finger braces, SOS medical line (pulse oximeters, thermometers, first aid kit, bandage tapes, saline tubes, gauze, fever patches, nasal strips, heat patches, wound films, plasters, arm slings, surgical masks, acne patches)
UPDATE public.skus SET
  product_type = 'device',
  taxonomy_note = 'เครื่องมือแพทย์ตามพ.ร.บ.เครื่องมือแพทย์ 2562',
  enrichment_status = 'not_applicable'
WHERE company_code IN (
  'IC-005085',
  'IC-005087',
  'IC-005088',
  'IC-003731',
  'IC-003730',
  'IC-003729',
  'IC-005263',
  'IC-005262',
  'IC-002518',
  'IC-002517',
  'IC-002519',
  'IC-004633',
  'IC-004632',
  'IC-004631',
  'IC-004919',
  'IC-004918',
  'IC-005207',
  'IC-004917',
  'IC-004928',
  'IC-002150',
  'IC-001734',
  'IC-001735',
  'IC-001736',
  'IC-001737',
  'IC-002126',
  'IC-002124',
  'IC-002125',
  'IC-004686',
  'IC-001275',
  'IC-004366',
  'IC-003941',
  'IC-005141',
  'IC-005413',
  'IC-004367',
  'IC-005136',
  'IC-004741',
  'IC-004628',
  'IC-004629',
  'IC-004368',
  'IC-005414',
  'IC-005349',
  'IC-004702',
  'IC-004942',
  'IC-004941',
  'IC-004730',
  'IC-005137',
  'IC-005140',
  'IC-005138',
  'IC-005139',
  'IC-004052',
  'IC-005352',
  'IC-005599',
  'IC-005601',
  'IC-002188',
  'IC-002187',
  'IC-002186',
  'IC-002505'
);

COMMIT;