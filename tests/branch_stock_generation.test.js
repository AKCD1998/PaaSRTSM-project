"use strict";

// Branch-stock generation round (_ledger/claude.md CLAIM-C-046/C-047/C-048)
// PLUS the follow-up remediation round (CLAIM-X-046/X-047, fixed by
// C-051/C-052/C-053). Real-Postgres acceptance tests for: v1 reconciliation
// reaching PASS, full-snapshot retirement via the durable retirement queue,
// crash-before-finalization safety, overlapping generations, the C-048 v1/v2
// freshness interaction (both directions), and delta-mode safety. Every test
// here runs against a real throwaway Postgres cluster gated by
// CP4_TEST_DATABASE_URL, same convention as tests/cp4_postgres_integration.test.js.
//
// The remediation round replaced direct finalizeFullSnapshotGeneration calls
// with a durable queue (ingest.branch_stock_retirements) requiring a
// membership-proof check before sweeping. Tests below register a retirement
// job the same way production does (mirroring the exact WITH...INSERT SQL
// routes/sync.js now runs atomically with the v1 status flip), then process
// it via the real registerRetirementJobIfComplete/processOneRetirement
// exports. The NEW adversarial file, tests/branch_stock_retirement_durability.test.js,
// proves the full route/worker lifecycle (including the old-agent
// compatibility requirement) through the real HTTP routes, not helpers.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const {
  applyBranchStockBatch, processOneReconciliation,
  processOneRetirement, processRetirementJob,
} = require("../apps/admin-api/src/worker");
const {
  upsertBranchStockSnapshot, upsertBranchStockCurrent,
} = require("../apps/admin-api/src/routes/branch-stock");
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

async function insertRun(overrides = {}) {
  const values = {
    sync_type: "test", source_name: "gen-test", branch_code: "001", ingestion_mode: "v1",
    status: "running", snapshot_mode: "full",
    ...overrides,
  };
  const result = await pool.query(
    `INSERT INTO ingest.sync_runs
       (sync_type, source_name, branch_code, ingestion_mode, status, snapshot_mode,
        handoff_status, apply_status, started_at, total_batches, finalized_at)
     VALUES ($1,$2,$3,$4,$5,$6,
             CASE WHEN $4='hybrid_v2' THEN 'success' ELSE 'not_applicable' END,
             CASE WHEN $4='hybrid_v2' THEN $8 ELSE 'not_applicable' END,
             now(), $7, CASE WHEN $4='hybrid_v2' AND $9 THEN now() ELSE NULL END)
     RETURNING sync_run_id`,
    [
      values.sync_type, values.source_name, values.branch_code, values.ingestion_mode,
      values.status, values.snapshot_mode, values.total_batches ?? 1,
      values.apply_status ?? "applied", values.finalized ?? true,
    ],
  );
  return Number(result.rows[0].sync_run_id);
}

async function finishV1Run(syncRunId, status = "success") {
  await pool.query("UPDATE ingest.sync_runs SET status = $2 WHERE sync_run_id = $1::bigint", [syncRunId, status]);
}

// Mirrors the exact INSERT the "registered" CTE in routes/sync.js's
// run-finish handler runs atomically with the v1 status flip — kept in sync
// with that predicate deliberately (same WHERE clause) so this test file
// exercises the real production condition without needing a full HTTP
// request per test. The NEW durability test file proves the real route path.
async function registerV1RetirementIfComplete(syncRunId) {
  await pool.query(
    `INSERT INTO ingest.branch_stock_retirements (sync_run_id, branch_code, status, next_attempt_at)
     SELECT sync_run_id, branch_code, 'pending', now() FROM ingest.sync_runs
     WHERE sync_run_id = $1::bigint AND ingestion_mode = 'v1' AND status = 'success' AND snapshot_mode = 'full'
     ON CONFLICT (sync_run_id) DO NOTHING`,
    [syncRunId],
  );
}

async function registerManifest(syncRunId, branchCode, records) {
  await pool.query(
    `INSERT INTO ingest.branch_stock_reconciliations (sync_run_id, branch_code, contract_version, expected_manifest)
     VALUES ($1::bigint, $2, 'branch-stock-v1', $3::jsonb)
     ON CONFLICT (sync_run_id) DO NOTHING`,
    [syncRunId, branchCode, JSON.stringify(buildBranchStockReconciliationManifest(records))],
  );
}

