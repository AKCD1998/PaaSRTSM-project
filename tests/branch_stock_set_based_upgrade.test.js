"use strict";

// Track C — Legacy Branch-Stock v1 Set-Based Optimization.
// POST /branch-stock/sync (and its byte-identical alias
// POST /sync/ada/branch-stock) currently do a per-record read/merge/upsert
// loop against ada.branch_stock_snapshots (wide) and ada.branch_stock_current
// (normalized). This file is TESTS-FIRST: written BEFORE the set-based
// handler implementation, against the OLD per-record path, to establish
// ground truth exactly as GLM's Phase 1 OLD BEHAVIOR CHARACTERIZATION
// documented and Sonnet independently re-verified from source
// (_ledger/claude.md CLAIM-X-182). All tests run against a REAL disposable
// local Postgres gated on TRACK_C_LEGACY_BRANCH_STOCK_TEST_DATABASE_URL —
// never a structural mock, per the human's explicit instruction that a mock
// must evaluate real SQL predicates, not return hardcoded rows.
//
// Schema fidelity note (Senior Review finding, CLAIM-X-182d): GLM's Phase 1
// probe schema had qty_branch_XXX/synced_at/source_synced_at as nullable on
// ada.branch_stock_snapshots, but the true migrations/022_add_ada_branch_stock_snapshots.sql
// declares all three NOT NULL. This file's schema bootstrap is corrected to
// match the true migration exactly (see buildRealSchema below) — it is NOT
// a copy of GLM's probe schema.
//
// Known asymmetric behavior this file locks in, not "fixes" (QUESTION-004,
// docs/BRANCH_STOCK_GENERATION_CONTRACT.md): the wide table's qty write is
// UNCONDITIONAL (arrival-order-wins); the normalized table's qty write is
// freshness-guarded (WHERE synced_at IS NULL OR synced_at <= EXCLUDED.synced_at).
// A batch/set-based rewrite must preserve this exact asymmetry unless
// separately authorized to change it.
//
// The two sync routes are byte-identical except for the acquireIngestionDbClient
// routeLabel string (confirmed by direct source diff, not assumed). The
// manual-upload route (/branch-stock/upload) shares all 6 helper functions
// with the two sync routes and must not regress from any Phase-2/3 change,
// even though it is not itself being converted to set-based in this candidate.
//
// Dedup-key note for Phase 3 (forward-looking, not testable against OLD path):
// the OLD path has NO app-level string-concatenation dedup key at all — it
// relies on per-record DB round-trips and ON CONFLICT (product_code) alone.
// If Phase 3's batch implementation needs a de-dup Map before building a
// UNNEST array, it MUST use a collision-safe structured key
// (JSON.stringify([productCode, branchCode])), never string concatenation —
// the exact bug class Codex's Slice 2 review found and every later slice in
// this engagement has proactively avoided.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { Pool } = require("pg");

// Stub categorization BEFORE requiring branch-stock.js, not after (Codex
// Tech Lead review, second housekeeping item: a guessed setTimeout(200ms)
// drain in test.after() was a race, not a real fix, and is removed).
// branch-stock.js destructures `{ runCategorizationBatch }` from this
// module at its own require-time, so the exports object must already hold
// the stub by the time that destructuring runs -- mutating it afterward
// would not affect branch-stock.js's already-captured local reference.
// fireCategorizationBatch (branch-stock.js:23-31) fires this via
// setImmediate, decoupled from the route's own response, and
// .catch()-swallows any rejection -- the ONLY reason it could ever touch a
// closed pool is that the real implementation queries `db` (the pool) for
// real. This stub never references its `db` argument at all, so there is
// no longer any resource for a late-firing setImmediate callback to race
// against pool.end() on -- the race is eliminated structurally, not worked
// around with a wait. This also removes the pre-existing, out-of-scope
// "relation ... does not exist" console noise every real-Postgres test file
// exercising these routes previously showed (the throwaway schema here was
// never going to build out the full multi-tier categorization schema).
const categorizationModule = require("../apps/admin-api/src/categorization");
const originalRunCategorizationBatch = categorizationModule.runCategorizationBatch;
categorizationModule.runCategorizationBatch = async () => ({ scanned: 0, matched: 0, stubbed: true });

let createBranchStockRouter;
try {
  ({ createBranchStockRouter } = require("../apps/admin-api/src/routes/branch-stock"));
} finally {
  // branch-stock.js has already captured the stub through its destructured
  // import. Restore the shared module export immediately so any later import
  // in this process still observes the real categorization implementation.
  categorizationModule.runCategorizationBatch = originalRunCategorizationBatch;
}
assert.strictEqual(
  categorizationModule.runCategorizationBatch,
  originalRunCategorizationBatch,
  "test setup must restore the shared categorization export after branch-stock captures the stub",
);
const {
  processOneReconciliation,
  processOneRetirement,
} = require("../apps/admin-api/src/worker");
const {
  buildBranchStockReconciliationManifest,
} = require("../apps/admin-api/src/services/branchStockReconciliation");

const databaseUrl = process.env.TRACK_C_LEGACY_BRANCH_STOCK_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

const migrationsDir = path.join(__dirname, "..", "migrations");
function readMigration(name) {
  return fs.readFileSync(path.join(migrationsDir, name), "utf8");
}
const sql023 = readMigration("023_add_ada_branch_stock_uploads.sql");
const sql032 = readMigration("032_add_branch_stock_cost_columns.sql");
const sql060 = readMigration("060_add_async_ingestion_queue.sql");
const sql066 = readMigration("066_add_ada_branch_stock_current.sql");
const sql067 = readMigration("067_add_branch_stock_reconciliation.sql");
const sql068 = readMigration("068_add_branch_stock_generation_tracking.sql");
const sql069 = readMigration("069_add_branch_stock_retirements.sql");

