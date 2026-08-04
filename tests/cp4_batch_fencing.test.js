"use strict";

// CP4 batch-apply pipeline fencing (self-filed CLAIM-C-058, confirmed by
// Codex gpt-5.6-sol xhigh on the real production functions with an
// independent adversarial probe reproducing both a dead-letter-then-zombie-
// commit and an A/B lease-steal). This is the SAME ownership-fencing class
// already fixed for the retirement queue (CLAIM-C-056/X-050) and the
// reconciliation queue plus retirement's own catch block (CLAIM-C-057/X-052),
// applied here to `processOneBatch`/`claimNextBatch`/`reapStuckBatches` — the
// oldest, most foundational queue in this system (CP4 async ingestion),
// which predates the whole branch-stock generation review chain.
//
// Required test scenarios:
//   1. a worker fenced out AFTER its batch is already dead-lettered (max
//      attempts reached) must not be able to commit stock when it resumes
//   2. Worker A loses its lease, Worker B legitimately claims the SAME
//      batch, Worker A resumes — must not steal/cancel B's lease, and B
//      must still be able to complete normally
//   3. the reaper running concurrently with a live (not actually dead)
//      worker must not let the worker's stock commit land under a
//      terminal row the queue no longer agrees with
//   4. a forced zero-row final UPDATE must roll back any stock already
//      applied in the same transaction
//   5. a normal (non-adversarial) retry after a transient failure must
//      still be able to complete successfully — the fence must not break
//      legitimate retry/reclaim

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const {
  processOneBatch, reapStuckBatches, claimNextBatch,
} = require("../apps/admin-api/src/worker");

const databaseUrl = process.env.CP4_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 12 }) : null;

const migrationsDir = path.join(__dirname, "..", "migrations");
const sql060 = fs.readFileSync(path.join(migrationsDir, "060_add_async_ingestion_queue.sql"), "utf8");
const sql066 = fs.readFileSync(path.join(migrationsDir, "066_add_ada_branch_stock_current.sql"), "utf8");
const sql067 = fs.readFileSync(path.join(migrationsDir, "067_add_branch_stock_reconciliation.sql"), "utf8");
const sql068 = fs.readFileSync(path.join(migrationsDir, "068_add_branch_stock_generation_tracking.sql"), "utf8");
const sql069 = fs.readFileSync(path.join(migrationsDir, "069_add_branch_stock_retirements.sql"), "utf8");

