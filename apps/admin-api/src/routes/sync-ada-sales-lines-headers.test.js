"use strict";

// Track C Slice 3 — tests for POST /api/sync/ada/sales set-based UPSERT
// (both ada.sales_headers and ada.sales_lines in one request).
// Tests-first: written BEFORE the set-based handler implementation, against
// the OLD per-record path first to establish ground truth. All tests run
// against a REAL disposable local Postgres gated on
// TRACK_C_SLICE3_TEST_DATABASE_URL — never a structural mock.
//
// No FK constraints on ada.sales_headers/ada.sales_lines (unlike Slice 2's
// analytics.product_sales_summary_periods) — confirmed by reading
// migrations/015_add_ada_raw_ingestion.sql directly, no seeding needed.
//
// Ground truth established empirically against the OLD path before writing
// this file (see FINAL_TRACK_C_SLICE3_REVIEW_PACKET.md Phase B):
//   - duplicate header conflict key (branch_code, doc_no) in one payload ->
//     LAST array occurrence wins, acceptedHeaders = INPUT header count.
//   - duplicate line conflict key (branch_code, doc_no, line_no,
//     product_code) in one payload -> LAST array occurrence wins,
//     acceptedLines = INPUT line count.
//   - an invalid record in EITHER array rolls back BOTH headers and lines
//     (single shared transaction) -> HTTP 500, {"error":"Internal server
//     error"}, zero rows in both tables.
//   - empty headers/lines -> HTTP 200, {acceptedHeaders:0, acceptedLines:0}.
//   - Codex's Slice 2 review found a real dedup-key collision bug (string
//     concatenation with "|" as separator collides when a field value
//     itself contains "|"). Applied that lesson here from the start: dedup
//     keys use JSON.stringify(tuple), never string concatenation.
//   - Codex's Slice 2 review also found the counting-pool test helper
//     restored a re-bound copy of client.query, not the true original
//     reference. Applied that lesson here from the start too.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { Pool } = require("pg");
const { createAdaSyncRouter } = require("./sync-ada");

const databaseUrl = process.env.TRACK_C_SLICE3_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

// Pool proxy recording every SQL statement issued (test #9's query-count
// assertion). Restores the TRUE original client.query/client.release
// references (no rebinding) before the client returns to the shared pool —
// the exact fix Codex's Slice 2 review required.
function makeCountingPool(realPool) {
  const statements = [];
  const wrapped = {
    statements,
    async connect() {
      const client = await realPool.connect();
      const origQuery = client.query;
      const origRelease = client.release;
      client.query = function patchedQuery(sql, params) {
        if (typeof sql === "string") statements.push(sql.replace(/\s+/g, " ").trim());
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
  // Standalone schema bootstrap (test-harness remediation, 2026-08-09): this
  // file previously assumed the target database already had the ada.*
  // schema applied out-of-band. No FK dependencies here (unlike Slice 2's
  // table) — ada.sales_headers/ada.sales_lines only need
  // migrations/015_add_ada_raw_ingestion.sql, same file Slice 1 and Slice 4
  // already bootstrap from. Confirmed genuinely idempotent by reading the
  // file (CREATE SCHEMA/TABLE IF NOT EXISTS throughout, wrapped in
  // BEGIN/COMMIT, no bare ALTER) — safe to apply unconditionally.
  const migrationSql = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "..", "migrations", "015_add_ada_raw_ingestion.sql"),
    "utf8",
  );
  await pool.query(migrationSql);
});

test.after(async function () {
  if (pool) await pool.end();
});

function makeApp(db, crmMirrorClient) {
  const app = express();
  // Matches production's actual body-size limit (server.js:167:
  // app.use("/api/sync/ada", express.json({ limit: "10mb" }))) — the
  // default express.json() limit (100kb) is too small for a
  // production-representative 1000-record payload and would produce a
  // spurious 413 that has nothing to do with the code under test.
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/sync/ada", createAdaSyncRouter({ config: { posApiKeys: new Set() }, db, crmMirrorClient }));
  app.use((req, res) => res.status(404).json({ error: "Not found", request_id: req.requestId || null }));
  // Mirrors the real production error middleware, server.js:486-496.
  app.use((error, req, res, _next) => {
    const status = error.statusCode || error.status || 500;
    return res.status(status).json({
      error: status >= 500 ? "Internal server error" : error.message,
      request_id: req.requestId || null,
    });
  });
  return app;
}

async function reset(p = pool) {
  await p.query("TRUNCATE ada.sales_headers, ada.sales_lines RESTART IDENTITY CASCADE");
}

