# Branch-stock full-snapshot generation contract

Status: implemented locally, NOT deployed. See `_ledger/claude.md` CLAIM-C-046
through C-059 and their fixes below. This document is the design record for
all six authorizations required before any code was written in each: the
"branch-stock generation round," the "remediation round" (durable retirement
queue, fixing X-046/X-047), the second "remediation round" (dependent-
reconciliation terminalization, fixing X-048), the third "remediation round"
(zombie-worker fencing, fixing X-050), the fourth "remediation round"
(fencing every state transition, not just the success path, fixing X-052),
and the fifth "remediation round" (fencing the CP4 batch-apply pipeline,
fixing X-058).

## Problem recap (generation round)

- **CLAIM-C-046**: `reconcileBranchStockJob`'s wide-table read filtered on
  `synced_at_branch_XXX IS NOT NULL`. Legacy v1 branches never wrote that
  column, so the read was permanently empty and every v1 reconciliation
  dead-lettered on `buildBranchStockReconciliationManifest`'s
  empty-snapshot guard.
- **CLAIM-C-047**: reconciliation compares a run-scoped payload manifest
  against a whole-catalog read of `ada.branch_stock_current` /
  `ada.branch_stock_snapshots`. A product that silently disappears from a
  branch's real stock (discontinued, removed from the source system) has no
  retirement mechanism — it stays at its last known nonzero quantity forever
  ("ghost stock"), which is a real data-integrity gap under the *current*
  full-snapshot contract (not merely a "false FAIL" under some future
  delta contract, per the concession in `_ledger/claude.md`).
- **CLAIM-C-048**: fixing C-046 by having v1 stamp its freshness column
  activates a previously-dormant guard in the v2 write path
  (`WHERE synced_at IS NULL OR synced_at <= EXCLUDED.synced_at`). Before this
  round, that guard's `IS NULL` branch always won for a v1-touched row,
  silently letting an older v2 write regress a newer v1 value. This needed to
  be deliberately characterized, not left implicit.

## Problem recap (remediation round — Codex X-046/X-047, both CONFIRMED)

The first round's `finalizeFullSnapshotGeneration` was reachable directly from
run completion with no proof the completing run actually participated in the
new stamping contract, and was invoked fire-and-forget with no durable retry.
Codex found, and this round's real-Postgres probe independently reproduced
byte-for-byte, two severe defects:

- **CLAIM-X-046 (CONFIRMED, was a real data-loss bug)**: a branch whose sync
  agent has not yet been upgraded (still omits `syncRunId` from its stock
  upload, the pre-generation-round shape) never stamps
  `full_sync_run_id_branch_XXX` / `last_full_sync_run_id` on any row it
  writes. The very next time that unmodified agent completes a **completely
  normal, successful** sync after the *backend* is upgraded, the old
  finalization logic saw a complete `status='success'` v1 run and swept every
  row whose generation column was `NULL` — which, for an all-old-agent
  branch, is *every row*. Reproduced directly: a healthy 3-product branch
  (qty 42/17/5) was zeroed to 0/0/0 by nothing more than a second ordinary
  sync from the same unmodified agent. This is not a corner case — it is the
  default outcome for any branch during the gap between backend deploy and
  agent upgrade, which is an inherent, unavoidable window in a staged rollout.
- **CLAIM-X-047 (CONFIRMED)**: `claimNextReconciliation`'s eligibility
  predicate never referenced retirement at all; reconciliation could run (and
  record a misleading PASS or FAIL) before retirement had run for the same
  generation. Both finalize call sites only logged a caught error on failure
  — `routes/sync.js`'s v1 call wasn't even `await`ed — with no code anywhere
  that re-discovers a generation whose retirement never completed. A crash
  between "run marked success" and "finalize actually runs" (worker restart,
  web-process restart, transient SQL error) left that generation's retirement
  silently lost forever.

Root cause of both: the previous round treated **"run reached
status=success/apply_status=applied"** as sufficient proof to retire, and
treated **direct synchronous invocation** as sufficient durability. Neither
holds under realistic operational conditions (staged agent rollout; process
restarts). The remediation below replaces both assumptions with durable,
provable state.

## Generation identity

