# Workbook Taxonomy Reconciliation Report

## Scope

- Workbook taxonomy source: `c:\Users\scgro\OneDrive\Documents\กรอกข้อมูล 001 15-12-2025 ลงข้อมูล 2_.xlsx`
- Workbook sheet: `001 PRINT`
- Live dataset source used for this run: `c:\Users\scgro\OneDrive\Documents\rpt_sql_allmpdtentryexceldataonly.xls`
- Live dataset detected format: `grouped_product_report`
- Live dataset sheet: `Sheet1`

## Backend Source Check

- Render/Postgres `taxonomy_map` rows: 2957
- Render/Postgres `products` rows: 0
- Render/Postgres `branch_stock_snapshots` rows: 0
- Backend source status: ok

The configured backend could not be used as the authoritative live branch-stock dataset for this run because `products` and `branch_stock_snapshots` are empty. This report therefore uses the local live export file above instead of claiming a DB-backed full match.

## Summary

- Total live rows examined: 6513
- Unique live product codes: 6468
- Duplicate live product-code groups: 45
- Live rows participating in duplicate live product-code groups: 90
- Total workbook rows examined: 2957
- Unique workbook column C codes: 2957
- Duplicate workbook column C groups: 0
- Workbook rows participating in duplicate column C groups: 0
- Exact column C code matches: 2936
- Exact barcode matches: 1
- Normalized-name-only matches: 0
- Unmatched live rows: 3427
- Unmatched workbook rows: 21
- Conflict / duplicate rows: 187

The live export contained 45 extra rows beyond the unique code count because the source export repeats some product codes. Those rows are listed as conflicts instead of being auto-matched.

## Matching Rules Applied

- Ignored workbook column B completely.
- Treated workbook column C as the only workbook product code field.
- Used barcode only as a secondary exact match when the barcode is not a dummy `99999...`.
- Used normalized Thai name only as an audit fallback.
- Performed no IC-to-630 or 630-to-IC conversion.

## Commands Used

```powershell
npm run taxonomy:reconcile -- --workbook-file "c:\Users\scgro\OneDrive\Documents\กรอกข้อมูล 001 15-12-2025 ลงข้อมูล 2_.xlsx" --workbook-sheet "001 PRINT" --live-file "c:\Users\scgro\OneDrive\Documents\rpt_sql_allmpdtentryexceldataonly.xls" --report-file "c:\Users\scgro\Desktop\Webapp training project\SC-StockDay-Ordering\docs\taxonomy-match-report-2026-05-29.md" --json-file "c:\Users\scgro\Desktop\Webapp training project\SC-StockDay-Ordering\docs\taxonomy-match-report-2026-05-29.json"
```

## Conflict Breakdown

| Conflict Type | Rows |
| --- | --- |
| duplicate_live_code | 90 |
| duplicate_live_name | 97 |

## Examples: Exact Code Matches