async function buildRealSchema() {
  await pool.query(`
    DROP SCHEMA IF EXISTS ingest CASCADE; DROP SCHEMA IF EXISTS ada CASCADE;
    CREATE SCHEMA ingest; CREATE SCHEMA ada;
    CREATE TABLE ingest.sync_runs (
      sync_run_id bigserial PRIMARY KEY, sync_type text NOT NULL, source_name text NOT NULL,
      started_at timestamptz NOT NULL, finished_at timestamptz,
      status text NOT NULL CHECK (status IN ('queued','running','success','failed')),
      records_read integer NOT NULL DEFAULT 0, records_sent integer NOT NULL DEFAULT 0,
      message text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE ada.branch_stock_snapshots (
      product_code text PRIMARY KEY, product_name_thai text, product_name_eng text, barcode text, unit text,
      qty_branch_000 numeric(14,4) NOT NULL DEFAULT 0, qty_branch_001 numeric(14,4) NOT NULL DEFAULT 0,
      qty_branch_002 numeric(14,4) NOT NULL DEFAULT 0, qty_branch_003 numeric(14,4) NOT NULL DEFAULT 0,
      qty_branch_004 numeric(14,4) NOT NULL DEFAULT 0, qty_branch_005 numeric(14,4) NOT NULL DEFAULT 0,
      qty_total_all_branches numeric(14,4) NOT NULL DEFAULT 0,
      cost_avg_branch_000 numeric(18,4), cost_avg_branch_001 numeric(18,4), cost_avg_branch_002 numeric(18,4),
      cost_avg_branch_003 numeric(18,4), cost_avg_branch_004 numeric(18,4), cost_avg_branch_005 numeric(18,4),
      synced_at timestamptz NOT NULL, source_system text NOT NULL DEFAULT 'AdaAcc',
      source_table text NOT NULL DEFAULT 'TCNTPdtInWha', source_synced_at timestamptz NOT NULL,
      raw_payload jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(sql060);
  await pool.query(sql066);
  await pool.query(sql067);
  await pool.query(sql068);
  await pool.query(sql069);
}

async function resetData() {
  await pool.query(
    "TRUNCATE ingest.branch_stock_retirements, ingest.branch_stock_reconciliations, ingest.sync_batches, ingest.sync_runs, " +
    "ada.branch_stock_snapshots, ada.branch_stock_current RESTART IDENTITY CASCADE",
  );
}

async function insertHybridRun(branchCode = "000") {
  return (await pool.query(
    `INSERT INTO ingest.sync_runs
       (sync_type, source_name, branch_code, ingestion_mode, handoff_status, apply_status, started_at, status, total_batches, finalized_at, snapshot_mode)
     VALUES ('test','cp4-fencing-test',$1,'hybrid_v2','success','pending', now(), 'running', 1, now(), 'full')
     RETURNING sync_run_id`,
    [branchCode],
  )).rows[0].sync_run_id;
}

async function stockRow(productCode, branchCode) {
  return (await pool.query(
    "SELECT qty_branch_000 AS qty FROM ada.branch_stock_snapshots WHERE product_code = $1", [productCode],
  )).rows[0] || null;
}

async function batchRow(batchId) {
  return (await pool.query(
    "SELECT * FROM ingest.sync_batches WHERE batch_id = $1::bigint", [batchId],
  )).rows[0] || null;
}

async function normalizedStockRow(productCode, branchCode) {
  return (await pool.query(
    "SELECT qty FROM ada.branch_stock_current WHERE product_code = $1 AND branch_code = $2", [productCode, branchCode],
  )).rows[0] || null;
}

async function waitForCondition(checkFn, timeoutMs = 3000, intervalMs = 20) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkFn()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function pausingDb(realPool, shouldPause) {
  let resolveClaimed;
  let releaseGate;
  const claimed = new Promise((resolve) => { resolveClaimed = resolve; });
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  let paused = false;
  return {
    claimed,
    release: () => releaseGate(),
    connect: () => realPool.connect(),
    query: async (sql, params) => {
      const result = await realPool.query(sql, params);
      if (!paused && shouldPause(sql, result)) {
        paused = true;
        resolveClaimed(result.rows[0]);
        await gate;
      }
      return result;
    },
  };
}

function pausesAfterBatchClaim(sql, result) {
  return /UPDATE ingest\.sync_batches b/.test(sql) && /RETURNING b\.batch_id/.test(sql) && result.rowCount === 1;
}

// ---------------------------------------------------------------------------
// SCENARIO 1: a batch already dead-lettered (max attempts reached) must
// reject a resuming worker's stale commit — Codex's exact reproduction.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES (CLAIM-X-058): a worker resuming after its batch is already dead-lettered cannot commit stock", async () => {
  await buildRealSchema();
  await resetData();
  const runId = await insertHybridRun("000");
  const payload = [{ branchCode: "000", productCode: "ZOMBIE", qty: 17, syncedAt: "2026-07-30T01:00:00.000Z" }];
  await pool.query(
    `INSERT INTO ingest.sync_batches (sync_run_id, dataset, batch_seq, payload_hash, payload, record_count, status, queued_at, next_attempt_at, attempts, max_attempts)
     VALUES ($1::bigint, 'branch_stock', 1, 'zombie', $2::jsonb, 1, 'queued', now(), now(), 4, 5)`,
    [runId, JSON.stringify(payload)],
  );

  const dbA = pausingDb(pool, pausesAfterBatchClaim);
  const pendingA = processOneBatch(dbA);
  const jobA = await dbA.claimed;
  assert.equal(jobA.attempts, 5);

  // Reaped for real: attempts already at max, so this goes straight to
  // dead_letter (not retry_wait) — Worker A's own row is already terminal.
  await pool.query("UPDATE ingest.sync_batches SET claimed_at = now() - interval '1 hour' WHERE batch_id = $1::bigint", [jobA.batch_id]);
  const reaped = await reapStuckBatches(pool);
  assert.equal(reaped.rowCount, 1);
  assert.equal((await batchRow(jobA.batch_id)).status, "dead_letter");

  // Worker A resumes (it was never actually dead) and tries to finish.
  dbA.release();
  await pendingA;

  const finalBatch = await batchRow(jobA.batch_id);
  assert.equal(finalBatch.status, "dead_letter", "the dead-lettered batch must not be silently flipped to applied");
  assert.equal(finalBatch.applied_at, null);
  const stock = await stockRow("ZOMBIE", "000");
  assert.equal(stock, null, "the fenced-out worker must not commit any stock row at all");
  const run = (await pool.query("SELECT status, apply_status FROM ingest.sync_runs WHERE sync_run_id=$1::bigint", [runId])).rows[0];
  assert.equal(run.status, "failed");
});

// REVERT-CHECK: this is exactly Codex's own reproduction, run against the
// SAME real functions with the fence temporarily bypassed by using a stale
// job object with the WRONG batch_id would not reproduce it (the fence keys
// on batch_id + attempts, both real) — so to faithfully prove the pre-fix
// gap we replay the OLD (no fence, no rowCount check) SQL sequence directly.
integration("REVERT-CHECK: without fencing, a worker resuming after dead-letter commits stock anyway", async () => {
  await buildRealSchema();
  await resetData();
  const runId = await insertHybridRun("000");
  const payload = [{ branchCode: "000", productCode: "ZOMBIE", qty: 17, syncedAt: "2026-07-30T01:00:00.000Z" }];
  const batchId = (await pool.query(
    `INSERT INTO ingest.sync_batches (sync_run_id, dataset, batch_seq, payload_hash, payload, record_count, status, queued_at, next_attempt_at, attempts, max_attempts)
     VALUES ($1::bigint, 'branch_stock', 1, 'zombie', $2::jsonb, 1, 'processing', now(), now(), 5, 5)
     RETURNING batch_id`,
    [runId, JSON.stringify(payload)],
  )).rows[0].batch_id;
  await pool.query("UPDATE ingest.sync_batches SET status='dead_letter', claimed_at=NULL WHERE batch_id=$1::bigint", [batchId]);
  await pool.query("UPDATE ingest.sync_runs SET status='failed' WHERE sync_run_id=$1::bigint", [runId]);

  // OLD shape: applier commits stock, then the final UPDATE has no rowCount
  // check — it silently affects zero rows (already dead_letter) and nobody
  // notices, so the COMMIT still lands the stock write.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO ada.branch_stock_snapshots (product_code, qty_branch_000, qty_total_all_branches, synced_at, source_synced_at)
       VALUES ('ZOMBIE', 17, 17, now(), now())`,
    );
    await client.query(
      "UPDATE ingest.sync_batches SET status = 'applied', applied_at = now() WHERE batch_id = $1::bigint AND status = 'processing'",
      [batchId],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }

  const stock = await stockRow("ZOMBIE", "000");
  assert.equal(Number(stock.qty), 17, "reproduces CLAIM-X-058: without fencing, stock commits underneath a dead_letter batch");
  assert.equal((await batchRow(batchId)).status, "dead_letter", "reproduces CLAIM-X-058: the queue still (accurately) says dead_letter even though stock was silently written");
});

