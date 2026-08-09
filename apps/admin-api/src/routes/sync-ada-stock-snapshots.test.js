"use strict";

// Track C Slice 1 — tests for POST /api/sync/ada/stock-snapshots set-based UPSERT.
// Tests-first: written BEFORE the stockSnapshotsBatchHandler implementation.
// All tests run against a REAL disposable local Postgres gated on
// TRACK_C_SLICE1_TEST_DATABASE_URL — never a structural mock that returns fixed
// rows regardless of SQL. The route is exercised end-to-end via supertest with
// a real pg.Pool, so ON CONFLICT, constraint, and type-cast behavior are all
// exercised for real.
//
// Setup (run once before importing): stand up a disposable local Postgres,
// apply migrations/015_add_ada_raw_ingestion.sql, set
// TRACK_C_SLICE1_TEST_DATABASE_URL to point at it. Never point this at
// production or at the read-only gate6_observer role.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { Pool } = require("pg");
const { createAdaSyncRouter } = require("./sync-ada");

const databaseUrl = process.env.TRACK_C_SLICE1_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

// A Pool proxy that records every SQL statement issued, for query-count
// assertions (test #9). It forwards connect()/query() to the real pool and
// captures the trimmed SQL text of each call.
//
// Root-cause fix (Codex-diagnosed, 2026-08-09): the client objects handed
// out by pg's Pool are POOLED and REUSED across connect() calls — patching
// client.query on one and never undoing it means a later, unrelated
// pool.connect() (e.g. test 12, which uses the plain `pool`, not this
// counting wrapper) can receive that SAME client instance with its query
// method still overridden, breaking pg's internal call handling and
// hanging the process. Fix: restore the original client.query BEFORE the
// client is handed back to the pool via release(), so every client that
// leaves this wrapper's control is byte-for-byte the client pg gave us.
function makeCountingPool(realPool) {
  const statements = [];
  const wrapped = {
    statements,
    async connect() {
      const client = await realPool.connect();
      const origQuery = client.query.bind(client);
      const origRelease = client.release.bind(client);
      client.query = (sql, params) => {
        if (typeof sql === "string") statements.push(sql.replace(/\s+/g, " ").trim());
        return origQuery(sql, params);
      };
      client.release = (...args) => {
        // Undo the patch before the client re-enters the shared pool.
        client.query = origQuery;
        return origRelease(...args);
      };
      return client;
    },
    async query(sql, params) {
      if (typeof sql === "string") statements.push(sql.replace(/\s+/g, " ").trim());
      return realPool.query(sql, params);
    },
    end() { return realPool.end(); },
  };
  return wrapped;
}

let pool;
let countingPool;
test.before(async function () {
  if (!databaseUrl) return;
  pool = new Pool({ connectionString: databaseUrl, max: 8 });
  countingPool = makeCountingPool(pool);
  // Safety net: ensure the target table exists (a prior crashed run could have
  // left it dropped). CREATE TABLE IF NOT EXISTS is a no-op if already present.
  const migrationSql = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "..", "migrations", "015_add_ada_raw_ingestion.sql"),
    "utf8",
  );
  await pool.query(migrationSql);
});

test.after(async function () {
  if (pool) await pool.end();
});

// Wires createAdaSyncRouter with a real (or counting) pool + the real-shape
// error middleware from server.js:486-496, so thrown validation errors produce
// the same HTTP 500 / { error: "Internal server error" } body as production.
function makeApp(db) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/sync/ada",
    createAdaSyncRouter({ config: { posApiKeys: new Set() }, db, crmMirrorClient: null }),
  );
  app.use((error, req, res, _next) => {
    const status = error.statusCode || error.status || 500;
    return res.status(status).json({
      error: status >= 500 ? "Internal server error" : error.message,
      request_id: req.requestId || null,
    });
  });
  return app;
}

async function reset() {
  await pool.query("TRUNCATE ada.stock_snapshots RESTART IDENTITY");
}

// Canonical column dump for byte-equivalence (excludes updated_at/created_at/id
// which are run-time defaults and legitimately differ).
async function dumpRows(p = pool) {
  return (await p.query(
    `SELECT snapshot_key, snapshot_at, branch_code, warehouse_code, product_code,
            barcode, lot_no, expiry_date, qty_on_hand, qty_reserved, unit_code,
            qty_base, source_system, source_table, source_synced_at, raw_payload
     FROM ada.stock_snapshots ORDER BY snapshot_key`,
  )).rows.map((r) => {
    // Canonicalize for stable comparison against the reference snapshot, which was
    // saved via JSON.stringify (so dates became ISO strings, jsonb became a string).
    // pg returns date/timestamptz as JS Date and jsonb as a parsed object; coerce
    // both to strings so the comparison is value-equal, not type-sensitive.
    const dateFields = ["snapshot_at", "expiry_date", "source_synced_at"];
    const out = { ...r };
    for (const f of dateFields) {
      if (out[f] instanceof Date) out[f] = out[f].toISOString();
    }
    out.raw_payload = out.raw_payload == null ? null : JSON.stringify(out.raw_payload);
    return out;
  });
}