| Live Code | Workbook C Code | Live Name | Workbook Name | Workbook Label |
| --- | --- | --- | --- | --- |
| 630010003 | 630010003 | สามัญ ฮีรูสการ์โพสแอคเน่ 5 กรัม | สามัญ ฮีรูสการ์โพสแอคเน่ 5 กรัม | ลบรอย |
| 630010004 | 630010004 | สามัญ ฮีรูสการ์ 7 กรัม | สามัญ ฮีรูสการ์ 7 กรัม | ลบรอย |
| 630010005 | 630010005 | สามัญ กระเทียมเมกกะ 100 แคปซูล | สามัญ กระเทียมเมกกะ 100 แคปซูล | สมุนไพร |
| 630010011 | 630010011 | สามัญ สำลีก้อนรถพยาบาล 40 กรัม | สามัญ สำลีก้อนรถพยาบาล 40 กรัม | สำลี |
| 630010013 | 630010013 | สามัญ สำลีก้อนนางพยาบาล 10 กรัม | สามัญ สำลีก้อนนางพยาบาล 10 กรัม | สำลี |
| 630010015 | 630010015 | สามัญ สำลีแผ่นรถพยาบาล 50 กรัม | สามัญ สำลีแผ่นรถพยาบาล 50 กรัม | สำลี |
| 630010016 | 630010016 | สามัญ สำลีซอง นางพยาบาล 5 กรัม | สามัญ สำลีซอง นางพยาบาล 5 กรัม | สำลี |
| 630010018 | 630010018 | สามัญ สบู่ยาอาเซฟโซ่แดง 80 กรัม | สามัญ สบู่ยาอาเซฟโซ่แดง 80 กรัม | เวชสำอางค์ |
| 630010020 | 630010020 | สามัญ สบู่แบนเนทวิตามิน อี 130 กรัม | สามัญ สบู่แบนเนทวิตามิน อี 130 กรัม | เวชสำอางค์ |
| 630010021 | 630010021 | สามัญ สบู่แบนเนทว่านหางจระเข้ 130 กรัม | สามัญ สบู่แบนเนทว่านหางจระเข้ 130 กรัม | เวชสำอางค์ |
| 630010023 | 630010023 | สามัญ สบู่เบนเนท วิตามินอี ส้ม 130 กรัม | สามัญ สบู่เบนเนท วิตามินอี ส้ม 130 กรัม | เวชสำอางค์ |
| 630010024 | 630010024 | สามัญ สกาเจล คิดส์ 9 กรัม | สามัญ สกาเจล คิดส์ 9 กรัม | ลบรอย |
| 630010025 | 630010025 | สามัญ สกาเจล 9 กรัม | สามัญ สกาเจล 9 กรัม | ลบรอย |
| 630010026 | 630010026 | สามัญ สกาเจล 4 กรัม | สามัญ สกาเจล 4 กรัม | ลบรอย |
| 630010028 | 630010028 | สามัญ ไฮซี 100 มก 4 เม็ด | สามัญ ไฮซี 100 มก 4 เม็ด | วิตามิน |
| 630010029 | 630010029 | สามัญ เมดเมเกอร์ ปิโตรเลียม เจลลี่ 50 กรัม | สามัญ เมดเมเกอร์ ปิโตรเลียม เจลลี่ 50 กรัม | เวชสำอางค์ |
| 630010032 | 630010032 | สามัญ ลูกยางเบอร์ 1 30 มล | สามัญ ลูกยางเบอร์ 1 30 มล | อุปกรณ์ |
| 630010033 | 630010033 | สามัญ ลิปแคร์เภสัชกร 2 กรัม | สามัญ ลิปแคร์เภสัชกร 2 กรัม | เวชสำอางค์ |
| 630010038 | 630010038 | สามัญ ยาอมสเตร็ปซิลออริจินัล เอช เอช อาร์ 8 เม็ด | สามัญ ยาอมสเตร็ปซิลออริจินัล เอช เอช อาร์ 8 เม็ด | ลูกอม |
| 630010039 | 630010039 | สามัญ ยาอมสเตร็ปซิลซิตรัส 6 เม็ด | สามัญ ยาอมสเตร็ปซิลซิตรัส 6 เม็ด | ลูกอม |

## Examples: Barcode Matches

| Live Code | Barcode | Workbook C Code | Live Name | Workbook Name |
| --- | --- | --- | --- | --- |
| IC-004442 | 4975479498039 | IC-004977 | สามัญ ออมรอน ปรอทวัดไข้ดิจิตอล รุ่น MC-341 1 ชิ้น | สามัญ ออมรอนปรอทวัดไข้ดิจิตอล รุ่น MC-341 1 ชิ้น |

## Examples: Unmatched Live Rows

| Live Code | Barcode | Live Name | Live Row |
| --- | --- | --- | --- |
| 630010001 | 8851743003658 | สามัญ ฮีรูสการ์ซิลิโคนโปร 4 กรัม | 6 |
| 630010002 | 8851743003665 | สามัญ ฮีรูสการ์ซิลิโคนโปร 10 กรัม | 10 |
| 630010006 | 8858755200570 | สามัญอาหารเสริมไฟเบอร์เบอร์น่า (ส้ม) 10 ซอง | 22 |
| 630010007 | 8858755200587 | สามัญอาหารเสริมไฟเบอร์เบอร์น่า (เลม่อน) 10 ซอง | 25 |
| 630010008 | 8850185000119 | สามัญ สำลีม้วนเล็กรถพยาบาล 25 กรัม | 28 |
| 630010009 | 8857123748034 | สามัญสำลีม้วนใหญ่นางพยาบาล 120 กรัม | 32 |
| 630010010 | 8857123748065 | สามัญสำลีก้านนางพยาบาล 100 ก้าน | 35 |
| 630010012 | 8857123748409 | สามัญ สำลีก้อนนางพยาบาล 40 กรัม | 42 |
| 630010014 | 8850185000041 | สามัญ สำลีแผ่นรีดข้างรถพยาบาล 50 กรัม | 49 |
| 630010017 | 8857123748300 | สามัญสำลีแผ่นนางพยาบาล 40 กรัม | 61 |
| 630010019 | 8850784994710 | สามัญ สบู่แบนเนทอโรม่า 160 กรัม | 69 |
| 630010022 | 8850784994734 | สามัญ สบู่แบนเนทขมิ้น 130 กรัม | 81 |
| 630010027 | 8851847000164 | สามัญวิตามินบำรุงเฮโมวิต-วัน 31 แคปซูล | 99 |
| 630010030 | 8854536000360 | สามัญลูกยางดูดน้ำมูก หัวยาง น้ำเงิน 1 ชิ้น | 112 |
| 630010031 | 8854536000391 | สามัญ ลูกยางดูดน้ำมูก หัวพลาสติก แดง 1 ชิ้น | 116 |
| 630010034 | 8858658900232 | สามัญลบรอยแผลเป็นสการ์เอสทิค 10 ก. | 128 |
| 630010035 | 8850884007037 | สามัญ ยูเรียครีมเอ็มซอฟต์ 50 กรัม | 131 |
| 630010036 | 8850884007013 | สามัญ ยูเรียครีมเอ็มซอฟต์ 20 กรัม | 135 |
| 630010041 | 9999900000429 | สามัญ ยาอมรวมรสอ้วยอันโอสถ 100 เม็ด | 151 |
| 630010045 | 8852913120113 | สามัญ ยาอมมะขามป้อมอ้วยอันโอสถ 100 เม็ด | 163 |