// Base ingest.sync_runs + ada.branch_stock_snapshots, inlined exactly matching
// the true migrations/022_add_ada_branch_stock_snapshots.sql (NOT NULL on
// qty_branch_XXX/synced_at/source_synced_at, matching production — corrected
// from GLM's looser Phase-1 probe schema per CLAIM-X-182d) plus a minimal
// ingest.sync_runs base that migrations 060/068 (below) ALTER into its full
// shape. This exact pattern (real ALTER-only migration files applied on top
// of a minimal inlined CREATE) is proven correct and already used by
// tests/branch_stock_generation.test.js in this same repo.
async function buildRealSchema(pool) {
  await pool.query(`
    DROP SCHEMA IF EXISTS ingest CASCADE; DROP SCHEMA IF EXISTS ada CASCADE; DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA ingest; CREATE SCHEMA ada; CREATE SCHEMA public;
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
      synced_at timestamptz NOT NULL, source_system text NOT NULL DEFAULT 'AdaAcc',
      source_table text NOT NULL DEFAULT 'TCNTPdtInWha', source_synced_at timestamptz NOT NULL,
      raw_payload jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.skus (company_code text PRIMARY KEY, category_name text);
    CREATE TABLE ada.products (product_code text PRIMARY KEY, category_name text);
    CREATE TABLE ada.product_category_states (product_code text PRIMARY KEY, review_status text);
  `);
  await pool.query(sql032);
  await pool.query(sql060);
  await pool.query(sql023);
  await pool.query(sql066);
  await pool.query(sql067);
  await pool.query(sql068);
  await pool.query(sql069);
}

async function resetData(pool) {
  await pool.query(
    "TRUNCATE ingest.branch_stock_retirements, ingest.branch_stock_reconciliations, ingest.sync_batches, ingest.sync_runs, " +
    "ada.branch_stock_snapshots, ada.branch_stock_current, ada.branch_stock_uploads RESTART IDENTITY CASCADE",
  );
}

function buildConfig(overrides = {}) {
  return {
    posApiKeys: new Set(["test-pos-key"]),
    ...overrides,
  };
}

function makeApp(pool) {
  const app = express();
  app.use(express.json());
  const router = createBranchStockRouter({
    config: buildConfig(),
    db: pool,
    requireAuthMiddleware: (req, res, next) => next(),
    requireRoleMiddleware: () => (req, res, next) => next(),
    requireCsrfMiddleware: (req, res, next) => next(),
  });
  app.use("/api", router);
  app.use((err, req, res, _next) => {
    res.status(500).json({ error: "Internal server error" });
  });
  return app;
}

// Pool proxy recording every SQL statement. Restores the TRUE original
// client.query/client.release references (no rebinding) before the client
// returns to the shared pool — same proven pattern as
// apps/admin-api/src/routes/sync-ada-transfers.test.js.
//
// Tracks TWO separate lists deliberately: `clientStatements` (everything run
// on the transaction client acquired via connect() — the actual per-record
// write-path work matrix J is measuring) and `topLevelStatements`
// (everything run via db.query() directly, outside any transaction).
// fireCategorizationBatch (branch-stock.js:23-31) calls db.query() directly
// via a setImmediate AFTER the response is sent — a real but unrelated,
// asynchronously-racing side effect discovered while first running this
// test (it intermittently landed inside the same tick and inflated the
// count by exactly 1). Matrix J's assertion must isolate the write path from
// this side effect, not average over its nondeterministic timing.
function makeCountingPool(realPool) {
  const clientStatements = [];
  const topLevelStatements = [];
  const wrapped = {
    statements: clientStatements,
    topLevelStatements,
    async connect() {
      const client = await realPool.connect();
      const origQuery = client.query;
      const origRelease = client.release;
      client.query = function patchedQuery(sql, params) {
        if (typeof sql === "string") clientStatements.push(sql.replace(/\s+/g, " ").trim());
        return origQuery.call(client, sql, params);
      };
      client.release = function patchedRelease(...args) {
        client.query = origQuery;
        client.release = origRelease;
        return origRelease.apply(client, args);
      };
      return client;
    },
    async query(sql, params) {
      if (typeof sql === "string") topLevelStatements.push(sql.replace(/\s+/g, " ").trim());
      return realPool.query(sql, params);
    },
    end() { return realPool.end(); },
  };
  return wrapped;
}

let pool;
test.before(async function () {
  if (!databaseUrl) return;
  pool = new Pool({ connectionString: databaseUrl, max: 8 });
  await buildRealSchema(pool);
});

test.after(async function () {
  // No drain needed: the categorization stub above never touches `pool`,
  // so a late-firing fireCategorizationBatch setImmediate callback has
  // nothing left to race against pool.end() on (Codex Tech Lead review --
  // an earlier setTimeout(200ms) "probably long enough" guess is removed).
  if (pool) await pool.end();
});

function record(productCode, qty, overrides = {}) {
  return { productCode, qty, ...overrides };
}

async function post(app, path, body) {
  return request(app).post(path).set("x-api-key", "test-pos-key").send(body);
}

async function currentRow(productCode, branchCode) {
  return (await pool.query(
    "SELECT * FROM ada.branch_stock_current WHERE product_code = $1 AND branch_code = $2",
    [productCode, branchCode],
  )).rows[0] || null;
}

async function wideRow(productCode) {
  return (await pool.query(
    "SELECT * FROM ada.branch_stock_snapshots WHERE product_code = $1", [productCode],
  )).rows[0] || null;
}

// ===========================================================================
// MATRIX A — Normal batch
// ===========================================================================

integration("A1: 1 record — business fields match direct upsert expectations", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const res = await post(app, "/api/branch-stock/sync", {
    branchCode: "000",
    records: [record("A1-P1", 5, { costAvg: 1.5 })],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { accepted: 1, insertedOrUpdated: 1, branchCode: "000" });
  const wide = await wideRow("A1-P1");
  assert.equal(Number(wide.qty_branch_000), 5);
  assert.equal(Number(wide.cost_avg_branch_000), 1.5);
  const cur = await currentRow("A1-P1", "000");
  assert.equal(Number(cur.qty), 5);
});

integration("A2: 50 records — all business fields correct", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const records = Array.from({ length: 50 }, (_, i) => record(`A2-P${i}`, i + 1, { costAvg: i * 0.1 }));
  const res = await post(app, "/api/branch-stock/sync", { branchCode: "001", records });
  assert.equal(res.status, 200);
  assert.equal(res.body.accepted, 50);
  assert.equal(res.body.insertedOrUpdated, 50);
  for (let i = 0; i < 50; i += 1) {
    const wide = await wideRow(`A2-P${i}`);
    assert.equal(Number(wide.qty_branch_001), i + 1, `product A2-P${i} qty mismatch`);
    const cur = await currentRow(`A2-P${i}`, "001");
    assert.equal(Number(cur.qty), i + 1, `product A2-P${i} current-table qty mismatch`);
  }
});

