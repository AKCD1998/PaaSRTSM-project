# WP3 Normalized Recommendation Reader Refresh — Review Packet

## 1. Status

`READY FOR TECH LEAD RE-REVIEW — ROUND-TWO BLOCKERS ADDRESSED LOCALLY`

This is a fresh, local-only, uncommitted WP3 candidate. The second pass addresses the four Tech Lead blockers—shallow-CI independence, branch-scoped candidate discovery, a real branch canary, and served-snapshot shadow evidence—plus retention after shadow is disabled. It does not authorize a commit, PR, merge, migration, deploy, or production cutover.

## 2. Current baseline

- Repository: `PaaSRTSM-project`
- Fetched `origin/main`: `bbfca5c14cec95c351b9e9a4cdb13b4c7c5683ee`
- Candidate `HEAD`: the same SHA; `HEAD...origin/main = 0/0`
- Baseline full suite before edits: 606 tests — 432 pass, 1 fail, 173 skip.
- The sole baseline failure was `tests/focus_products_api.test.js` — `editing a frozen row's date range clears the freeze so it re-evaluates` (`true !== false`). It reproduces alone and is outside WP3.
- `npm ci` supplied the test dependency missing from the checkout. Tracked `node_modules` content was restored before edits; `package.json` and `package-lock.json` are unchanged.
- Read-only live check: Web is live at the baseline SHA. The sync Worker is live at `4741fd83b5a66dad06480fc6cce9f055cccfd35d`, behind Web/main; reader code is Web-side, but this deploy drift remains an operational risk to acknowledge.

## 3. Worktree and branch

- Worktree: `C:\Users\scgro\Desktop\Webapp training project\PaaSRTSM-wp3-normalized-reader-refresh-2026-09-01`
- Branch: `candidate/wp3-normalized-reader-refresh-2026-09-01`
- Base: current `origin/main`, not the dirty/stale canonical checkout.
- State: local modifications and untracked files only; no commit.

## 4. Old candidate review

Read-only reference:

- Worktree: `PaaSRTSM-wp3-wp4-candidates-2026-08-25`
- Branch: `candidate/wp3-wp4-review6-local-2026-08-25`
- HEAD: `2ea01bb2c536ef5812215050157c80843b13aa9e`
- Studied: `027900f`, `031e639`, and only the WP3-specific ideas/hunks in mixed commit `635d55f`.

Ideas retained and freshly reimplemented were the narrow reader seam, explicit `legacy`/`shadow`/`normalized` policy, bounded comparison evidence, generation-gated normalized reads, and no normalized-to-wide fallback.

Rejected rather than cherry-picked:

- the old base and combined WP3+WP4 history;
- every WP4 recompute/queue/availability/schema hunk and migration 071;
- the old maximum-timestamp freshness test (this candidate gates on the oldest row in the selected generation);
- status-only reconciliation acceptance (this candidate also validates generation-membership and normalized-vs-wide evidence inside `mismatch_summary`);
- the old inactive-product filter because adding that filter would change current recommendation business rules;
- any migration-runner change: current production proves migrations 066–069 apply successfully, so `2c9aa6d` is not a demonstrated prerequisite.

No old-candidate commit or whole-file patch was cherry-picked.

## 5. Exact WP3 scope

Included:

- reader policy and mode parsing;
- explicit branch-scoped normalized canary selection;
- isolated legacy and normalized stock mapping;
- active-branch and exact-generation selection;
- terminal retirement/reconciliation/freshness eligibility;
- refresh-only same-snapshot old-vs-new input/output comparison;
- atomic comparison-to-precomputed-batch linkage;
- bounded evidence persistence and refresh-driven cleanup;
- HTTP 503 fail-closed availability contract;
- route/schedule wiring and focused tests.

Excluded: WP4 recompute, debounce/queue/scheduler redesign, reservation/availability work, stock-request behavior, UI, SC sender/repository code, algorithm tuning, and writer/dual-write changes.