// ---------------------------------------------------------------------------
// SCENARIO 2: Worker A loses its lease, Worker B legitimately reclaims the
// SAME batch, Worker A resumes — must not steal/cancel B's lease, and B
// must still complete normally.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES (CLAIM-X-058): Worker A cannot steal or cancel Worker B's reclaimed batch lease", async () => {
  await buildRealSchema();
  await resetData();
  const runId = await insertHybridRun("000");
  const payload = [{ branchCode: "000", productCode: "P1", qty: 23, syncedAt: "2026-07-30T01:00:00.000Z" }];
  await pool.query(
    `INSERT INTO ingest.sync_batches (sync_run_id, dataset, batch_seq, payload_hash, payload, record_count, status, queued_at, next_attempt_at, attempts, max_attempts)
     VALUES ($1::bigint, 'branch_stock', 1, 'ab-race', $2::jsonb, 1, 'queued', now(), now(), 0, 5)`,
    [runId, JSON.stringify(payload)],
  );

  const dbA = pausingDb(pool, pausesAfterBatchClaim);
  const pendingA = processOneBatch(dbA);
  const jobA = await dbA.claimed;
  assert.equal(jobA.attempts, 1);

  // A appears stuck (attempts below max -> reaped to retry_wait, reclaimable).
  await pool.query("UPDATE ingest.sync_batches SET claimed_at = now() - interval '1 hour' WHERE batch_id = $1::bigint", [jobA.batch_id]);
  const reaped = await reapStuckBatches(pool);
  assert.equal(reaped.rowCount, 1);
  assert.equal((await batchRow(jobA.batch_id)).status, "retry_wait");
  await pool.query("UPDATE ingest.sync_batches SET next_attempt_at = now() WHERE batch_id = $1::bigint", [jobA.batch_id]);

  // Worker B legitimately claims the SAME batch for real.
  const dbB = pausingDb(pool, pausesAfterBatchClaim);
  const pendingB = processOneBatch(dbB);
  const jobB = await dbB.claimed;
  assert.equal(jobB.attempts, 2);

  // Release A: its applier call succeeds (it doesn't know it's stale), but
  // its final UPDATE (attempts=1) no longer matches the row (attempts=2 now)
  // -> assertExactlyOneRowChanged throws -> A's whole transaction (including
  // its own stock write) rolls back -> A lands in its own catch, fenced.
  dbA.release();
  await pendingA;

  const afterA = await batchRow(jobA.batch_id);
  assert.equal(afterA.status, "processing", "Worker A must not disturb Worker B's legitimately-claimed row");
  assert.equal(afterA.attempts, 2);

  // Let B finish — it must still be able to complete normally.
  dbB.release();
  await pendingB;
  const final = await batchRow(jobA.batch_id);
  assert.equal(final.status, "applied", "Worker B's own legitimate attempt must still be able to succeed");
  const stock = await stockRow("P1", "000");
  assert.equal(Number(stock.qty), 23, "exactly one copy of the stock write must land, from the legitimate owner");
});