integration("A3: 1000 records — succeeds, no partial failure", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const records = Array.from({ length: 1000 }, (_, i) => record(`A3-P${i}`, i));
  const res = await post(app, "/api/branch-stock/sync", { branchCode: "003", records });
  assert.equal(res.status, 200);
  assert.equal(res.body.accepted, 1000);
  const count = await pool.query(
    "SELECT count(*) FROM ada.branch_stock_current WHERE branch_code = '003'",
  );
  assert.equal(Number(count.rows[0].count), 1000);
});

// ===========================================================================
// MATRIX B — Wide-table safety
// ===========================================================================

integration("B1: writing branch 001 for a product already touched by branch 000 does not clobber branch 000", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  await post(app, "/api/branch-stock/sync", { branchCode: "000", records: [record("B1-P1", 11)] });
  await post(app, "/api/branch-stock/sync", { branchCode: "001", records: [record("B1-P1", 22)] });
  const wide = await wideRow("B1-P1");
  assert.equal(Number(wide.qty_branch_000), 11, "branch 000 must be preserved");
  assert.equal(Number(wide.qty_branch_001), 22);
  assert.equal(Number(wide.qty_total_all_branches), 33, "total must be recomputed across both branches");
});

integration("B2: product metadata (name/barcode/unit) preserved across a later branch-only update", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  await post(app, "/api/branch-stock/sync", {
    branchCode: "000",
    records: [record("B2-P1", 1, { productNameThai: "สินค้า B2", barcode: "8801234", unit: "BOX" })],
  });
  await post(app, "/api/branch-stock/sync", { branchCode: "001", records: [record("B2-P1", 2)] });
  const wide = await wideRow("B2-P1");
  assert.equal(wide.product_name_thai, "สินค้า B2");
  assert.equal(wide.barcode, "8801234");
  assert.equal(wide.unit, "BOX");
});

integration("B3: qty_total_all_branches correct after 3 different branches touch the same product across 3 separate requests", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  await post(app, "/api/branch-stock/sync", { branchCode: "000", records: [record("B3-P1", 5)] });
  await post(app, "/api/branch-stock/sync", { branchCode: "003", records: [record("B3-P1", 7)] });
  await post(app, "/api/branch-stock/sync", { branchCode: "004", records: [record("B3-P1", 9)] });
  const wide = await wideRow("B3-P1");
  assert.equal(Number(wide.qty_total_all_branches), 21);
});

// ===========================================================================
// MATRIX C — Normalized-table safety
// ===========================================================================

integration("C1: product/branch membership correct — one row per (product, branch)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  await post(app, "/api/branch-stock/sync", { branchCode: "000", records: [record("C1-P1", 1)] });
  await post(app, "/api/branch-stock/sync", { branchCode: "001", records: [record("C1-P1", 2)] });
  const rows = (await pool.query(
    "SELECT branch_code, qty FROM ada.branch_stock_current WHERE product_code = 'C1-P1' ORDER BY branch_code",
  )).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].branch_code, "000");
  assert.equal(Number(rows[0].qty), 1);
  assert.equal(rows[1].branch_code, "001");
  assert.equal(Number(rows[1].qty), 2);
});

integration("C2: qty, cost, timestamps, and raw_payload are accurate on the normalized table", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const syncedAt = "2026-08-12T03:00:00.000Z";
  // Note: raw_payload is NOT read from a dedicated "rawPayload" input field —
  // parseBranchStockPayload always stores the entire submitted record object
  // verbatim as rawPayload (confirmed by direct source read, branch-stock.js:212).
  // A record-level "rawPayload" key, if sent, is simply ignored/overwritten.
  await post(app, "/api/branch-stock/sync", {
    branchCode: "005",
    records: [record("C2-P1", 3.5, { costAvg: 12.25, syncedAt })],
  });
  const cur = await currentRow("C2-P1", "005");
  assert.equal(Number(cur.qty), 3.5);
  assert.equal(Number(cur.cost_avg), 12.25);
  assert.equal(new Date(cur.synced_at).toISOString(), syncedAt);
  assert.equal(cur.raw_payload.productCode, "C2-P1", "raw_payload must contain the entire submitted record, not a nested field");
  assert.equal(Number(cur.raw_payload.qty), 3.5);
});

integration("C3: two branches for the same product occupy independent normalized rows (no cross-branch overwrite)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  await post(app, "/api/branch-stock/sync", { branchCode: "000", records: [record("C3-P1", 100)] });
  await post(app, "/api/branch-stock/sync", { branchCode: "001", records: [record("C3-P1", 1)] });
  const r000 = await currentRow("C3-P1", "000");
  const r001 = await currentRow("C3-P1", "001");
  assert.equal(Number(r000.qty), 100, "branch 000 row must be untouched by branch 001 write");
  assert.equal(Number(r001.qty), 1);
});

// ===========================================================================
// MATRIX D — Freshness / order (locks in the OLD asymmetry, does not "fix" it)
// ===========================================================================

integration("D1: wide table — a STALE write arriving after a FRESH one overwrites it (unconditional, must be preserved)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  await post(app, "/api/branch-stock/sync", {
    branchCode: "000", syncRunId: 601,
    records: [record("D1-P1", 100, { syncedAt: "2026-08-12T02:00:00.000Z" })],
  });
  await post(app, "/api/branch-stock/sync", {
    branchCode: "000", syncRunId: 602,
    records: [record("D1-P1", 1, { syncedAt: "2026-08-12T01:00:00.000Z" })],
  });
  const wide = await wideRow("D1-P1");
  assert.equal(Number(wide.qty_branch_000), 1, "wide table must NOT freshness-guard qty (QUESTION-004, open, must not be silently fixed)");
  assert.equal(Number(wide.full_sync_run_id_branch_000), 602);
});