**Generation identity = `ingest.sync_runs.sync_run_id`** of the branch's
full-stock sync run. This table and column already exist and are already
durable (bigserial PK), already monotonic, and already created before the
first byte of stock data is written (`POST /api/sync/run-start`, both v1 and
hybrid_v2). No new identity table was introduced — reusing this satisfies the
authorization's preference for "a run/generation identifier over
wall-clock-only comparisons."

**Generation completion**:
- v1: `ingest.sync_runs.status = 'success'` (set by `POST /api/sync/run-finish`).
- hybrid_v2: `apply_status = 'applied' AND finalized_at IS NOT NULL AND status <> 'failed'`
  — the same condition `claimNextReconciliation` already used.

## snapshot_mode: full vs delta

`ingest.sync_runs.snapshot_mode` (migration 068) is `'full'` by default and
`CHECK`-constrained to `('full', 'delta')`. **Retirement logic refuses to run
for anything but `'full'`** — enforced twice: `registerRetirementJobIfComplete`
never enqueues a job for a non-full run, and `claimNextRetirement`'s own
gate re-checks `snapshot_mode='full'` (both in
`apps/admin-api/src/worker.js`). There is no delta ingestion implementation
today; this column and check exist purely as a guard rail so a future delta
sync cannot accidentally inherit full-snapshot retirement semantics (a delta
payload's absence of a product means "unchanged," not "gone" — retiring on
that basis would be a data-loss bug). `tests/branch_stock_generation.test.js`
proves this refusal directly against a run explicitly marked `'delta'`.

## Per-row generation stamping

Every branch-stock write now stamps which generation last touched that row
for that branch:

- `ada.branch_stock_snapshots` (wide): 6 new columns
  `full_sync_run_id_branch_000..005`, one per branch, mirroring the existing
  per-branch `synced_at_branch_XXX` columns.
- `ada.branch_stock_current` (normalized): 1 new column
  `last_full_sync_run_id` (the table is already one row per product+branch).

**Write-path asymmetry (deliberate, not accidental)**:

| | qty write | freshness/generation stamp |
|---|---|---|
| Wide table, v1 path (`upsertBranchStockSnapshot`) | unconditional (arrival order) — **unchanged this round, this is QUESTION-004** | unconditional (arrival order) — matches qty |
| Wide table, v2 path (`applyBranchStockBatch`) | guarded (source-timestamp order) — pre-existing | guarded — pre-existing |
| Normalized table, both paths (`upsertBranchStockCurrent`) | guarded (source-timestamp order) — pre-existing | guarded — pre-existing |

The wide table's v1 qty write was **not** touched — doing so would silently
resolve QUESTION-004 (still open) as a side effect of a bug fix. The
bookkeeping columns added this round follow whichever ordering discipline
their own table's qty column already had, so a column never claims a fresher
generation than the qty value actually reflects. This was caught during
design by literally tracing what would happen if the bookkeeping column were
guarded independently of qty (it would let freshness/generation drift ahead
of a stale qty value) — see the code comment in
`apps/admin-api/src/routes/branch-stock.js` above `upsertBranchStockSnapshot`.

## Retirement representation: zero-quantity, not DELETE, not a tombstone flag