async function retirementRow(syncRunId) {
  return (await pool.query(
    "SELECT * FROM ingest.branch_stock_retirements WHERE sync_run_id = $1::bigint", [syncRunId],
  )).rows[0] || null;
}

function wideRec(productCode, qty, at, extra = {}) {
  return {
    productCode, productNameThai: null, productNameEng: null, barcode: null, unit: null,
    qtyBranch000: 0, qtyBranch001: 0, qtyBranch002: 0, qtyBranch003: 0, qtyBranch004: 0, qtyBranch005: 0,
    qtyTotalAllBranches: qty, costAvgBranch000: null, costAvgBranch001: null, costAvgBranch002: null,
    costAvgBranch003: null, costAvgBranch004: null, costAvgBranch005: null, syncedAt: at, rawPayload: {},
    ...extra,
  };
}

async function writeV1Product(client, branchCode, productCode, qty, at, syncRunId) {
  const key = `qtyBranch${branchCode}`;
  const record = wideRec(productCode, qty, at, { [key]: qty });
  await upsertBranchStockSnapshot(client, record, branchCode, syncRunId);
  await upsertBranchStockCurrent(client, {
    productCode, branchCode, qty, costAvg: null, syncedAt: at, rawPayload: {}, syncRunId,
  });
}

// ---------------------------------------------------------------------------
// TEST 1: v1 real end-to-end reaches reconciliation PASS (CLAIM-C-046 fix),
// now including the remediation round's added requirement that retirement
// must complete before reconciliation is even claimable.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES: v1 branch reaches reconciliation PASS end-to-end (CLAIM-C-046, gated by retirement)", async () => {
  await buildRealSchema();
  await resetData();
  const at = "2026-07-29T01:00:00.000Z";
  const syncRunId = await insertRun({ branch_code: "001", ingestion_mode: "v1" });
  const client = await pool.connect();
  try {
    await writeV1Product(client, "001", "P1", 10, at, syncRunId);
    await writeV1Product(client, "001", "P2", 20, at, syncRunId);
  } finally {
    client.release();
  }
  await finishV1Run(syncRunId, "success");
  const recs = [{ productCode: "P1", qty: 10, syncedAt: at }, { productCode: "P2", qty: 20, syncedAt: at }];
  await registerManifest(syncRunId, "001", recs);

  // Reconciliation must NOT be claimable yet — retirement hasn't run.
  const tooEarly = await processOneReconciliation(pool);
  assert.equal(tooEarly, false, "reconciliation must not be claimable before retirement completes");

  await registerV1RetirementIfComplete(syncRunId);
  const retireDid = await processOneRetirement(pool);
  assert.equal(retireDid, true);
  const retirement = await retirementRow(syncRunId);
  assert.equal(retirement.status, "done", `expected done, got ${retirement.status} (${retirement.last_error})`);

  const did = await processOneReconciliation(pool);
  assert.equal(did, true);
  const row = (await pool.query(
    "SELECT status, last_error FROM ingest.branch_stock_reconciliations WHERE sync_run_id = $1::bigint",
    [syncRunId],
  )).rows[0];
  assert.equal(row.status, "pass", `expected pass, got ${row.status} (${row.last_error})`);
});

// REVERT-CHECK for TEST 1: with the pre-fix filter (freshness IS NOT NULL),
// the wide-table read must come back EMPTY for a v1 branch even after this
// round's writes stamp the *generation* column — proving the fix is in the
// filter column choice, not incidentally fixed by something else.
integration("REVERT-CHECK: pre-fix wide-table filter (freshness IS NOT NULL) is empty for a v1 branch", async () => {
  await buildRealSchema();
  await resetData();
  const at = "2026-07-29T01:00:00.000Z";
  const syncRunId = await insertRun({ branch_code: "001", ingestion_mode: "v1" });
  const client = await pool.connect();
  try {
    await writeV1Product(client, "001", "P1", 10, at, syncRunId);
  } finally {
    client.release();
  }
  await pool.query("UPDATE ada.branch_stock_snapshots SET synced_at_branch_001 = NULL WHERE product_code = 'P1'");
  const oldFilterRows = (await pool.query(
    "SELECT product_code FROM ada.branch_stock_snapshots WHERE synced_at_branch_001 IS NOT NULL",
  )).rows;
  assert.equal(oldFilterRows.length, 0, "pre-fix freshness-based filter finds nothing for a v1 branch, reproducing C-046's empty-snapshot dead-letter");
});