integration("D2: normalized table — a STALE write arriving after a FRESH one is REJECTED (freshness-guarded, must be preserved)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  await post(app, "/api/branch-stock/sync", {
    branchCode: "000", syncRunId: 601,
    records: [record("D2-P1", 100, { syncedAt: "2026-08-12T02:00:00.000Z" })],
  });
  await post(app, "/api/branch-stock/sync", {
    branchCode: "000", syncRunId: 602,
    records: [record("D2-P1", 1, { syncedAt: "2026-08-12T01:00:00.000Z" })],
  });
  const cur = await currentRow("D2-P1", "000");
  assert.equal(Number(cur.qty), 100, "normalized table must reject the stale write");
  assert.equal(Number(cur.last_full_sync_run_id), 601, "generation marker must stay at the fresher run");
});

integration("D3: the wide/normalized freshness asymmetry from D1+D2 exists simultaneously from ONE pair of requests (not two independently-passing tests)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  await post(app, "/api/branch-stock/sync", {
    branchCode: "001", syncRunId: 1,
    records: [record("D3-P1", 50, { syncedAt: "2026-08-12T05:00:00.000Z" })],
  });
  await post(app, "/api/branch-stock/sync", {
    branchCode: "001", syncRunId: 2,
    records: [record("D3-P1", 5, { syncedAt: "2026-08-12T04:00:00.000Z" })],
  });
  const wide = await wideRow("D3-P1");
  const cur = await currentRow("D3-P1", "001");
  assert.equal(Number(wide.qty_branch_001), 5, "wide overwrote (unconditional)");
  assert.equal(Number(cur.qty), 50, "normalized rejected the same stale write (guarded)");
});

// ===========================================================================
// MATRIX E — Duplicate / collision
// ===========================================================================

// Codex correction (Tech Lead review, real-Postgres reproduction, BLOCKED
// verdict before seal): "last occurrence wins" is true ONLY for this
// qty-only case, because qty is the one field OLD always overwrites
// unconditionally on every record regardless of duplicates. It is NOT true
// for the complete record state -- name/barcode/unit/cost/timestamp
// preservation across duplicate records depends on OLD's SEQUENTIAL
// per-record merge (each duplicate reads the state the previous duplicate,
// within the same payload, just wrote), which a naive "keep only the last
// occurrence, discard the rest" reduction does not reproduce. See MATRIX K
// below for the full regression coverage Codex required.
integration("E1: duplicate product code within one payload — LAST occurrence wins for qty specifically (unconditional overwrite every record, not the same as full-record last-wins — see MATRIX K)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const res = await post(app, "/api/branch-stock/sync", {
    branchCode: "000",
    records: [record("E1-DUP", 10), record("E1-DUP", 20)],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.accepted, 2, "accepted count is the INPUT count, not de-duped");
  const wide = await wideRow("E1-DUP");
  const cur = await currentRow("E1-DUP", "000");
  assert.equal(Number(wide.qty_branch_000), 20, "wide table: last-wins");
  assert.equal(Number(cur.qty), 20, "normalized table: last-wins");
});

integration("E2: product codes containing separator-like special characters (|, \", \\) round-trip without corruption", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const weirdCodes = ["E2|P1", 'E2"P2', "E2\\P3"];
  const res = await post(app, "/api/branch-stock/sync", {
    branchCode: "000",
    records: weirdCodes.map((code, i) => record(code, i + 1)),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.accepted, weirdCodes.length);
  for (let i = 0; i < weirdCodes.length; i += 1) {
    const wide = await wideRow(weirdCodes[i]);
    assert.ok(wide, `product code ${JSON.stringify(weirdCodes[i])} must round-trip intact`);
    assert.equal(Number(wide.qty_branch_000), i + 1);
  }
});

// ===========================================================================
// MATRIX K — Codex Tech Lead regression: sequential-merge duplicate handling
// ===========================================================================
//
// Codex independently reproduced against real Postgres (BLOCKED verdict
// before seal) that dedupeByProductCodeLastWins's naive "keep only the last
// occurrence" discards state the OLD sequential per-record merge depends on.
// Sonnet independently re-reproduced both the OLD and candidate outputs
// below via a throwaway probe script BEFORE trusting Codex's report or
// writing any fix (not accepted on the report alone) -- every expected
// value in this matrix is either Codex's own reproduction or Sonnet's own
// independent empirical trace against the real OLD implementation, not a
// hand-derived guess.
//
// The core mechanism: OLD's per-record loop, for N duplicate records of the
// same productCode in one payload, calls upsertBranchStockSnapshot/
// upsertBranchStockCurrent N SEPARATE times, each reading the row-state the
// PREVIOUS call (for the same product, same transaction) just wrote. This is
// a genuine sequential fold, not a "last write wins" collapse -- the two
// tables fold DIFFERENTLY (wide: qty/synced_at always take the LAST
// record's own value unconditionally, but name/barcode/unit/cost carry
// forward from an earlier record when a later one omits them; normalized:
// every record independently attempts a freshness-guarded write against
// whatever the fold has accumulated so far, so a later record can be
// REJECTED by an earlier record's write within the same payload).

integration("K1: Codex's exact repro — duplicate with newer-then-older timestamps, second omits name/cost (wide keeps last qty/synced_at but carries forward name/cost; normalized rejects the stale second write entirely)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const res = await post(app, "/api/branch-stock/sync", {
    branchCode: "000",
    records: [
      record("K1-P1", 10, { syncedAt: "2026-08-13T05:00:00.000Z", productNameThai: "FIRST", costAvg: 9.99 }),
      record("K1-P1", 20, { syncedAt: "2026-08-13T04:00:00.000Z" }), // name/cost omitted, OLDER timestamp
    ],
  });
  assert.equal(res.status, 200);
  const wide = await wideRow("K1-P1");
  const cur = await currentRow("K1-P1", "000");
  assert.equal(Number(wide.qty_branch_000), 20, "wide: qty always takes the LAST record's own value");
  assert.equal(wide.product_name_thai, "FIRST", "wide: name carried forward from the earlier record since the later one omitted it");
  assert.equal(Number(wide.cost_avg_branch_000), 9.99, "wide: cost carried forward (later record's hasCostAvg was false)");
  assert.equal(new Date(wide.synced_at).toISOString(), "2026-08-13T04:00:00.000Z", "wide: synced_at always takes the LAST record's own value, even though it is older");
  assert.equal(Number(cur.qty), 10, "normalized: the second (older) record's write is REJECTED by the freshness guard against the first record's own just-written state");
  assert.equal(Number(cur.cost_avg), 9.99);
  assert.equal(new Date(cur.synced_at).toISOString(), "2026-08-13T05:00:00.000Z", "normalized: stays at the first record's timestamp, not overwritten by the rejected second write");
});

