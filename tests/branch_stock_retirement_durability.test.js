"use strict";

// Branch-stock generation REMEDIATION round (_ledger/claude.md CLAIM-X-046,
// CLAIM-X-047, fixed by CLAIM-C-051/C-052/C-053), extended by the SECOND
// remediation round (CLAIM-X-048, fixed by CLAIM-C-054/C-055; CLAIM-X-049
// conceded as an evidence-labeling accuracy issue, not a stock-safety one —
// see the "old agent + new backend" scenario's updated comment below and the
// scenario 6 relabeling). Adversarial real-Postgres tests driven through the
// ACTUAL Express routes and worker functions — not by manually sequencing
// helpers in the order the test wants — proving the durable retirement
// queue's safety properties end-to-end:
//
//   1. old agent + new backend: no stock mutation (CLAIM-X-046 compatibility)
//   2. new agent + new backend: retirement and reconciliation PASS
//   3. reconciliation cannot claim while retirement is pending/processing/retry_wait
//   4. one forced retirement failure is retried successfully
//   5. process-style interruption leaves durable pending work recoverable
//   6. terminal retry exhaustion does not silently certify reconciliation
//      (this is ALSO the fully-faithful old-agent scenario per CLAIM-X-049:
//      no syncRunId AND no manifest registration call at all)
//   7. duplicate worker execution remains idempotent
//   8. superseded generations retain the existing safety properties
//      (delta-generation safety is covered exhaustively in the sibling file
//      tests/branch_stock_generation.test.js, since there is no HTTP route
//      that can mark a run as snapshot_mode='delta' today — that column is
//      only ever set directly, matching "no delta ingestion implementation
//      exists yet")
//   9. CLAIM-X-048 fix: a retirement ending refused/dead_letter terminalizes
//      its dependent reconciliation instead of leaving it pending forever,
//      that terminalized evidence is retained/pruned by maintenance like any
//      other terminal row, and a later same-branch CP4 batch is NOT
//      permanently blocked by it.
//  10. CLAIM-X-050 fix: a worker whose processing lease was reaped to
//      dead_letter (e.g. it appeared stuck past STUCK_PROCESSING_MINUTES but
//      was actually still alive and merely slow) must be fenced out if it
//      later tries to finish — it must NOT be able to commit a stock sweep
//      while the durable queue says the job failed.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { Pool } = require("pg");
const { createSyncRouter } = require("../apps/admin-api/src/routes/sync");
const { createBranchStockRouter } = require("../apps/admin-api/src/routes/branch-stock");
const {
  processOneReconciliation, processOneRetirement, processRetirementJob, maintainRetirements,
  maintainReconciliations, processOneBatch, claimNextBatch, claimNextRetirement,
} = require("../apps/admin-api/src/worker");
const {
  buildBranchStockReconciliationManifest,
} = require("../apps/admin-api/src/services/branchStockReconciliation");

const databaseUrl = process.env.CP4_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8 }) : null;

const migrationsDir = path.join(__dirname, "..", "migrations");
const sql060 = fs.readFileSync(path.join(migrationsDir, "060_add_async_ingestion_queue.sql"), "utf8");
const sql066 = fs.readFileSync(path.join(migrationsDir, "066_add_ada_branch_stock_current.sql"), "utf8");
const sql067 = fs.readFileSync(path.join(migrationsDir, "067_add_branch_stock_reconciliation.sql"), "utf8");
const sql068 = fs.readFileSync(path.join(migrationsDir, "068_add_branch_stock_generation_tracking.sql"), "utf8");
const sql069 = fs.readFileSync(path.join(migrationsDir, "069_add_branch_stock_retirements.sql"), "utf8");

const API_KEY = "test-pos-key";

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

function buildApp() {
  const config = {
    posApiKeys: new Set([API_KEY]),
    syncV2AllowedDatasets: new Set(["branch_stock"]),
    syncV2AllowedBranches: new Set(["001"]),
    syncV2MaxBatchRecords: 500,
  };
  const app = express();
  app.use(express.json());
  app.use("/api/sync", createSyncRouter({ config, db: pool }));
  app.use("/api", createBranchStockRouter({
    config, db: pool,
    requireAuthMiddleware: (req, res, next) => next(),
    requireRoleMiddleware: () => (req, res, next) => next(),
    requireCsrfMiddleware: (req, res, next) => next(),
  }));
  app.use((error, req, res, next) => res.status(500).json({ message: error.message })); // eslint-disable-line no-unused-vars
  return app;
}

// Drives one full v1 sync exactly the way a real sync agent does:
// run-start -> upload (with or without syncRunId, simulating an
// old-vs-upgraded agent) -> register the reconciliation manifest (agents
// have always made this call, independent of this round's syncRunId-in-
// upload-body change, per the diff Codex cited in CLAIM-X-046) -> run-finish.
async function runV1SyncViaRoutes(app, { branchCode, records, sendSyncRunId, finishStatus = "success", skipManifestRegistration = false }) {
  const startRes = await request(app).post("/api/sync/run-start").set("x-api-key", API_KEY)
    .send({ syncType: `adapos_branch_${branchCode}`, branchCode, ingestionMode: "v1" });
  assert.equal(startRes.status, 200, JSON.stringify(startRes.body));
  const syncRunId = startRes.body.runId;

  const uploadBody = {
    branchCode,
    records: records.map((r) => ({ product_code: r.productCode, qty: r.qty, synced_at: r.syncedAt })),
  };
  if (sendSyncRunId) uploadBody.syncRunId = syncRunId;
  const uploadRes = await request(app).post("/api/branch-stock/sync").set("x-api-key", API_KEY).send(uploadBody);
  assert.equal(uploadRes.status, 200, JSON.stringify(uploadRes.body));

  if (!skipManifestRegistration) {
    const manifest = buildBranchStockReconciliationManifest(records);
    const registerRes = await request(app)
      .post(`/api/sync/v1/runs/${syncRunId}/reconcile-branch-stock`)
      .set("x-api-key", API_KEY)
      .send({ branchCode, reconciliation: manifest });
    assert.equal(registerRes.status, 202, JSON.stringify(registerRes.body));
  }

  const finishRes = await request(app).post("/api/sync/run-log").set("x-api-key", API_KEY)
    .send({ runId: syncRunId, status: finishStatus, recordsRead: records.length, recordsSent: records.length });
  assert.equal(finishRes.status, 200, JSON.stringify(finishRes.body));

  return { syncRunId };
}

async function retirementRow(syncRunId) {
  return (await pool.query(
    "SELECT * FROM ingest.branch_stock_retirements WHERE sync_run_id = $1::bigint", [syncRunId],
  )).rows[0] || null;
}

async function stockRow(productCode, branchCode) {
  return (await pool.query(
    "SELECT qty FROM ada.branch_stock_current WHERE product_code = $1 AND branch_code = $2", [productCode, branchCode],
  )).rows[0] || null;
}