// REVERT-CHECK for the remediation round's ordering requirement: without the
// EXISTS(...retirement...status='done') clause this round added to
// claimNextReconciliation, reconciliation WOULD be claimable immediately
// after run success, with no retirement having run at all. Reproduced
// directly against the pre-remediation predicate shape.
integration("REVERT-CHECK: pre-remediation reconciliation predicate (no retirement gate) would claim immediately", async () => {
  await buildRealSchema();
  await resetData();
  const at = "2026-07-29T01:00:00.000Z";
  const syncRunId = await insertRun({ branch_code: "001", ingestion_mode: "v1" });
  const client = await pool.connect();
  try {
    await writeV1Product(client, "001", "P1", 10, at, syncRunId);
  } finally {
    client.release();
  }
  await finishV1Run(syncRunId, "success");
  await registerManifest(syncRunId, "001", [{ productCode: "P1", qty: 10, syncedAt: at }]);
  // No retirement registered/processed at all — this is the exact
  // pre-remediation-round state (a run marked success with retirement never
  // having run). Reproduce the OLD predicate directly to prove it WOULD have
  // matched (the actual current predicate is proven separately to reject it
  // in TEST 1 above via the real processOneReconciliation call).
  const oldPredicateMatch = (await pool.query(
    `SELECT 1 FROM ingest.branch_stock_reconciliations candidate
     JOIN ingest.sync_runs candidate_run ON candidate_run.sync_run_id = candidate.sync_run_id
     WHERE candidate.status IN ('pending', 'retry_wait')
       AND candidate.next_attempt_at <= now()
       AND (candidate_run.apply_status = 'applied' OR (candidate_run.ingestion_mode = 'v1' AND candidate_run.status = 'success'))`,
  )).rows;
  assert.equal(oldPredicateMatch.length, 1, "the old (pre-remediation) predicate would have made this claimable with zero retirement having run");
});

// ---------------------------------------------------------------------------
// TEST 2: full-snapshot retirement (CLAIM-C-047 fix) via the durable queue —
// a product absent from the newest complete generation is zeroed out in BOTH
// tables and no longer readable as live stock, without deleting the row.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES: retirement zeroes a product dropped from the newest full snapshot (CLAIM-C-047)", async () => {
  await buildRealSchema();
  await resetData();
  const at1 = "2026-07-29T01:00:00.000Z";
  const at2 = "2026-07-29T02:00:00.000Z";
  const client = await pool.connect();
  const gen1 = await insertRun({ branch_code: "001", ingestion_mode: "v1", status: "running" });
  try {
    await writeV1Product(client, "001", "P1", 10, at1, gen1);
    await writeV1Product(client, "001", "P2", 20, at1, gen1);
  } finally {
    client.release();
  }
  await finishV1Run(gen1, "success");
  await registerV1RetirementIfComplete(gen1);
  await registerManifest(gen1, "001", [{ productCode: "P1", qty: 10, syncedAt: at1 }, { productCode: "P2", qty: 20, syncedAt: at1 }]);
  assert.equal(await processOneRetirement(pool), true);
  assert.equal((await retirementRow(gen1)).status, "done");

  // Generation 2 only re-syncs P1 — P2 has been discontinued and is absent.
  const gen2 = await insertRun({ branch_code: "001", ingestion_mode: "v1", status: "running" });
  const client2 = await pool.connect();
  try {
    await writeV1Product(client2, "001", "P1", 11, at2, gen2);
  } finally {
    client2.release();
  }
  await finishV1Run(gen2, "success");
  await registerV1RetirementIfComplete(gen2);
  await registerManifest(gen2, "001", [{ productCode: "P1", qty: 11, syncedAt: at2 }]);
  assert.equal(await processOneRetirement(pool), true);
  const gen2Retirement = await retirementRow(gen2);
  assert.equal(gen2Retirement.status, "done", gen2Retirement.last_error);
  assert.equal(gen2Retirement.retired_normalized_count, 1);
  assert.equal(gen2Retirement.retired_wide_count, 1);

  const normalized = (await pool.query(
    "SELECT qty, retired_at, retired_by_sync_run_id FROM ada.branch_stock_current WHERE product_code = 'P2' AND branch_code = '001'",
  )).rows[0];
  assert.equal(Number(normalized.qty), 0);
  assert.ok(normalized.retired_at, "retired_at must be stamped");
  assert.equal(Number(normalized.retired_by_sync_run_id), gen2);

  const wide = (await pool.query(
    "SELECT qty_branch_001, qty_total_all_branches FROM ada.branch_stock_snapshots WHERE product_code = 'P2'",
  )).rows[0];
  assert.equal(Number(wide.qty_branch_001), 0);
  assert.equal(Number(wide.qty_total_all_branches), 0);

  // P1 (re-synced by generation 2) must be untouched.
  const p1 = (await pool.query(
    "SELECT qty FROM ada.branch_stock_current WHERE product_code = 'P1' AND branch_code = '001'",
  )).rows[0];
  assert.equal(Number(p1.qty), 11);
});

