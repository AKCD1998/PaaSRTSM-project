# Hourly Stock hardening — 2 October 2026

Status: LOCAL CANDIDATE TESTED / TECH LEAD RE-REVIEW REQUIRED.
This addendum supersedes readiness assumptions, not historical evidence.

## Scope and baseline

- SC: SC-StockDay-Ordering.hourly-dual-stock-shadow-2026-09-13,
  candidate HEAD 1ec70550dc370dbce844dde109a240db3e7387ba, main f9f82b9.
- PaaS: PaaSRTSM-project.hourly-dual-stock-evidence-2026-09-18,
  pre-rebase HEAD 2bf848c29a04bf854e1aeae17ddeee3927fe7aed,
  rebased onto main 3255da9294244329f654d18ba39d79ed60ca3c3f, HEAD dbdf31e.
- Draft PRs #61 (SC) and #26 (PaaS) still contain the previously pushed version.
  Today's changes are uncommitted/unpushed. Old green CI is NOT proof of this patch.
- Existing migration remains 074; no new migration or production schema change.
- Canonical SC worktree and pre-existing untracked observations/helpers preserved.

## Candidate changes

1. Standalone runner rejects morning anchors before SQL. Full's opt-in anchor is
   queued only after all authoritative work and success run-log complete, including
   CP4 terminal APPLIED. The read timestamp is captured adjacent to the stock SELECT,
   not at upload time. The selected cohort must be complete and acknowledgement exact.
2. Morning captures require explicit 08:20 classification and a real read timestamp
   between 08:20 inclusive and 09:00 exclusive in Bangkok. This is a classification
   guard, NOT approval of any stock-freshness/lateness threshold. Evening recovery
   cannot create a morning anchor. Backend checks the referenced central run's branch,
   date, full snapshot, success and CP4 apply state. Receipt ID participates in identity.
3. Atomic/fsynced bounded local outbox persists exact request bodies before delivery.
   Replay does not read SQL, re-hash changed data, or rewrite capturedAt. Pending data
   is never silently evicted. Branch/count/capture-time acknowledgement must match
   before removal. Delivery retries remain bounded; token is never written to outbox.
4. Shared per-branch capture mutex prevents Full/selected-SKU reads from overlapping.
   Intraday fails fast when Full is active; Full waits at most 120 seconds. Hourly
   closes SQL and releases its capture lock BEFORE HTTP retries. Dead-PID locks can
   be reclaimed; live, malformed or incomplete locks are not age-evicted.
5. Backend ingestion has an explicit default-OFF flag. Token-map parsing fails closed
   for inactive/malformed/duplicate branches, shared tokens and tokens under 32
   characters. Credentials remain separate from legacy Full and Transfer tokens.
6. Summary chooses the earliest deterministic capture per slot, counts duplicate
   morning/intraday anchors, and separates computable drift from qualifying collection.
   Missing slots, duplicate captures, early/late captures, cohort differences and null
   estimated quantities prevent qualification. Without approved configured lateness,
   qualification is false with lateness-policy-pending; no numerical stock pass
   threshold, Reservation TTL or QtyNow source-freshness guarantee was invented.
7. PaaS cleanup is default OFF and dry-run by default. Explicit execution deletes
   children and bounded batches of old runs in one transaction with row locks.
   Current/recent windows survive; incomplete old windows also expire at the deadline.
   Invalid policy refuses SQL. When retention is enabled, expired uploads return 410,
   preventing old retries from resurrecting pruned runs.

## Local test evidence

- Full Agent: 227/227 pass, 0 skip, 0 fail.
- PaaS focused unit/HTTP/retention: 18/18 pass after the complete-cohort qualification test.
- Guarded real PostgreSQL 18: 1/1 pass, 0 skip, loopback-only
  127.0.0.1:55439, DB sc_hourly_evidence_test_20261002.
  Migration 074 first/rerun, real constraints, nullable UNNEST, complete inserts,
  exact idempotency, row-insert rollback, central receipt rejection, summary and
  retention dry-run/bounded deletion/rollback/rerun exercised.
- Initial parallel full PaaS: 688 tests, 500 pass, 187 skip, 1 failure in unchanged
  video_provider_mock.test.js (25ms sleep observed completed rather than processing).
  Isolated video: 3/3 pass. First full rerun at concurrency 2: 688 tests, 501 pass,
  187 environment-dependent skips, 0 fail.
- Full PaaS after the additional cleanup-CLI test: 689 tests, 502 pass,
  187 environment-dependent skips, 0 fail (concurrency 2). Final rerun after
  the complete-cohort qualification test is recorded in the verification addendum.
- Cleanup and cross-repository contract verification appended below.

## Prepared rollout configuration — NOT applied

Backend:

- FEATURE_HOURLY_STOCK_EVIDENCE=false.
- HOURLY_STOCK_EVIDENCE_BRANCH_TOKENS absent/empty until approved; generate one
  random dedicated token per active canary branch and provision securely.
- FEATURE_HOURLY_STOCK_EVIDENCE_RETENTION=false.
- HOURLY_STOCK_EVIDENCE_RETENTION_DAYS=30 is ONLY a dormant candidate default,
  not an approved retention decision. Allowed range 3–365 days.
- HOURLY_STOCK_EVIDENCE_MAX_SLOT_DELAY_SECONDS absent until policy approved.
  This threshold concerns capture scheduling, NOT the accuracy of QtyNow.