integration("K2: duplicate with an EXPLICIT-null cost on the second (accepted) record — wide overwrites to null, normalized still preserves (the two tables' asymmetry survives folding, not just single-record writes)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const res = await post(app, "/api/branch-stock/sync", {
    branchCode: "000",
    records: [
      record("K2-P1", 1, { syncedAt: "2026-08-13T01:00:00.000Z", costAvg: 9.99 }),
      record("K2-P1", 2, { syncedAt: "2026-08-13T02:00:00.000Z", costAvg: null }), // newer, passes guard, EXPLICIT null cost
    ],
  });
  assert.equal(res.status, 200);
  const wide = await wideRow("K2-P1");
  const cur = await currentRow("K2-P1", "000");
  assert.equal(Number(wide.qty_branch_000), 2);
  assert.equal(wide.cost_avg_branch_000, null, "wide: explicit null on the accepted second record OVERWRITES cost to null");
  assert.equal(Number(cur.qty), 2, "normalized: the second record passes the freshness guard (newer) and applies");
  assert.equal(Number(cur.cost_avg), 9.99, "normalized: even though the second record's own explicit-null cost applied, the route always collapses it to null before the SQL layer, so COALESCE preserves the prior accepted cost -- asymmetric with the wide table's overwrite, exactly like the single-record F2b case");
});

integration("K3: duplicate with OLDER-then-NEWER timestamps — the ordinary case where sequential fold degenerates to simple last-record-wins on both tables (sanity check the fold doesn't break the common case)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const res = await post(app, "/api/branch-stock/sync", {
    branchCode: "000",
    records: [
      record("K3-P1", 5, { syncedAt: "2026-08-13T01:00:00.000Z", productNameThai: "OLD-NAME", costAvg: 1.11 }),
      record("K3-P1", 8, { syncedAt: "2026-08-13T02:00:00.000Z", productNameThai: "NEW-NAME", costAvg: 2.22 }),
    ],
  });
  assert.equal(res.status, 200);
  const wide = await wideRow("K3-P1");
  const cur = await currentRow("K3-P1", "000");
  assert.equal(Number(wide.qty_branch_000), 8);
  assert.equal(wide.product_name_thai, "NEW-NAME");
  assert.equal(Number(wide.cost_avg_branch_000), 2.22);
  assert.equal(Number(cur.qty), 8, "normalized: second record is genuinely newer, guard passes, applies normally");
  assert.equal(Number(cur.cost_avg), 2.22);
});

integration("K4: duplicate with EQUAL timestamps — the later record in payload order still wins on the normalized table (guard uses <=, not <)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const sameTs = "2026-08-13T03:00:00.000Z";
  const res = await post(app, "/api/branch-stock/sync", {
    branchCode: "000",
    records: [
      record("K4-P1", 1, { syncedAt: sameTs }),
      record("K4-P1", 2, { syncedAt: sameTs }),
    ],
  });
  assert.equal(res.status, 200);
  const wide = await wideRow("K4-P1");
  const cur = await currentRow("K4-P1", "000");
  assert.equal(Number(wide.qty_branch_000), 2);
  assert.equal(Number(cur.qty), 2, "normalized: equal timestamps still let the later record apply (guard is <=, matching the real SQL's WHERE clause exactly)");
});

integration("K5: normalized cost carried from an EARLIER accepted record when a LATER accepted record omits cost (not just 'omitted on the only record')", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const res = await post(app, "/api/branch-stock/sync", {
    branchCode: "000",
    records: [
      record("K5-P1", 1, { syncedAt: "2026-08-13T01:00:00.000Z", costAvg: 9.99 }),
      record("K5-P1", 2, { syncedAt: "2026-08-13T02:00:00.000Z" }), // newer, passes guard, cost OMITTED (not explicit null)
    ],
  });
  assert.equal(res.status, 200);
  const wide = await wideRow("K5-P1");
  const cur = await currentRow("K5-P1", "000");
  assert.equal(Number(wide.qty_branch_000), 2);
  assert.equal(Number(wide.cost_avg_branch_000), 9.99, "wide: omitted cost on the second record carries forward the first record's cost");
  assert.equal(Number(cur.qty), 2, "normalized: second record passes the freshness guard and applies its own qty");
  assert.equal(Number(cur.cost_avg), 9.99, "normalized: cost carried forward from the earlier ACCEPTED record's state, not the pre-batch DB state (there was none here) and not null");
});

integration("K6: a duplicate group behaves identically whether or not a pre-existing DB row already exists before this payload arrives (fold must seed from real DB state, not always start empty)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  // Seed a pre-existing row via a separate, earlier request.
  await post(app, "/api/branch-stock/sync", {
    branchCode: "000",
    records: [record("K6-P1", 100, { syncedAt: "2026-08-13T00:00:00.000Z", productNameThai: "SEED-NAME", costAvg: 50 })],
  });
  // Now a payload with a duplicate pair, both OLDER than the seeded row's
  // timestamp, second omits name/cost.
  const res = await post(app, "/api/branch-stock/sync", {
    branchCode: "000",
    records: [
      record("K6-P1", 1, { syncedAt: "2026-08-12T23:00:00.000Z", productNameThai: "TRY1" }),
      record("K6-P1", 2, { syncedAt: "2026-08-12T22:00:00.000Z" }),
    ],
  });
  assert.equal(res.status, 200);
  const wide = await wideRow("K6-P1");
  const cur = await currentRow("K6-P1", "000");
  assert.equal(Number(wide.qty_branch_000), 2, "wide: qty always takes the last record's own value, unconditional, regardless of any pre-existing row");
  assert.equal(wide.product_name_thai, "TRY1", "wide: name carried from the group's first record (which itself carried forward from... no, TRY1 was explicit); the second record omitted name so it carries TRY1 forward, not the pre-existing SEED-NAME (once a record in THIS payload sets it, it's the fold's accumulated value, not the original DB row)");
  assert.equal(Number(wide.cost_avg_branch_000), 50, "wide: neither record in this payload had a cost, so it must fall through to the PRE-EXISTING DB row's cost (50), proving the fold correctly seeds from real DB state, not always starting empty");
  assert.equal(Number(cur.qty), 100, "normalized: both records in this payload are OLDER than the pre-existing row's timestamp — the freshness guard rejects both, normalized stays exactly as the seed left it");
  assert.equal(Number(cur.cost_avg), 50);
});