// ---------------------------------------------------------------------------
// SCENARIO 1 (CLAIM-X-046 compatibility): an agent that never sends
// syncRunId on its stock upload — the exact pre-this-round upload shape —
// must be able to complete run after run after run, forever, without ANY
// existing nonzero branch-stock quantity ever being zeroed or otherwise
// changed.
//
// CLAIM-X-049 concession (accurate, not disputed): this scenario still calls
// the reconciliation-registration endpoint, which is itself new work from
// the earlier reconciliation round, not something a truly unmodified
// production agent necessarily does in lockstep with this round's changes.
// Its outcome is 'refused' (deterministic membership-proof failure). The
// FULLY unmodified agent — omitting both syncRunId AND the manifest
// registration call — is scenario 6 below, whose outcome is 'dead_letter'
// (evidence never becomes available at all). Both are proven safe (no stock
// mutation); which terminal status a given real agent version produces
// depends on which of the two newer behaviors it has picked up, and that
// distinction is exactly what this pair of tests demonstrates.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES (partially-upgraded old agent + new backend): no stock mutation across repeated old-shape syncs", async () => {
  await buildRealSchema();
  await resetData();
  const app = buildApp();
  const records = [
    { productCode: "P1", qty: 42, syncedAt: "2026-07-01T01:00:00.000Z" },
    { productCode: "P2", qty: 17, syncedAt: "2026-07-01T01:00:00.000Z" },
    { productCode: "P3", qty: 5, syncedAt: "2026-07-01T01:00:00.000Z" },
  ];
  // First (old-shape) sync establishes healthy stock.
  await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: false });
  assert.equal(Number((await stockRow("P1", "001")).qty), 42);
  assert.equal(Number((await stockRow("P2", "001")).qty), 17);
  assert.equal(Number((await stockRow("P3", "001")).qty), 5);

  // Drain the worker loop's retirement queue exactly as production would —
  // this is where CLAIM-X-046 said stock would get destroyed.
  while (await processOneRetirement(pool)) { /* drain */ }

  // A SECOND, equally normal, equally old-shape sync — the realistic every-
  // day case for any branch during the staged-rollout gap.
  const { syncRunId: secondRun } = await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: false });
  while (await processOneRetirement(pool)) { /* drain */ }

  const retirement = await retirementRow(secondRun);
  assert.equal(retirement.status, "refused", `expected refused, got ${retirement.status}`);
  assert.match(retirement.last_error, /membership proof failed/i);

  // The whole point: nothing changed.
  assert.equal(Number((await stockRow("P1", "001")).qty), 42, "P1 must be untouched");
  assert.equal(Number((await stockRow("P2", "001")).qty), 17, "P2 must be untouched");
  assert.equal(Number((await stockRow("P3", "001")).qty), 5, "P3 must be untouched");

  // Reconciliation must also never become eligible for either run (no `done`
  // retirement exists for either) — a refused generation produces no
  // misleading shadow evidence either.
  const reconciled = await processOneReconciliation(pool);
  assert.equal(reconciled, false, "reconciliation must never become eligible when retirement is refused");
});

// REVERT-CHECK for scenario 1: this is the exact reproduction already
// recorded against pre-remediation code in the VERDICT on CLAIM-X-046 in
// _ledger/claude.md (the old finalizeFullSnapshotGeneration zeroed all 3
// products). Re-stated here as an executable artifact tied to this test
// file: disabling the membership-proof check (i.e. treating any complete v1
// run as sufficient proof, the pre-remediation assumption) reproduces the
// destructive outcome directly against the SAME data this test builds.
integration("REVERT-CHECK: without the membership-proof check, the second old-shape sync would zero everything", async () => {
  await buildRealSchema();
  await resetData();
  const app = buildApp();
  const records = [
    { productCode: "P1", qty: 42, syncedAt: "2026-07-01T01:00:00.000Z" },
    { productCode: "P2", qty: 17, syncedAt: "2026-07-01T01:00:00.000Z" },
  ];
  await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: false });
  while (await processOneRetirement(pool)) { /* drain */ }
  const { syncRunId: secondRun } = await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: false });

  // Reproduce the OLD (pre-membership-proof) sweep directly: the exact SQL
  // finalizeFullSnapshotGeneration used to run, unconditionally, once a run
  // is complete — no expected-vs-actual comparison at all.
  await pool.query(
    `UPDATE ada.branch_stock_current
     SET qty = 0, retired_at = now(), retired_by_sync_run_id = $2::bigint, updated_at = now()
     WHERE branch_code = $1 AND qty <> 0
       AND (last_full_sync_run_id IS NULL OR last_full_sync_run_id < $2::bigint)`,
    ["001", secondRun],
  );
  assert.equal(Number((await stockRow("P1", "001")).qty), 0, "reproduces X-046: the pre-fix sweep zeroes healthy stock");
  assert.equal(Number((await stockRow("P2", "001")).qty), 0, "reproduces X-046: the pre-fix sweep zeroes healthy stock");
});

// ---------------------------------------------------------------------------
// SCENARIO 2: new agent + new backend — retirement completes and
// reconciliation reaches PASS, through the real route/worker lifecycle.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES (new agent + new backend): retirement done, then reconciliation PASS", async () => {
  await buildRealSchema();
  await resetData();
  const app = buildApp();
  const records = [{ productCode: "P1", qty: 10, syncedAt: "2026-07-29T01:00:00.000Z" }];
  const { syncRunId } = await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: true });

  assert.equal(await processOneRetirement(pool), true);
  assert.equal((await retirementRow(syncRunId)).status, "done");

  assert.equal(await processOneReconciliation(pool), true);
  const reconciliation = (await pool.query(
    "SELECT status FROM ingest.branch_stock_reconciliations WHERE sync_run_id = $1::bigint", [syncRunId],
  )).rows[0];
  assert.equal(reconciliation.status, "pass");
});

// ---------------------------------------------------------------------------
// SCENARIO 3: reconciliation cannot claim while retirement is pending,
// processing, or retry_wait — only once it reaches 'done'.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES: reconciliation refuses to claim across every non-done retirement status", async () => {
  await buildRealSchema();
  await resetData();
  const app = buildApp();
  const records = [{ productCode: "P1", qty: 10, syncedAt: "2026-07-29T01:00:00.000Z" }];
  const { syncRunId } = await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: true });

  // pending
  assert.equal((await retirementRow(syncRunId)).status, "pending");
  assert.equal(await processOneReconciliation(pool), false, "must not claim while retirement is pending");

  // processing
  await pool.query(`UPDATE ingest.branch_stock_retirements SET status='processing', claimed_at=now() WHERE sync_run_id=$1::bigint`, [syncRunId]);
  assert.equal(await processOneReconciliation(pool), false, "must not claim while retirement is processing");

  // retry_wait
  await pool.query(`UPDATE ingest.branch_stock_retirements SET status='retry_wait', next_attempt_at=now() WHERE sync_run_id=$1::bigint`, [syncRunId]);
  assert.equal(await processOneReconciliation(pool), false, "must not claim while retirement is retry_wait");

  // done
  await pool.query(`UPDATE ingest.branch_stock_retirements SET status='done', completed_at=now() WHERE sync_run_id=$1::bigint`, [syncRunId]);
  assert.equal(await processOneReconciliation(pool), true, "must claim once retirement is done");
});

