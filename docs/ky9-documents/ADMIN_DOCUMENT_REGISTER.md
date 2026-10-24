# KY9 document and incident register — implementation and release review

Implements the user's saved KY9_DOCUMENT_INCIDENT_PLAN_20261024 concept.
Frontend base: SC-StockDay-Ordering dbfe80d.
Backend base: PaaSRTSM-project 3f451f1.
Both isolated worktrees use branch codex/ky9-admin-documents-20261024.

## Behavior

Admin users get an เอกสาร tab within Branch Stock. Select a receiving month
(Gregorian YYYY-MM in the API, Buddhist year in the UI), open the period,
and maintain company/per-branch progress, incidents, notes and draft references.

Coverage has three distinct states: gathering, complete against collected evidence,
and reconciled for the whole period. Onsite review/signature status is separate.
An incident closure never changes either state. Outstanding blockers are counted
independently; the screen never claims that processing all scans proves all
company receipts have been collected.

Incidents distinguish facts, hypotheses, completed checks, evidence, owner,
next action and impact on report versions. A closure requires evidence or
attestation, a conclusion, and report impact. It records either corrected or
documented_unresolved. The latter means stop re-investigating old avenues while
retaining the discrepancy; it does not assert that Ada has been corrected.
Every change needs a reason and records the signed-session actor and server time.
Reopening and amending closed records preserve previous snapshots.

Notes are append-only, optional links must point to an incident in the same
period. Draft registrations preserve all previous versions, permit only one
current chain per branch, and reset that branch's onsite review status when a
replacement is registered. Signed status requires a reference and a registered
draft. This is a record of reported onsite review, not an electronic signature.

## Prepared evidence

Prepared evidence lives in the private database table prepared_cases and is
imported separately after an authorized release. Real incident content, supplier
data, invoice identifiers and amounts are not bundled in the public repository.
Tests use synthetic cases. Each prepared item carries its evidence date and is
returned only through the admin endpoint. These are dated records, not fresh
Ada queries. No live incident is created or closed by startup, migration or
template import. The admin must review and save each item. A unique source key
prevents creating the same prepared case twice. This feature does not run an allocator.

## Storage and API

Migration 076_add_ky9_document_register.sql adds a separate ky9_documents schema:
periods, incidents, notes, drafts, events and prepared_cases. It contains no
stock/Ada mutations or case-seeding INSERTs. It is rerunnable; prepared evidence,
notes, drafts and event history reject UPDATE/DELETE. The migration ledger is
managed by the normal release runner.

All endpoints below are under /api/admin/ky9-documents and require role=admin.
All mutations also require the session X-CSRF-Token. No-store response headers
apply to reads and writes. Service functions repeat the admin guard.

- GET /:period — consistent read snapshot, plus remaining prepared case drafts.
- POST /:period — explicitly open a period with a reason.
- PUT /:period — progress revision with expectedVersion and reason.
- POST /:period/incidents — create with data, reason, optional prepared sourceKey.
- PUT /:period/incidents/:id — revise/close/reopen with expectedVersion.
- POST /:period/notes — immutable body and optional same-period incidentId.
- POST /:period/drafts — register/supersede, requires current period version.
- GET /:period/events?before=ID — newest first, 100 per page, complete history accessible.

Month-scoped advisory locks serialize mutations. Optimistic versions reject
stale edits with HTTP 409. Body-supplied actors, closure times, ready and
human_verified are not accepted. Evidence is stored as text references;
optional draft links accept HTTPS without embedded credentials. No PDF upload,
OCR, stock movement write, pharmacist signature execution or PDF generation
is added by this feature.

## Validation completed locally

- 4 backend tests, including real disposable PostgreSQL 18 (no skips):
  migration applied twice, auth/CSRF on every route, concurrency, rollback,
  closure attribution, independent progress, cross-period guards, append-only
  history, pagination, draft supersession and prepared-case duplicate protection.
- 13 existing branch-auth tests pass.
- 52 frontend/stock compatibility tests pass; documents also unmount on a role
  downgrade, keyboard tab navigation works, stale responses are ignored,
  conflicts retain unsaved incident text and prepared drafts require explicit save.
- Vite production build passes; its existing large-chunk advisory remains.
- Browser: used the actual BranchStockPanel and API against a separate local
  database, reviewed a prepared draft and saved a documented_unresolved
  example. Progress and onsite-signature status remained unchanged.

Backend command: node --test tests/ky9_documents.test.js
Set KY9_DOCUMENTS_TEST_DATABASE_URL only to a disposable local database named
sc_ky9_documents_test_*. The integration test refuses any other host/name.
It drops only ky9_documents within that guarded test database.
Existing checked-in backend node_modules are incomplete; local branch-auth
verification used installed dependencies via NODE_PATH from the original
backend checkout and the isolated frontend checkout. No dependency files changed.

## Release authorization and sequencing

Initial review changed only isolated local code, disposable databases and preview
files. The user subsequently approved publishing both the API and frontend and
installing the register in production. Existing dirty checkouts and stock/sync/
worker code remain outside this release. The preview's closed example exists
only in its test database.

Before publishing: verify scoped user release approval; fetch both repositories;
recheck all intervening changes and migration ceilings; renumber 076 and its
test reference if occupied. Inspect the production migration ledger and exact
pre-deploy effects first. Backend main is configured to deploy after checks and
run db:migrate before start, so merging can cause a production schema change.
Review the full pending migration chain, not only 076, before approving release.
Deploy backend before frontend, then verify admin access, non-admin denial and
an empty month without silently creating any live cases.

Rollback: revert the frontend tab and backend route registration; retain the
new schema and history. Do not drop incident records or audit history as rollback.
Existing report files and Ada data are outside this change.
