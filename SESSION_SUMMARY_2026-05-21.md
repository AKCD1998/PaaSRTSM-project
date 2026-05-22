# Session Summary — 2026-05-21

## Scope

Session นี้โฟกัสที่การยืนยันและบังคับใช้ shared production architecture ระหว่าง:

- mother-PC repo: `AKCD1998/SC-StockDay-Ordering`
- shared Render backend repo: `AKCD1998/PaaSRTSM-project`

เป้าหมายหลักคือทำให้ mother-PC sync agent สามารถโพสต์ข้อมูลเข้า shared backend ได้โดยไม่มี contract mismatch โดยเฉพาะ route:

- `/api/sync/ada/branches`
- `/api/sync/ada/transfers`

## สิ่งที่ตรวจใน repo นี้

ไฟล์หลักที่ตรวจ:

- `apps/admin-api/src/server.js`
- `apps/admin-api/src/routes/sync-ada.js`
- `tests/ada_sync_api.test.js`
- `tests/ada_sync_agent.test.js`
- `scripts/lib/ada_sync_agent.js`
- `migrations/015_add_ada_raw_ingestion.sql`
- `migrations/019_add_transfer_reconciliation_foundation.sql`

สิ่งที่ยืนยันได้:

- route จริงถูก mount ที่ `/api/sync/ada`
- backend มี route สำหรับ branches, products, transfers, run-log อยู่แล้ว
- schema ปัจจุบันเก็บ transfer ที่ `ada.transfer_headers` และ `ada.transfer_lines`
- downstream reconciliation layer อ้างอิงตาราง `ada.transfer_headers` และ `ada.transfer_lines` โดยตรง

## ปัญหาที่พบ

ก่อนแก้ไข backend route ของ transfer ยังมีช่องโหว่ด้าน compatibility กับ mother-PC payload จริง:

- transfer header รองรับ `branchFrm` แค่บางจุด
- transfer line ยังต้องการ `docType` จาก line ตรงๆ เป็นหลัก
- transfer line ยังไม่ fallback จาก header เมื่อ line ส่ง camelCase แบบสั้น
- บาง alias สำคัญของ payload จริงยังไม่ครบ เช่น:
  - `branchTo`
  - `whFrm`
  - `whTo`
  - `seqNo`
  - `factor`
  - `usrCode`
  - `tnfDate`

ความเสี่ยงหลักคือ mother-PC agent ส่ง camelCase payload จริงแล้ว backend reject หรือ map ค่าบาง field ไม่ครบ

## การปรับแก้ที่ทำ

แก้ไขที่:

- `apps/admin-api/src/routes/sync-ada.js`

### 1. เพิ่ม transfer normalization ก่อน validate/upsert

เพิ่ม logic เพื่อ normalize transfer payload เป็น canonical shape ก่อนเข้า upsert:

- header:
  - `docNo <= FTPthDocNo | docNo`
  - `docType <= FTPthDocType | docType`
  - `branchCode <= FTBchCode | branchCode | branchFrm`
  - `branchCodeTo <= FTBchCodeTo | branchCodeTo | branchTo`
  - `warehouseCode <= FTWahCode | warehouseCode | whFrm`
  - `warehouseCodeTo <= FTWahCodeTo | warehouseCodeTo | whTo`
  - `docDate <= FDPthDocDate | docDate | tnfDate`
  - `createdBy <= FTPthUsrName | createdBy | usrCode`
  - `approvedBy <= FTPthApvCode | approvedBy | usrCode`