// ---------------------------------------------------------------------------
// SCENARIO 4: one forced retirement failure is retried successfully. The
// realistic transient condition is the manifest-registration race described
// in docs/BRANCH_STOCK_GENERATION_CONTRACT.md: the FIRST processing attempt
// happens before the agent's separate manifest-registration call lands, then
// succeeds once it does.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES: a forced retirement failure (missing manifest) retries and then succeeds", async () => {
  await buildRealSchema();
  await resetData();
  const app = buildApp();
  const records = [{ productCode: "P1", qty: 10, syncedAt: "2026-07-29T01:00:00.000Z" }];

  const startRes = await request(app).post("/api/sync/run-start").set("x-api-key", API_KEY)
    .send({ syncType: "adapos_branch_001", branchCode: "001", ingestionMode: "v1" });
  const syncRunId = startRes.body.runId;
  await request(app).post("/api/branch-stock/sync").set("x-api-key", API_KEY)
    .send({ branchCode: "001", syncRunId, records: records.map((r) => ({ product_code: r.productCode, qty: r.qty, synced_at: r.syncedAt })) });
  // Deliberately skip the manifest-registration call before finishing the run.
  await request(app).post("/api/sync/run-log").set("x-api-key", API_KEY)
    .send({ runId: syncRunId, status: "success", recordsRead: 1, recordsSent: 1 });

  const attempt1 = await processOneRetirement(pool);
  assert.equal(attempt1, true, "the job is claimed even though it will fail");
  const afterAttempt1 = await retirementRow(syncRunId);
  assert.equal(afterAttempt1.status, "retry_wait", `expected retry_wait, got ${afterAttempt1.status}`);
  assert.equal(afterAttempt1.attempts, 1);
  assert.match(afterAttempt1.last_error, /manifest not yet available/i);
  // Stock must be untouched by the failed attempt.
  assert.equal(Number((await stockRow("P1", "001")).qty), 10);

  // The manifest becomes available (production's own registration endpoint
  // requires the run to still be 'running', so it cannot itself be the
  // recovery path once the run has finished — this directly writes the
  // evidence table the way an ops backfill or a future relaxed registration
  // window would, to isolate and prove the RETRY mechanism itself: a
  // transient failure that resolves is retried and reaches done, without
  // asserting anything about how registration timing gets fixed).
  await pool.query(
    `INSERT INTO ingest.branch_stock_reconciliations (sync_run_id, branch_code, contract_version, expected_manifest)
     VALUES ($1::bigint, '001', 'branch-stock-v1', $2::jsonb)`,
    [syncRunId, JSON.stringify(buildBranchStockReconciliationManifest(records))],
  );
  await pool.query(`UPDATE ingest.branch_stock_retirements SET next_attempt_at = now() WHERE sync_run_id = $1::bigint`, [syncRunId]);

  const attempt2 = await processOneRetirement(pool);
  assert.equal(attempt2, true);
  const afterAttempt2 = await retirementRow(syncRunId);
  assert.equal(afterAttempt2.status, "done", afterAttempt2.last_error);
});

// ---------------------------------------------------------------------------
// SCENARIO 5: process-style interruption (worker restart mid-processing)
// leaves durable pending work recoverable — a lease stuck in 'processing'
// (simulating a crashed worker that claimed but never finished) is reaped by
// maintainRetirements and becomes processable again.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES: a stuck 'processing' lease (worker restart) is reaped and recovers", async () => {
  await buildRealSchema();
  await resetData();
  const app = buildApp();
  const records = [{ productCode: "P1", qty: 10, syncedAt: "2026-07-29T01:00:00.000Z" }];
  const { syncRunId } = await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: true });

  // Simulate a worker that claimed the job, then the whole process died
  // before finishing (claimed_at far enough in the past to be reapable).
  await pool.query(
    `UPDATE ingest.branch_stock_retirements
     SET status = 'processing', claimed_at = now() - interval '1 hour', attempts = 1
     WHERE sync_run_id = $1::bigint`,
    [syncRunId],
  );
  const stuck = await retirementRow(syncRunId);
  assert.equal(stuck.status, "processing");

  const maintained = await maintainRetirements(pool, {});
  assert.equal(maintained.reaped.rowCount, 1, "the stuck lease must be found and reaped");
  const reaped = await retirementRow(syncRunId);
  assert.equal(reaped.status, "retry_wait", "a reaped lease with attempts remaining goes to retry_wait, not lost");

  await pool.query(`UPDATE ingest.branch_stock_retirements SET next_attempt_at = now() WHERE sync_run_id = $1::bigint`, [syncRunId]);
  assert.equal(await processOneRetirement(pool), true);
  assert.equal((await retirementRow(syncRunId)).status, "done", "the recovered job must still be able to reach done");
});

// ---------------------------------------------------------------------------
// SCENARIO 6: terminal retry exhaustion (dead_letter) does not silently
// certify reconciliation — a generation whose retirement permanently fails
// must never produce a reconciliation PASS (or any reconciliation outcome
// at all). This is ALSO the fully-faithful old-agent scenario (CLAIM-X-049):
// no syncRunId on upload AND no manifest-registration call — the complete
// pre-generation-round, pre-reconciliation-round request shape.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES (fully unmodified old agent): dead-lettered retirement never becomes reconciliation-eligible", async () => {
  await buildRealSchema();
  await resetData();
  const app = buildApp();
  const records = [{ productCode: "P1", qty: 10, syncedAt: "2026-07-29T01:00:00.000Z" }];
  // Old-shape upload (no syncRunId) with no manifest ever registered either —
  // guarantees processRetirementJob throws every single attempt.
  const startRes = await request(app).post("/api/sync/run-start").set("x-api-key", API_KEY)
    .send({ syncType: "adapos_branch_001", branchCode: "001", ingestionMode: "v1" });
  const syncRunId = startRes.body.runId;
  await request(app).post("/api/branch-stock/sync").set("x-api-key", API_KEY)
    .send({ branchCode: "001", records: records.map((r) => ({ product_code: r.productCode, qty: r.qty, synced_at: r.syncedAt })) });
  await request(app).post("/api/sync/run-log").set("x-api-key", API_KEY)
    .send({ runId: syncRunId, status: "success", recordsRead: 1, recordsSent: 1 });

  let lastRow = null;
  for (let i = 0; i < 10; i += 1) {
    const did = await processOneRetirement(pool);
    lastRow = await retirementRow(syncRunId);
    if (!did || lastRow.status === "dead_letter") break;
    await pool.query(`UPDATE ingest.branch_stock_retirements SET next_attempt_at = now() WHERE sync_run_id = $1::bigint`, [syncRunId]);
  }
  assert.equal(lastRow.status, "dead_letter", `expected dead_letter after exhausting attempts, got ${lastRow.status}`);
  assert.equal(lastRow.attempts, lastRow.max_attempts);

  const reconciled = await processOneReconciliation(pool);
  assert.equal(reconciled, false, "terminal retry exhaustion must never silently certify reconciliation");
  assert.equal(Number((await stockRow("P1", "001")).qty), 10, "dead-lettering must never mutate stock either");
});

// ---------------------------------------------------------------------------
// SCENARIO 7: duplicate worker execution remains idempotent — two workers
// racing to claim the same retirement job (SKIP LOCKED) must result in
// exactly one of them doing the work, not a double-sweep or a crash.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES: two concurrent processOneRetirement callers never double-process the same job", async () => {
  await buildRealSchema();
  await resetData();
  const app = buildApp();
  const records = [{ productCode: "P1", qty: 10, syncedAt: "2026-07-29T01:00:00.000Z" }];
  const { syncRunId } = await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: true });

  const [a, b] = await Promise.all([processOneRetirement(pool), processOneRetirement(pool)]);
  // Exactly one caller must have found and processed the job; the other
  // finds nothing left to claim (SKIP LOCKED prevents a double-claim, and
  // the job is already terminal by the time the loser would retry).
  assert.equal([a, b].filter(Boolean).length >= 1, true, "at least one caller must process the job");
  const row = await retirementRow(syncRunId);
  assert.equal(row.status, "done");
  assert.equal(row.attempts, 1, "SKIP LOCKED must prevent the same job from being claimed and incremented twice concurrently");

  // Re-running registration (as production would on a retried run-finish
  // call) must not create a second row or duplicate the sweep.
  await request(app).post("/api/sync/run-log").set("x-api-key", API_KEY)
    .send({ runId: syncRunId, status: "success", recordsRead: 1, recordsSent: 1 });
  const rows = (await pool.query("SELECT * FROM ingest.branch_stock_retirements WHERE sync_run_id = $1::bigint", [syncRunId])).rows;
  assert.equal(rows.length, 1, "re-registration must be idempotent, not create a duplicate row");
  assert.equal(rows[0].status, "done", "re-registration must not disturb an already-done retirement");
});