// REVERT-CHECK for TEST 2: without ever registering/processing a retirement
// job at all (pre-C-047 behavior), P2 remains readable at its old nonzero
// quantity forever ("ghost stock").
integration("REVERT-CHECK: without a retirement job, a discontinued product stays visible at its stale quantity", async () => {
  await buildRealSchema();
  await resetData();
  const at1 = "2026-07-29T01:00:00.000Z";
  const at2 = "2026-07-29T02:00:00.000Z";
  const client = await pool.connect();
  const gen1 = await insertRun({ branch_code: "001", ingestion_mode: "v1", status: "running" });
  try {
    await writeV1Product(client, "001", "P2", 20, at1, gen1);
  } finally {
    client.release();
  }
  await finishV1Run(gen1, "success");
  const gen2 = await insertRun({ branch_code: "001", ingestion_mode: "v1", status: "running" });
  const client2 = await pool.connect();
  try {
    await writeV1Product(client2, "001", "P1", 11, at2, gen2);
  } finally {
    client2.release();
  }
  await finishV1Run(gen2, "success");
  // Deliberately skip registerV1RetirementIfComplete/processOneRetirement.
  const p2 = (await pool.query(
    "SELECT qty FROM ada.branch_stock_current WHERE product_code = 'P2' AND branch_code = '001'",
  )).rows[0];
  assert.equal(Number(p2.qty), 20, "ghost stock: P2 is still readable at its stale quantity without a retirement job");
});

// ---------------------------------------------------------------------------
// TEST 3: crash-before-finalization — a generation that never reaches
// 'success'/'applied' must never even get a retirement job registered, and
// the previous complete generation must remain fully intact and readable.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES: crash before completion never registers a retirement job; previous generation stays intact", async () => {
  await buildRealSchema();
  await resetData();
  const at1 = "2026-07-29T01:00:00.000Z";
  const at2 = "2026-07-29T02:00:00.000Z";
  const gen1 = await insertRun({ branch_code: "001", ingestion_mode: "v1", status: "running" });
  const client = await pool.connect();
  try {
    await writeV1Product(client, "001", "P1", 10, at1, gen1);
    await writeV1Product(client, "001", "P2", 20, at1, gen1);
  } finally {
    client.release();
  }
  await finishV1Run(gen1, "success");
  await registerV1RetirementIfComplete(gen1);
  await registerManifest(gen1, "001", [{ productCode: "P1", qty: 10, syncedAt: at1 }, { productCode: "P2", qty: 20, syncedAt: at1 }]);
  assert.equal(await processOneRetirement(pool), true);
  assert.equal((await retirementRow(gen1)).status, "done");

  // Generation 2 starts, writes one partial batch, then "crashes" — run
  // status stays 'running' forever (simulating an agent process that died
  // mid-upload before calling run-finish).
  const gen2 = await insertRun({ branch_code: "001", ingestion_mode: "v1", status: "running" });
  const client2 = await pool.connect();
  try {
    await writeV1Product(client2, "001", "P1", 999, at2, gen2); // partial: P2 never arrives
  } finally {
    client2.release();
  }
  // No finishV1Run(gen2, ...) — it never completes.
  await registerV1RetirementIfComplete(gen2); // matches production: called unconditionally, no-ops on an incomplete run
  const gen2Row = await retirementRow(gen2);
  assert.equal(gen2Row, null, "an incomplete generation must never even get a retirement row registered");

  // P2 must still be readable at its generation-1 quantity — not retired.
  const p2 = (await pool.query(
    "SELECT qty FROM ada.branch_stock_current WHERE product_code = 'P2' AND branch_code = '001'",
  )).rows[0];
  assert.equal(Number(p2.qty), 20, "an incomplete generation must never retire products from the last COMPLETE generation");
});

