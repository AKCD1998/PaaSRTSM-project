# CP4, retirement, and reconciliation rollout runbook

> Last verified: 2026-08-04 (Asia/Bangkok)
>
> This is the operator runbook for sealed Backend candidate
> `4c376fb15bf87bb231ebdef3cee2b3173608efcc` and sealed Agent candidate
> `248980f59d5e678ac3dde6a9ccc5d1a1beeb158f`. Re-query Render and the
> database immediately before a rollout; the production facts below are a
> dated baseline, not permission to deploy later without a fresh preflight.

## Post-rollout status addendum — 2026-08-05

The candidate/topology text below is preserved as the pre-rollout baseline.
Current cross-verified coordination state is:

- Backend and the one Worker are live on merge
  `4db9b7c76b677311a57b5ea297e4b44f51a9087d`; migrations 066-069 were
  applied in order on 2026-08-04.
- Gate 4 passed on hybrid run 1907: 67/67 batches applied once, retirement
  `done`, reconciliation `pass`, four matching manifests, and zero direct
  wide/normalized quantity or membership mismatch.
- Gate 5 passed on v1 run 1913: 6,649/6,649 membership, retirement `done`,
  reconciliation `pass`, zero direct cross-table mismatch, and approximately
  2.364 seconds from retirement eligibility to reconciliation pass. The
  four-branch serial projection is approximately 9.46 seconds versus the
  7.5-minute budget.
- Agent `248980f...` was merged to SC `main` as
  `26c6800163261a4748191c3b4e7e16dec274e46a`. The current phase is Gate 6
  fleet convergence; no additional branch should be enabled for CP4 until two
  complete simultaneous full-sync fleet windows meet this runbook's gates.
- Self-update distributes CP4-capable code but does not edit the ignored
  per-branch `.env`. A branch remains v1 until a separately authorized config
  change sets `ADAPOS_SYNC_V2_DATASETS=branch_stock`.
- Gate-4 memory was independently replayed as 75.67% rather than the earlier
  81.11% report. Both are below the 95% stop threshold; the discrepancy does
  not change the pass outcome.
- `ingest.sync_runs.retirement_finalized_at` is a legacy unused audit column.
  Runtime authority is the same-run row in
  `ingest.branch_stock_retirements`, especially `status` and `completed_at`.
  Do not use the legacy column as a lifecycle completion check.
- The shadow acceptance duration is not yet fixed at one or two weeks. The
  90-day reconciliation/retirement retention default preserves evidence but
  does not define how long a clean streak must be before WP3.

These facts update current position only. They do not erase the earlier canary,
topology, rollback, or failure evidence below. Every future production change
still requires a fresh live preflight and explicit human authorization.

The release is shadow infrastructure. It does not move any stock reader, change
the branch-stock UI, publish stock recommendations, or automate a transfer.
Its purpose is to apply `branch_stock` through one durable worker, retire rows
missing from a complete full snapshot, and record whether the committed wide
and normalized stock agree with the Agent's manifest.

## Non-negotiable invariants

1. Keep the existing 08:20/19:20 branch schedules. Do not stagger branches as
   a capacity workaround.
2. Update the one existing Render worker. Never create a second worker service
   and never run the worker inside the web process.
3. Web and worker must run the same reviewed backend merge SHA. Keep the worker
   at one instance.
4. Drain eligible work and suspend the old worker before changing its revision.
   `worker.js` has no graceful `SIGTERM` drain handler, and Render deploys may
   briefly overlap old and new instances.
5. Migrations 066-069 are additive. Roll back application code if necessary,
   but keep the schema and audit rows; do not down-migrate during an incident.
6. Keep Microsoft SQL/AdaPOS as the source of truth. Reconciliation is
   shadow-only evidence and must never repair stock automatically.
7. Do not change or copy production secrets for this release. The web and the
   existing worker intentionally use the same backend database; the Agent's
   SQL Server credentials remain only on its branch PC.
8. Freeze feature work in CP4/reconciliation/retirement until this rollout is
   accepted. Refactoring and unrelated features remain on separate branches.