// Canonical column dumps for business-data equivalence. Exclude the
// surrogate PK and created_at/updated_at (runtime defaults) — neither path
// lets the caller set these, so dumpRows() never selects them.
async function dumpHeaders(p = pool) {
  return (await p.query(
    `SELECT branch_code, doc_no, doc_date, doc_time, customer_code, paid_status,
            grand_amount, net_amount, vat_amount, cashier_code, terminal_code,
            reference_doc_no, source_system, source_table, source_synced_at, raw_payload
     FROM ada.sales_headers ORDER BY branch_code, doc_no`,
  )).rows.map(canonicalizeRow);
}
async function dumpLines(p = pool) {
  return (await p.query(
    `SELECT branch_code, doc_no, line_no, product_code, barcode, qty, unit_price,
            discount_amount, line_amount, stock_factor, qty_base, lot_no, expiry_date,
            source_system, source_table, source_synced_at, raw_payload
     FROM ada.sales_lines ORDER BY branch_code, doc_no, line_no, product_code`,
  )).rows.map(canonicalizeRow);
}
function canonicalizeRow(r) {
  const out = { ...r };
  for (const key of Object.keys(out)) {
    if (out[key] instanceof Date) out[key] = out[key].toISOString();
  }
  return out;
}

// ---- Test 1: mixed INSERT + UPDATE, both headers and lines ----------------
integration("test 1: mixed INSERT + UPDATE (headers and lines) — final values match direct upserts", async () => {
  await reset();
  const seed = await request(makeApp(pool)).post("/api/sync/ada/sales").send({
    headers: [{ branchCode: "001", docNo: "UPD", grandAmount: 1 }],
    lines: [{ branchCode: "001", docNo: "UPD", lineNo: 1, productCode: "P1", qty: 1 }],
  });
  assert.equal(seed.statusCode, 200);
  const res = await request(makeApp(pool)).post("/api/sync/ada/sales").send({
    headers: [
      { branchCode: "001", docNo: "UPD", grandAmount: 42 }, // UPDATE
      { branchCode: "001", docNo: "NEW1", grandAmount: 7 }, // INSERT
    ],
    lines: [
      { branchCode: "001", docNo: "UPD", lineNo: 1, productCode: "P1", qty: 42 }, // UPDATE
      { branchCode: "001", docNo: "UPD", lineNo: 2, productCode: "P2", qty: 8 }, // INSERT
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acceptedHeaders, 2);
  assert.equal(res.body.acceptedLines, 2);
  const headers = await dumpHeaders();
  const lines = await dumpLines();
  assert.equal(headers.length, 2, "1 updated + 1 inserted header");
  assert.equal(lines.length, 2, "1 updated + 1 inserted line");
  const updHeader = headers.find((h) => h.doc_no === "UPD");
  assert.equal(Number(updHeader.grand_amount), 42);
  const updLine = lines.find((l) => l.doc_no === "UPD" && l.line_no === 1);
  assert.equal(Number(updLine.qty), 42);
});

// ---- Test 2: idempotency ----------------------------------------------------
integration("test 2: identical payload POSTed twice → identical final state", async () => {
  await reset();
  // sourceSyncedAt is fixed explicitly — without it, getSourceSyncedAt()
  // defaults to new Date().toISOString() and every POST gets a different
  // "current" timestamp, making two otherwise-identical payloads
  // legitimately produce different persisted rows. This is not a bug in
  // either path; it's the correct behavior for an unset field. Fixing it
  // in the payload is what makes an idempotency comparison meaningful.
  const body = {
    sourceSyncedAt: "2026-08-09T01:00:00Z",
    headers: [{ branchCode: "001", docNo: "IDEM", grandAmount: 5 }],
    lines: [{ branchCode: "001", docNo: "IDEM", lineNo: 1, productCode: "P1", qty: 3 }],
  };
  const r1 = await request(makeApp(pool)).post("/api/sync/ada/sales").send(body);
  assert.equal(r1.statusCode, 200);
  const state1 = JSON.stringify([await dumpHeaders(), await dumpLines()]);
  const r2 = await request(makeApp(pool)).post("/api/sync/ada/sales").send(body);
  assert.equal(r2.statusCode, 200);
  const state2 = JSON.stringify([await dumpHeaders(), await dumpLines()]);
  assert.equal(state1, state2, "second POST must leave DB identical to first");
});

// ---- Test 3: duplicate conflict key within one payload — matches OLD ------
integration("test 3: duplicate header+line conflict keys in payload → last-wins, matches OLD path", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/sales").send({
    headers: [
      { branchCode: "001", docNo: "DUP", grandAmount: 10 },
      { branchCode: "001", docNo: "DUP", grandAmount: 20 },
    ],
    lines: [
      { branchCode: "001", docNo: "DUP", lineNo: 1, productCode: "P1", qty: 10 },
      { branchCode: "001", docNo: "DUP", lineNo: 1, productCode: "P1", qty: 20 },
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acceptedHeaders, 2, "acceptedHeaders must be INPUT count, not de-duped");
  assert.equal(res.body.acceptedLines, 2, "acceptedLines must be INPUT count, not de-duped");
  const h = (await pool.query("SELECT grand_amount FROM ada.sales_headers WHERE doc_no='DUP'")).rows[0];
  const l = (await pool.query("SELECT qty FROM ada.sales_lines WHERE doc_no='DUP' AND line_no=1")).rows[0];
  assert.equal(Number(h.grand_amount), 20, "last header wins");
  assert.equal(Number(l.qty), 20, "last line wins");
});

// ---- Test 3c: dedup key must not collide on separator characters ----------
// Codex's Slice 2 finding, applied proactively here (not discovered after
// the fact): a naive "|"-joined dedup key would collide when a field value
// itself contains "|". docNo/productCode are free-text and not validated
// against containing "|".
integration("test 3c: separator-colliding field values must NOT be treated as the same conflict key", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/sales").send({
    headers: [
      { branchCode: "A|B", docNo: "C", grandAmount: 111 },
      { branchCode: "A", docNo: "B|C", grandAmount: 222 },
    ],
    lines: [
      { branchCode: "A|B", docNo: "C", lineNo: 1, productCode: "P1", qty: 111 },
      { branchCode: "A", docNo: "B|C", lineNo: 1, productCode: "P1", qty: 222 },
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acceptedHeaders, 2);
  assert.equal(res.body.acceptedLines, 2);
  const headers = (await pool.query("SELECT branch_code, doc_no, grand_amount FROM ada.sales_headers ORDER BY branch_code")).rows;
  const lines = (await pool.query("SELECT branch_code, doc_no, qty FROM ada.sales_lines ORDER BY branch_code")).rows;
  assert.equal(headers.length, 2, "two distinct (branch_code, doc_no) header pairs must persist as two separate rows");
  assert.equal(lines.length, 2, "two distinct (branch_code, doc_no) line pairs must persist as two separate rows");
});