## 6. Refactor and rationale

`stockRecommendationReaders.js` is the stable seam. It exposes literal legacy-column mapping, normalized SQL/mapping, eligibility, comparison, persistence, sampling, and repeatable-read helpers. Eligibility remains explicit rather than hidden behind a generic data-source abstraction.

`stockRecommendations.js` retains the existing recommendation algorithm. It orchestrates which reader feeds the unchanged calculation. The default legacy path has no normalized query, extra transaction, evidence write, or new response metadata. In shadow, request traffic only serves the normal legacy result—including its precomputed cache—and never waits for a comparison. Sampled comparisons run in the existing scheduled refresh path; the exact live legacy rows compared are written to the precomputed cache and the evidence row is linked to that cache batch in the same write transaction.

Normalized candidate discovery now uses `scope.branchCodes` (the branch actually requested), while current-stock loading deliberately continues to use `scope.activeBranchCodes` so donor calculations still see all eligible active branches. This removes the cross-branch candidate surplus without changing donor behavior.

## 7. Changed-file manifest

Modified:

- `apps/admin-api/src/config.js`
- `apps/admin-api/src/routes/stock-recommendations.js`
- `apps/admin-api/src/server.js`
- `apps/admin-api/src/services/stockRecommendationSchedule.js`
- `apps/admin-api/src/services/stockRecommendations.js`
- `tests/stock_recommendations_api.test.js`

New:

- `apps/admin-api/src/services/stockRecommendationReaders.js`
- `migrations/070_add_stock_recommendation_reader_comparisons.sql`
- `tests/fixtures/stock_recommendations_legacy_baseline.json`
- `tests/stock_recommendation_reader_postgres.test.js`
- `tests/stock_recommendation_readers.test.js`
- `tests/stock_recommendations_legacy_equivalence.test.js`
- `WP3_NORMALIZED_READER_REFRESH_REVIEW_PACKET.md`

No `.env`, package manifest/lock, Worker, writer, stock-request, UI, SC coordination, shared-ledger, or owner-only status file changed.

## 8. Migration number and collision evidence

- Current `origin/main` maximum migration number: 069.
- Candidate migration: `070_add_stock_recommendation_reader_comparisons.sql`; exactly one local `070_*` file and no `071_*` file.
- Production read-only `schema_migrations` contains 066, 067, 068, and 069; `ordering.stock_recommendation_reader_comparisons` does not exist.
- Migration 070 was not applied to production.
- The repository has a pre-existing duplicate number 020; it does not collide with 070.

Migration 070 is additive and idempotent on exact rerun. It stores status, counts, SHA-256 digests, at most 12 identifier-only examples, branch generation IDs, bounded availability, transaction snapshot ID, timing, and expiry. It also stores the served cache batch identity (`precomputed`, anchor date, target days, generated timestamp, row count, and branch codes), with a partial lookup index. It has no stock/recommendation payload column.

## 9. Three-mode reader contract

### `legacy` (default)

- Uses the existing precomputed cache when available and existing live wide-table path otherwise.
- Live stock reads `ada.branch_stock_snapshots` only.
- No normalized query, reader transaction, comparison write, or `meta.reader` field.
- Existing actions, quantities, donor plan, summaries, and legacy null-cost coercion are preserved.

### `shadow`

- Always serves the normal legacy dataset; precomputed results remain precomputed.
- Request traffic never runs or waits for a live comparison, even when the configured sample rate is 100%; response metadata reports `comparisonStatus=refresh_only`.
- Requires an explicit sample rate. If absent, it reports `configuration_required` and performs no normalized query.
- A selected scheduled refresh computes live legacy and normalized inputs/outputs inside one `REPEATABLE READ READ ONLY` transaction, records `txid_current_snapshot()`, then persists evidence outside the read-only transaction.
- Compares product/branch membership, quantity, cost, metadata, freshness, generations, row membership, actions, recommendation quantities, donor plan, priority/flags, and summary.
- The refresh writes the compared live legacy result to `ordering.stock_recommendation_snapshots`, then links the evidence to that exact generated cache batch before commit. A missing evidence row rolls back the cache write, preventing an unlinked success claim.
- Request-time mismatch, normalized availability, and evidence errors cannot affect latency or replace/fail the served legacy response because no comparison work occurs in a request.
- Retention is independent of inserts: every existing recommendation refresh, including `legacy` mode after shadow is disabled, deletes at most 100 expired rows (hard maximum 1,000 if called explicitly with a larger batch).