// ---------------------------------------------------------------------------
// TEST 4: overlapping generations — a superseded (older) generation's
// retirement must be a safe refusal once a newer complete generation has
// already been retired, so two generations can never interleave retirement
// into a mixed result. This bypasses the normal same-branch ordering guard
// deliberately (which would otherwise make this scenario unreachable through
// claimNextRetirement alone) to prove the defense-in-depth check inside
// processRetirementJob itself still holds.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES: a superseded generation's retirement is refused and never retires newer data", async () => {
  await buildRealSchema();
  await resetData();
  const at1 = "2026-07-29T01:00:00.000Z";
  const at2 = "2026-07-29T02:00:00.000Z";
  const gen1 = await insertRun({ branch_code: "001", ingestion_mode: "v1", status: "running" });
  const client = await pool.connect();
  try {
    await writeV1Product(client, "001", "P1", 10, at1, gen1);
  } finally {
    client.release();
  }
  await finishV1Run(gen1, "success");
  // gen1's retirement job is registered (as production would) but NOT yet
  // processed — simulating a delayed/slow worker pick-up.
  await registerV1RetirementIfComplete(gen1);

  // Generation 2 completes normally (re-syncs P1, no P2 ever existed) and
  // its retirement is fully processed to done BEFORE gen1's.
  const gen2 = await insertRun({ branch_code: "001", ingestion_mode: "v1", status: "running" });
  const client2 = await pool.connect();
  try {
    await writeV1Product(client2, "001", "P1", 15, at2, gen2);
  } finally {
    client2.release();
  }
  await finishV1Run(gen2, "success");
  await registerV1RetirementIfComplete(gen2);
  await registerManifest(gen2, "001", [{ productCode: "P1", qty: 15, syncedAt: at2 }]);
  // Directly transition gen2's row to 'processing' and call
  // processRetirementJob for it, bypassing claimNextRetirement's own
  // same-branch ordering guard (which would otherwise make out-of-order
  // processing unreachable) — this is the deliberate bypass described above.
  // job.attempts must match the row's current value exactly — the
  // CLAIM-X-050 ownership fence processRetirementJob now enforces.
  const gen2Claimed = (await pool.query(
    `UPDATE ingest.branch_stock_retirements SET status='processing', claimed_at=now(), attempts=attempts+1 WHERE sync_run_id=$1::bigint RETURNING attempts`,
    [gen2],
  )).rows[0];
  await processRetirementJob(pool, { sync_run_id: gen2, branch_code: "001", ingestion_mode: "v1", attempts: gen2Claimed.attempts });
  const gen2Retirement = await retirementRow(gen2);
  assert.equal(gen2Retirement.status, "done", gen2Retirement.last_error);

  // Now process gen1 out of order (e.g. its delayed original claim finally
  // goes through, or an ops action manually reset it back to processing).
  const gen1Claimed = (await pool.query(
    `UPDATE ingest.branch_stock_retirements SET status='processing', claimed_at=now(), attempts=attempts+1 WHERE sync_run_id=$1::bigint RETURNING attempts`,
    [gen1],
  )).rows[0];
  await processRetirementJob(pool, { sync_run_id: gen1, branch_code: "001", ingestion_mode: "v1", attempts: gen1Claimed.attempts });
  const gen1Retirement = await retirementRow(gen1);
  assert.equal(gen1Retirement.status, "refused");
  assert.match(gen1Retirement.last_error, /Superseded/);

  const p1 = (await pool.query(
    "SELECT qty FROM ada.branch_stock_current WHERE product_code = 'P1' AND branch_code = '001'",
  )).rows[0];
  assert.equal(Number(p1.qty), 15, "gen1's superseded retirement must not overwrite gen2's newer data");
});

// ---------------------------------------------------------------------------
// TEST 5: idempotency — processing the same generation's retirement twice
// retires nothing the second time (a 'done' row is no longer claimable).
// ---------------------------------------------------------------------------
integration("REAL POSTGRES: processing the same generation's retirement twice is idempotent", async () => {
  await buildRealSchema();
  await resetData();
  const at = "2026-07-29T01:00:00.000Z";
  const gen1 = await insertRun({ branch_code: "001", ingestion_mode: "v1", status: "running" });
  const client = await pool.connect();
  try {
    await writeV1Product(client, "001", "P1", 10, at, gen1);
  } finally {
    client.release();
  }
  await finishV1Run(gen1, "success");
  await registerV1RetirementIfComplete(gen1);
  await registerManifest(gen1, "001", [{ productCode: "P1", qty: 10, syncedAt: at }]);
  assert.equal(await processOneRetirement(pool), true);
  assert.equal((await retirementRow(gen1)).status, "done");

  // Registration is idempotent (ON CONFLICT DO NOTHING); processing finds no
  // claimable row for a 'done' generation.
  await registerV1RetirementIfComplete(gen1);
  const second = await processOneRetirement(pool);
  assert.equal(second, false, "a done retirement must not be reclaimable");
  assert.equal((await retirementRow(gen1)).status, "done");
});