Before choosing, every current reader of `ada.branch_stock_snapshots` and
`ada.branch_stock_current` was enumerated (`grep -rn` across
`apps/admin-api/src`, 2026-07-29): `categorization/index.js`,
`routes/branch-stock.js` (the table's own read paths),
`services/focusProducts.js`, `routes/ingredient-admin.js`,
`services/stockRecommendations.js`, `routes/ingredient-knowledge.js`,
`routes/mobile-products.js`, `services/stockRequests.js`, `routes/ordering.js`,
`routes/movement-analytics.js`. Every one of them treats `qty` as the live
number with no separate "is this row still real" check, and
`stockRecommendations.js` already filters on `qty > 0`.

**Decision: retirement zeroes `qty`** (and, for the normalized table, stamps
`retired_at` / `retired_by_sync_run_id` for audit — the wide table has no
spare per-branch columns for that without adding 12 more columns, so it
relies on the generation column + `qty = 0` sentinel instead; nothing reads
retirement status from the wide table specifically today).

Rejected alternatives:
- **DELETE**: destroys history and would need every LEFT JOIN reader
  re-verified as null-safe (most already are, since branch-stock rows are
  frequently absent for brand-new products — but this is unnecessary risk
  for zero benefit).
- **Separate tombstone/status column**: requires threading an
  `AND NOT retired` (or equivalent) into ~10 call sites across 8 files,
  each a new chance to forget one and leak retired stock into a UI or the
  recommendation engine. Zero-quantity needs zero reader changes because
  every reader already treats quantity as the source of truth.

This is non-destructive (row + name/barcode/history stay queryable) and
reversible (the product reappearing in a later full snapshot simply
overwrites `qty` again — no "un-retire" step needed).

## Durable retirement state machine (remediation round)

Retirement is now a durable queue, `ingest.branch_stock_retirements`
(migration 069), one row per `sync_run_id`, deliberately mirroring the
already-proven `ingest.branch_stock_reconciliations` shape (SKIP LOCKED
claim, bounded retry with backoff, terminal states, lease-reap, retention) —
reusing a pattern this codebase already has real-Postgres coverage for,
rather than inventing a second one.

```
pending -> processing -> done                    (success, terminal)
                       -> retry_wait -> processing -> ... -> dead_letter
                       -> refused                  (membership proof failed, terminal)
```

### Registration is atomic with the completion signal, not fire-and-forget

This is the direct fix for the X-047 half of the remediation ("durable
database state... after a transient SQL failure, worker restart, web-process
restart"):

- **v1**: `POST /api/sync/run-finish` (`routes/sync.js`) now registers the
  retirement row in the **same SQL statement** that flips
  `ingest.sync_runs.status` to `'success'`, via a `WITH updated AS (UPDATE
  ...) INSERT INTO ingest.branch_stock_retirements ... SELECT ... FROM
  updated WHERE ... ON CONFLICT (sync_run_id) DO NOTHING`. There is no gap
  between "run recorded successful" and "retirement job exists" — they commit
  in the same statement, so a process crash immediately after can only ever
  land on "both happened" or "neither happened," never "success recorded,
  retirement job lost."
- **v2**: registration happens inside the SAME `BEGIN...COMMIT` transaction
  `processOneBatch` already uses for the batch apply + `recomputeRunStatus`,
  immediately after `recomputeRunStatus` (which is what flips
  `apply_status` to `'applied'`). Same atomicity argument.

Neither path calls `finalizeFullSnapshotGeneration` directly anymore. The
function was split: registration (`registerRetirementJobIfComplete`, in the
same transaction as completion) enqueues a `pending` row; the actual sweep
work moved into a worker-loop-polled job processor, exactly like
reconciliation already does.

### Claiming (`claimNextRetirement`)

SKIP LOCKED claim, gated on the SAME completeness/full-snapshot condition the
old direct-call version checked (v1: `status='success'`; v2:
`apply_status='applied' AND finalized_at IS NOT NULL AND status<>'failed'`;
`snapshot_mode='full'`), plus a same-branch generation-ordering guard
(mirroring `claimNextBatch`'s existing pattern): an earlier, still-pending
retirement for the same branch blocks a later one from claiming, but a
**terminal** earlier retirement (`done`/`refused`/`dead_letter`) does **not**
— preserving the existing no-permanent-block guarantee (X-045) for the new
queue.

### Membership-proof check — the direct fix for X-046

Before sweeping anything, `processRetirementJob` computes:

- **expected membership**: for v1, `uniqueProductCount` from the
  `expected_manifest` already registered in
  `ingest.branch_stock_reconciliations` for this `sync_run_id` (the agent's
  existing, independent, dedicated registration call — not something the
  stock-upload route itself controls). If no manifest is registered yet, the
  job is not yet provable and goes to `retry_wait` (bounded), not `refused`
  — a registration race is plausible and should get a few chances before
  giving up. For hybrid_v2, the same `buildBranchStockReconciliationManifest`
  function is reused directly against `ingest.sync_batches`' own stored
  payload for this run (dataset `branch_stock`), so v1 and v2 use the exact
  same manifest-membership logic, not two parallel implementations.
- **actual membership**: `COUNT(DISTINCT product_code)` in
  `ada.branch_stock_current` for this branch where
  `last_full_sync_run_id = this generation`.

If `actual < expected`, the generation is **refused**, not retried further —
this is the deterministic, stable signal that the writer that produced this
"successful" run never actually stamped it (an old agent, or any future bug
with the same shape), and retrying will never fix it since nothing will
re-write those rows. `refused` is terminal and does **not** sweep anything —
stock is left exactly as-is, ghost rows (if any) remain (the pre-existing,
already-known, strictly-safer C-047-class gap) rather than being wrongly
zeroed. A `refused`/`dead_letter` retirement is also excluded from the
reconciliation eligibility gate below and from blocking later generations'
retirement claims (same non-permanent-block property as reconciliation).

If `actual >= expected`, retirement proceeds exactly as the previous round's
`finalizeFullSnapshotGeneration` did: sweep any row for the branch not
touched by this generation (`last_full_sync_run_id IS NULL OR < this
generation`) to zero-quantity, in both tables, then mark the retirement row
`done`.

### Retry, dead-letter, reaping, retention

`processOneRetirement` mirrors `processOneReconciliation` exactly: bounded
attempts with exponential backoff, `dead_letter` at exhaustion (a transient
SQL failure retries and can still succeed — required test scenario 4);
`maintainRetirements` (mirroring `maintainReconciliations`) reaps
stuck-`processing` leases past a timeout (worker-restart recovery — required
test scenario 5) and prunes aged terminal rows after a retention window. Both
are wired into `runWorkerLoop` alongside the existing reconciliation
maintenance.

**Zombie-worker fencing (third remediation round, CLAIM-X-050, fixed by
CLAIM-C-056)**: reaping a `processing` lease past `STUCK_PROCESSING_MINUTES`
assumes the worker holding it is dead — but "looked stuck" and "is dead" are
not the same thing. Codex found and this round reproduced directly: a worker
that is merely slow (not crashed) can be reaped to `dead_letter` while it is
still actually running, and if it later finishes, its transaction — with no
ownership check anywhere — would zero stock and commit a `done`-shaped result
underneath a queue row that already says the job failed. Fixed with two
layers in `processRetirementJob`:

1. **Ownership fencing**: the very first thing the transaction does is
   `SELECT status, attempts FROM ingest.branch_stock_retirements ... FOR
   UPDATE` and verify both the status is still `processing` and `attempts`
   still equals the value `claimNextRetirement` handed this specific worker
   (its fencing token). If either has moved — reaped, or reclaimed by a
   different attempt — the transaction throws immediately, before touching
   any stock table. Locking the row this early also means a concurrent
   `maintainRetirements()` reap targeting the SAME row blocks on that row
   lock until this transaction ends — a genuinely crashed worker's dropped
   connection releases the lock (and rolls back its transaction)
   automatically, so this does not reintroduce an unbounded stuck-forever
   risk; it only makes a truly-alive-but-slow worker delay the reaper's
   write to that one row, not indefinitely.
2. **Belt-and-suspenders**: every terminal status UPDATE (`refused` x2,
   `done` x1) now also filters on `attempts = $N` and asserts its `rowCount`
   is exactly 1, throwing (and therefore rolling back everything in that
   transaction, including any stock sweep already performed) if not.

**Ownership fencing must cover EVERY state transition, not just the success
path (fourth remediation round, CLAIM-X-052, fixed by CLAIM-C-057)**: fixing
X-050 protected the success path but left `processOneRetirement`'s outer
`catch` block using the OLD ownership condition (`status='processing'`
only — no attempts token). Codex found the resulting race: Worker A claims a
job, is reaped (its lease genuinely expires and is reclaimed — not merely
*looks* stuck), Worker B legitimately claims the SAME job next, and Worker A
then resumes, gets correctly fenced out by the X-050 check inside
`processRetirementJob` (good — it throws "no longer owned"), but that
exception lands A in `processOneRetirement`'s `catch`, which — unaudited —
happily rewrote Worker B's live `processing` row back to `retry_wait` using
Worker A's stale error message. No stock was at risk here (the fenced worker
never reached the sweep), but the durable queue itself could be starved:
a job could bounce between being legitimately claimed and getting yanked
back by a stale worker's catch block, indefinitely.

The fix generalizes the fencing principle Codex named explicitly: **every
state transition a worker performs must prove `status + attempts` still
matches what it was handed, not just the terminal/success transition.**
Auditing the whole state machine for this (not just the one reported
line) found the identical, previously-unaudited gap one level up the same
call stack in the RECONCILIATION queue too — `reconcileBranchStockJob`'s own
success write (`pass`/`fail`) and `processOneReconciliation`'s `catch` both
had the exact same shape as retirement's pre-fix code, for the same reason
(built by mirroring retirement's pattern before retirement itself was fully
fenced). Both were fixed the same way: add `attempts = $N` to the WHERE
clause and check `rowCount`; on a mismatch, the success path throws (routing
into its own `catch`, which itself is now fenced), and a `catch` that no
longer owns the row logs `*_CATCH_LEASE_NOT_OWNED` and returns without
writing anything.

**CP4 batch-apply pipeline fenced too (fifth remediation round, CLAIM-X-058,
fixed by CLAIM-C-059)**: the self-filed finding above (a prior round flagged
this but deliberately did not fix it, pending explicit authorization) was
confirmed by Codex on the real production functions with an adversarial probe
reproducing both directions: (1) a batch already dead-lettered (max attempts
reached) that a stale-but-still-running worker then committed stock
underneath anyway, and (2) Worker A losing its lease, Worker B legitimately
reclaiming the same batch, and Worker A's stale catch overwriting Worker B's
`processing` row back to `retry_wait`. Authorization to fix was then given
explicitly. Fixed with the EXACT same two-layer pattern as the retirement and
reconciliation queues, applied to `processOneBatch`:

1. **Ownership fencing**: `assertStillOwnsBatch` locks the `sync_batches` row
   `FOR UPDATE` and verifies `status='processing' AND attempts` matches the
   value `claimNextBatch` handed this worker, as the very first statement in
   the transaction — before the stock-mutating `applier(...)` call.
2. **Every terminal write fenced**: the success `'applied'` UPDATE and the
   catch's `retry_wait`/`dead_letter` UPDATE both filter on `attempts = $N`
   and check `rowCount`. A mismatch on the success path throws (rolling back
   the whole transaction, including whatever the applier already wrote); a
   mismatch in the catch logs `BATCH_CATCH_LEASE_NOT_OWNED` and returns
   without writing anything — so a fenced-out worker's failure handling can
   never steal or cancel a different, legitimate owner's lease, matching the
   exact fix already proven for the other two queues.

This closes the audit across all three queues in this system (batches,
reconciliations, retirements) with the same invariant: **every state
transition a worker performs must prove `status + attempts` still matches
what it was handed.**

### Reconciliation eligibility now requires retirement `done`

`claimNextReconciliation`'s WHERE clause gained one more condition:
`EXISTS (SELECT 1 FROM ingest.branch_stock_retirements ret WHERE
ret.sync_run_id = candidate_run.sync_run_id AND ret.status = 'done')`. This
enforces the required ordering directly at the claim query, proven through
the actual route/worker lifecycle (not by manually sequencing helper calls
in a test): stock apply complete -> retirement complete -> reconciliation
eligible. A generation whose retirement is `refused` or `dead_letter` simply
never becomes reconciliation-eligible — consistent with "terminal retry
exhaustion does not silently certify reconciliation" (required test
scenario 6): there is no path from a non-`done` retirement status to a
reconciliation PASS.

**Follow-up gap found by Codex (CLAIM-X-048, fixed by CLAIM-C-054/C-055)**:
"never becomes eligible" is correct but incomplete on its own — a
reconciliation row that CAN'T ever become eligible (its retirement is
permanently `refused` or `dead_letter`) was, in the first cut of this round,
simply left at `status='pending'` forever. That has two consequences beyond
just "no reconciliation happens": (1) `maintainReconciliations`' retention
DELETE only ever covered `pass`/`fail`/`dead_letter`, so this evidence
accumulated without bound; (2) `claimNextBatch`'s same-branch ordering guard
treats an earlier `pending` reconciliation on a successfully-completed run as
a live blocker (it only excludes `dead_letter`), so a branch whose retirement
ever lands on `refused` (the exact, intended, safe outcome of the old-agent
compatibility rule below) would have its hybrid_v2 CP4 pipeline wedged
indefinitely on every subsequent batch — a real rollout-blocking regression
introduced by fixing X-046/X-047, reproduced directly before fixing (see
`_ledger/claude.md` VERDICT on X-048).