### `normalized`

- Requires `STOCK_RECOMMENDATION_NORMALIZED_CANARY_BRANCHES` in addition to normalized mode. A comma-separated branch list selects only those branch requests; explicit `all` selects the global scope. Missing/empty configuration and out-of-canary requests fail safely back to legacy with selection metadata.
- A branch user is selected by `effectiveBranchCode`; an admin is selected only when explicitly requesting one listed branch. An admin `all` request remains legacy unless the configured value is `all`.
- Reads current stock only from `ada.branch_stock_current`, scoped to one exact eligible full-sync generation per active recommendation branch.
- Candidate discovery is scoped to the requested branch(es); donor stock remains scoped to all active eligible branches.
- Never falls back to or mixes with `ada.branch_stock_snapshots`.
- Requires explicit positive max-stock-age policy and complete terminal run, hybrid handoff/apply/finalize where applicable, retirement `done`, reconciliation `pass`, exact expected/actual/generation membership counts, matching reconciliation JSON evidence, and oldest-generation-row freshness.
- Missing, stale, pending, failed, mismatched, or query-error evidence fails closed as bounded HTTP 503.
- Successful responses expose `servedReader=normalized`, the source snapshot, and every branch generation.
- Branch scope can expand beyond legacy 000–005 only after an active branch has real full-sync history; active dry-run branches without it are excluded.
- Wide schema/writer/dual-write remain untouched for rollback.

## 10. Tests and counts

- Focused WP3 + API + exact-baseline equivalence: 34/34 pass.
  - Reader/config/eligibility/comparator/snapshot unit tests: 17/17.
  - Recommendation API/refresh tests: 16/16.
  - Exact baseline characterization: 1/1.
- Actual shallow-checkout simulation: 1/1 pass with `git rev-list --count HEAD = 1` and `git rev-parse --is-shallow-repository = true`.
- Disposable real PostgreSQL 18: 5/5 pass.
- Final full PaaS suite: 639 tests — 460 pass, 1 fail, 178 skip.
- The one final failure is the same unrelated baseline `focus_products_api` failure; no new failure was introduced. The five new integration skips in the ordinary full run are separately proven by the 5/5 real-PostgreSQL run.
- Syntax: 10 changed/new JavaScript files checked, 0 failures.
- `git diff --check`: pass.
- Migration chain: origin max 069, candidate 070 unique, migration exact rerun passes.
- Secret/env scan: 0 newly introduced secret-pattern matches; the one URL-shaped test fixture match already exists at baseline. There are 0 `.env` changes and 0 package-file changes.
- Full suite includes the existing stock-request contract tests; they remain passing.

Adversarial coverage includes null versus numeric zero cost, negative quantity, duplicate input candidates, a reconciled empty branch generation, absent branch/product rows, active branch expansion, active dry-run exclusion, inactive products without a new business-rule filter, retired/old-generation rows, and first-seen exact-generation zero quantity.

## 11. Real-PostgreSQL and production read-only evidence

Disposable PostgreSQL 18 proved:

- migration exact rerun, served-snapshot columns/index, and database constraints/indexes;
- the 12-example bound and absence of payload columns;
- branch expansion plus zero/null/negative/absent/inactive/retired mapping;
- reconciliation mismatch closing eligibility;
- one repeatable-read snapshot continuing to observe the old value after a concurrent transaction commits an update;
- comparison persistence, exact served cache-batch linkage, and separately invoked bounded expired-row pruning.