## Examples: Unmatched Workbook Rows

| Workbook C Code | Barcode | Workbook Name | Workbook Label | Workbook Row |
| --- | --- | --- | --- | --- |
| IC-002335 | 9999900074246 | เภสัช ไวโรกอน 400 มก 10 เม็ด | 1ยาฆ่าเชื้อไวรัส | 20 |
| IC-002562 | 9999900076820 | เภสัช ไวโรกอน 800 มก 5 เม็ด | 1ยาฆ่าเชื้อไวรัส | 21 |
| IC-003351 | 8019561230018 | เภสัช อาร์โทรฟอร์ท คอมเพล็กซ์ 30 ซอง | 6ยาเสริมน้ำข้อเข่า | 710 |
| IC-003727 | 840164515756 | เภสัช รีเมอรอน โซลแทป 15 มก 30 เม็ด | 7ยาจิตเวช | 780 |
| IC-004469 | 9999900102161 | เภสัช อ๊อกซิทีน 20 มก 10 เม็ด | 7ยาจิตเวช | 781 |
| IC-002930 | 9999900082333 | เภสัช สยามฟอร์เมท 850 มก 10 เม็ด | 8ยาเบาหวาน | 850 |
| IC-003716 | 8850285134011 | เภสัช จานูเวีย 100 มก 28 เม็ด | 8ยาเบาหวาน | 854 |
| IC-003733 | 8852364009852 | เภสัช กัลวัสเม็ท 50/1000 มก 60 เม็ด | 8ยาเบาหวาน | 855 |
| IC-003734 | 9317935680148 | เภสัช จานูเมท 50/1000 มก 56 เม็ด | 8ยาเบาหวาน | 856 |
| IC-002358 | 9999900074598 | เภสัช ซิมเม็กซ์ 10 มก 10 เม็ด | 8ยาลดไขมัน | 889 |
| IC-002364 | 9999900074659 | เภสัช ซิมเม็กซ์ 20 มก 10 เม็ด | 8ยาลดไขมัน | 890 |
| IC-002881 | 9999900079746 | เภสัช ซิมเม็กซ์ 40 มก. 10 เม็ด | 8ยาลดไขมัน | 894 |
| IC-003736 | 8859774100223 | ปกติ แผ่นแปะนีโอบัน 10 แผ่น | แผ่นแปะ | 1405 |
| IC-004609 | 9999900102635 | ปกติ ไดแอสเจสท์ 10 เม็ด | ยาช่วยย่อย | 1607 |
| 630010160 | 8850921010655 | สามัญ พาราแคพ 500 มก 10 เม็ด | ยาลดไข้ | 1889 |
| 630010140 | 8851473006233 | สามัญ ซาร่า 500 มก เม็ดยาว 10 เม็ด | ลดไข้ | 1969 |
| IC-003365 | 8852027349752 | ปกติ เฟลมเม็กซ์ 10 เม็ด | ละลายเสมหะ | 2068 |
| IC-003626 | 8850886103263 | ปกติ ไบโซลวอน 8 มก 10 เม็ด | ละลายเสมหะ | 2070 |
| IC-003836 | 8850886103287 | ปกติ มิวโคโซลวาน 30 มก 10 เม็ด | ละลายเสมหะ | 2072 |
| IC-003784 | 8850886077274 | ปกติ เอสเซนเซียลฟอร์ต 300 มก 10 เม็ด | วิตามิน | 2275 |

