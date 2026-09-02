# WP3 Normalized Reader Comparator Fix — Tech Lead Review Packet

Date: 2026-09-02 (Asia/Bangkok)
Status: **RELEASE EXECUTION AUTHORIZED** — the aggregate-freshness blocker from the first review is fixed; the user subsequently authorized commit, push, CI wait, merge, and backend deployment in that order. No migration or environment change is included.

## 1. Baseline and isolation

- Fetched latest `origin/main` before starting.
- Baseline/HEAD: `8466ffd4c070103b66447e24782103a1e81bf435` (`Merge pull request #19 from AKCD1998/candidate/wp3-normalized-reader-refresh-2026-09-01`).
- Branch: `candidate/wp3-normalized-reader-comparator-fix-2026-09-02`.
- Isolated worktree: `C:\Users\scgro\Desktop\Webapp training project\PaaSRTSM-wp3-normalized-reader-comparator-fix-2026-09-02`.
- The canonical `PaaSRTSM-project` worktree and other session worktrees were not edited.

## 2. Confirmed root cause

The 2026-09-02 shadow outputs already agreed for actions, quantities, donor plans, flags, priorities, summaries, and row membership, but the comparison status was `mismatch` for two independent input-contract reasons:

1. The unchanged legacy wide loader materializes every fixed legacy branch column, including retired branch `002`, as `sourcePresent=true`. The comparator previously unioned branch keys from both readers instead of using the active scope. That made inactive placeholders look like normalized omissions.
2. The normalized reader took visible product metadata from sparse `ada.products` / `ada.product_barcodes`, while the legacy result and current user-visible response take metadata from `ada.branch_stock_snapshots` with those tables as fallback. Production observations supplied for this task show the wide snapshot has the complete catalog while the ADA master tables are nearly empty.

These were comparator/read-contract defects, not recommendation business-rule differences.

## 3. Active-branch correction

- Both shadow comparison call sites now pass `normalizedDataset.scope.activeBranchCodes` explicitly.
- The comparator restricts input branch membership, quantity, cost, freshness, generation evidence, output rows, donor plans, and comparison digests to that supplied active set.
- With an explicit active scope, product-level aggregate `syncedAt` is excluded from both the freshness counter and digest because that timestamp can be advanced by an inactive wide branch. Active per-branch timestamps remain compared and digested.
- The comparator does not hard-code the five current production branches.
- Retired `002` and any other inactive placeholder are ignored.
- A branch included in the active set but missing from normalized stock or generation evidence remains a mismatch.
- Omitting `activeBranchCodes` preserves the prior union behavior for callers that do not provide an explicit scope.

## 4. Metadata-source correction

Added a legacy-compatible product-metadata loader with exactly the current visible precedence:

1. `ada.branch_stock_snapshots` metadata,
2. sparse `ada.products` / primary `ada.product_barcodes` fallback,
3. product code/null fallback matching the existing response contract.

The normalized stock query now selects quantity, cost, freshness, and generation only from `ada.branch_stock_current`; a separate metadata-only query selects no wide quantity/cost/freshness/generation columns. Search applies the same legacy-compatible Thai-name/barcode semantics after deriving current-table candidates.

The legacy SQL remains byte-for-byte protected by the checked-in origin/main fixture. It keeps its existing one-query behavior; both paths share the same metadata mapping contract without adding another query to Legacy.

### Deliberate remaining dependency

Normalized recommendations still depend on `ada.branch_stock_snapshots` **only for user-visible metadata**. This is the smallest compatible fix because WP3 migrates stock state, not the product-master writer. A later, separately reviewed change should establish and populate one canonical product metadata source, then move both readers to it. No migration or new write path is included here.

## 5. Business-rule and reader-policy invariants

- No recommendation formula, action, donor selection, target, shortage, transfer, purchase, priority, flag, or summary implementation changed.
- Legacy remains the default reader and its SQL/output fixture is unchanged.
- Shadow request handling still serves the exact Legacy snapshot and does no normalized work inline.
- Normalized generation/freshness/reconciliation remains fail-closed.
- The canary test now explicitly proves branch `004` uses Normalized while branch `001` remains Legacy; candidate selection is scoped to `004`, while donor loading retains the active global set.

## 6. Files changed

- `apps/admin-api/src/services/stockRecommendationReaders.js`
- `apps/admin-api/src/services/stockRecommendations.js`
- `tests/stock_recommendation_readers.test.js`
- `tests/stock_recommendations_api.test.js`
- `tests/stock_recommendation_reader_postgres.test.js`
- `WP3_NORMALIZED_READER_COMPARATOR_FIX_REVIEW_PACKET.md`

No package manifest, lockfile, migration, environment file, or production configuration was changed.

## 7. Tests and evidence

Environment: locally installed Node 24.11.1, `TZ=UTC`, `CI=true`; local PostgreSQL 18.1 on an isolated temporary cluster. Node 20 and PostgreSQL 16 were not installed, and the installed Docker CLI had no running Docker daemon, so the exact GitHub versions were not locally available.