## Verified production topology (2026-08-04)

| Component | Current fact | Rollout implication |
|---|---|---|
| Web `srv-d6c0sd0gjchc73fvup5g` | `main`, one Starter instance, live SHA `0faabd6b1026bcc34c68a8bf9e59ea8b4b9be93f`, auto-deploy `checksPass` | Merging an approved PR to `main` starts the web deploy automatically. Do **not** also trigger a manual deploy. |
| Web pre-deploy | `npm run db:migrate` | Migrations 066-069 are owned by the web pre-deploy step and must run exactly once there. |
| Worker `srv-d9fiumrtqb8s73d6t0u0` | one Starter instance, auto-deploy off, branch `fix/cp4-branch-stock-safe-apply`, live SHA `e2fb16841d5c49869f5aef3f81e3eea6ac3a5318` | Change the existing worker to the approved backend merge SHA under human control. Do not create another worker. |
| Worker command | `npm run sync:worker`; no pre-deploy command | The worker must not run migrations. Keep auto-deploy off during the canary. |
| Database | existing Render Postgres plan; no plan upgrade assumed | Every expansion decision is governed by the capacity gate below. |

## Evidence already complete

- Both sealed commits passed the post-seal gates: backend mocked
  `487/426/0/61`, real PostgreSQL `57/57`, Agent `55/55`, and E2E migration
  guard `7/7`.
- One supervised branch-004 Agent canary ran candidate `248980f...` against the
  old production Backend/Worker as run 1906. It completed `67/67` batches and
  6,637 stock records with no retry, HTTP error, or queue residue.
- Run 1906 proves Agent-to-old-Backend compatibility only. It does **not** prove
  retirement or reconciliation because migrations 066-069 and backend
  candidate `4c376fb...` were not live.
- Run 1906 is the initial capacity baseline, not a scale claim. CP4 staging had
  67 requests over 05:07:49-05:08:11Z with 3,543 ms aggregate response time;
  the immediately following legacy stock-history upload had 67 requests over
  05:08:13-05:09:09Z with 38,622 ms aggregate response time. PostgreSQL MAX CPU
  touched its 0.1 limit for one one-minute sample and recovered afterward.
  These coarse metrics cannot attribute CPU to either path individually, and
  aggregate HTTP response time is not a CPU measurement.

## Rollout gates

No gate authorizes the next gate automatically. Each production mutation still
requires explicit human approval.

### Gate 0 — release identity and recovery evidence

Before opening a PR or touching Render:

1. Confirm backend candidate SHA `4c376fb...` is clean, has parent `0faabd6...`,
   and contains exactly the reviewed 19 paths.
2. Confirm Agent candidate SHA `248980f...` is clean, has parent `a024a76...`,
   and contains exactly the reviewed 12 paths.
3. Rerun the four post-seal test groups if either SHA or any dependency has
   changed. A changed SHA is a new candidate and must pass cross-verification.
4. Confirm a usable database recovery point or an approved logical-backup
   procedure exists before migration. If neither can be demonstrated, stop.
5. Record the live web/worker deploy IDs and SHAs. Never copy a rollback SHA
   from this document without checking Render again.

### Gate 1 — fresh live preflight and drain

Perform this in a staffed off-window, with no branch Agent currently running:

1. Health is HTTP 200; no recent web/worker crash, restart, DB acquisition
   timeout, statement timeout, 499, or 5xx burst is active.
2. Database CPU, memory, and active connections have recovered to normal
   idle-range values. Record, do not infer, the pre-rollout baseline.
3. No recent `ingest.sync_runs` row is genuinely active. Old orphaned `running`
   history must be identified separately rather than treated as a live sender.
4. Every CP4 batch is terminal and the oldest eligible batch is absent.
   Investigate or explicitly adjudicate any queued, processing, retrying, or
   dead-letter work before continuing.
5. Confirm migrations 066-069 are not already recorded, then record before
   counts for the wide stock table and expected normalized backfill.
6. Freeze manual resyncs. For any branch task temporarily disabled, first
   verify it is `Ready`, check for a live process, account for
   `StartWhenAvailable=true`, and recheck after disabling. Disabling a task
   does not stop an already-running instance.
