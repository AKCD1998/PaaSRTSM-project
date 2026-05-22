# Session Summary - 2026-05-21 - AdaPOS Transfer Sync Compatibility

## Scope

This session focused on making the shared backend in `PaaSRTSM-project` compatible with the real mother-PC AdaPOS sync agent payload, then proving end-to-end persistence into Render Postgres.

Primary production route:

- `POST /api/sync/ada/transfers`

Related route:

- `POST /api/sync/ada/branches`

## Problem Statement

The mother-PC sync agent posts transfer payloads in camelCase, for example:

- headers: `docNo`, `docType`, `docDate`, `tnfDate`, `branchFrm`, `branchTo`, `whFrm`, `whTo`, `usrCode`
- lines: `docNo`, `seqNo`, `productCode`, `unitCode`, `unitName`, `factor`, `qty`, `qtyBase`, `branchFrm`, `branchTo`, `whFrm`, `whTo`

The backend had previously rejected this shape with errors equivalent to requiring raw AdaAcc fields such as:

- `FTPthDocNo`
- `FTPthDocType`
- `FTBchCode`

This created a production mismatch between:

- real writer: mother-PC `SC-StockDay-Ordering/apps/adapos-sync`
- shared reader: `PaaSRTSM-project/apps/admin-api`

## What Was Verified

### Real agent payload shape

The mother-PC payload shape was confirmed externally from the agent source and then supported here in the backend.

### Shared backend deployment target

Render production service was confirmed to be using:

- repo: `AKCD1998/PaaSRTSM-project`
- branch: `main`

Compatibility fix was committed and deployed on:

- commit: `eda3289f70cd184e53d539378e30b109f59b2897`
- commit message: `fix: accept mother-PC AdaPOS transfer payload`

## Key Backend Changes

### 1. Transfer payload normalization in ADA sync route

File:

- `apps/admin-api/src/routes/sync-ada.js`

Behavior added or confirmed:

- accepts both raw AdaAcc-style fields and real mother-PC camelCase fields
- normalizes transfer headers before validation and upsert
- normalizes transfer lines before validation and upsert
- backfills line-level `docType` and `branchCode` from matching header when omitted by caller
- preserves original source record in `raw_payload`

Accepted aliases include:

#### Headers

- `docNo <= FTPthDocNo | docNo`
- `docType <= FTPthDocType | docType`
- `branchCode <= FTBchCode | branchCode | branchFrm`
- `branchCodeTo <= FTBchCodeTo | branchCodeTo | branchTo`
- `warehouseCode <= FTWahCode | warehouseCode | whFrm`
- `warehouseCodeTo <= FTWahCodeTo | warehouseCodeTo | whTo`
- `docDate <= FDPthDocDate | docDate | tnfDate`
- `createdBy <= FTPthUsrName | createdBy | usrCode`
- `approvedBy <= FTPthApvCode | approvedBy | usrCode`

#### Lines

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

### 2. ADA branch sync compatibility confirmed

File:

- `apps/admin-api/src/routes/sync-ada.js`

`/api/sync/ada/branches` already accepted:

- `branchCode <= FTBchCode | branchCode`
- `branchName <= FTBchName | branchName`
- `branchNameTh <= FTBchNameTH | branchNameTh`
- `branchStatus <= FTBchStaActive | branchStatus | status`

### 3. Observability cleanup for run logs

Files:

- `apps/admin-api/src/routes/sync-ada.js`
- `apps/admin-api/src/routes/sync.js`

Final behavior:

- `POST /api/sync/ada/run-log` writes to `ada.sync_runs`
- legacy `POST /api/sync/run-log` keeps writing to `ingest.sync_runs`
- legacy AdaPOS-origin run logs are now mirrored into `ada.sync_runs`
- failed legacy AdaPOS-origin runs are also mirrored into `ada.sync_errors`

This preserves compatibility while closing the observability gap.

## Tests Added / Updated

Files:

- `tests/ada_sync_api.test.js`
- `tests/ada_sync_agent.test.js`
- `tests/admin_api_smoke.test.js`

What was covered:

- mother-PC camelCase transfer payload accepted by `/api/sync/ada/transfers`
- raw AdaAcc aliases still accepted
- sparse transfer lines can omit `docType` and use header fallback
- ADA and legacy run-log behavior remains compatible

Observed passing runs during the session:

- `node --test tests\\ada_sync_api.test.js tests\\ada_sync_agent.test.js`
- `15/15` passing
- later expanded:
- `node --test tests\\admin_api_smoke.test.js tests\\ada_sync_api.test.js tests\\ada_sync_agent.test.js`
- `23/23` passing

## Production Verification

### Live deployment proof

Render service was verified live on commit:

- `eda3289`

Evidence included:

- service branch = `main`
- event log showed `Deploy live for eda3289`
- deploy detail page showed status `Live`

### Live mother-PC sync result

The real mother-PC sync agent ran successfully against the shared backend.

Reported live run:

- branch filter: `005`
- datasets: `transfers,transfer_lines` on the mother-PC agent side
- SQL Server connection: OK
- headers read: `200`
- lines read: `3294`
- API accepted headers: `200`
- API accepted lines: `3294`
- total records sent: `3494`

### Direct Postgres persistence proof

Transfer persistence was directly proven by querying Render Postgres.

Tables:

- `ada.transfer_headers`
- `ada.transfer_lines`

Natural keys:

- headers: `(doc_no, doc_type, branch_code)`
- lines: `(doc_no, doc_type, branch_code, line_no, product_code)`

Verified persisted counts for the live batch after excluding 2 older probe docs:

- headers: `200`
- lines: `3294`

Branch `005` specifically:

- headers: `28`
- lines: `118`

Sample docs confirmed in DB:

- `TS00526-000027`
- `TS00526-000028`
- `TS00526-000026`

Sample persisted line for `TS00526-000028`:

- line `1`: product `IC-004334`
- line `2`: product `IC-005458`

## Final Status

This repo is now production-compatible with the real mother-PC AdaPOS transfer payload.

What is complete:

- live contract mismatch fixed
- shared backend deployed on correct commit
- live sync succeeded
- transfer persistence directly proven
- run-log observability gap closed for both ADA and legacy callers

## Remaining Follow-up

Not blockers, only optional cleanup:

- unify `ingest.sync_runs` and `ada.sync_runs` later if desired
- expose a narrow internal read/verification endpoint for transfers if operators need easier self-service validation
- continue monitoring next branch sync runs after the branch `005` pilot

## Open Architecture Question

The team is not yet confident which transfer-origination model is easier and more stable for production:

1. create / confirm outbound in our app first, then automate filling Ada via robotic / AI / RPA flow
2. let Ada remain the place where outbound is created, then detect/capture those Ada commands and broadcast them into our reconciliation workflow

Current status:

- this decision is still open
- no final claim should be made yet that one path is definitely simpler or more stable
- future evaluation should compare:
  - implementation complexity
  - operational stability
  - observability/auditability
  - staff workflow burden
  - failure recovery when branch internet or Ada workflow is inconsistent