// ---------------------------------------------------------------------------
// SCENARIO 8: a superseded generation retains the existing safety property
// (refused, never sweeps) when driven through the real route lifecycle for
// both generations, not raw SQL fixtures.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES: a superseded generation (via real routes) is refused, never overwrites the newer one", async () => {
  await buildRealSchema();
  await resetData();
  const app = buildApp();
  const { syncRunId: gen1 } = await runV1SyncViaRoutes(app, {
    branchCode: "001", records: [{ productCode: "P1", qty: 10, syncedAt: "2026-07-29T01:00:00.000Z" }], sendSyncRunId: true,
  });
  // gen1's retirement job exists (registered atomically at run-finish) but is
  // deliberately left unprocessed — simulating a slow worker pick-up.
  assert.equal((await retirementRow(gen1)).status, "pending");

  const { syncRunId: gen2 } = await runV1SyncViaRoutes(app, {
    branchCode: "001", records: [{ productCode: "P1", qty: 15, syncedAt: "2026-07-29T02:00:00.000Z" }], sendSyncRunId: true,
  });
  // Bypass the same-branch ordering guard deliberately (as in the sibling
  // unit-level test) to prove the defense-in-depth supersession check inside
  // processRetirementJob itself, not just the claim-time guard. The job
  // object's `attempts` must match the row's current value exactly — that is
  // the CLAIM-X-050 ownership fence processRetirementJob now enforces.
  const gen2Claimed = (await pool.query(`UPDATE ingest.branch_stock_retirements SET status='processing', claimed_at=now(), attempts=attempts+1 WHERE sync_run_id=$1::bigint RETURNING attempts`, [gen2])).rows[0];
  await processRetirementJob(pool, { sync_run_id: gen2, branch_code: "001", ingestion_mode: "v1", attempts: gen2Claimed.attempts });
  assert.equal((await retirementRow(gen2)).status, "done");

  const gen1Claimed = (await pool.query(`UPDATE ingest.branch_stock_retirements SET status='processing', claimed_at=now(), attempts=attempts+1 WHERE sync_run_id=$1::bigint RETURNING attempts`, [gen1])).rows[0];
  await processRetirementJob(pool, { sync_run_id: gen1, branch_code: "001", ingestion_mode: "v1", attempts: gen1Claimed.attempts });
  const gen1Row = await retirementRow(gen1);
  assert.equal(gen1Row.status, "refused");
  assert.match(gen1Row.last_error, /Superseded/);

  assert.equal(Number((await stockRow("P1", "001")).qty), 15, "gen1's superseded retirement must not overwrite gen2's newer value");
});

// Drives one full hybrid_v2 sync through the real routes + the real worker's
// processOneBatch (which now also registers the retirement job atomically,
// see CLAIM-C-051). Used for the CLAIM-X-048 "later CP4 batch" test since
// claimNextBatch's same-branch ordering guard — the thing X-048 says can
// wedge — is v2/hybrid-batch-specific machinery; v1 never queues a batch.
async function runV2SyncViaRoutes(app, { branchCode, records }) {
  const startRes = await request(app).post("/api/sync/run-start").set("x-api-key", API_KEY)
    .send({ syncType: `adapos_branch_${branchCode}`, branchCode, ingestionMode: "hybrid_v2", v2Datasets: ["branch_stock"] });
  assert.equal(startRes.status, 200, JSON.stringify(startRes.body));
  const syncRunId = startRes.body.runId;

  const batchRecords = records.map((r) => ({ branchCode, productCode: r.productCode, qty: r.qty, syncedAt: r.syncedAt }));
  const batchRes = await request(app).post("/api/sync/v2/batches").set("x-api-key", API_KEY)
    .send({ syncRunId, dataset: "branch_stock", batchSeq: 1, records: batchRecords });
  assert.equal(batchRes.status, 202, JSON.stringify(batchRes.body));

  const manifest = buildBranchStockReconciliationManifest(records);
  const finalizeRes = await request(app).post(`/api/sync/v2/runs/${syncRunId}/finalize`).set("x-api-key", API_KEY)
    .send({ dataset: "branch_stock", batchCount: 1, recordCount: records.length, reconciliation: manifest });
  assert.equal(finalizeRes.status, 200, JSON.stringify(finalizeRes.body));

  return { syncRunId };
}

// ---------------------------------------------------------------------------
// CLAIM-X-048 FIX TESTS. Codex found that a retirement ending refused or
// dead_letter left its dependent reconciliation permanently 'pending' —
// excluded from maintenance/retention (which only handles pass/fail/
// dead_letter) and, for hybrid_v2, a live blocker for every later same-
// branch CP4 batch (claimNextBatch's ordering guard excludes dead_letter
// reconciliations but not pending ones). Reproduced directly on real
// Postgres before fixing (see the REVERT-CHECK below), fixed by
// terminalizing the dependent reconciliation to 'dead_letter' the moment
// retirement itself terminalizes as refused (inline, same transaction) or
// dead_letter (same statement group), plus a defense-in-depth "orphaned"
// scan in maintainReconciliations for the case where the manifest is
// registered AFTER retirement has already exhausted its own retries.
// ---------------------------------------------------------------------------

integration("REAL POSTGRES (CLAIM-X-048): a refused retirement terminalizes its dependent reconciliation, not left pending", async () => {
  await buildRealSchema();
  await resetData();
  const app = buildApp();
  const records = [
    { productCode: "P1", qty: 42, syncedAt: "2026-07-01T01:00:00.000Z" },
    { productCode: "P2", qty: 17, syncedAt: "2026-07-01T01:00:00.000Z" },
  ];
  await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: false });
  while (await processOneRetirement(pool)) { /* drain */ }
  const { syncRunId: secondRun } = await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: false });
  while (await processOneRetirement(pool)) { /* drain */ }

  const retirement = await retirementRow(secondRun);
  assert.equal(retirement.status, "refused");

  const reconciliation = (await pool.query(
    "SELECT status, last_error FROM ingest.branch_stock_reconciliations WHERE sync_run_id = $1::bigint", [secondRun],
  )).rows[0];
  assert.equal(reconciliation.status, "dead_letter", "a refused retirement must terminalize its dependent reconciliation, not leave it pending forever");
  assert.match(reconciliation.last_error, /refused/i);
});