7. Human suspends the existing worker only after the queue is drained. Verify
   its heartbeat stops and that no worker instance remains before merging the
   backend.

Useful read-only inventory before migrations:

```sql
SELECT status, count(*) AS batches,
       min(COALESCE(queued_at, next_attempt_at, created_at)) AS oldest
FROM ingest.sync_batches
GROUP BY status
ORDER BY status;

SELECT filename
FROM public.schema_migrations
WHERE filename ~ 'migrations/0(66|67|68|69)_'
ORDER BY filename;
```

### Gate 2 — web and migrations

1. Push the sealed backend release branch and open a PR against `main`.
2. Require CI and a final manifest/secret scan. Merge only the reviewed SHA.
3. Because the web uses `autoDeploy=checksPass`, the merge triggers one web
   deploy. Do not call a second manual deploy.
4. Watch the pre-deploy output. It must apply 066, 067, 068, and 069 in order.
   If pre-deploy fails, keep the worker suspended and do not retry blindly.
5. Require the web to become live on the backend merge SHA and `/admin/health`
   to return 200. Confirm ordinary branch-stock and request pages still read
   the unchanged wide table.
6. Verify all four migration rows and objects, plus the normalized backfill.
   Zero-stock rows that existed only in legacy v1 history cannot be recovered
   by migration 066; the next complete branch sync supplies them.

```sql
SELECT filename, applied_at
FROM public.schema_migrations
WHERE filename ~ 'migrations/0(66|67|68|69)_'
ORDER BY filename;

SELECT
  to_regclass('ada.branch_stock_current') AS normalized_stock,
  to_regclass('ingest.branch_stock_reconciliations') AS reconciliations,
  to_regclass('ingest.branch_stock_retirements') AS retirements;

SELECT branch_code, count(*) AS rows, max(synced_at) AS latest
FROM ada.branch_stock_current
GROUP BY branch_code
ORDER BY branch_code;
```

### Gate 3 — replace the existing worker

1. Keep the worker at one instance and auto-deploy off.
2. Point the existing worker service at `main` and deploy the exact same merge
   SHA now live on the web. Do not provision a second worker and do not add a
   worker migration command.
3. Prefer building/deploying while suspended if the Render dashboard permits.
   If Render requires a resume before deploy, keep all senders frozen and the
   queue empty so an old/new overlap has nothing to claim.
4. Before unfreezing any sender, require one `STARTED` event and three
   consecutive one-minute `HEARTBEAT` events from the new revision, no warning
   or error, and an empty eligible queue.
5. Alert/stop if no heartbeat is observed for more than three configured
   heartbeat intervals or any `DEAD_LETTER`, `REFUSED`, lease-ownership, or
   reaper event appears unexpectedly.

### Gate 4 — branch-004 hybrid lifecycle canary

At the next staffed normal 08:20 or 19:20 window, run branch 004 once with the
sealed Agent candidate and CP4 `branch_stock` enabled. This is not a schedule
stagger: the official schedule remains unchanged. Apply the local
single-sender/task controls, start once, and never auto-retry a failed canary.

The canary passes correctness only if all of the following are true:

- ordinary datasets finish and the run is `success`;
- handoff and apply are complete, every expected batch is `applied`, attempts
  remain 1, and no nonterminal batch remains;
- retirement becomes `done`, expected and actual membership counts equal the
  Agent's unique product count, and every nonzero retired-row count is reviewed
  against source membership before expansion;
- reconciliation becomes `pass`, both wide and normalized manifests match the
  payload, mismatch count is zero, and the evidence is tied to the same
  `sync_run_id`;
- no user-facing stock reader changes behavior and branch 004's stock timestamp
  advances to this generation;
- all capacity conditions in the next section pass.

Lifecycle query:

