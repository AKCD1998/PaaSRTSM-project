# WP3 Normalized Reader Source-Present Fix — Review Packet

Date: 2026-09-03

Status: **READY FOR TECH LEAD REVIEW**

Release state: local-only; not committed, pushed, deployed, or enabled

## 1. Baseline and isolation

- Remote checked read-only with `git ls-remote` before creating the worktree.
- Exact baseline: `origin/main@ffb29044499a7316605de6ed667c344c3ed6120a`.
- Branch: `candidate/wp3-normalized-reader-source-present-fix-2026-09-03`.
- Worktree: `C:\Users\scgro\Desktop\Webapp training project\PaaSRTSM-wp3-normalized-reader-source-present-fix-2026-09-03`.
- Commits ahead of the baseline: 0.
- The canonical PaaS worktree and the earlier
  `PaaSRTSM-wp3-normalized-reader-comparator-fix-2026-09-02` worktree were not
  modified.

## 2. Reproduced root cause

The legacy wide reader creates every fixed branch slot whenever a product-wide
row exists and labels every slot `sourcePresent: true`. A retirement sweep can
zero a branch quantity without updating that branch's generation stamp. The
result is a stale zero placeholder whose generation does not match the accepted
current generation.

The normalized reader derives membership from
`ada.branch_stock_current.last_full_sync_run_id = accepted generation`, so the
same product/branch is correctly absent there. Comparing the raw legacy slot to
the normalized slot produced false `inputBranchMembership`, `inputCost`,
`inputFreshness`, and generation evidence differences.

Two focused regression tests were added first and executed against the
unchanged baseline implementation:

- 39 tests total: 37 passed, 2 failed.
- Unit failure: expected a stale wide placeholder to compare as absent, but
  `matches` was false.
- Refresh-path failure: expected persisted status `match`, but received
  `mismatch`.

The 2026-09-03 production observation remains **PASS 2/3** under the Tech Lead's
evidence policy. This candidate does not rewrite that result or any status
document.

## 3. Implementation and layer choice

The fix is limited to the scoped shadow-comparison projection:

1. The shadow refresh passes the independently accepted generation map that was
   already established by normalized eligibility/reconciliation.
2. For an active branch, the legacy comparison view considers the slot present
   only when its per-branch generation stamp equals that branch's accepted
   generation.
3. A stale slot is canonicalized for comparison as absent: quantity 0, null
   cost, null generation, null freshness, and `sourcePresent: false`.
4. A slot stamped with the accepted generation remains present, including a
   genuine quantity of zero.
5. Scoped generation digest input is canonicalized to `branchCode` and
   `syncRunId` for both readers. Rich normalized generation evidence remains
   persisted separately; unscoped comparison behavior is unchanged.

The projection/comparator is the smallest correct layer. Changing the legacy
loader would change the dataset used by the production legacy recommendation
engine and could alter user-facing behavior. Changing the normalized reader
would weaken the authoritative generation-membership contract.

## 4. Files changed

- `apps/admin-api/src/services/stockRecommendationReaders.js`
- `apps/admin-api/src/services/stockRecommendations.js`
- `tests/stock_recommendation_readers.test.js`
- `tests/stock_recommendations_api.test.js`
- `WP3_NORMALIZED_READER_SOURCE_PRESENT_FIX_REVIEW_PACKET.md` (this file)

No migration, schema, environment, package, scheduler, route, UI, or API
contract file changed.

## 5. Behavioral proof

Regression coverage proves:

- stale wide placeholder absent from the accepted generation: match, all
  relevant mismatch counters zero, and digests equal;
- genuine accepted-generation membership with quantity zero: still present and
  matches;
- genuine membership disagreement in the accepted generation: mismatch remains,
  the membership and generation counters increment, digests differ, and the
  example identifies branch `001`;
- unscoped comparator calls retain the previous wide-slot semantics;
- the scheduled shadow-refresh path persists `match`, zero counters, and equal
  digests for the stale-placeholder case.

The pre-existing checked-in equivalence test compares the default legacy result
and exact SQL query log against the frozen `origin/main` fixture. It remains
green, proving the user-facing default legacy response and query behavior did
not change.

## 6. Test results

All tests used local/disposable resources only.

- Focused reader, API, and legacy-equivalence tests: **43/43 passed**.
- WP3 PostgreSQL integration tests: **6/6 passed**.
- Concurrent `track_r_option_b` plus WP3 PostgreSQL tests: **13/13 passed**.
- Final full suite, serial, fresh disposable PostgreSQL 18 database:
  **650 tests — 546 passed, 104 skipped, 0 failed**.

The final full-suite run was repeated after the scoped digest correction. The
temporary database, PostgreSQL cluster, and test processes were then stopped
and removed; port 5554 is closed and no matching PostgreSQL process remains.

## 7. Validation and dependency audit

- JavaScript syntax checks: passed.
- `git diff --check`: passed (Windows LF-to-CRLF notices only).
- Added-line secret scan: 0 findings.
- `.env` changes: 0.
- `package.json` / lockfile changes: 0.
- Migration changes: 0.
- Staged files: 0.
- Local production-dependency audit reports 27 existing findings: 1 low,
  12 moderate, 14 high, 0 critical. No dependency file changed in this
  candidate, so these findings were not introduced here.

## 8. Risks and release assessment

- Scoped shadow projection now depends on the legacy per-branch generation
  stamp and the independently accepted generation map. The shadow flow supplies
  this map only after normalized eligibility/reconciliation succeeds; failure
  paths remain bounded and do not enable normalized serving.
- The full local suite used Node 24 and PostgreSQL 18. CI validation on the
  repository's Node 20 / PostgreSQL 16 environment remains a release gate after
  a future authorized commit and push.
- Existing concurrent integration files can race while dropping shared schemas;
  the full acceptance run was serial, while the relevant WP3 + `track_r` pair
  was explicitly run concurrently and passed.

The candidate is safe to commit and push **only after Tech Lead approval**. It
does not itself authorize merge, deploy, reader-mode change, or acceptance
status change.

## 9. Mutation declaration

No commit, push, PR update, merge, deploy, migration apply, Render/environment
change, production query/write, branch-PC change, Scheduled Task change, manual
sync, or ledger update was performed. SC branches 001 and 004 were not touched.