const BASE_BODY = {
  sourceSystem: "AdaAcc",
  sourceSyncedAt: "2026-08-09T01:00:00Z",
};

// ---- Test 1: mixed INSERT + UPDATE in one payload ---------------------------
integration("test 1: mixed INSERT + UPDATE — final values match direct upserts", async () => {
  await reset();
  // Pre-seed one existing row by POSTing it through the route itself first
  // (avoids hardcoding the snapshot_key string, which is fragile — see
  // buildStockSnapshotKey's pipe-join). Then send a payload that updates it
  // (same productCode+snapshotAt+empty optionals => same key) + inserts new.
  const seed = await request(makeApp(pool)).post("/api/sync/ada/stock-snapshots").send({
    ...BASE_BODY,
    records: [{ productCode: "UPD", snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: 1, unitCode: "OLD" }],
  });
  assert.equal(seed.statusCode, 200);
  const seedKey = (await pool.query("SELECT snapshot_key FROM ada.stock_snapshots WHERE product_code='UPD'")).rows[0].snapshot_key;
  const res = await request(makeApp(pool)).post("/api/sync/ada/stock-snapshots").send({
    ...BASE_BODY,
    records: [
      { productCode: "UPD", snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: 42, unitCode: "EA" }, // UPDATE (same key)
      { productCode: "NEW1", snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: 7 },                 // INSERT
      { productCode: "NEW2", snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: 8 },                 // INSERT
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accepted, 3);
  const rows = await dumpRows();
  assert.equal(rows.length, 3, "1 updated + 2 inserted = 3 rows, no duplicate UPD");
  const upd = rows.find((r) => r.product_code === "UPD");
  assert.equal(upd.snapshot_key, seedKey, "UPDATE must hit the same snapshot_key, not insert a new row");
  assert.equal(Number(upd.qty_on_hand), 42, "UPD row must reflect new qty");
  assert.equal(upd.unit_code, "EA");
});

// ---- Test 2: idempotency — same payload twice → identical state -------------
integration("test 2: identical payload POSTed twice → identical final state", async () => {
  await reset();
  const body = {
    ...BASE_BODY,
    records: [
      { productCode: "IDEM1", snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: 5, lotNo: "L1" },
      { productCode: "IDEM2", snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: 6 },
    ],
  };
  const r1 = await request(makeApp(pool)).post("/api/sync/ada/stock-snapshots").send(body);
  assert.equal(r1.statusCode, 200);
  const state1 = JSON.stringify(await dumpRows());
  const r2 = await request(makeApp(pool)).post("/api/sync/ada/stock-snapshots").send(body);
  assert.equal(r2.statusCode, 200);
  const state2 = JSON.stringify(await dumpRows());
  assert.equal(state1, state2, "second POST must leave DB identical to first");
});

// ---- Test 3: duplicate snapshot_key within one payload — last-wins ----------
// Ground truth established empirically on the OLD path: HTTP 200, accepted =
// INPUT count (2), persisted row = SECOND (last array position) record's values.
integration("test 3: duplicate snapshot_key in payload → last-wins, accepted=input count", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/stock-snapshots").send({
    ...BASE_BODY,
    records: [
      { productCode: "DUP", snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: 10, unitCode: "U1" },
      { productCode: "DUP", snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: 20, unitCode: "U2" },
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accepted, 2, "accepted must be INPUT record count, not de-duped");
  const row = (await pool.query("SELECT qty_on_hand, unit_code FROM ada.stock_snapshots WHERE product_code='DUP'")).rows[0];
  assert.equal(Number(row.qty_on_hand), 20, "last (second) record must win");
  assert.equal(row.unit_code, "U2");
});

// ---- Test 4: one invalid record rolls back the ENTIRE payload --------------
integration("test 4: invalid record (missing productCode) → full rollback, 0 rows, HTTP 500", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/stock-snapshots").send({
    ...BASE_BODY,
    records: [
      { productCode: "OK1", snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: 5 },
      { snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: 9 }, // missing productCode -> throws
    ],
  });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "Internal server error");
  const count = (await pool.query("SELECT count(*)::int AS c FROM ada.stock_snapshots")).rows[0].c;
  assert.equal(count, 0, "entire payload must roll back");
});