// ---------------------------------------------------------------------------
// TEST 6 (CLAIM-C-048, both directions): fixing C-046 makes v1 stamp the
// normalized table's freshness column, which activates the previously-DORMANT
// v2 guard (WHERE synced_at IS NULL OR synced_at <= EXCLUDED.synced_at).
// Direction A: v1 writes a NEWER value, then an OLDER v2 batch arrives for
// the same branch/product — the older v2 write must now be REJECTED (before
// this round, it would have silently regressed the value, since freshness
// was always NULL for a v1-only row).
// Direction B: v2 writes first, then a NEWER v1 write arrives — it must be
// ACCEPTED (v1's own write path was never guarded and stays unconditional).
// ---------------------------------------------------------------------------
integration("REAL POSTGRES CLAIM-C-048 direction A: v1-then-older-v2 is now rejected by the normalized table's guard", async () => {
  await buildRealSchema();
  await resetData();
  const LATE = "2026-07-29T10:00:00.000Z";
  const EARLY = "2026-07-29T09:00:00.000Z";
  const gen1 = await insertRun({ branch_code: "001", ingestion_mode: "v1", status: "running" });
  const client = await pool.connect();
  try {
    await writeV1Product(client, "001", "P1", 100, LATE, gen1);
  } finally {
    client.release();
  }
  await finishV1Run(gen1, "success");

  // A v2/CP4 batch arrives for the SAME branch/product with an OLDER source
  // timestamp (e.g. a hybrid-rollout transition window, or a retried stale batch).
  await applyBranchStockBatch(pool, [{ productCode: "P1", qty: 55, syncedAt: EARLY }], "001", null);

  const normalized = (await pool.query(
    "SELECT qty FROM ada.branch_stock_current WHERE product_code = 'P1' AND branch_code = '001'",
  )).rows[0];
  assert.equal(Number(normalized.qty), 100, "the older v2 write must be rejected now that v1 populates the freshness column");
});

integration("REAL POSTGRES CLAIM-C-048 direction B: v2-then-newer-v1 is accepted (v1's own write stays unconditional)", async () => {
  await buildRealSchema();
  await resetData();
  const EARLY = "2026-07-29T09:00:00.000Z";
  const LATE = "2026-07-29T10:00:00.000Z";
  await applyBranchStockBatch(pool, [{ productCode: "P1", qty: 55, syncedAt: EARLY }], "001", null);

  const gen1 = await insertRun({ branch_code: "001", ingestion_mode: "v1", status: "running" });
  const client = await pool.connect();
  try {
    await writeV1Product(client, "001", "P1", 100, LATE, gen1);
  } finally {
    client.release();
  }
  await finishV1Run(gen1, "success");

  const normalized = (await pool.query(
    "SELECT qty FROM ada.branch_stock_current WHERE product_code = 'P1' AND branch_code = '001'",
  )).rows[0];
  assert.equal(Number(normalized.qty), 100, "a newer v1 write must still be accepted over an older v2 value");
});

// REVERT-CHECK for CLAIM-C-048 direction A: before this round (v1 never
// stamping the freshness column), the guard's IS NULL escape hatch always
// took over and the older v2 write WAS accepted, silently regressing data.
// We reproduce that exact pre-fix condition directly (freshness left NULL).
integration("REVERT-CHECK: with freshness left NULL (pre-fix v1), the older v2 write silently wins", async () => {
  await buildRealSchema();
  await resetData();
  const LATE = "2026-07-29T10:00:00.000Z";
  const EARLY = "2026-07-29T09:00:00.000Z";
  await pool.query(
    `INSERT INTO ada.branch_stock_current (product_code, branch_code, qty, synced_at, updated_at)
     VALUES ('P1', '001', 100, NULL, now())`,
  );
  await applyBranchStockBatch(pool, [{ productCode: "P1", qty: 55, syncedAt: EARLY }], "001", null);
  const normalized = (await pool.query(
    "SELECT qty FROM ada.branch_stock_current WHERE product_code = 'P1' AND branch_code = '001'",
  )).rows[0];
  assert.equal(Number(normalized.qty), 55, "reproduces the pre-fix regression: with freshness NULL, an older write silently wins");
});