// Codex correction round 2 (Tech Lead review, real-Postgres reproduction,
// SECOND BLOCKED verdict): foldWideGroup's seed lines for
// product_name_thai/eng/barcode/unit used `??` (only replaces
// null/undefined), but the OLD path's own row-read normalization,
// mapExistingSnapshotRowToRecord (branch-stock.js:779-782), uses `||`
// (also replaces "" -- the actual value Postgres returns for an unset
// text column that was written as an empty string rather than a true
// SQL NULL). A pre-existing row with product_name_thai = "" would seed
// the fold with "" instead of null, diverging from what the OLD path
// would have merged. The route's own parser normalizes an INCOMING ""
// to null before it ever reaches the merge/fold layer (normalizeNullableText),
// so this case can only be reached by an EXISTING row that already holds a
// literal empty string -- seeded here directly via SQL, not through the
// route, to reproduce exactly the legacy-data shape Codex's finding
// describes.
integration("K7: a pre-existing row whose name/barcode/unit are literal empty strings (not NULL) must seed the fold as NULL, matching the OLD path's own || normalization, not preserve the empty string", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  await pool.query(
    `INSERT INTO ada.branch_stock_snapshots
       (product_code, product_name_thai, product_name_eng, barcode, unit, synced_at, source_synced_at)
     VALUES ('K7-P1', '', '', '', '', '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z')`,
  );
  const res = await post(app, "/api/branch-stock/sync", {
    branchCode: "000",
    records: [record("K7-P1", 5, { syncedAt: "2026-08-13T01:00:00.000Z" })], // name/barcode/unit all omitted
  });
  assert.equal(res.status, 200);
  const wide = await wideRow("K7-P1");
  assert.equal(wide.product_name_thai, null, "an existing empty-string name must seed the fold as null (|| normalization), not preserve ''");
  assert.equal(wide.product_name_eng, null);
  assert.equal(wide.barcode, null);
  assert.equal(wide.unit, null);
});

// ===========================================================================
// MATRIX F — Null / missing fields
// ===========================================================================

integration("F1: cost_avg omitted on first write — stored as null, not 0", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  await post(app, "/api/branch-stock/sync", { branchCode: "000", records: [record("F1-P1", 1)] });
  const wide = await wideRow("F1-P1");
  const cur = await currentRow("F1-P1", "000");
  assert.equal(wide.cost_avg_branch_000, null);
  assert.equal(cur.cost_avg, null);
});

integration("F2: cost_avg explicitly null on a FIRST write — stored as null (same visible result as omitted, but not the same code path)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  await post(app, "/api/branch-stock/sync", { branchCode: "000", records: [record("F2-P1", 1, { costAvg: null })] });
  const cur = await currentRow("F2-P1", "000");
  assert.equal(cur.cost_avg, null);
});

// Design-time finding (Phase 3 preflight, empirically probed against real
// Postgres twice before writing the batch SQL -- the first probe pass only
// checked the wide table and led to a wrong assumption, corrected by a
// second probe against the normalized table specifically):
//
// WIDE table: parseOptionalNumber(null) returns { present: true, value: null
// }, which sets hasCostAvg=true -- mergeBranchStockRecord only calls
// applyBranchCostAvg when hasCostAvg is true (branch-stock.js:814-816), so an
// EXPLICIT null OVERWRITES an existing cost to null. OMITTED
// (hasCostAvg=false) skips that call entirely, PRESERVING the existing cost
// via the untouched spread of the existing record.
//
// NORMALIZED table: the route always computes `costAvg: record.hasCostAvg ?
// record.costAvg : null` before calling upsertBranchStockCurrent
// (branch-stock.js:1295) -- when hasCostAvg is true AND the incoming value is
// itself null (the EXPLICIT-null case), this expression ALSO evaluates to
// null, identical to the omitted case. The SQL then does
// `COALESCE(EXCLUDED.cost_avg, ada.branch_stock_current.cost_avg)`, so BOTH
// omitted and explicit-null PRESERVE the existing cost on this table -- the
// hasCostAvg distinction that matters on the wide table is silently lost
// before it ever reaches the normalized table's SQL.
//
// Net result: explicit-null and omitted are DISTINGUISHABLE on the wide
// table (overwrite vs preserve) but INDISTINGUISHABLE on the normalized
// table (both preserve) -- a genuine, easy-to-miss asymmetry on top of the
// already-known freshness asymmetry (D1-D3). F1/F2 above could not reveal
// any of this because both start from an empty row (nothing to preserve
// either way, so every code path produces the same visible null). This test
// starts from a real existing cost so the branches are distinguishable.
integration("F2b: cost_avg EXPLICIT null OVERWRITES the wide table's cost but PRESERVES the normalized table's cost; OMITTED preserves both (asymmetric, not distinct-wording-same-behavior)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  await post(app, "/api/branch-stock/sync", { branchCode: "000", records: [record("F2b-P1", 1, { costAvg: 9.99 })] });
  assert.equal(Number((await wideRow("F2b-P1")).cost_avg_branch_000), 9.99, "sanity: cost written");
  assert.equal(Number((await currentRow("F2b-P1", "000")).cost_avg), 9.99);

  await post(app, "/api/branch-stock/sync", { branchCode: "000", records: [record("F2b-P1", 2)] }); // costAvg OMITTED
  assert.equal(Number((await wideRow("F2b-P1")).cost_avg_branch_000), 9.99, "wide: OMITTED cost must PRESERVE the existing value");
  assert.equal(Number((await currentRow("F2b-P1", "000")).cost_avg), 9.99, "normalized: OMITTED cost must PRESERVE the existing value");

  await post(app, "/api/branch-stock/sync", { branchCode: "000", records: [record("F2b-P1", 3, { costAvg: null })] }); // costAvg EXPLICIT null
  assert.equal((await wideRow("F2b-P1")).cost_avg_branch_000, null, "wide: EXPLICIT null cost must OVERWRITE the existing value to null");
  assert.equal(Number((await currentRow("F2b-P1", "000")).cost_avg), 9.99, "normalized: EXPLICIT null cost must PRESERVE the existing value (asymmetric with the wide table)");
});