```sql
SELECT r.sync_run_id, r.branch_code, r.ingestion_mode, r.status,
       r.handoff_status, r.apply_status, r.total_batches,
       r.applied_batches, r.failed_batches, r.started_at,
       r.handoff_finished_at, r.applied_at, r.finished_at,
       t.status AS retirement_status, t.attempts AS retirement_attempts,
       t.expected_membership_count, t.actual_membership_count,
       t.retired_normalized_count, t.retired_wide_count, t.completed_at,
       c.status AS reconciliation_status,
       c.attempts AS reconciliation_attempts,
       c.mismatch_summary, c.reconciled_at
FROM ingest.sync_runs r
LEFT JOIN ingest.branch_stock_retirements t USING (sync_run_id)
LEFT JOIN ingest.branch_stock_reconciliations c USING (sync_run_id)
WHERE r.sync_run_id = :sync_run_id;

SELECT status, count(*) AS batches, sum(record_count) AS records,
       max(attempts) AS max_attempts,
       min(created_at) AS first_staged,
       max(applied_at) AS last_applied
FROM ingest.sync_batches
WHERE sync_run_id = :sync_run_id
GROUP BY status;
```

### Gate 5 — v1 lifecycle capacity proof before fleet merge

Merging the Agent to SC `main` makes every remaining v1 branch register
reconciliation at its next run. The manifest request is small, but each full
v1 generation adds catalog-wide retirement and reconciliation work. Therefore
fleet merge is blocked until the new Backend/Worker processes one supervised
production-representative **v1** lifecycle under the capacity gate.

The preferred no-new-code test is one separately authorized branch-004
candidate run with CP4 datasets temporarily empty in the throwaway candidate
environment only. Do not edit the official checkout or permanent Scheduled
Task configuration, restore the same single-sender controls, and run once at a
staffed normal window. If this operational test is not accepted, add a reviewed
per-branch reconciliation enable flag and rebuild/retest the candidate instead;
do not merge fleet-wide without either form of staged evidence.

Let `T` be the measured elapsed time from the v1 retirement becoming eligible
until reconciliation reaches `pass`. The current four non-004 branches are
processed serially by one worker. Require `4 * T <= 7.5 minutes`; this gives a
2x safety margin under the 15-minute oldest-job ceiling. If the inequality or
any capacity condition fails, stop and add staged enablement or reduce work
before fleet merge. This is a rollout budget, not proof of 100-1,000 branch
capacity.

### Gate 6 — fleet convergence, then branch-by-branch CP4 expansion

1. Merge the already-tested Agent revision to SC `main` only after Gates 4-5.
   Fleet update then puts every branch on one maintained code version; branches
   without the CP4 dataset flag remain v1.
2. Observe at least two complete simultaneous fleet windows. Every branch must
   reconcile to `pass`, the queue must drain within the capacity budget, and no
   stock/request page may show a new error burst.
3. Enable CP4 `branch_stock` for one additional branch at a time. Keep the
   shared 08:20/19:20 schedule and apply the capacity gate after each expansion.
4. Do not enable another dataset, move a stock reader to the normalized table,
   or begin WP4 recommendation recompute until the shadow evidence acceptance
   period is complete.

## Capacity gate

Collect one-minute Render metrics from five minutes before the first Agent
request until at least ten minutes after the final reconciliation. Save the
exact run window, `sync_run_id`, Agent SHA, web SHA, worker SHA, and active
branch count with the measurements.

Measure both consecutive ingestion paths separately:

- `/api/sync/v2/batches`: request count, first/last timestamp, aggregate
  response time, p95, maximum, and non-2xx count;
- `/api/sync/ada/stock-snapshots`: the same measurements;
- worker apply, retirement, and reconciliation: eligibility, first claim,
  terminal timestamp, attempts, and terminal status;
- database: MAX CPU versus limit, memory versus limit, active connections;
- web: 499/5xx, `DB_UNAVAILABLE`, statement timeout, restart/crash, and p95;
- worker: heartbeat continuity, retry/reaper/refused/dead-letter events;
- queue: maximum oldest eligible age and time to fully drain.

The aggregate response-time ratio between endpoints is only a latency signal;
do not describe it as a CPU ratio. One-minute database metrics may show overlap
but cannot attribute CPU to a specific query or endpoint.