// ---------------------------------------------------------------------------
// SCENARIO 5 (normal-path regression check): a genuine transient failure
// followed by a normal retry (no adversarial reclaim) must still succeed —
// the fence must not break ordinary retry/reclaim behavior.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES (CLAIM-X-058 regression check): a normal retry after transient failure still succeeds", async () => {
  await buildRealSchema();
  await resetData();
  const runId = await insertHybridRun("000");
  const payload = [{ branchCode: "000", productCode: "P1", qty: 5, syncedAt: "2026-07-30T01:00:00.000Z" }];
  await pool.query(
    `INSERT INTO ingest.sync_batches (sync_run_id, dataset, batch_seq, payload_hash, payload, record_count, status, queued_at, next_attempt_at, attempts, max_attempts)
     VALUES ($1::bigint, 'branch_stock', 1, 'retry-ok', $2::jsonb, 1, 'queued', now(), now(), 0, 5)`,
    [runId, JSON.stringify(payload)],
  );

  // First attempt: force a genuine (transient-shaped) applier error by
  // poisoning the payload's qty — normalizeBranchStock throws synchronously
  // on an invalid qty, before any DB write, a realistic stand-in for "the
  // upstream data had a bad row this cycle."
  const badPayload = [{ branchCode: "000", productCode: "P1", qty: "not-a-number", syncedAt: "2026-07-30T01:00:00.000Z" }];
  await pool.query("UPDATE ingest.sync_batches SET payload = $2::jsonb WHERE sync_run_id = $1::bigint", [runId, JSON.stringify(badPayload)]);
  const first = await processOneBatch(pool);
  assert.equal(first, true);
  const afterFirst = (await pool.query("SELECT status, attempts FROM ingest.sync_batches WHERE sync_run_id=$1::bigint", [runId])).rows[0];
  assert.equal(afterFirst.status, "retry_wait");
  assert.equal(afterFirst.attempts, 1);

  // Fix the payload (simulating whatever transient condition caused the
  // first failure resolving itself) and let the normal retry proceed.
  await pool.query("UPDATE ingest.sync_batches SET payload = $2::jsonb, next_attempt_at = now() WHERE sync_run_id = $1::bigint", [runId, JSON.stringify(payload)]);
  const second = await processOneBatch(pool);
  assert.equal(second, true);
  const afterSecond = (await pool.query("SELECT status, attempts, applied_at FROM ingest.sync_batches WHERE sync_run_id=$1::bigint", [runId])).rows[0];
  assert.equal(afterSecond.status, "applied", "a normal retry after a transient failure must still be able to succeed");
  assert.equal(afterSecond.attempts, 2);
  assert.ok(afterSecond.applied_at);
  const stock = await stockRow("P1", "000");
  assert.equal(Number(stock.qty), 5);
});