The disposable server was stopped, port 5548 was confirmed closed, and its temporary cluster directory was deleted.

Production was queried read-only. Current eligible generations and raw reader inputs are:

| Branch | Run | Wide rows | Normalized rows | Membership | Qty | Cost | Freshness mismatches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 000 | 2066 | 6,679 | 6,679 | 0 | 0 | 0 | 0 |
| 001 | 2067 | 6,684 | 6,684 | 0 | 0 | 0 | 0 |
| 003 | 2068 | 6,690 | 6,690 | 0 | 0 | 0 | 0 |
| 004 | 2065 | 6,690 | 6,690 | 0 | 0 | 0 | 0 |
| 005 | 2064 | 6,679 | 6,679 | 0 | 0 | 0 | 0 |

Run 2068 is the successful manual recovery for branch 003 and is not counted in the natural WP3 acceptance window. The closed natural gate remains 7/7 days, 35/35 branch-windows, runs 2029–2063.

## 12. Legacy behavior-equivalence proof

`tests/stock_recommendations_legacy_equivalence.test.js` reads the checked-in fixture `tests/fixtures/stock_recommendations_legacy_baseline.json`; it does not execute Git or depend on repository history. The fixture records baseline SHA `bbfca5c14cec95c351b9e9a4cdb13b4c7c5683ee`, the complete expected response, and SHA-256 digests for the ten expected SQL statements. Against the same duplicate-safe inputs, the test asserts:

- complete public response equivalence after replacing only dynamic `generatedAt`;
- exact normalized SQL query-log equivalence;
- no `branch_stock_current` query;
- no reader metadata in default mode.

The exact test was copied into a real depth-one clone with the local candidate files and passed, proving CI does not require the baseline commit.

API tests additionally prove:

- a normalized request for branch `001` discovers candidates with `['001']` while its donor-stock read uses `['001', '003']`;
- branch `001` can serve normalized while an admin `all` request stays on legacy, and a missing canary config stays fail-safe legacy;
- a 100%-sample shadow request serves cached legacy without a repeatable-read transaction, normalized query, or evidence insert;
- a shadow refresh compares live/live, writes the compared legacy rows into the cache, and atomically links the comparison ID to the exact generated timestamp, branch set, and row count;
- a legacy refresh still prunes expired evidence after shadow is disabled.

## 13. Risks and open human decisions

No value was guessed for these production decisions:

- `STOCK_RECOMMENDATION_MAX_STOCK_AGE_HOURS`;
- shadow observation duration;
- production shadow sample rate;
- `STOCK_RECOMMENDATION_NORMALIZED_CANARY_BRANCHES` canary scope;
- cutover date/time.

Options for Tech Lead/operator review:

- Freshness: choose a window greater than the proven branch sync envelope but short enough to reject a missed morning generation; too short creates avoidable 503s, too long serves stale stock.
- Shadow sample: start small to bound scheduled-refresh load, or run a controlled off-peak 100% observation; request latency is no longer affected. Unexplained mismatches remain stop conditions.
- Observation duration: require enough natural branch windows to cover routine sync variability; the candidate intentionally does not encode a duration.
- Canary: configure one explicitly approved branch first versus explicit `all`; all donor branches still require eligible generations to avoid mixed allocation input.

Important implementation risk: existing precomputed recommendation rows do not record reader/generation provenance. Shadow-generated evidence now records the identity of the exact legacy cache batch created from the compared legacy result. Normalized mode still computes live, and normalized refresh deliberately does not overwrite the legacy cache (`skipped_normalized_reader_without_provenance`). Tech Lead must choose either a tightly monitored live branch canary accepting current normalized-reader latency, or separately review a provenance-aware normalized cache design before broader activation.

Retention now runs on the existing recommendation refresh cadence rather than comparison inserts. If that existing refresh is stopped, expired evidence remains until refresh resumes or the bounded prune function is invoked; there is no new scheduler in WP3.