### GO conditions (all required)

| Signal | Required result |
|---|---|
| Correctness | Full Gate-4 lifecycle reaches `apply → retirement done → reconciliation pass`; mismatch zero; no duplicate apply. |
| HTTP | Zero sync-route 499/5xx; zero unexpected sync 4xx; zero new user-facing 5xx burst; zero `DB_UNAVAILABLE` or statement-timeout event. |
| Agent/run | Terminal success within the existing 30-minute Agent wait limit; no automatic second attempt. |
| Queue | Oldest eligible batch/retirement/reconciliation job stays below 15 minutes and every job drains to its expected terminal state. |
| Worker | No heartbeat gap longer than three one-minute intervals; no unexpected retry, reaper, refused, dead-letter, or lost-lease event. |
| CPU | Fewer than three consecutive one-minute MAX samples at or above 99% of the CPU limit, and CPU falls below 80% of the limit within five minutes after the final ingestion request. One isolated cap sample may pass only if every other condition passes. |
| Memory | No one-minute sample reaches 95% of the memory limit. |
| Connections | No acquisition timeout and fewer than three consecutive samples at 10 or more active connections. |
| Request latency | No ingestion request reaches 30 seconds; record per-path p95/max and compare with run 1906 rather than assuming the two paths have equal cost. |
| Fleet projection | Before fleet merge, the measured v1 lifecycle satisfies `4 * T <= 7.5 minutes`. |

The CPU, memory, connection, and latency limits above are conservative first-
rollout stop thresholds derived from the healthy canary and the 2026-08-04
incident (healthy peak connections 6; degraded window 12-15). Recalibrate them
only from preserved production evidence and an explicit human decision, never
mid-canary to turn a failure into a pass.

### 2026-08-17 addendum — how to READ a borderline Memory sample (numeric threshold unchanged)

Recorded by Claude/Sonnet 5, acting temporarily as Tech Lead at explicit human
direction, for whoever resumes this workstream (Codex or otherwise). This is
an addition, not a replacement — the 95%-of-limit Memory STOP threshold above
is UNCHANGED. What changed is guidance on how to interpret a sample that
reaches it, based on evidence gathered today that did not exist when the
original threshold was set.

**Context**: the Postgres plan was upgraded from the original small canary
plan to `basic_1gb` (0.5 vCPU / ~1024 MiB) earlier in this engagement (see
Gate 6 closure, `_ledger/codex.md` CLAIM-X-227 and `_ledger/claude.md`). The
Memory/CPU/Connections thresholds above were never revisited after that
upgrade. Today, branch 005's first real CP4 window ran concurrently with
branch 004's (two `hybrid_v2` branches at once for the first time), and an
on-demand retest (`SC-StockDay-Ordering` `_ledger/claude.md` CLAIM-C-118/119)
measured a Memory peak of 94.28% of the limit -- technically still a PASS
against the 95% line, but close enough to prompt investigation before this
recurs with a third CP4 branch.

**Finding**: PostgreSQL deliberately fills available memory with buffer
cache (`shared_buffers`) and OS page cache -- unused RAM has no benefit to a
database, so a high Memory% reading does not by itself distinguish "healthy
cache, plenty of real headroom" from "genuinely about to fail." Three
corroborating, directly-checked signals from the same measurement window
support the "healthy cache" reading this time:
- `pg_stat_database` cache hit ratio: 99.1% (essentially all reads served
  from memory, not disk -- a sign of effective, not exhausted, caching);
- no Postgres service restart/status-change event around the peak (`updatedAt`
  on the Render Postgres resource predates today entirely);
- `max_connections=103` against an observed peak of 4-7 connections that day
  -- nowhere near the connections limit, which was not a contributing factor.