**Fix**: the moment a retirement job terminalizes as `refused` (inside
`processRetirementJob`, same transaction as the retirement's own status
write) or exhausts retries to `dead_letter` (inside `processOneRetirement`,
immediately after), any dependent reconciliation row still in
`pending`/`processing`/`retry_wait` is moved to `dead_letter` too —
`terminalizeDependentReconciliation` in `worker.js`. This makes it eligible
for the SAME pre-existing retention DELETE (no change needed there once the
status is right) and removes it from `claimNextBatch`'s blocking set (which
already excluded `dead_letter`, just never saw one land there for this
reason). A defense-in-depth "orphaned" scan was added to
`maintainReconciliations` for the one race the inline fix cannot cover: the
agent's manifest-registration call arriving AFTER its retirement has already
exhausted retries to `dead_letter` (at which point no reconciliation row
existed yet to terminalize inline) — this scan finds any reconciliation
whose same-run retirement is already `refused`/`dead_letter` and terminalizes
it too, independent of which code path produced that combination.

## Old-agent compatibility rule

**An agent that does not send `syncRunId` on its stock upload can never
cause retirement to run for its own branch, under any circumstance, no
matter how many times it syncs successfully — but it also never loses stock,
never gets blocked, and its reconciliation shadow-evidence is simply never
produced (which is correct: there is nothing meaningful to reconcile for a
run this backend cannot prove touched the rows it claims to own).** This is
an emergent property of the membership-proof check above, not a special-cased
"if old agent" branch — the SAME check that refuses a `NULL`-generation sweep
also refuses a hypothetical future bug that reports success without actually
writing anything. The old-agent case is simply the concrete instance this
round needed to prove doesn't regress, hence the required compatibility test
(`tests/branch_stock_retirement_durability.test.js`) that reproduces the
exact pre-syncRunId request shape end-to-end through the real
`/branch-stock/sync` route and `/run-finish` and asserts **no existing
nonzero quantity changes**.