// ---------------------------------------------------------------------------
// CLAIM-X-053 gap-closing tests. Codex's C-059 review confirmed the
// production fix is correct via disposable adversarial probes, but found the
// four tests above don't themselves exercise two specific mechanisms the
// fix relies on: (1) that a live (not actually dead) worker's batch-row
// lock genuinely makes a CONCURRENT reaper wait rather than racing past it,
// and (2) that a zero-row final `applied` UPDATE (not a thrown error) rolls
// back BOTH stock representations. The A/B test above proves a related but
// different property (a worker whose row already moved on gets fenced at
// the START, before ever reaching the applier) — these two tests close the
// remaining gap using the exact techniques Codex's own probes used, now
// checked into the suite permanently.
// ---------------------------------------------------------------------------

integration("REAL POSTGRES (CLAIM-X-053): a live worker's batch-row lock makes a concurrent reaper genuinely wait, not race past it", async () => {
  await buildRealSchema();
  await resetData();
  const runId = await insertHybridRun("000");
  const payload = [{ branchCode: "000", productCode: "LOCKTEST", qty: 47, syncedAt: "2026-07-30T01:00:00.000Z" }];
  await pool.query(
    `INSERT INTO ingest.sync_batches (sync_run_id, dataset, batch_seq, payload_hash, payload, record_count, status, queued_at, next_attempt_at, attempts, max_attempts)
     VALUES ($1::bigint, 'branch_stock', 1, 'live-lock', $2::jsonb, 1, 'queued', now(), now(), 0, 5)`,
    [runId, JSON.stringify(payload)],
  );

  // A separate connection holds an ACCESS EXCLUSIVE lock on the wide stock
  // table the applier writes to, acquired BEFORE the worker even claims —
  // so once the worker reaches its applier call, it genuinely blocks there.
  const blocker = await pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("LOCK TABLE ada.branch_stock_snapshots IN ACCESS EXCLUSIVE MODE");

  // claimNextBatch's own claim UPDATE auto-commits as a standalone statement
  // BEFORE processOneBatch opens its transaction and takes
  // assertStillOwnsBatch's FOR UPDATE lock — so there is a brief, safe window
  // right after the claim (and before that lock) in which claimed_at can be
  // pushed into the past without contending for any lock the worker holds.
  // pausingDb (already defined above) pauses exactly there.
  const dbWorker = pausingDb(pool, pausesAfterBatchClaim);
  const pendingWorker = processOneBatch(dbWorker);
  const jobA = await dbWorker.claimed;
  assert.equal(jobA.attempts, 1);
  await pool.query("UPDATE ingest.sync_batches SET claimed_at = now() - interval '1 hour' WHERE batch_id = $1::bigint", [jobA.batch_id]);
  dbWorker.release();

  const workerBlocked = await waitForCondition(async () => (await pool.query(
    "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%branch_stock_snapshots%'",
  )).rowCount > 0);
  assert.ok(workerBlocked, "the worker must actually be blocked mid-transaction on the stock-table lock before this test proceeds");

  // The real reaper is fired concurrently, exactly the production race
  // (reapStuckBatches runs on its own timer independent of any specific
  // worker). By this point the worker has already re-acquired
  // assertStillOwnsBatch's FOR UPDATE lock on the SAME row (it holds that
  // lock across its whole transaction, including while blocked below on the
  // stock table) — so the reaper's own UPDATE targeting that row must WAIT.
  const reapPromise = reapStuckBatches(pool);

  const reaperWaiting = await waitForCondition(async () => (await pool.query(
    "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%sync_batches%'",
  )).rowCount > 0);
  assert.ok(reaperWaiting, "the reaper's own UPDATE must be waiting on the batch row's lock, not proceeding past it while the worker is still genuinely alive");

  // Release the stock-table lock: the worker's applier completes, its
  // transaction commits (releasing the batch-row lock), and ONLY THEN does
  // the reaper's blocked UPDATE finally get to evaluate — by which point the
  // row is 'applied', not 'processing', so it matches nothing.
  await blocker.query("COMMIT");
  blocker.release();

  const workerResult = await pendingWorker;
  const reapResult = await reapPromise;

  assert.equal(workerResult, true);
  assert.equal(reapResult.rowCount, 0, "the reaper must not reap a batch that had already committed by the time its blocked UPDATE was finally evaluated");
  const finalBatch = await batchRow(jobA.batch_id);
  assert.equal(finalBatch.status, "applied");
  assert.equal(Number((await stockRow("LOCKTEST", "000")).qty), 47);
});