// ---- Test 5: simulated DB failure mid-batch → rollback, single release -----
integration("test 5: DB query failure → rollback, connection released exactly once (no leak/double-release)", async () => {
  // Use a SEPARATE scratch database that has the ada schema but NOT the
  // stock_snapshots table, so the route's INSERT fails with a genuine Postgres
  // error without ever touching the shared test DB's table. This avoids the
  // shared-state-poisoning failure mode an earlier DROP-based version had.
  const adminPool = new Pool({ connectionString: databaseUrl, max: 2 });
  await adminPool.query("DROP DATABASE IF EXISTS trackc_slice1_empty");
  await adminPool.query("CREATE DATABASE trackc_slice1_empty");
  await adminPool.end();
  const emptyPool = new Pool({ connectionString: databaseUrl.replace(/\/[^/]*$/, "/trackc_slice1_empty"), max: 2 });
  try {
    await emptyPool.query("CREATE SCHEMA ada"); // schema only, no stock_snapshots table
  } finally {
    await emptyPool.end();
  }
  // Pool used by the handler under test: points at the empty DB. Wrap connect()
  // ONLY to count release() calls — never replace client.query (that breaks
  // pg's internal queue and deadlocks).
  let releaseCount = 0;
  const handlerPool = new Pool({ connectionString: databaseUrl.replace(/\/[^/]*$/, "/trackc_slice1_empty"), max: 2 });
  const instrumented = {
    async connect() {
      const client = await handlerPool.connect();
      const origRelease = client.release.bind(client);
      client.release = () => { releaseCount += 1; return origRelease(); };
      return client;
    },
    async query(sql, params) { return handlerPool.query(sql, params); },
    end() { return handlerPool.end(); },
  };
  try {
    const res = await request(makeApp(instrumented)).post("/api/sync/ada/stock-snapshots").send({
      ...BASE_BODY,
      records: [{ productCode: "FAIL", snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: 1 }],
    });
    assert.equal(res.statusCode, 500, "must surface as a server error");
    assert.equal(releaseCount, 1, "connection must be released exactly once, no leak, no double-release");
  } finally {
    await handlerPool.end();
    const cleanup = new Pool({ connectionString: databaseUrl, max: 2 });
    await cleanup.query("DROP DATABASE IF EXISTS trackc_slice1_empty");
    await cleanup.end();
  }
});

// ---- Test 6: empty payload -------------------------------------------------
integration("test 6: empty records: [] → 200, accepted:0, no error", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/stock-snapshots").send({ ...BASE_BODY, records: [] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accepted, 0);
  assert.equal(res.body.syncRunId, null);
});

// ---- Test 7: normalization edge cases match OLD behavior -------------------
integration("test 7: null/decimal/timestamp normalization edges — missing optional fields OK", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/stock-snapshots").send({
    ...BASE_BODY,
    records: [
      { productCode: "EDGE", snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: 3.5, qtyReserved: 1.25, qtyBase: 10 }, // decimals
      { productCode: "NULLS", snapshotAt: "2026-08-09T01:00:00Z" }, // all optional fields missing
    ],
  });
  assert.equal(res.statusCode, 200);
  const rows = await dumpRows();
  const edge = rows.find((r) => r.product_code === "EDGE");
  assert.equal(Number(edge.qty_on_hand), 3.5);
  assert.equal(Number(edge.qty_reserved), 1.25);
  assert.equal(Number(edge.qty_base), 10);
  const nulls = rows.find((r) => r.product_code === "NULLS");
  assert.equal(nulls.qty_on_hand, null);
  assert.equal(nulls.lot_no, null);
  assert.equal(nulls.expiry_date, null);
});