## Examples: Conflict / Duplicate Rows

| Type | Value | Product Code | Barcode | Name | Row | Details |
| --- | --- | --- | --- | --- | --- | --- |
| duplicate_live_code | IC-000997 | IC-000997 |  | วัสดุ ถาดสีทอง สังฑทาน | 8207 | 2 rows share live_product_code=IC-000997 |
| duplicate_live_code | IC-000997 | IC-000997 | 9999900125801 | ชิ้น | 8208 | 2 rows share live_product_code=IC-000997 |
| duplicate_live_code | IC-000998 | IC-000998 |  | วัสดุ ถุงสีทอง สังฑทาน | 8212 | 2 rows share live_product_code=IC-000998 |
| duplicate_live_code | IC-000998 | IC-000998 | 9999900125832 | ชิ้น | 8213 | 2 rows share live_product_code=IC-000998 |
| duplicate_live_code | IC-000999 | IC-000999 |  | วัสดุ ริบบินสีทอง สังฑทาน | 8217 | 2 rows share live_product_code=IC-000999 |
| duplicate_live_code | IC-000999 | IC-000999 | 9999900125863 | ชิ้น | 8218 | 2 rows share live_product_code=IC-000999 |
| duplicate_live_code | IC-001069 | IC-001069 |  | วัสดุ หัวตู้กระจก บอยเลอร์ BMT01 | 8561 | 2 rows share live_product_code=IC-001069 |
| duplicate_live_code | IC-001069 | IC-001069 | 9999900127263 | ชิ้น | 8562 | 2 rows share live_product_code=IC-001069 |
| duplicate_live_code | IC-001165 | IC-001165 |  | วัสดุแอร์ติดผนัง MITSUBISHI รุ่น MUY / MSY-KS13VF | 9036 | 2 rows share live_product_code=IC-001165 |
| duplicate_live_code | IC-001165 | IC-001165 | 9999900129281 | ชิ้น | 9037 | 2 rows share live_product_code=IC-001165 |
| duplicate_live_code | IC-001174 | IC-001174 |  | วัสดุถุงซิปใส 5x7 นิ้ว 1 กก. | 9081 | 2 rows share live_product_code=IC-001174 |
| duplicate_live_code | IC-001174 | IC-001174 | 9999900129557 | แพค | 9082 | 2 rows share live_product_code=IC-001174 |
| duplicate_live_code | IC-001181 | IC-001181 |  | วัสดุเสื้อยืดเบียร์ช้าง | 9116 | 2 rows share live_product_code=IC-001181 |
| duplicate_live_code | IC-001181 | IC-001181 | 9999900129762 | ชิ้น | 9117 | 2 rows share live_product_code=IC-001181 |
| duplicate_live_code | IC-001183 | IC-001183 |  | สามัญยาถ่ายพยาธิตัวกลม 100 มก. 6 เม็ด | 9126 | 2 rows share live_product_code=IC-001183 |
| duplicate_live_code | IC-001183 | IC-001183 |  | กล่อง | 9127 | 2 rows share live_product_code=IC-001183 |
| duplicate_live_code | IC-001185 | IC-001185 |  | สามัญยาใส่แผลโพวาดีน 30 มล. | 9134 | 2 rows share live_product_code=IC-001185 |
| duplicate_live_code | IC-001185 | IC-001185 | 9999900129847 | ขวด | 9135 | 2 rows share live_product_code=IC-001185 |
| duplicate_live_code | IC-001293 | IC-001293 |  | วัสดุกระดาษ A4 ไอเดียแม็กซ์ 70 แกรม 500 แผ่น | 9667 | 2 rows share live_product_code=IC-001293 |
| duplicate_live_code | IC-001293 | IC-001293 | 9999900132625 | แพค | 9668 | 2 rows share live_product_code=IC-001293 |

## Recommendation

- The configured backend source was not usable for this run, so this comparison used a file-backed live export. Do not treat the counts as Render/Postgres-backed production truth until `products` or `branch_stock_snapshots` are populated.
- Use workbook column C as the only code key. In this run, exact code matching produced 2936 matches against 6513 live rows from `grouped_product_report`.
- Keep barcode matching secondary and gated behind conflict review. There are 187 conflict rows, so any barcode or name fallback should be excluded from automatic writes when the workbook code or live code is duplicated.
- Treat normalized Thai name matches as audit-only suggestions. They are useful for queueing manual review, not for automatic category writes.
- Do not add IC-to-630 or 630-to-IC translation logic. Native code identity should remain exact-string based.