Critical release gate: Render Web auto-deploy is enabled and runs `npm run db:migrate` before deploy. A merge would therefore cause both migration and deployment automatically. Do not merge until the Tech Lead explicitly approves those two state changes together. Worker auto-deploy remains disabled and behind Web. Metadata differences between wide-row fallbacks and normalized product master data will be visible as shadow mismatches rather than silently accepted.

## 14. Production cutover plan — prepared, not executed

Every state-changing step requires fresh explicit approval. Because Web auto-deploy runs migrations before deployment, steps 1–2 are a single approval/merge gate in the current Render setup.

1. Explicitly approve migration 070 and the automatic Web deployment together, while keeping reader mode `legacy`.
2. Merge only after that combined approval; allow the pre-deploy migration and Web deploy to complete.
3. Verify legacy API output, latency, errors, and scheduled refresh.
4. Approve explicit freshness, sample-rate, retention, and observation policies; switch to `shadow`.
5. Collect old-vs-new evidence for the human-approved duration.
6. Stop on any unexplained mismatch, availability failure, latency/error regression, or missing evidence.
7. Review evidence and explicitly approve the smallest normalized branch canary.
8. Set mode to `normalized` and set `STOCK_RECOMMENDATION_NORMALIZED_CANARY_BRANCHES` only to the approved branch list.
9. Monitor HTTP 503/5xx, latency, freshness, per-branch generations, reconciliation, and comparison history.
10. Expand only after another explicit review/approval.
11. Roll back immediately to `legacy` on a stop condition.
12. Keep normalized and wide schema/writers intact during rollback.

## 15. Rollback plan

1. Set the reader mode back to `legacy` after approval to change production config.
2. Confirm `servedReader=normalized` disappears and normal precomputed/live legacy responses return.
3. Do not drop migration 070, `ada.branch_stock_current`, `ada.branch_stock_snapshots`, or either writer; evidence rows expire through bounded retention.
4. Investigate by comparison ID, bounded examples, generation IDs, source snapshot, and logs. Do not replay full payloads into the evidence table.

Rollback is config-only; it does not require reverting migration 070.

## 16. Manual actions not authorized or performed

- No production migration apply or database write.
- No Render environment/config change.
- No deploy, restart, Worker trigger, or reader-mode change.
- No branch machine, `.env`, or Scheduled Task change.
- No commit, push, PR, merge, rebase, or cherry-pick.
- No shared-ledger or owner-only WP3 status edit.

## 17. WP4 exclusion confirmation

The candidate contains no WP4 recompute service, queue/debounce behavior, availability/reservation foundation, Worker change, migration 071, stock-request change, UI change, or SC `postgresRepository.js` change. The only scheduler edit passes the existing config object to the existing refresh call; it does not redesign scheduling.

## 18. Local-only attestation and draft ledger entry

Current state is local-only, uncommitted, unpushed, unreviewed by PR, unmerged, unapplied, undeployed, and not enabled in production. The canonical PaaS checkout, old candidate worktree, SC repo, shared ledger, and owner-only status file were not edited.

Draft for Tech Lead review only; do not append without owner approval:

> WP3 normalized recommendation reader refresh round two prepared from `origin/main` `bbfca5c14cec95c351b9e9a4cdb13b4c7c5683ee` in local branch `candidate/wp3-normalized-reader-refresh-2026-09-01`. Shallow-CI fixture, requested-branch candidate scope, explicit normalized branch canary, refresh-only shadow comparison with atomic served-cache linkage, and refresh-driven retention are implemented. Focused 34/34, shallow checkout 1/1, and disposable PostgreSQL 5/5 pass; full suite 460 pass / 1 pre-existing unrelated fail / 178 skip. Production remains unchanged. No commit/PR/merge/deploy/cutover is authorized. Awaiting Tech Lead re-review plus explicit combined approval of migration and Web deployment before any merge.