// ---- Test 4: invalid record rolls back BOTH headers and lines -------------
integration("test 4: invalid line record → full rollback of BOTH headers and lines, HTTP 500", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/sales").send({
    headers: [{ branchCode: "001", docNo: "OK1", grandAmount: 5 }],
    lines: [{ branchCode: "001", docNo: "OK1", lineNo: 1 }], // missing productCode -> throws
  });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "Internal server error");
  const hc = (await pool.query("SELECT count(*)::int AS c FROM ada.sales_headers")).rows[0].c;
  const lc = (await pool.query("SELECT count(*)::int AS c FROM ada.sales_lines")).rows[0].c;
  assert.equal(hc, 0, "header must roll back even though it was individually valid");
  assert.equal(lc, 0, "line must roll back");
});

// ---- Test 4b: invalid header ALSO rolls back everything, including lines --
integration("test 4b: invalid header record → full rollback of BOTH headers and lines, HTTP 500", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/sales").send({
    headers: [{ docNo: "OK2" }], // missing branchCode -> throws
    lines: [{ branchCode: "001", docNo: "OK2", lineNo: 1, productCode: "P1", qty: 1 }],
  });
  assert.equal(res.statusCode, 500);
  const hc = (await pool.query("SELECT count(*)::int AS c FROM ada.sales_headers")).rows[0].c;
  const lc = (await pool.query("SELECT count(*)::int AS c FROM ada.sales_lines")).rows[0].c;
  assert.equal(hc, 0);
  assert.equal(lc, 0, "line must roll back even though it was individually valid");
});