integration("F3: syncRunId omitted — generation fields stay null on both tables", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  await post(app, "/api/branch-stock/sync", { branchCode: "000", records: [record("F3-P1", 1)] });
  const wide = await wideRow("F3-P1");
  const cur = await currentRow("F3-P1", "000");
  assert.equal(wide.full_sync_run_id_branch_000, null);
  assert.equal(cur.last_full_sync_run_id, null);
});

integration("F4: invalid branchCode — 400, no DB write", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const res = await post(app, "/api/branch-stock/sync", { branchCode: "999", records: [record("F4-P1", 1)] });
  assert.equal(res.status, 400);
  const wide = await wideRow("F4-P1");
  assert.equal(wide, null);
});

integration("F5: an invalid record in the middle of the payload — 400, entire payload rejected before any write", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const res = await post(app, "/api/branch-stock/sync", {
    branchCode: "000",
    records: [record("F5-OK", 1), { productCode: "F5-BAD" }, record("F5-OK2", 1)],
  });
  assert.equal(res.status, 400);
  assert.equal(await wideRow("F5-OK"), null, "no partial commit — first valid record must not be written");
  assert.equal(await wideRow("F5-OK2"), null);
});

// ===========================================================================
// MATRIX G — Transaction rollback
// ===========================================================================

integration("G1: a DB-time failure mid-batch rolls back BOTH tables completely, releases connection exactly once", async () => {
  await resetData(pool);
  // Point a fresh app at a pool whose ada.branch_stock_current table is
  // temporarily renamed away, forcing the SECOND write in the per-record
  // sequence (current-table upsert) to fail after the wide-table write for
  // the same record already succeeded within the transaction.
  await pool.query("ALTER TABLE ada.branch_stock_current RENAME TO branch_stock_current_hidden");
  try {
    const app = makeApp(pool);
    const res = await post(app, "/api/branch-stock/sync", {
      branchCode: "000",
      records: [record("G1-P1", 1)],
    });
    assert.equal(res.status, 500);
  } finally {
    await pool.query("ALTER TABLE ada.branch_stock_current_hidden RENAME TO branch_stock_current");
  }
  const wide = await wideRow("G1-P1");
  assert.equal(wide, null, "wide-table write must be rolled back even though it happened first in the same transaction");
  const poolStats = await pool.query("SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'");
  assert.equal(Number(poolStats.rows[0].count), 0, "no connection left idle-in-transaction (rollback + release completed)");
});

integration("G2: a parse-time validation failure never opens a transaction at all — zero writes, zero orphaned connections", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const before = await pool.query("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()");
  await post(app, "/api/branch-stock/sync", { branchCode: "000", records: [{ productCode: "G2-BAD" }] });
  const after = await pool.query("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()");
  assert.ok(Number(after.rows[0].count) <= Number(before.rows[0].count) + 1, "no leaked connection from a validation-only rejection");
});

// ===========================================================================
// MATRIX H — Generation / reconciliation
// ===========================================================================

async function insertSyncRun(overrides = {}) {
  const values = {
    sync_type: "branch_stock_test", source_name: "set-based-test", branch_code: "001",
    ingestion_mode: "v1", status: "running", snapshot_mode: "full", ...overrides,
  };
  const result = await pool.query(
    `INSERT INTO ingest.sync_runs (sync_type, source_name, branch_code, ingestion_mode, status, snapshot_mode, started_at)
     VALUES ($1,$2,$3,$4,$5,$6, now()) RETURNING sync_run_id`,
    [values.sync_type, values.source_name, values.branch_code, values.ingestion_mode, values.status, values.snapshot_mode],
  );
  return Number(result.rows[0].sync_run_id);
}

async function registerRetirementIfComplete(syncRunId) {
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

integration("H1: generation fields present and consistent on both tables after a route-driven write", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const syncRunId = await insertSyncRun({ branch_code: "001" });
  await post(app, "/api/branch-stock/sync", {
    branchCode: "001", syncRunId,
    records: [record("H1-P1", 1)],
  });
  const wide = await wideRow("H1-P1");
  const cur = await currentRow("H1-P1", "001");
  assert.equal(Number(wide.full_sync_run_id_branch_001), syncRunId);
  assert.equal(Number(cur.last_full_sync_run_id), syncRunId);
});

integration("H2: a real end-to-end route-driven v1 branch reaches reconciliation PASS (must not regress CLAIM-C-046's fix)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const syncRunId = await insertSyncRun({ branch_code: "001" });
  const at = new Date().toISOString();
  const recs = [record("H2-P1", 10, { syncedAt: at }), record("H2-P2", 20, { syncedAt: at })];
  const res = await post(app, "/api/branch-stock/sync", { branchCode: "001", syncRunId, records: recs });
  assert.equal(res.status, 200);
  await pool.query("UPDATE ingest.sync_runs SET status = 'success' WHERE sync_run_id = $1::bigint", [syncRunId]);
  await registerManifest(syncRunId, "001", recs.map((r) => ({ productCode: r.productCode, qty: r.qty, syncedAt: at })));
  await registerRetirementIfComplete(syncRunId);
  const retireDid = await processOneRetirement(pool);
  assert.equal(retireDid, true);
  const reconDid = await processOneReconciliation(pool);
  assert.equal(reconDid, true);
  const row = (await pool.query(
    "SELECT status, last_error FROM ingest.branch_stock_reconciliations WHERE sync_run_id = $1::bigint", [syncRunId],
  )).rows[0];
  assert.equal(row.status, "pass", `expected pass, got ${row.status} (${row.last_error})`);
});

integration("H3: a product missing from the current generation is NOT silently counted as present (membership check still catches drift)", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const syncRunId = await insertSyncRun({ branch_code: "001" });
  const at = new Date().toISOString();
  // Route writes only ONE product for this generation...
  await post(app, "/api/branch-stock/sync", { branchCode: "001", syncRunId, records: [record("H3-P1", 1, { syncedAt: at })] });
  await pool.query("UPDATE ingest.sync_runs SET status = 'success' WHERE sync_run_id = $1::bigint", [syncRunId]);
  // ...but the manifest CLAIMS two products were expected (simulating a
  // record that failed to persist for the current generation).
  await registerManifest(syncRunId, "001", [
    { productCode: "H3-P1", qty: 1, syncedAt: at },
    { productCode: "H3-P2-MISSING", qty: 1, syncedAt: at },
  ]);
  await registerRetirementIfComplete(syncRunId);
  await processOneRetirement(pool);
  await processOneReconciliation(pool);
  const row = (await pool.query(
    "SELECT status FROM ingest.branch_stock_reconciliations WHERE sync_run_id = $1::bigint", [syncRunId],
  )).rows[0];
  assert.notEqual(row.status, "pass", "a genuinely missing product must not be silently accepted as a pass");
});