- Cleanup candidate: node scripts/prune_hourly_stock_evidence.js (OFF/dry-run),
  explicit --execute only with separate policy/production authorization.

Agent:

- ADAPOS_HOURLY_STOCK_EVIDENCE_SHADOW=false.
- ADAPOS_HOURLY_STOCK_EVIDENCE_FULL_SYNC_ANCHOR=false.
- ADAPOS_HOURLY_STOCK_EVIDENCE_FULL_SYNC_LOCAL_SHADOW=false remains independent.
- Dedicated branch token, <=500 fixed cohort and approved protected cache directory
  required before activation. Windows ACLs must be verified on each pilot machine;
  POSIX mode 0600 does not establish Windows access control.
- Morning explicit classification: morning_anchor / 08:20 on the normal Full task,
  not a standalone morning query.
- Intraday proposed tasks: runner with explicit --hourly-kind=intraday and
  --hourly-slot=09:00 through 19:00. No tasks installed or enabled today.
- Explicit recovery: node src/hourlyStockRunner.js --replay-only; no new SQL read.
  Outbox limit 168 files (including orphan temp captures), <=256 KiB per body,
  maximum 12 uploads per replay invocation. Full's post-run drain is limited to 1.
  A corrupt/head-of-line failure or full queue requires operator review; no automatic
  deletion/quarantine of unacknowledged evidence.
- Disable overlapping instances and audit any existing Full/recovery schedule before
  installation. Morning lock timeout and malformed-lock handling require operational
  review, not silent fallback to concurrent reads.

## Remaining decisions / release order

1. Tech Lead re-review this uncommitted patch and contract compatibility.
2. Approve pilot branch/cohort, scheduling lateness, retention, storage ACLs,
   cleanup ownership, retry/corruption response and actual Task wiring.
3. Obtain separate commit/push/PR-update authority, refresh Draft CI, then evaluate
   merge/deploy default OFF after the Transfer canary release gate permits it.
4. Separately authorize per-branch token/flag/Task rollout. Backend first, Agent next;
   verify real ingest receipts and all daily slots before counting qualifying windows.
5. Keep QtyRet canonical. Existing 55/75 exact match is old evidence, not new success.
   Seven qualifying windows/three movement days remain proposals, not final approval.
   Stock-drift thresholds, data-lag fallback, TTL and WP4 activation remain pending.

## Refactor consideration

Storage/mutex and morning anchor are separate Agent modules; retention and
collection-quality logic are separate Backend services. No App.jsx/UI/Reservation
changes and no broad refactor of legacy repositories were introduced.

## Mutation declaration

Local candidate code/tests/docs and incremental ledger/Gantt updates only.
No commit, push, PR state change, production migration/DB write, Render change,
deploy, secret provisioning, branch-PC/task/config change, Manual Sync or WP4
activation. Disposable local DB/cluster creation is test-only and must be cleaned up.

## Final verification addendum — 09:40 ICT

- Final full Agent: 227/227 pass, 0 fail, 0 skip.
- Final full PaaS: 690 tests, 503 pass, 187 environment-dependent skips, 0 fail.
  Final focused suite: 18/18 pass; PostgreSQL integration: 1/1 pass separately.
- Cross-repository runtime check: Agent intraday and receipt-bound morning payload
  identities parse identically in the PaaS service; nullable QtyNow preserved.
- Node syntax checks and git diff --check pass for changed candidate code.
- Gantt syntax/data validation passed: unique IDs, local-only task, diary entry,
  explicit re-review gate. No live-browser visual QA was performed for this data patch.
- Disposable DB was dropped, temporary cluster stopped, port 55439 has no listener.
  Existing postgresql-x64-18 service remains Running and was not changed.
- Recursive removal of the stopped cluster's temporary directory was blocked by tool
  policy; its test-only files remain at
  C:\Users\scgro\AppData\Local\Temp\sc-hourly-evidence-20261002-9c4d763cd03e4e0488717d8c628d3230.
  No alternative filesystem deletion was attempted. No production data was removed.

## Draft publication phase — user authorized continuation

Human direction: "ดำเนินการต่อได้เลย".
Scope: final code review, commit/push, refresh existing Draft PRs #26/#61 and
observe CI. This does not approve merge/deploy, product policies, provisioning
production secrets, flags, schedules, branch expansion or canonical QtyNow.

Review disposition: APPROVED FOR DRAFT PUBLICATION / NOT ACTIVATION APPROVED.
Earlier "uncommitted" statements describe the pre-publication snapshot and are
preserved as history. Actual published SHA/CI evidence is recorded in the PR
conversation and append-only ledger, not inferred from earlier test results.

Final review follow-ups:

- Agent quantity and receipt-ID bounds now match Backend validation, preventing
  an out-of-contract request from permanently blocking the outbox.
- PaaS CI provisions a separate disposable sc_hourly_evidence_test_ci database
  on its PostgreSQL 16 service, runs the guarded real integration test instead
  of skipping it, and removes that database with an always-run cleanup step.
  CP4 tests keep their original separate database; no production URL is used.
- Existing main SHAs remain SC f9f82b9 / PaaS 3255da9 at publication preflight.
  Main migration ceiling 073; Hourly candidate 074; no new migration introduced.
- The rebased PaaS branch will require a lease-protected update against the
  independently verified prior remote SHA 2bf848c. Any newer remote work must
  stop publication for reconciliation; it must not be overwritten.