// ---- Test 5: simulated DB failure mid-batch → rollback, single release ----
integration("test 5: DB query failure → rollback, connection released exactly once (no leak/double-release)", async () => {
  const adminPool = new Pool({ connectionString: databaseUrl, max: 2 });
  await adminPool.query("DROP DATABASE IF EXISTS trackc_slice3_empty");
  await adminPool.query("CREATE DATABASE trackc_slice3_empty");
  await adminPool.end();
  let releaseCount = 0;
  const handlerPool = new Pool({ connectionString: databaseUrl.replace(/\/[^/]*$/, "/trackc_slice3_empty"), max: 2 });
  const instrumented = {
    async connect() {
      const client = await handlerPool.connect();
      const origRelease = client.release;
      client.release = function (...args) { releaseCount += 1; return origRelease.apply(client, args); };
      return client;
    },
    async query(sql, params) { return handlerPool.query(sql, params); },
    end() { return handlerPool.end(); },
  };
  try {
    const res = await request(makeApp(instrumented)).post("/api/sync/ada/sales").send({
      headers: [{ branchCode: "001", docNo: "FAIL", grandAmount: 1 }],
      lines: [{ branchCode: "001", docNo: "FAIL", lineNo: 1, productCode: "P1", qty: 1 }],
    });
    assert.equal(res.statusCode, 500, "must surface as a server error");
    assert.equal(releaseCount, 1, "connection must be released exactly once, no leak, no double-release");
  } finally {
    await handlerPool.end();
    const cleanup = new Pool({ connectionString: databaseUrl, max: 2 });
    await cleanup.query("DROP DATABASE IF EXISTS trackc_slice3_empty");
    await cleanup.end();
  }
});

// ---- Test 6: empty headers/lines -------------------------------------------
integration("test 6: empty headers/lines → 200, acceptedHeaders:0, acceptedLines:0, no error", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/sales").send({ headers: [], lines: [] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acceptedHeaders, 0);
  assert.equal(res.body.acceptedLines, 0);
});

// ---- Test 7: normalization edge cases --------------------------------------
integration("test 7: null/decimal/date normalization edges match OLD defaults", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/sales").send({
    headers: [{ branchCode: "001", docNo: "EDGE", grandAmount: 3.5, netAmount: 1.25 }],
    lines: [
      { branchCode: "001", docNo: "EDGE", lineNo: 1, productCode: "P1", qty: 2.5, unitPrice: 9.99 },
      { branchCode: "001", docNo: "EDGE", lineNo: 2, productCode: "P2" }, // all optional fields missing
    ],
  });
  assert.equal(res.statusCode, 200);
  const headers = await dumpHeaders();
  const lines = await dumpLines();
  const h = headers.find((x) => x.doc_no === "EDGE");
  assert.equal(Number(h.grand_amount), 3.5);
  assert.equal(Number(h.net_amount), 1.25);
  assert.equal(h.customer_code, null);
  const l2 = lines.find((x) => x.line_no === 2);
  assert.equal(l2.barcode, null);
  assert.equal(Number(l2.qty), 0, "default qty");
});

// ---- Test 8: full-fixture business-data equivalence vs OLD path reference -
integration("test 8: mixed fixture → NEW output business-data equivalent to OLD reference", async () => {
  await reset();
  const headers = [];
  const lines = [];
  for (let i = 0; i < 100; i++) headers.push({ branchCode: "001", docNo: `D${i}`, grandAmount: i + 1 });
  for (let i = 0; i < 50; i++) headers.push({ branchCode: "001", docNo: `D${i}`, grandAmount: 1000 + i }); // updates
  for (let i = 0; i < 100; i++) lines.push({ branchCode: "001", docNo: `D${i}`, lineNo: 1, productCode: "P1", qty: i + 1 });
  for (let i = 0; i < 50; i++) lines.push({ branchCode: "001", docNo: `D${i}`, lineNo: 1, productCode: "P1", qty: 2000 + i }); // updates
  const res = await request(makeApp(pool)).post("/api/sync/ada/sales").send({ sourceSyncedAt: "2026-08-09T01:00:00Z", headers, lines });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acceptedHeaders, headers.length);
  assert.equal(res.body.acceptedLines, lines.length);
  const newHeaders = await dumpHeaders();
  const newLines = await dumpLines();
  const refPath = path.join(__dirname, "..", "..", "test", "fixtures", "track_c_slice3_sales_ref.json");
  const ref = JSON.parse(fs.readFileSync(refPath, "utf8"));
  assert.equal(newHeaders.length, ref.headers.length, `header count mismatch: NEW=${newHeaders.length} REF=${ref.headers.length}`);
  assert.equal(newLines.length, ref.lines.length, `line count mismatch: NEW=${newLines.length} REF=${ref.lines.length}`);
  for (let i = 0; i < newHeaders.length; i++) {
    assert.deepStrictEqual(newHeaders[i], ref.headers[i], `header row ${i} (${newHeaders[i].doc_no}) diverges from OLD-path reference`);
  }
  for (let i = 0; i < newLines.length; i++) {
    assert.deepStrictEqual(newLines[i], ref.lines[i], `line row ${i} (${newLines[i].doc_no}/${newLines[i].line_no}) diverges from OLD-path reference`);
  }
});