// REVERT-CHECK: this is the exact defect Codex reproduced against the
// pre-X-048-fix code — a refused retirement with its reconciliation left
// permanently 'pending'. Reproduced here directly (bypassing the fix) by
// resetting the reconciliation row back to 'pending' after the real refusal
// already happened, simulating what the OLD code (no terminalizeDependentReconciliation
// call) would have left behind.
integration("REVERT-CHECK: without terminalization, a refused retirement's reconciliation stays pending forever and blocks retention", async () => {
  await buildRealSchema();
  await resetData();
  const app = buildApp();
  const records = [{ productCode: "P1", qty: 42, syncedAt: "2026-07-01T01:00:00.000Z" }];
  await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: false });
  while (await processOneRetirement(pool)) { /* drain */ }
  const { syncRunId: secondRun } = await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: false });
  while (await processOneRetirement(pool)) { /* drain */ }
  assert.equal((await retirementRow(secondRun)).status, "refused");

  // Simulate the pre-fix code path: undo the terminalization the fix just
  // performed, then run ONLY the two pre-X-048 maintenance queries directly
  // (copied verbatim from the pre-fix shape of maintainReconciliations,
  // before the "orphaned" scan existed) — calling the real, now-fixed
  // maintainReconciliations here would be confounded by its own new
  // orphaned-scan independently catching this same row, which would make
  // the revert-check pass for the wrong reason.
  await pool.query(
    `UPDATE ingest.branch_stock_reconciliations
     SET status='pending', last_error=NULL, reconciled_at=NULL,
         created_at = now() - interval '8 days', updated_at = now() - interval '8 days'
     WHERE sync_run_id=$1::bigint`,
    [secondRun],
  );
  const abandoned = await pool.query(
    `UPDATE ingest.branch_stock_reconciliations reconciliation
     SET status = 'dead_letter', claimed_at = NULL, last_error = 'test', updated_at = now()
     FROM ingest.sync_runs run
     WHERE run.sync_run_id = reconciliation.sync_run_id
       AND reconciliation.status = 'pending'
       AND (
         run.status = 'failed'
         OR (
           reconciliation.created_at < now() - (1::double precision * interval '1 day')
           AND NOT (run.apply_status = 'applied' OR (run.ingestion_mode = 'v1' AND run.status = 'success'))
         )
       )
     RETURNING reconciliation.sync_run_id`,
  );
  const pruned = await pool.query(
    `DELETE FROM ingest.branch_stock_reconciliations
     WHERE status IN ('pass', 'fail', 'dead_letter')
       AND COALESCE(reconciled_at, updated_at) < now() - (1::double precision * interval '1 day')
     RETURNING sync_run_id`,
  );
  assert.equal(abandoned.rowCount, 0, "the pre-fix abandon query never matches — the source run succeeded, it just has no path forward");
  assert.equal(pruned.rowCount, 0, "the pre-fix prune query never matches a 'pending' row — retention only ever covered pass/fail/dead_letter");
  const stillPending = (await pool.query(
    "SELECT status FROM ingest.branch_stock_reconciliations WHERE sync_run_id=$1::bigint", [secondRun],
  )).rows[0];
  assert.equal(stillPending.status, "pending", "reproduces CLAIM-X-048: without the fix, an 8-day-old reconciliation for a refused retirement is neither abandoned nor pruned, exactly as Codex reproduced");
});

integration("REAL POSTGRES (CLAIM-X-048): a terminalized reconciliation is retained then pruned by maintenance like any other terminal evidence", async () => {
  await buildRealSchema();
  await resetData();
  const app = buildApp();
  const records = [{ productCode: "P1", qty: 42, syncedAt: "2026-07-01T01:00:00.000Z" }];
  await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: false });
  while (await processOneRetirement(pool)) { /* drain */ }
  const { syncRunId: secondRun } = await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: false });
  while (await processOneRetirement(pool)) { /* drain */ }
  assert.equal((await retirementRow(secondRun)).status, "refused");
  assert.equal((await pool.query(
    "SELECT status FROM ingest.branch_stock_reconciliations WHERE sync_run_id=$1::bigint", [secondRun],
  )).rows[0].status, "dead_letter");

  // Not yet aged past retention: still present.
  const tooEarly = await maintainReconciliations(pool, { reconciliationRetentionDays: 90 });
  assert.equal(tooEarly.pruned.rowCount, 0);
  assert.equal((await pool.query("SELECT 1 FROM ingest.branch_stock_reconciliations WHERE sync_run_id=$1::bigint", [secondRun])).rows.length, 1);

  // Age it past an 8-day retention window (matching the exact reproduction).
  await pool.query(
    `UPDATE ingest.branch_stock_reconciliations SET reconciled_at = now() - interval '8 days' WHERE sync_run_id=$1::bigint`,
    [secondRun],
  );
  const aged = await maintainReconciliations(pool, { reconciliationRetentionDays: 7 });
  assert.equal(aged.pruned.rowCount, 1, "the terminalized reconciliation must now be pruned by ordinary retention");
  assert.equal((await pool.query("SELECT 1 FROM ingest.branch_stock_reconciliations WHERE sync_run_id=$1::bigint", [secondRun])).rows.length, 0);
});

integration("REAL POSTGRES (CLAIM-X-048): late manifest registration after dead_letter is caught by the orphaned-reconciliation scan", async () => {
  await buildRealSchema();
  await resetData();
  const app = buildApp();
  const records = [{ productCode: "P1", qty: 10, syncedAt: "2026-07-29T01:00:00.000Z" }];
  // Fully unmodified old agent: no syncRunId, no manifest call at all — the
  // retirement job retries "manifest not yet available" until it dead-letters,
  // at which point NO reconciliation row exists yet (nothing to terminalize).
  const { syncRunId } = await runV1SyncViaRoutes(app, { branchCode: "001", records, sendSyncRunId: false, skipManifestRegistration: true });
  for (let i = 0; i < 10; i += 1) {
    const did = await processOneRetirement(pool);
    const row = await retirementRow(syncRunId);
    if (!did || row.status === "dead_letter") break;
    await pool.query(`UPDATE ingest.branch_stock_retirements SET next_attempt_at = now() WHERE sync_run_id = $1::bigint`, [syncRunId]);
  }
  assert.equal((await retirementRow(syncRunId)).status, "dead_letter");
  assert.equal((await pool.query("SELECT 1 FROM ingest.branch_stock_reconciliations WHERE sync_run_id=$1::bigint", [syncRunId])).rows.length, 0);

  // The manifest registration finally arrives late — a real race the
  // no-await-in-front v1 wiring cannot rule out. This creates a NEW pending
  // reconciliation row for a generation whose retirement is already terminal
  // and will never be reprocessed.
  await pool.query(
    `INSERT INTO ingest.branch_stock_reconciliations (sync_run_id, branch_code, contract_version, expected_manifest)
     VALUES ($1::bigint, '001', 'branch-stock-v1', $2::jsonb)`,
    [syncRunId, JSON.stringify(buildBranchStockReconciliationManifest(records))],
  );
  assert.equal((await pool.query(
    "SELECT status FROM ingest.branch_stock_reconciliations WHERE sync_run_id=$1::bigint", [syncRunId],
  )).rows[0].status, "pending");

  const maintained = await maintainReconciliations(pool, { reconciliationRetentionDays: 90 });
  assert.equal(maintained.orphaned.rowCount, 1, "the orphaned-reconciliation scan must catch a late-registered manifest whose retirement is already terminal");
  const after = (await pool.query(
    "SELECT status FROM ingest.branch_stock_reconciliations WHERE sync_run_id=$1::bigint", [syncRunId],
  )).rows[0];
  assert.equal(after.status, "dead_letter");
});

