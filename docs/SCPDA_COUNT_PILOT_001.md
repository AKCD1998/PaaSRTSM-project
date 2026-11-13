# SCPDA branch 001 count pilot — activation candidate

## Browser continuation, 2026-11-13

Prepared on current backend main `46985c9` without changing its PJK/other work.
The existing Sites staff panel was separately removed and published; this count
backend and its schema/access changes remain unactivated.

Live read-only checks still found no `ordering.scpda_observations`, lot or review
tables. `/api/scpda/counts/admission` returns 405 `READ_ONLY` from the old reader
catch-all. The existing preview origin receives preflight 403. Therefore the
current hosted demo is not evidence of live count persistence.

The new default-off `FEATURE_SCPDA_WEB_001` capability admits exactly
`https://sc-stockday-pda-lab.scgroup1989-it.chatgpt.site` and `/api/scpda` paths.
It permits Content-Type/Authorization and GET/POST/OPTIONS, **without credentialed
cookies**. It does not put the Site on the general CORS allowlist and grants no
admin, legacy-mobile-enrollment or Sync route access. Existing device/PIN auth
and separate count-purpose proof still run. Four actual middleware checks cover
default-off, exact scope, lack of cookie admission and preserved auth rejection.

The actual browser adapter uses a nonextractable P256 key persisted in its own
IndexedDB, the existing one-time device invitation/PIN login and the existing
count contracts. PINs and reader/count JWTs are not persisted. There is no
backend proxy, no-cors mode, shared credential or mock stock fallback. A browser
is a separate registered device from Android Keystore; do not reuse/export an
Android private key or register a new production device without approval.

New cloud browser checks exercised real WebCrypto proof and real isolated
HTTP/auth/PostgreSQL handlers: count receipt, lot dates, late-lot reason, offline
cold reopen, lost response recovery, original-preserving correction, second
browser, CSRF admin review and logout (12 linked assertions). Synthetic movement
coverage was explicitly seeded only for the late-lot case; real Ada movement
coverage is still unverified. Current-main backend 38 checks, admin45 and build
also passed. No production count write or physical-phone acceptance is claimed.

Activation now needs the previously reserved approval for migration083 plus the
reviewed backend/admin deployment, `FEATURE_SCPDA_COUNTS_001=true`, the narrowly
scoped `FEATURE_SCPDA_WEB_001=true`, the prepared browser Site version, and one
new branch001 browser admission invitation. Existing three account/PIN values,
general CORS configuration, Sites audience and official Ada inventory remain
unchanged. The preview request is not permission to bypass the existing 403 or
mint a session from the application's signing secret.

Status: implemented and tested in an isolated cloud fixture; NOT deployed. Existing
live reader contract remains `scpda-read-001-v1`. Production flags, credentials,
inventory and migration history have not been changed in this phase.

## What is recorded

`scpda-counts-001-v1` records a **measurement at a stated time**, never an official
Ada adjustment or an automatically accepted current stock balance. A record has
an immutable event UUID, server receipt UUID/time, branch 001, registered device
reference, operator, exact SKU/IC/lookup string, category, independent round 1–3,
staff-reported unit, complete-product checkbox, lots, quantities and nullable
manufacture/expiry dates. Leading zeroes survive. Missing dates/lot identity stay
unknown; an explicit zero is distinct from not counting. Rounds are compared,
never summed. A partial count is not a complete product baseline.

The existing barcode lookup does not establish the physical pack or stock-unit
factor. We preserve that uncertainty: no guessed factor 1 and no automatic
conversion/comparison to Full Sync. The raw Full Sync reference retains
null/zero/negative values and unknown observation time. Ingestion time is not
presented as stock observation time. IC lookup is distinguished from barcode
lookup; neither claims a verified physical scan.

## Auth and API

No new PINs, accounts, device invitations or password/refresh contract. Existing
reader login still works if the count service is absent/disabled. New app builds
may request a separate count-purpose proof from the same registered P256 key.
The fresh challenge binds the parent reader session and device, expires after
60 seconds, and cannot reuse the reader-login proof. The resulting memory-only
count JWT has a distinct derived key/audience/role and is capped by the reader
session and device certificate. Reader JWTs cannot write; count JWTs cannot read
reader routes. Parent logout/revocation and credential rotation invalidate
count sessions. This is a new submit capability and requires activation approval.

`/api/scpda/counts` routes (mounted before the reader catch-all):

- GET `/admission`, POST `/access/challenge`, POST `/access/authorize`: reader
  admission plus fresh registered-device proof.
- GET `/capabilities`, POST `/check`, POST `/`, GET `/history`, GET `/events/:id`:
  count-purpose token. History/receipt access is scoped to branch and operator.
- Submit body: `id,capturedByOperator,skuId,productCode,barcode,unitLabel,category,
  round,completeProduct,observedAt,lots,correctionOf,correctionReason,lateReason`.
- `lots[]`: `code,quantity,manufacturedOn,expiresOn`. Quantity is a whole-number
  string under the current entry rule. Unknowns are explicit JSON null.
- `lateReason`: null or `{code,note}`; codes `found-existing`, `previously-missed`,
  `new-receipt`, `label-correction`, `other` (the last requires a note).
- Retry uses the same event UUID and exact canonical payload. Same authorized
  device/operator receives the same receipt; changed payload returns 409.
  Receipt lookup permits recovery after a lost accepted response.
- `capturedByOperator` must equal the authenticated operator. App account-switch
  guards prevent a queued record from being sent under another session.

`/api/stock-lots` uses existing **admin web session** auth; review writes also
require existing CSRF. GET `/review-queue`, `/products/:code?branchCode=001`,
`/events/:id`, `/events/:id/reviews`; POST `/events/:id/reviews` takes
`{action,reason,expectedRevision}`. Actions accept a measurement, request a
recount, dismiss, or reopen. Optimistic revision prevents stale decisions.
No route changes official stock, source priority, or replenishment orders.