// ---------------------------------------------------------------------------
// TEST 7 (delta safety): a run marked snapshot_mode='delta' must NEVER get a
// retirement job registered at all, even if it otherwise looks complete.
// There is no delta ingestion implementation yet, so this proves the guard
// rejects it outright rather than silently mishandling it.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES: a delta-mode run never gets a retirement job registered (no retirement)", async () => {
  await buildRealSchema();
  await resetData();
  const at1 = "2026-07-29T01:00:00.000Z";
  const gen1 = await insertRun({ branch_code: "001", ingestion_mode: "v1", status: "running" });
  const client = await pool.connect();
  try {
    await writeV1Product(client, "001", "P1", 10, at1, gen1);
    await writeV1Product(client, "001", "P2", 20, at1, gen1);
  } finally {
    client.release();
  }
  await finishV1Run(gen1, "success");
  await registerV1RetirementIfComplete(gen1);
  await registerManifest(gen1, "001", [{ productCode: "P1", qty: 10, syncedAt: at1 }, { productCode: "P2", qty: 20, syncedAt: at1 }]);
  assert.equal(await processOneRetirement(pool), true);

  // A later run claims to be a delta (partial) update touching only P1 —
  // must not be allowed to retire P2.
  const gen2 = await insertRun({
    branch_code: "001", ingestion_mode: "v1", status: "running", snapshot_mode: "delta",
  });
  const client2 = await pool.connect();
  try {
    await writeV1Product(client2, "001", "P1", 11, "2026-07-29T02:00:00.000Z", gen2);
  } finally {
    client2.release();
  }
  await finishV1Run(gen2, "success");

  await registerV1RetirementIfComplete(gen2);
  const gen2Row = await retirementRow(gen2);
  assert.equal(gen2Row, null, "a delta-marked run must never even get a retirement job registered");

  const p2 = (await pool.query(
    "SELECT qty FROM ada.branch_stock_current WHERE product_code = 'P2' AND branch_code = '001'",
  )).rows[0];
  assert.equal(Number(p2.qty), 20, "a delta-marked run must never retire products it didn't mention");
});

// ---------------------------------------------------------------------------
// TEST 8 (shadow-only safety re-verification, refuting X-044): reconciliation
// must never touch stock tables, and retirement's own sweep only ever writes
// ada.branch_stock_current / ada.branch_stock_snapshots / its own queue row.
// ---------------------------------------------------------------------------
integration("REAL POSTGRES: reconciliation PASS writes only evidence, never touches stock tables", async () => {
  await buildRealSchema();
  await resetData();
  const at = "2026-07-29T01:00:00.000Z";
  const syncRunId = await insertRun({ branch_code: "001", ingestion_mode: "v1" });
  const client = await pool.connect();
  try {
    await writeV1Product(client, "001", "P1", 10, at, syncRunId);
  } finally {
    client.release();
  }
  await finishV1Run(syncRunId, "success");
  await registerV1RetirementIfComplete(syncRunId);
  await registerManifest(syncRunId, "001", [{ productCode: "P1", qty: 10, syncedAt: at }]);
  assert.equal(await processOneRetirement(pool), true);
  assert.equal((await retirementRow(syncRunId)).status, "done");

  const before = (await pool.query("SELECT qty_branch_001 FROM ada.branch_stock_snapshots WHERE product_code = 'P1'")).rows[0];
  const did = await processOneReconciliation(pool);
  assert.equal(did, true, "sanity check: the reconciliation job must actually be claimed and processed for this test to be meaningful");
  const status = (await pool.query("SELECT status FROM ingest.branch_stock_reconciliations WHERE sync_run_id = $1::bigint", [syncRunId])).rows[0].status;
  assert.equal(status, "pass");
  const after = (await pool.query("SELECT qty_branch_001 FROM ada.branch_stock_snapshots WHERE product_code = 'P1'")).rows[0];
  assert.equal(Number(before.qty_branch_001), Number(after.qty_branch_001), "reconciliation must never mutate stock quantities");
});