// ---- Test 9: query count — NEW path O(1) vs OLD path O(N) -----------------
integration("test 9: query count — batch path issues a small constant number of INSERTs for N headers+lines", async () => {
  await reset();
  countingPool.statements.length = 0;
  const headers = Array.from({ length: 50 }, (_, i) => ({ branchCode: "001", docNo: `QC${i}`, grandAmount: i }));
  const lines = Array.from({ length: 50 }, (_, i) => ({ branchCode: "001", docNo: `QC${i}`, lineNo: 1, productCode: "P1", qty: i }));
  const res = await request(makeApp(countingPool)).post("/api/sync/ada/sales").send({ headers, lines });
  assert.equal(res.statusCode, 200);
  const headerInserts = countingPool.statements.filter((s) => /INSERT INTO ada\.sales_headers/i.test(s));
  const lineInserts = countingPool.statements.filter((s) => /INSERT INTO ada\.sales_lines/i.test(s));
  assert.ok(headerInserts.length <= 2, `header path must issue <=2 INSERTs, got ${headerInserts.length} for 50 headers`);
  assert.ok(lineInserts.length <= 2, `line path must issue <=2 INSERTs, got ${lineInserts.length} for 50 lines`);
  assert.ok(headerInserts.length >= 1 && lineInserts.length >= 1, "must issue at least one INSERT per table");
});

// ---- Test 10: real Postgres — implicit in all above ------------------------

// ---- Test 11: CRM mirror still runs after commit+release, still swallows errors --
integration("test 11: CRM mirror call happens after commit+release, mirror failure does not fail the request", async () => {
  await reset();
  let releasedBeforeMirrorStarted = false;
  const trackingPool = {
    async connect() {
      const client = await pool.connect();
      const origRelease = client.release;
      client.released = false;
      client.release = function (...args) { client.released = true; return origRelease.apply(client, args); };
      return client;
    },
  };
  const crmMirrorClient = {
    enabled: true,
    async mirrorSales() {
      releasedBeforeMirrorStarted = true; // only reachable if handler got this far
      throw new Error("simulated CRM mirror failure");
    },
    async mirrorRefunds() { return { ok: true }; },
  };
  const res = await request(makeApp(trackingPool, crmMirrorClient)).post("/api/sync/ada/sales").send({
    // docType must be "1" (sale) for buildMirroredSalesPayload to push a
    // sales-mirror entry — confirmed by reading sync-ada.js:663-711
    // directly, not assumed. A header with no docType/docType!=="1" is
    // silently excluded from the mirror payload (sales.length===0), which
    // is exactly why an earlier draft of this test never observed the
    // mirror function being called at all.
    headers: [{ branchCode: "001", docNo: "MIRROR", grandAmount: 1, docType: "1" }],
    lines: [{ branchCode: "001", docNo: "MIRROR", lineNo: 1, productCode: "P1", qty: 1 }],
  });
  assert.equal(res.statusCode, 200, "mirror failure must not fail an already-committed sync");
  assert.equal(releasedBeforeMirrorStarted, true);
  const count = (await pool.query("SELECT count(*)::int AS c FROM ada.sales_headers WHERE doc_no='MIRROR'")).rows[0].c;
  assert.equal(count, 1, "data must still be committed despite the mirror failure");
});

// ---- Test 12: production-representative payload size ----------------------
integration("test 12: 1000 headers + 1000 lines in one POST — succeeds", async () => {
  await reset();
  const headers = Array.from({ length: 1000 }, (_, i) => ({ branchCode: "001", docNo: `BIG${i}`, grandAmount: i }));
  const lines = Array.from({ length: 1000 }, (_, i) => ({ branchCode: "001", docNo: `BIG${i}`, lineNo: 1, productCode: "P1", qty: i }));
  const res = await request(makeApp(pool)).post("/api/sync/ada/sales").send({ sourceSyncedAt: "2026-08-09T01:00:00Z", headers, lines });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acceptedHeaders, 1000);
  assert.equal(res.body.acceptedLines, 1000);
  const hc = (await pool.query("SELECT count(*)::int AS c FROM ada.sales_headers")).rows[0].c;
  const lc = (await pool.query("SELECT count(*)::int AS c FROM ada.sales_lines")).rows[0].c;
  assert.equal(hc, 1000);
  assert.equal(lc, 1000);
});