## Corrections and FEFO

A correction appends a new event linked to the original. Product, identity,
unit, category, independent round and original observation time remain fixed.
Original evidence, lot rows, review events and projection snapshots are guarded
against UPDATE/DELETE/TRUNCATE. A correction has its own receipt/reason. A new
delivery is a later observation, not a correction of the earlier count.

FEFO is inference, not proof of which lot was sold. `scpdaFefo.projectFefo`
requires an accepted complete baseline, verified unit/rule, and complete,
deduplicated movement coverage for the stated interval. Equal-expiry lots
produce possible ranges rather than arbitrary depletion. Missing identity,
unknown expiry, insufficient coverage, unsupported unallocated outflow, or a
movement conflict yields unknown/null. A corrected or no-longer-accepted
baseline invalidates its old projections without deleting them.

When a valid stored projection estimated a lot at zero and a later positive
observation names that same known lot identity, `/check` requests a reason and
submit returns 422 until it is supplied. The positive entry is then accepted as
evidence with a receipt and an automatic `needs-review` event. It does **not**
assert staff are wrong. The projection/version, reason, person, device and both
times remain available to admin review.

## What remains unknown / intentionally inactive

Read-only schema discovery found Ada sales/receipt/transfer/adjustment lines,
some base quantities, factors and lot/expiry fields. That is not a verified
movement contract. No live movement-completeness/status/unit/time provider or
projection scheduler is connected. Synthetic FEFO snapshots in tests are NOT
evidence of real Ada coverage. Consequently production estimates should remain
unknown while observations accumulate. No scheduled Codex/LLM auditor was
created or enabled. No official Ada stock adjustment path is implemented here.

Hosted v4, old ScProductDev static HTML port 8765, prior Windows R2 acceptance,
current cloud fixtures, staging, and physical Android acceptance are separate.
This phase does not claim a new Windows run, reachable HTTPS staging, or a
physical Android/WebView/camera/HID test. Existing CORS restrictions remain.

## Exact activation and rollback boundary

Before production activation, obtain the user's explicit approval for:

1. Applying `083_add_scpda_lot_observations.sql` to existing `sc_drug_db` and
   deploying the reviewed backend commit to `paasrtsm-project`.
2. Enabling `FEATURE_SCPDA_COUNTS_001=true` on that service. Existing reader
   credentials/device admission remain unchanged; this adds branch 001 submit
   capability only, not any official inventory write.
3. Deploying the reviewed admin frontend with
   `VITE_FEATURE_SCPDA_LOTS_001=true`, admin-only entry. No branch 004/005 logic
   or stock-source-selection changes.

Render currently auto-deploys main after checks and runs `npm run db:migrate`
predeploy. Therefore **even a merge with flags off would apply this migration**;
do not merge as a workaround for the migration approval. Before activation,
re-fetch main, recheck migration-number collisions and actual production
`schema_migrations` slash style. Never run the Windows migration runner against
Linux-recorded production history. Verify only the new table/trigger set and
row counts after approved application. A production rollback disables both
flags/reverts code while preserving evidence tables; it does not delete audit
data. No additional service, cost, tunnel, CORS change or credentials is needed
for the reviewed collection path.

## Reproducible isolated checks

`tests/scpda_fefo.test.js` exercises pure inference; the PostgreSQL suite needs
explicit `SCPDA_COUNT_FIXTURE_ORIGIN`, `SCPDA_COUNT_FIXTURE_PG_PORT`, and
`SCPDA_COUNT_FIXTURE_FILES`. It refuses generic production `DATABASE_URL` use.
`tests/fixtures/scpda-counts-http.cjs` requires a new synthetic DB or the exact
fixture marker with `--reopen`. The browser projection seed refuses an
unmarked store. Its unit and movement assertions are synthetic-only.

See the delivered evidence manifest for exact source hashes, check counts,
actual receipts, screenshots, fixture restart proof and unfinished checks.

### Fixture startup inputs

Use existing dependencies and an empty **disposable** PostgreSQL database named
`scpda_read_fixture`, user `scpda_fixture`, fixture password
`scpda-fixture-only`, on an explicitly loopback-bound port. No generic
`DATABASE_URL` is read by this harness. Never point it at a real database.

```sh
node tests/fixtures/scpda-count-fixture-config.cjs /absolute/empty/fixture-files --synthetic-only
node tests/fixtures/scpda-counts-http.cjs /absolute/backend/root 32773 /absolute/empty/fixture-files/backend-config.json --http-port 39963
```

Replace `32773` with the actual disposable Postgres port. The first command
refuses a nonempty directory and generates two disposable invitations plus
the public synthetic operator PINs 1111/2222/3333 (not live account PINs). The
second refuses an existing unmarked database. To reopen the same marked fixture,
add `--reopen`; never reset the store to make a failed test pass. The HTTP
listener binds only 127.0.0.1. Current fixture admin credentials are
`fixture-admin` / `fixture-admin-only-password`; they exist only in this harness.

Run the PostgreSQL suite with explicit fixture origin/port/files variables in
a fresh fixture; it consumes `invitation.json`. Then the synthetic browser seed
can create a valid fixture-only FEFO snapshot. The exact-APK host-JVM browser
test uses the separate `java-invitation.json`. The admin fixture runs in Vite on
127.0.0.1:5197 with `VITE_API_BASE_URL=http://127.0.0.1:39963` and the frontend
feature flag; fixture CORS permits that exact loopback origin only. No private
test device key/certificate, live config, DB dump, session or invitation is
included in the public review evidence package.