integration("REAL POSTGRES (CLAIM-X-048): a later same-branch CP4 batch is not permanently blocked by an earlier refused/terminalized reconciliation", async () => {
  await buildRealSchema();
  await resetData();
  const app = buildApp();

  // gen1: a hybrid_v2 run whose stamped row is corrupted right after apply
  // (simulating any bug/race with the same shape as X-046 for the v2 path,
  // which is otherwise structurally protected since it always threads
  // syncRunId) so its retirement is refused on the membership-proof check.
  const { syncRunId: gen1 } = await runV2SyncViaRoutes(app, {
    branchCode: "001", records: [{ productCode: "P1", qty: 10, syncedAt: "2026-07-29T01:00:00.000Z" }],
  });
  assert.equal(await processOneBatch(pool), true);
  await pool.query(
    `UPDATE ada.branch_stock_current SET last_full_sync_run_id = NULL WHERE product_code = 'P1' AND branch_code = '001'`,
  );
  assert.equal(await processOneRetirement(pool), true);
  const gen1Retirement = await retirementRow(gen1);
  assert.equal(gen1Retirement.status, "refused", gen1Retirement.last_error);
  const gen1Reconciliation = (await pool.query(
    "SELECT status FROM ingest.branch_stock_reconciliations WHERE sync_run_id=$1::bigint", [gen1],
  )).rows[0];
  assert.equal(gen1Reconciliation.status, "dead_letter", "gen1's reconciliation must be terminalized, not left pending, before gen2 is attempted");

  // gen2: a second hybrid_v2 run for the SAME branch. Before the X-048 fix,
  // gen1's still-'pending' reconciliation would have permanently blocked
  // this batch from ever being claimed (claimNextBatch's ordering guard).
  const startRes = await request(app).post("/api/sync/run-start").set("x-api-key", API_KEY)
    .send({ syncType: "adapos_branch_001", branchCode: "001", ingestionMode: "hybrid_v2", v2Datasets: ["branch_stock"] });
  const gen2 = startRes.body.runId;
  const gen2Records = [{ branchCode: "001", productCode: "P1", qty: 11, syncedAt: "2026-07-29T02:00:00.000Z" }];
  await request(app).post("/api/sync/v2/batches").set("x-api-key", API_KEY)
    .send({ syncRunId: gen2, dataset: "branch_stock", batchSeq: 1, records: gen2Records });
  await request(app).post(`/api/sync/v2/runs/${gen2}/finalize`).set("x-api-key", API_KEY)
    .send({ dataset: "branch_stock", batchCount: 1, recordCount: 1, reconciliation: buildBranchStockReconciliationManifest(gen2Records.map((r) => ({ productCode: r.productCode, qty: r.qty, syncedAt: r.syncedAt }))) });

  const claimed = await claimNextBatch(pool);
  assert.ok(claimed, "gen2's batch must be claimable — it must not be permanently blocked by gen1's now-terminalized reconciliation");
  assert.equal(String(claimed.sync_run_id), String(gen2));
});

// ---------------------------------------------------------------------------
// CLAIM-X-050 FIX TESTS. Codex found that a worker whose processing lease
// was reaped to dead_letter (because it looked stuck past
// STUCK_PROCESSING_MINUTES) could still be alive and merely slow — if it
// later woke up and finished its own in-flight processRetirementJob call, it
// would zero stock and write RETIREMENT_DONE-shaped success, all while the
// durable queue row (already reaped by another process in the meantime) said
// dead_letter. Neither the retirement row's ownership nor the final status
// UPDATE's rowCount were checked, so the stale worker's transaction happily
// committed a real stock mutation underneath a "failed" queue record.
// Reproduced directly below (REVERT-CHECK), fixed by fencing: lock the
// retirement row FOR UPDATE and verify status AND the claimed attempts token
// still match at the very start of processRetirementJob, and verify every
// terminal status UPDATE actually changed exactly one row before committing.
// ---------------------------------------------------------------------------

integration("REAL POSTGRES (CLAIM-X-050): a worker fenced out after its lease is reaped cannot mutate stock", async () => {
  await buildRealSchema();
  await resetData();

  const at = "2026-07-29T01:00:00.000Z";
  const runId = (await pool.query(
    "INSERT INTO ingest.sync_runs (sync_type, source_name, branch_code, ingestion_mode, status, snapshot_mode, handoff_status, apply_status, started_at, total_batches) VALUES ('adapos_branch_001','adapos_sync','001','v1','success','full','not_applicable','not_applicable', now(), 1) RETURNING sync_run_id",
  )).rows[0].sync_run_id;
  await pool.query(
    "INSERT INTO ingest.branch_stock_reconciliations (sync_run_id, branch_code, contract_version, expected_manifest) VALUES ($1::bigint, '001', 'branch-stock-v1', $2::jsonb)",
    [runId, JSON.stringify(buildBranchStockReconciliationManifest([{ productCode: "POLD", qty: 99, syncedAt: at }]))],
  );
  await pool.query(
    "INSERT INTO ada.branch_stock_current (product_code, branch_code, qty, synced_at, source_synced_at, last_full_sync_run_id) VALUES ('POLD', '001', 99, $1::timestamptz, $1::timestamptz, NULL)",
    [at],
  );
  await pool.query(
    "INSERT INTO ada.branch_stock_snapshots (product_code, qty_branch_001, qty_total_all_branches, synced_at, source_synced_at, full_sync_run_id_branch_001) VALUES ('POLD', 99, 99, $1::timestamptz, $1::timestamptz, NULL)",
    [at],
  );
  await pool.query(
    "INSERT INTO ingest.branch_stock_retirements (sync_run_id, branch_code, status, attempts, max_attempts) VALUES ($1::bigint, '001', 'pending', 4, 5)",
    [runId],
  );

  // The worker claims the job (attempts becomes 5) — this `job` reference is
  // what a real worker would hold onto while doing its (slow) work.
  const job = await claimNextRetirement(pool);
  assert.ok(job);
  assert.equal(job.attempts, 5);

  // It appears stuck: claimed_at is manually pushed into the past, and the
  // reaper (as a periodic maintenance tick genuinely would) reaps it. Since
  // attempts (5) already equals max_attempts (5), it goes straight to
  // dead_letter — exactly Codex's reproduction shape.
  await pool.query("UPDATE ingest.branch_stock_retirements SET claimed_at = now() - interval '1 hour' WHERE sync_run_id = $1::bigint", [runId]);
  const maintainedRetirements = await maintainRetirements(pool, {});
  assert.equal(maintainedRetirements.reaped.rowCount, 1);
  assert.equal((await retirementRow(runId)).status, "dead_letter");
  const maintainedReconciliations = await maintainReconciliations(pool, {});
  assert.equal(maintainedReconciliations.orphaned.rowCount, 1);
  assert.equal((await pool.query("SELECT status FROM ingest.branch_stock_reconciliations WHERE sync_run_id=$1::bigint", [runId])).rows[0].status, "dead_letter");

  // The "stale" worker was NOT actually dead — it now tries to finish the
  // SAME job using its old `job` reference (attempts:5, the value it was
  // claimed with). It must be fenced out before touching stock at all.
  await assert.rejects(
    () => processRetirementJob(pool, job),
    /no longer owned by this worker/,
  );

  const stock = await stockRow("POLD", "001");
  assert.equal(Number(stock.qty), 99, "the fenced-out worker must not be able to zero stock the durable queue already says failed");
  const wide = (await pool.query("SELECT qty_branch_001 FROM ada.branch_stock_snapshots WHERE product_code='POLD'")).rows[0];
  assert.equal(Number(wide.qty_branch_001), 99);
  assert.equal((await retirementRow(runId)).status, "dead_letter", "the reaped row must remain dead_letter, not get silently overwritten to done");
});