// ===========================================================================
// MATRIX I — Route contract
// ===========================================================================

integration("I1: response status/body/count match the documented OLD contract", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const res = await post(app, "/api/branch-stock/sync", { branchCode: "000", records: [record("I1-P1", 1), record("I1-P2", 2)] });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ["accepted", "branchCode", "insertedOrUpdated"]);
  assert.equal(res.body.accepted, 2);
  assert.equal(res.body.insertedOrUpdated, 2);
  assert.equal(res.body.branchCode, "000");
});

integration("I2: alias route /sync/ada/branch-stock produces identical persisted state for identical input", async () => {
  await resetData(pool);
  const app = makeApp(pool);
  const payload = { branchCode: "004", syncRunId: 900, records: [record("I2-P1", 7, { costAvg: 3.3 })] };
  const resA = await post(app, "/api/branch-stock/sync", payload);
  const wideA = await wideRow("I2-P1");
  await resetData(pool);
  const resB = await post(app, "/api/sync/ada/branch-stock", payload);
  const wideB = await wideRow("I2-P1");
  assert.equal(resA.status, resB.status);
  assert.deepEqual(resA.body, resB.body);
  for (const col of ["qty_branch_004", "cost_avg_branch_004", "full_sync_run_id_branch_004", "qty_total_all_branches"]) {
    assert.equal(String(wideA[col]), String(wideB[col]), `column ${col} must match between the two alias routes`);
  }
});

integration("I3: 503 DB_UNAVAILABLE when the pool cannot acquire a connection", async () => {
  const brokenPool = { connect: async () => { throw new Error("connection refused (test-simulated)"); } };
  const app = makeApp(brokenPool);
  const res = await post(app, "/api/branch-stock/sync", { branchCode: "000", records: [record("I3-P1", 1)] });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "DB_UNAVAILABLE");
});

integration("I4: no hidden retry — a single DB-time failure produces exactly one failed attempt, not a silently-retried success", async () => {
  await resetData(pool);
  await pool.query("ALTER TABLE ada.branch_stock_current RENAME TO branch_stock_current_hidden2");
  let res;
  try {
    const app = makeApp(pool);
    res = await post(app, "/api/branch-stock/sync", { branchCode: "000", records: [record("I4-P1", 1)] });
  } finally {
    await pool.query("ALTER TABLE ada.branch_stock_current_hidden2 RENAME TO branch_stock_current");
  }
  assert.equal(res.status, 500, "the route must surface the failure once, not retry until the renamed-back table happens to exist");
  assert.equal(await wideRow("I4-P1"), null);
});

// ===========================================================================
// MATRIX J — Query-count proof (OLD path baseline; Phase 3 must not grow this O(records))
// ===========================================================================

// J1 originally asserted the OLD per-record path's baseline (4 statements
// per record: 1 SELECT + 1 wide INSERT..ON CONFLICT + 1 UPDATE for
// generation columns + 1 normalized INSERT..ON CONFLICT = 200 statements for
// 50 records, confirmed against the OLD implementation before Phase 3
// existed). After Phase 3's FIRST batch implementation this was updated to
// assert exactly 3 -- but Codex's Tech Lead review (BLOCKED verdict, real
// Postgres reproduction, see MATRIX K) found that implementation discarded
// state a correct sequential fold needs. The remediation adds a second
// targeted SELECT (the normalized table's own pre-existing state, needed to
// seed foldNormalizedGroup correctly and independently of the wide table's
// state) -- Codex's own remediation instructions explicitly allowed this:
// "Exact count may become 3 or another small constant if an additional
// set-based state read is needed; correctness takes priority over
// preserving exactly 3." The contract locked in here is now 4 statements
// total (2 targeted SELECTs + 1 wide UPSERT + 1 normalized UPSERT),
// constant regardless of record count -- verified against 1000 records too
// so a record-count-scaled regression cannot silently creep back in.
integration("J1: 50-record payload — exact SQL statement count is O(1), not O(records) (Phase 3 contract, 4 statements after Codex's correctness-over-3 remediation)", async () => {
  await resetData(pool);
  const countingPool = makeCountingPool(pool);
  const app = makeApp(countingPool);
  const records = Array.from({ length: 50 }, (_, i) => record(`J1-P${i}`, i + 1, { costAvg: 1, syncRunId: undefined }));
  const res = await post(app, "/api/branch-stock/sync", { branchCode: "000", syncRunId: 1234, records });
  assert.equal(res.status, 200);
  const nonTxStatements = countingPool.statements.filter((s) => !/^(begin|commit|rollback)$/i.test(s));
  assert.equal(countingPool.statements.filter((s) => /^begin$/i.test(s)).length, 1);
  assert.equal(countingPool.statements.filter((s) => /^commit$/i.test(s)).length, 1);
  assert.equal(nonTxStatements.length, 4, `expected exactly 4 non-transaction statements for 50 records, got ${nonTxStatements.length}`);
});

integration("J2: 1000-record payload — same fixed statement count as J1's 50 records (proves O(1), not just 'less than before')", async () => {
  await resetData(pool);
  const countingPool = makeCountingPool(pool);
  const app = makeApp(countingPool);
  const records = Array.from({ length: 1000 }, (_, i) => record(`J2-P${i}`, i + 1, { costAvg: 1 }));
  const res = await post(app, "/api/branch-stock/sync", { branchCode: "000", syncRunId: 5678, records });
  assert.equal(res.status, 200);
  const nonTxStatements = countingPool.statements.filter((s) => !/^(begin|commit|rollback)$/i.test(s));
  assert.equal(nonTxStatements.length, 4, `expected the SAME fixed statement count for 1000 records as for 50 (got ${nonTxStatements.length}) — if this grows with record count, the O(1) contract has regressed`);
});