One new, NOT-yet-attributed lead was also found and is flagged for whoever
picks this up next, not resolved here: `pg_stat_database.temp_files=23`,
`temp_bytes≈200MB` (cumulative since last stats reset, not isolated to
today's test window) -- this indicates some quer(y/ies), plausibly the
branch-stock reconciliation's wide-vs-normalized comparison over 6,600+
rows per branch, exceed `work_mem` and spill to disk. Worth profiling
(`pg_stat_statements` during a live window) before assuming it is or is not
related to the Memory reading -- not established either way yet.

**What this changes in practice**: when a future Memory sample reaches or
nears the 95% line, do not treat that reading alone as sufficient grounds
to stop/reject a canary. Check the same three signals above first (cache
hit ratio, service restart/event history, actual connection count against
`max_connections`) before concluding real exhaustion occurred. If those
signals are also clean, treat the high Memory% as expected cache behavior,
not a stop condition on its own. The 95% number itself is NOT loosened by
this addendum -- an actual sample at or above 95% is still governed by the
existing STOP-condition process below; this addendum only affects how a
sample approaching that line, or a post-hoc review of one, should be read.

**Not decided here, left open for the real Tech Lead**: whether to formally
replace the Memory threshold's basis (raw %) with one or more of the above
signals, and whether CPU/Connections thresholds also warrant revisiting now
that the plan is 5x larger than when they were set (CPU is expected to
self-scale with plan size since it is a true consumption/limit ratio, unlike
Memory; Connections has enormous headroom at 4-7 observed against
`max_connections=103` and was not investigated further today because it
was never close to binding). Raw evidence for all of this is preserved in
`SC-StockDay-Ordering` `_ledger/claude.md` (search today's date) for
independent review.

### Immediate STOP conditions

Stop expansion, preserve evidence, and do not retry automatically if any of
these occurs:

- wrong SHA, migration order, service, branch, or more than one worker;
- duplicate Agent/worker, a Scheduled Task fires during a manual canary, or a
  task cannot be restored exactly;
- retirement is `refused`/`dead_letter`, reconciliation is `fail`/
  `dead_letter`, a mismatch is nonzero, or generation membership differs;
- any stock batch applies twice, remains nonterminal, or exceeds its lease;
- any capacity GO condition fails;
- branch stock becomes less fresh than the other branches or the source count/
  hash cannot be tied to the same generation;
- the web restarts, health becomes non-200, or users receive a new 5xx burst.

## Rollback order

Rollback stops the source before changing consumers:

1. Disable the branch-004 candidate/CP4 source under the task-state and
   duplicate-process controls. Do not start another attempt.
2. Wait for or explicitly adjudicate already-accepted work; preserve queue,
   reconciliation, retirement, and Render evidence.
3. Suspend the worker. Confirm no process or heartbeat remains.
4. If application rollback is needed, roll the web to the freshly re-confirmed
   pre-release live commit (the 2026-08-04 reference is `0faabd6...`). Keep
   migrations 066-069 and their tables.
5. Restore the existing worker only on a revision compatible with the restored
   web, still one instance. If compatibility cannot be proven, leave it
   suspended and keep senders frozen until a reviewed fix exists.
6. Restore official Scheduled Tasks/config exactly, verify a single sender,
   then obtain separate human approval before resuming normal sync.
7. If the Agent had already been merged to `main`, use a normal reviewed revert
   commit. Do not permanently pin individual PCs to divergent candidate code.

Rollback success means the known-good web is healthy, no duplicate sender or
worker exists, the queue is terminal/adjudicated, stock freshness is understood,
and no new writes occur without explicit approval. It does not mean deleting
the additive schema or audit evidence.

## Retention and ongoing alerts

The worker removes payloads only after terminal outcomes:

- applied batches after `WORKER_APPLIED_RETENTION_DAYS` (default 30);
- terminal batches after `WORKER_TERMINAL_RETENTION_DAYS` (default 90);
- abandoned staged batches after `WORKER_ABANDONED_STAGED_RETENTION_DAYS`
  (default 7);
- reconciliation and retirement rows after their independent 90-day defaults.

Alert on heartbeat loss longer than three intervals, any dead letter/refusal,
oldest eligible work at 10 minutes (warning) or 15 minutes (stop), repeated
lease reaping, reconciliation mismatch, or stock freshness outside the agreed
fleet window. Retention must remain enabled from day one; evidence counts and
terminal outcomes should be reported before pruning.