// REVERT-CHECK: reproduces the exact pre-fix defect Codex found, by running
// the OLD (pre-ownership-check, pre-rowCount-check) sweep logic directly —
// no fencing, no rowCount assertion — against the SAME reaped-row fixture as
// above, to prove the fix is not incidentally masking something else.
integration("REVERT-CHECK: without fencing, a reaped worker's stale commit zeroes stock while the queue still says dead_letter", async () => {
  await buildRealSchema();
  await resetData();
  const at = "2026-07-29T01:00:00.000Z";
  const runId = (await pool.query(
    "INSERT INTO ingest.sync_runs (sync_type, source_name, branch_code, ingestion_mode, status, snapshot_mode, handoff_status, apply_status, started_at, total_batches) VALUES ('adapos_branch_001','adapos_sync','001','v1','success','full','not_applicable','not_applicable', now(), 1) RETURNING sync_run_id",
  )).rows[0].sync_run_id;
  await pool.query(
    "INSERT INTO ingest.branch_stock_reconciliations (sync_run_id, branch_code, contract_version, expected_manifest) VALUES ($1::bigint, '001', 'branch-stock-v1', $2::jsonb)",
    [runId, JSON.stringify(buildBranchStockReconciliationManifest([{ productCode: "POLD", qty: 99, syncedAt: at }]))],
  );
  await pool.query(
    "INSERT INTO ada.branch_stock_current (product_code, branch_code, qty, synced_at, source_synced_at, last_full_sync_run_id) VALUES ('POLD', '001', 99, $1::timestamptz, $1::timestamptz, NULL)",
    [at],
  );
  await pool.query(
    "INSERT INTO ada.branch_stock_snapshots (product_code, qty_branch_001, qty_total_all_branches, synced_at, source_synced_at, full_sync_run_id_branch_001) VALUES ('POLD', 99, 99, $1::timestamptz, $1::timestamptz, NULL)",
    [at],
  );
  await pool.query(
    "INSERT INTO ingest.branch_stock_retirements (sync_run_id, branch_code, status, attempts, max_attempts) VALUES ($1::bigint, '001', 'pending', 4, 5)",
    [runId],
  );
  const job = await claimNextRetirement(pool);
  await pool.query("UPDATE ingest.branch_stock_retirements SET claimed_at = now() - interval '1 hour' WHERE sync_run_id = $1::bigint", [runId]);
  await maintainRetirements(pool, {});
  await maintainReconciliations(pool, {});
  assert.equal((await retirementRow(runId)).status, "dead_letter");

  // OLD shape: no ownership fence, no rowCount check on the final UPDATE —
  // this is exactly what processRetirementJob did before the X-050 fix.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE ada.branch_stock_current SET qty = 0, retired_at = now(), retired_by_sync_run_id = $2::bigint, updated_at = now() WHERE branch_code = $1 AND qty <> 0 AND (last_full_sync_run_id IS NULL OR last_full_sync_run_id < $2::bigint)",
      ["001", job.sync_run_id],
    );
    await client.query(
      "UPDATE ada.branch_stock_snapshots SET qty_total_all_branches = qty_total_all_branches - qty_branch_001, qty_branch_001 = 0, updated_at = now() WHERE qty_branch_001 <> 0 AND (full_sync_run_id_branch_001 IS NULL OR full_sync_run_id_branch_001 < $1::bigint)",
      [job.sync_run_id],
    );
    // The OLD final UPDATE — no rowCount check, so it does not matter that
    // this affects ZERO rows (the row is already dead_letter, not processing).
    await client.query(
      "UPDATE ingest.branch_stock_retirements SET status = 'done', completed_at = now() WHERE sync_run_id = $1::bigint AND status = 'processing'",
      [job.sync_run_id],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }

  const stock = await stockRow("POLD", "001");
  assert.equal(Number(stock.qty), 0, "reproduces CLAIM-X-050: without fencing, the stale worker's commit zeroes stock");
  assert.equal((await retirementRow(runId)).status, "dead_letter", "reproduces CLAIM-X-050: the queue still (accurately) says dead_letter even though stock was silently zeroed underneath it");
});

// ---------------------------------------------------------------------------
// CLAIM-X-052 FIX TEST. Codex found that fixing X-050 (fencing the SUCCESS
// path) left the OUTER catch block in processOneRetirement using the OLD
// ownership condition (status='processing' only, no attempts token). So a
// worker fenced out of the success path (correctly, by assertStillOwnsRetirement)
// would fall into this catch and — because the catch itself was never
// audited for the same fencing principle — silently reset a DIFFERENT,
// legitimately-reclaimed worker's in-flight row from 'processing' back to
// retry_wait/dead_letter, stealing or cancelling a lease it no longer owned.
// The SAME class of gap was independently found (by this same audit, not by
// Codex) in the reconciliation queue's success write (reconcileBranchStockJob)
// and its own catch block (processOneReconciliation) — fixed alongside this.
//
// This test drives the REAL processOneRetirement function twice concurrently
// (not a reimplementation) using a deterministic pause-after-claim technique
// so the interleaving is reproducible rather than timing-dependent: worker A
// claims first, gets reaped mid-flight, worker B claims the reclaimed lease,
// then A is allowed to resume into its catch block.
// ---------------------------------------------------------------------------

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

function pausesAfterRetirementClaim(sql, result) {
  return /UPDATE ingest\.branch_stock_retirements retirement/.test(sql)
    && /RETURNING retirement\.sync_run_id/.test(sql)
    && result.rowCount === 1;
}

integration("REAL POSTGRES (CLAIM-X-052): a fenced-out worker's catch block cannot steal or cancel a reclaimed lease", async () => {
  await buildRealSchema();
  await resetData();
  const runId = (await pool.query(
    "INSERT INTO ingest.sync_runs (sync_type, source_name, branch_code, ingestion_mode, status, snapshot_mode, handoff_status, apply_status, started_at, total_batches) VALUES ('adapos_branch_001','adapos_sync','001','v1','success','full','not_applicable','not_applicable', now(), 1) RETURNING sync_run_id",
  )).rows[0].sync_run_id;
  // No manifest registered — every processing attempt will genuinely fail
  // with "manifest not yet available," landing every worker in the catch
  // block, which is exactly the code path under test.
  await pool.query(
    "INSERT INTO ingest.branch_stock_retirements (sync_run_id, branch_code, attempts, max_attempts) VALUES ($1::bigint, '001', 0, 5)",
    [runId],
  );

  // Worker A claims the job (attempts becomes 1) and pauses immediately
  // after that claim commits, before it ever reaches processRetirementJob.
  const dbA = pausingDb(pool, pausesAfterRetirementClaim);
  const pendingA = processOneRetirement(dbA);
  const jobA = await dbA.claimed;
  assert.equal(jobA.attempts, 1);

  // A appears stuck: claimed_at pushed into the past, reaped for real. Since
  // attempts (1) is below max_attempts (5), this goes to retry_wait, not
  // dead_letter — making it re-claimable, which is exactly what lets Worker
  // B legitimately pick it up next.
  await pool.query("UPDATE ingest.branch_stock_retirements SET claimed_at = now() - interval '1 hour' WHERE sync_run_id = $1::bigint", [runId]);
  const reaped = await maintainRetirements(pool, {});
  assert.equal(reaped.reaped.rowCount, 1);
  assert.equal((await retirementRow(runId)).status, "retry_wait");

  // Worker B claims the SAME job for real (attempts becomes 2) and also
  // pauses right after its claim commits.
  await pool.query("UPDATE ingest.branch_stock_retirements SET next_attempt_at = now() WHERE sync_run_id = $1::bigint", [runId]);
  const dbB = pausingDb(pool, pausesAfterRetirementClaim);
  const pendingB = processOneRetirement(dbB);
  const jobB = await dbB.claimed;
  assert.equal(jobB.attempts, 2);

  // Now let Worker A resume. It still holds its STALE jobA (attempts:1). Its
  // call into processRetirementJob correctly throws "no longer owned"
  // (CLAIM-X-050's fence), landing it in processOneRetirement's catch block
  // — the code path this claim is actually about.
  dbA.release();
  await pendingA;

  const afterAsCatch = await retirementRow(runId);
  assert.equal(afterAsCatch.status, "processing", "Worker A's catch must not disturb Worker B's legitimately-claimed row");
  assert.equal(afterAsCatch.attempts, 2, "the row must still show Worker B's attempt count, not be reverted");
  assert.doesNotMatch(afterAsCatch.last_error || "", /no longer owned by this worker/, "Worker A's stale error must never be written onto Worker B's row");

  // Let Worker B finish its own (real) attempt — it also fails (no manifest),
  // and its OWN catch block must still be able to record that normally.
  dbB.release();
  await pendingB;
  const final = await retirementRow(runId);
  assert.equal(final.attempts, 2, "Worker B's own catch must still work normally");
  assert.equal(final.status, "retry_wait");
  assert.match(final.last_error, /manifest not yet available/i);
});