// ---- Test 8: full-fixture business-data equivalence vs OLD path reference --
// Renamed from "byte-identical" (2026-08-09 remediation, Codex review): the
// comparison below excludes ada_stock_snapshot_id (surrogate PK, never
// written by either path) and created_at/updated_at (runtime defaults) —
// dumpRows() deliberately never SELECTs those three columns, so they cannot
// differ either way. Every column dumpRows() DOES select (16 business
// fields: snapshot_key, snapshot_at, branch_code, warehouse_code,
// product_code, barcode, lot_no, expiry_date, qty_on_hand, qty_reserved,
// unit_code, qty_base, source_system, source_table, source_synced_at,
// raw_payload) is compared via deepStrictEqual after canonicalization, not
// just the 6 fields an earlier draft of this test checked individually.
integration("test 8: 200-record mixed fixture → NEW output business-data equivalent to OLD reference", async () => {
  await reset();
  // Deterministic 250-input fixture (same one used to capture the reference
  // snapshot fixture below against the OLD per-record path BEFORE
  // implementing the set-based handler).
  const records = [];
  for (let i = 0; i < 100; i++) records.push({ productCode: `P${i}`, snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: i + 1, unitCode: "EA", lotNo: i % 2 ? "L-A" : "", expiryDate: i % 3 ? "2027-01-01" : "" });
  for (let i = 0; i < 50; i++) records.push({ productCode: `P${i}`, snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: 1000 + i, unitCode: "BX" });
  for (let i = 0; i < 50; i++) records.push({ productCode: `DUP${i}`, snapshotAt: "2026-08-09T02:00:00Z", qtyOnHand: 7, unitCode: "X" });
  for (let i = 0; i < 50; i++) records.push({ productCode: `DUP${i}`, snapshotAt: "2026-08-09T02:00:00Z", qtyOnHand: 8, unitCode: "Y" });
  const res = await request(makeApp(pool)).post("/api/sync/ada/stock-snapshots").send({ ...BASE_BODY, records });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accepted, records.length);
  const newRows = await dumpRows();
  const refPath = path.join(__dirname, "..", "..", "test", "fixtures", "track_c_slice1_stock_snapshots_ref.json");
  const refRows = JSON.parse(fs.readFileSync(refPath, "utf8"));
  assert.equal(newRows.length, refRows.length, `row count mismatch: NEW=${newRows.length} REF=${refRows.length}`);
  // Full structural comparison per row, all 16 business fields at once —
  // deepStrictEqual fails loudly (with Node's own rich diff) on ANY field
  // divergence, not just the subset a manual field list would remember to
  // check.
  for (let i = 0; i < newRows.length; i++) {
    assert.deepStrictEqual(
      newRows[i],
      refRows[i],
      `row ${i} (${newRows[i].product_code}) diverges from the OLD-path reference across one or more business fields`,
    );
  }
});

// ---- Test 9: query count — NEW path O(1) vs OLD path O(N) ------------------
integration("test 9: query count — batch path issues O(1) INSERTs for N records", async () => {
  await reset();
  countingPool.statements.length = 0;
  const records = [];
  for (let i = 0; i < 50; i++) records.push({ productCode: `QC${i}`, snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: i });
  const res = await request(makeApp(countingPool)).post("/api/sync/ada/stock-snapshots").send({ ...BASE_BODY, records });
  assert.equal(res.statusCode, 200);
  // Count data INSERT statements (exclude BEGIN/COMMIT/ROLLBACK control flow).
  const inserts = countingPool.statements.filter((s) => /INSERT INTO ada\.stock_snapshots/i.test(s));
  // OLD path issued exactly 50 (one per record). NEW path must issue a SMALL
  // CONSTANT (1 set-based INSERT). Assert the upper bound loosely so a future
  // chunking refinement (e.g. 1 INSERT per 1000 rows) still passes, but a
  // regression to per-record looping (50) fails hard.
  assert.ok(
    inserts.length <= 2,
    `NEW path must issue a small constant number of INSERTs (<=2), got ${inserts.length} for 50 records — looks like per-record looping regressed`,
  );
  assert.ok(inserts.length >= 1, "must issue at least one INSERT");
});

// ---- Test 10: real Postgres (not a structural mock) — implicit in all above --
// (documented here per the packet: every test above exercises real ON CONFLICT,
// constraint, and type-cast behavior because it runs through a real pg.Pool.)

// ---- Test 12: production-representative payload size (>=1000 records) -------
integration("test 12: 1000-record payload in one POST — succeeds, no second-time error", async () => {
  await reset();
  const records = [];
  for (let i = 0; i < 1000; i++) records.push({ productCode: `BIG${i}`, snapshotAt: "2026-08-09T01:00:00Z", qtyOnHand: i });
  const res = await request(makeApp(pool)).post("/api/sync/ada/stock-snapshots").send({ ...BASE_BODY, records });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accepted, 1000);
  const count = (await pool.query("SELECT count(*)::int AS c FROM ada.stock_snapshots")).rows[0].c;
  assert.equal(count, 1000);
});

// ---- Test 11: full existing sync-ada.test.js still passes -------------------
// (run separately via `node --test apps/admin-api/src/routes/sync-ada.test.js`
// — that file is NOT modified and must still pass 3/3. Asserted in the report,
// not re-run inside this file to avoid double-wiring the router.)