| Test | Result |
|---|---:|
| WP3 reader unit + API + legacy equivalence | 38 pass, 0 fail, 0 skip |
| Disposable PostgreSQL WP3 integration | 6 pass, 0 fail, 0 skip |
| WP3 focused total after aggregate-freshness fix | 44 pass, 0 fail, 0 skip |
| Targeted concurrent: `track_r_option_b` + WP3 PostgreSQL integration | 13 pass, 0 fail, 0 skip |
| Full suite after aggregate-freshness fix, fresh DB, serial baseline | 645 total: 541 pass, 0 fail, 104 pre-existing skip |
| Full suite, fresh DB, CI-like concurrency 2, attempt 1 | Exit 1; WP3/focus/track_r passed, failures confined to pre-existing shared-schema collision in `cp4_postgres_integration.test.js` |
| Full suite, fresh DB, CI-like concurrency 2, attempt 2 | Reproduced pre-existing shared-schema lock race; interrupted after `cp4_batch_fencing` held an idle transaction/ACCESS EXCLUSIVE relation lock while `cp4_postgres_integration` waited to replace the same schemas |

### Concurrent full-suite baseline classification

The concurrent failure is outside this WP3 diff. The four observed participants are byte-identical to `origin/main`:

| File | HEAD blob | `origin/main` blob | Same |
|---|---|---|---:|
| `tests/cp4_batch_fencing.test.js` | `d6e96bada211ec5a1a9851693fa6a1274dc90f9f` | same | yes |
| `tests/cp4_postgres_integration.test.js` | `ba372cf88a34e67ecff131d9c5472dd4638158e4` | same | yes |
| `tests/branch_stock_generation.test.js` | `b84796eaf6ccb47ad1d3ec7fa77568e3f69f92c3` | same | yes |
| `tests/branch_stock_current_dual_write.test.js` | `cf7512d6c1bfc0b1244f8758cab686288964d9ab` | same | yes |

Observed collision evidence included `relation "ingest.branch_stock_retirements" does not exist`, a mismatched `ingest.sync_runs` shape, and simultaneous relation locks caused by old tests dropping/recreating shared `ingest`/`ada` schemas. The full serial green run and targeted concurrent 13/13 run separate this repository-wide baseline race from the WP3 disposable-database isolation.

## 8. Regression protections

- Inactive `002` plus arbitrary inactive `999`, with `002` advancing the Legacy aggregate timestamp beyond Normalized: `matches=true`, `inputFreshness=0`, all mismatch counts zero, and scoped digests equal.
- Active `001` timestamp drift: `matches=false`, `inputFreshness=1`, scoped digests differ, and the example identifies branch `001`.
- Active missing `003`: input branch membership and generation mismatch remain reported.
- Thai name, English name, barcode, and unit are asserted through unit, API, and real-PostgreSQL paths.
- Conflicting sparse ADA master metadata versus wide metadata proves wide-visible values win.
- SQL provenance assertions prove normalized stock state queries only `ada.branch_stock_current`, while the metadata query contains no `qty_branch_*` or current-stock columns.
- Every output comparison category remains exercised: row membership, action, current/target/shortage/transfer/purchase quantities, donor plan, priority, flags, and summary.
- The disposable PostgreSQL test retains a destructive-operation guard that refuses reset against the shared test database and asserts no schema-changing SQL was issued there.
- Each WP3 PostgreSQL run printed successful disposable-database removal with zero open connections; post-run catalog checks found zero `wp3_reader_%` databases.

## 9. Legacy equivalence

`tests/stock_recommendations_legacy_equivalence.test.js` passes against its checked-in `origin/main` SQL/response fixture without Git-history access. The production Legacy SELECT and recommendation engine were not changed.

## 10. Acceptance decision for the 2026-09-02 evidence

Count the 2026-09-02 result as **PASS 1/3**. All recommendation outputs for the real active scope agreed: actions, current stock, target/shortage/transfer/purchase quantities, donor plans, flags, priorities, summaries, and row membership each had zero mismatches. The old `comparison_status=mismatch` is classified as comparator-only false evidence caused by inactive branch `002`, aggregate freshness influenced by that inactive branch, and the non-equivalent sparse metadata source; each cause is covered by the corrected comparator and regression tests in this packet. After deployment, the next natural daily shadow result should be evaluated as round 2/3.

## 11. Risks and follow-up

- Remaining expected dependency: wide snapshot metadata, documented above.
- Existing repository-wide PostgreSQL tests are not fully isolated and can fail or hang under concurrent full-suite execution. Fixing those unrelated files would expand this change's scope and was intentionally not attempted.
- Validation used local Node 24.11.1/PostgreSQL 18.1 rather than CI's Node 20/PostgreSQL 16 due local availability. No version-specific feature was introduced, but CI remains the authoritative version check after an authorized commit/push.
- No production comparison was rerun, because doing so would require post-review deployment/operational authorization.

## 12. Local implementation safety and cleanup

- Before the later release authorization, no production query/write, migration apply, Render change, environment change, branch-PC/Agent change, commit, push, PR open/update, merge, or deploy occurred.
- Release execution is intentionally handled after this local evidence packet, with CI required to pass before merge and backend deployment.
- All temporary full-suite databases and WP3 disposable databases were removed; open disposable connections were zero.
- The dedicated local PostgreSQL test cluster is stopped and its temporary data directory removed before final handoff.
- Syntax checks passed for all five changed JavaScript files; `git diff --check` passed.
- No `.env`, package manifest, or lockfile changed; the added-line secret scan found zero matches.

Pre-commit `git status --short` captured for review:

```text
 M apps/admin-api/src/services/stockRecommendationReaders.js
 M apps/admin-api/src/services/stockRecommendations.js
 M tests/stock_recommendation_reader_postgres.test.js
 M tests/stock_recommendation_readers.test.js
 M tests/stock_recommendations_api.test.js
?? WP3_NORMALIZED_READER_COMPARATOR_FIX_REVIEW_PACKET.md
```