## Mixed v1/v2 (CLAIM-C-048) — characterized, not left implicit

Two real-Postgres tests in `tests/branch_stock_generation.test.js` prove both
directions on the real write paths (not a mock):

- **Direction A** (v1 writes newer, then an older v2 batch arrives for the
  same branch/product): now **rejected**. Before this round, it was silently
  **accepted** (regression) because v1 never populated the freshness column
  the v2 guard checks — proven by a dedicated revert-check test that
  reproduces the pre-fix NULL-freshness state directly and confirms the old
  write used to win.
- **Direction B** (v2 writes first, then a newer v1 write arrives): accepted,
  same as before — v1's own qty write was never guarded and stays that way
  (QUESTION-004, not resolved this round).

This is the concrete, tested resolution of C-048: the interaction is no
longer dormant-by-omission, it is a real, proven, asymmetric ordering rule
that only applies during a v1→v2 hybrid rollout transition for a branch.

## QUESTION-004 — still open, deliberately not resolved this round

*"Should the legacy wide table's v1 qty write also get a freshness/ordering
guard, matching the normalized table and the v2 path?"* This round adds the
bookkeeping (generation + freshness columns now populated, reconciliation
can now read them) without changing what quantity value actually wins on a
race — that is a live-production behavior change requiring explicit human
sign-off per the hard boundaries of this round's authorization, not something
to bundle into a bug fix. `tests/branch_stock_current_dual_write.test.js`
already encodes and proves today's (still unchanged) behavior for future
reference. Options for whoever decides this next: (a) add the same
freshness-guard WHERE clause used elsewhere to the wide table's qty column
(makes it consistent with everything else, but changes v1's live
overwrite-wins semantics), or (b) leave arrival-order-wins as the
intentional legacy behavior and document it as such permanently.

## What neither round does

- Does not recompute stock recommendations or change recommendation
  eligibility.
- Does not change `#/branch-stock` or `#/stock-recommendations` UI.
- Does not add automatic stock repair outside the retirement job described
  above.
- Does not implement delta sync (only guards against it retiring anything
  if/when it exists).
- Does not resolve QUESTION-004/005 (legacy wide-table v1 qty-write
  ordering) — still a human product decision, still untouched, including in
  this remediation round.
- Not deployed; no production database was accessed or mutated, in either
  round.