- line:
  - `docNo <= FTPthDocNo | docNo`
  - `docType <= FTPthDocType | docType | header.docType fallback`
  - `branchCode <= FTBchCode | branchCode | branchFrm | header.branchCode fallback`
  - `branchCodeTo <= FTBchCodeTo | branchCodeTo | branchTo | header.branchCodeTo fallback`
  - `lineNo <= FNPtdSeqNo | lineNo | seqNo`
  - `productCode <= FTPtdPdtCode | productCode`
  - `unitCode <= FTPunCode | unitCode`
  - `unitName <= FTPunName | unitName`
  - `qty <= FCPtdQtyAll | qty`
  - `qtyBase <= FCPtdQtyBase | qtyBase`
  - `stockFactor <= FCPtdStkFac | FCPtdFactor | stockFactor | factor`
  - `warehouseCode <= FTWahCode | warehouseCode | whFrm | header.warehouseCode fallback`
  - `docDate <= FDPthDocDate | docDate | tnfDate | header.docDate fallback`

### 2. ปรับ validation message ให้สะท้อน canonical contract

เปลี่ยน error message ให้ชัดว่ารองรับทั้ง canonical key และ AdaAcc aliases เช่น:

- header ต้องมี `docNo`, `docType`, `branchFrm/branchCode`
- line ต้องมี `docNo`, `docType`, `branchFrm/branchCode`, `seqNo/lineNo`, `productCode`

### 3. เก็บ raw payload เดิมจริง

แก้ `getRawPayload()` ให้เก็บ source record เดิมผ่าน `__rawPayload` แทนที่จะเก็บ normalized wrapper เพื่อไม่เสีย forensic/raw trace

## การทดสอบที่เพิ่ม/อัปเดต

แก้ไขที่:

- `tests/ada_sync_api.test.js`
- `tests/ada_sync_agent.test.js`

### ทดสอบ API

เพิ่ม test สำหรับพิสูจน์ว่า shared backend ยอมรับ mother-PC camelCase payload shape จริง:

- header ใช้:
  - `docNo`, `docType`, `docDate`, `tnfDate`, `branchFrm`, `branchTo`, `whFrm`, `whTo`, `type`, `total`, `vat`, `grand`, `deptCode`, `usrCode`
- line ใช้:
  - `docNo`, `seqNo`, `productCode`, `unitCode`, `unitName`, `factor`, `qty`, `qtyBase`, `branchFrm`, `branchTo`, `whFrm`, `whTo`, `docDate`

จุดสำคัญ:

- line test จงใจไม่ส่ง `docType` เพื่อพิสูจน์ว่า fallback จาก header ทำงาน

### ทดสอบ agent

อัปเดต test ฝั่ง agent เพื่อยืนยันว่า:

- agent โพสต์ไปที่ `/api/sync/ada/branches`
- agent โพสต์ไปที่ `/api/sync/ada/transfers`
- payload transfer ที่โพสต์ยังคงเป็น shape ที่ระบบ expect

## คำสั่งทดสอบที่รัน

```powershell
npm test -- tests/ada_sync_api.test.js tests/ada_sync_agent.test.js
```

ผลลัพธ์:

- 15 tests passed
- 0 failed

## สถานะสุดท้าย

shared backend ใน repo `PaaSRTSM-project` ตอนนี้รองรับ mother-PC sync agent ได้ครบสำหรับ flow ที่ตรวจใน session นี้ โดยเฉพาะ:

- `/api/sync/ada/branches`
- `/api/sync/ada/transfers`

สรุป:

- รองรับ camelCase payload จริงจาก mother PC
- ยัง preserve raw AdaAcc-style aliases
- ลดความเสี่ยง contract mismatch ระหว่าง `SC-StockDay-Ordering` กับ Render backend

## ข้อควรทราบ

field บางตัวจาก mother-PC transfer header ถูกยอมรับและเก็บไว้ใน `raw_payload` แต่ไม่ได้ map ลง dedicated relational columns ของ schema ปัจจุบันโดยตรง เช่น:

- `type`
- `total`
- `vat`
- `grand`
- `deptCode`

ถ้าภายหลัง reconciliation/reporting ต้อง query field เหล่านี้เชิง relational อาจต้องขยาย schema/migration เพิ่มในรอบถัดไป