// REVERT-CHECK: reproduces CLAIM-X-052 directly by running the OLD catch
// condition (status='processing' only, no attempts token) against the SAME
// post-interleaving state as above, to prove the fix is not vacuous.
integration("REVERT-CHECK: without the attempts token, a stale catch block overwrites a reclaimed lease", async () => {
  await buildRealSchema();
  await resetData();
  const runId = (await pool.query(
    "INSERT INTO ingest.sync_runs (sync_type, source_name, branch_code, ingestion_mode, status, snapshot_mode, handoff_status, apply_status, started_at, total_batches) VALUES ('adapos_branch_001','adapos_sync','001','v1','success','full','not_applicable','not_applicable', now(), 1) RETURNING sync_run_id",
  )).rows[0].sync_run_id;
  await pool.query(
    "INSERT INTO ingest.branch_stock_retirements (sync_run_id, branch_code, attempts, max_attempts) VALUES ($1::bigint, '001', 0, 5)",
    [runId],
  );
  const jobA = await claimNextRetirement(pool); // attempts=1
  await pool.query("UPDATE ingest.branch_stock_retirements SET claimed_at = now() - interval '1 hour' WHERE sync_run_id = $1::bigint", [runId]);
  await maintainRetirements(pool, {});
  await pool.query("UPDATE ingest.branch_stock_retirements SET next_attempt_at = now() WHERE sync_run_id = $1::bigint", [runId]);
  await claimNextRetirement(pool); // Worker B, attempts=2
  assert.equal((await retirementRow(runId)).attempts, 2);

  // OLD shape: no attempts token in the catch UPDATE — exactly what
  // processOneRetirement's catch block did before the X-052 fix.
  await pool.query(
    "UPDATE ingest.branch_stock_retirements SET status = 'retry_wait', last_error = $2, claimed_at = NULL, next_attempt_at = now() WHERE sync_run_id = $1::bigint AND status = 'processing'",
    [runId, "Retirement lease no longer owned by this worker (reaped or reclaimed by another attempt); aborting without committing any stock change."],
  );

  const after = await retirementRow(runId);
  assert.equal(after.attempts, 2, "attempts must be untouched (B's claim increment survives)");
  assert.equal(after.status, "retry_wait", "reproduces CLAIM-X-052: A's stale catch wrongly reverted B's in-flight 'processing' row");
  assert.match(after.last_error, /no longer owned by this worker/, "reproduces CLAIM-X-052: B's row now carries A's stale error message");
  void jobA;
});

// The SAME ownership-token gap, independently found (not by Codex) while
// auditing every queue state transition per the round-3 instruction —
// reconciliation's own success write (reconcileBranchStockJob) and its catch
// (processOneReconciliation) had the identical pre-fix shape as retirement.
function pausesAfterReconciliationClaim(sql, result) {
  return /UPDATE ingest\.branch_stock_reconciliations reconciliation/.test(sql)
    && /RETURNING reconciliation\.sync_run_id/.test(sql)
    && result.rowCount === 1;
}

integration("REAL POSTGRES (CLAIM-X-052, reconciliation queue): a fenced-out worker cannot steal or cancel a reclaimed reconciliation lease", async () => {
  await buildRealSchema();
  await resetData();
  const runId = (await pool.query(
    "INSERT INTO ingest.sync_runs (sync_type, source_name, branch_code, ingestion_mode, status, snapshot_mode, handoff_status, apply_status, started_at, total_batches) VALUES ('adapos_branch_001','adapos_sync','001','v1','success','full','not_applicable','not_applicable', now(), 1) RETURNING sync_run_id",
  )).rows[0].sync_run_id;
  // retirement must be 'done' for reconciliation to be claimable at all.
  await pool.query(
    "INSERT INTO ingest.branch_stock_retirements (sync_run_id, branch_code, status, attempts, max_attempts) VALUES ($1::bigint, '001', 'done', 1, 5)",
    [runId],
  );
  await pool.query(
    "INSERT INTO ingest.branch_stock_reconciliations (sync_run_id, branch_code, contract_version, expected_manifest, attempts, max_attempts) VALUES ($1::bigint, '001', 'branch-stock-v1', $2::jsonb, 0, 5)",
    [runId, JSON.stringify({ uniqueProductCount: 0, digest: "empty" })],
  );

  const dbA = pausingDb(pool, pausesAfterReconciliationClaim);
  const pendingA = processOneReconciliation(dbA);
  const jobA = (await dbA.claimed);
  assert.equal(jobA.attempts, 1);

  await pool.query("UPDATE ingest.branch_stock_reconciliations SET claimed_at = now() - interval '1 hour' WHERE sync_run_id = $1::bigint", [runId]);
  const reaped = await maintainReconciliations(pool, {});
  assert.equal(reaped.reaped.rowCount, 1);
  await pool.query("UPDATE ingest.branch_stock_reconciliations SET next_attempt_at = now() WHERE sync_run_id = $1::bigint", [runId]);

  const dbB = pausingDb(pool, pausesAfterReconciliationClaim);
  const pendingB = processOneReconciliation(dbB);
  const jobB = await dbB.claimed;
  assert.equal(jobB.attempts, 2);

  // Release A: its reconcileBranchStockJob read phase completes normally,
  // then its own final write finds attempts no longer match (B has it) and
  // throws — landing A in processOneReconciliation's catch, the code path
  // under test.
  dbA.release();
  await pendingA;

  const afterAsCatch = (await pool.query("SELECT status, attempts, last_error FROM ingest.branch_stock_reconciliations WHERE sync_run_id=$1::bigint", [runId])).rows[0];
  assert.equal(afterAsCatch.status, "processing", "Worker A must not disturb Worker B's legitimately-claimed reconciliation row");
  assert.equal(afterAsCatch.attempts, 2);

  dbB.release();
  await pendingB;
});