integration("REAL POSTGRES (CLAIM-X-053): a zero-row final 'applied' update rolls back both stock representations", async () => {
  await buildRealSchema();
  await resetData();
  // A BEFORE UPDATE trigger that returns NULL for any row transitioning to
  // 'applied' makes that UPDATE affect zero rows WITHOUT throwing — a
  // different failure shape than an exception, and the exact one
  // assertExactlyOneRowChanged exists to catch. Scoped to this disposable
  // schema only; buildRealSchema() DROPs the whole `ingest` schema at the
  // start of every test in this file, so no cleanup is needed afterward.
  await pool.query(`
    CREATE OR REPLACE FUNCTION ingest.test_suppress_applied()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
    CREATE TRIGGER test_suppress_applied
      BEFORE UPDATE ON ingest.sync_batches
      FOR EACH ROW WHEN (NEW.status = 'applied')
      EXECUTE FUNCTION ingest.test_suppress_applied();
  `);

  const runId = await insertHybridRun("000");
  const payload = [{ branchCode: "000", productCode: "ZEROROW", qty: 31, syncedAt: "2026-07-30T01:00:00.000Z" }];
  const batchId = (await pool.query(
    `INSERT INTO ingest.sync_batches (sync_run_id, dataset, batch_seq, payload_hash, payload, record_count, status, queued_at, next_attempt_at, attempts, max_attempts)
     VALUES ($1::bigint, 'branch_stock', 1, 'zero-row', $2::jsonb, 1, 'queued', now(), now(), 0, 5)
     RETURNING batch_id`,
    [runId, JSON.stringify(payload)],
  )).rows[0].batch_id;

  const result = await processOneBatch(pool);
  assert.equal(result, true);

  const finalBatch = await batchRow(batchId);
  assert.equal(finalBatch.status, "retry_wait", "the suppressed applied-transition must be treated as a failure, not silently ignored");
  assert.match(finalBatch.last_error, /expected to change exactly 1 row but changed 0/);
  assert.equal(finalBatch.applied_at, null);

  const wide = await stockRow("ZEROROW", "000");
  assert.equal(wide, null, "the applier's wide-table write must be rolled back, not left committed underneath a failed status transition");
  const normalized = await normalizedStockRow("ZEROROW", "000");
  assert.equal(normalized, null, "the applier's normalized-table write must be rolled back too");
});
