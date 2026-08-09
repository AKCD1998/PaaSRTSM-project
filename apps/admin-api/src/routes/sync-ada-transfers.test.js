"use strict";

// Track C Slice 4 — tests for POST /api/sync/ada/transfers set-based UPSERT
// (both ada.transfer_headers and ada.transfer_lines in one request).
// Tests-first: written BEFORE the set-based handler implementation, against
// the OLD per-record path first to establish ground truth. All tests run
// against a REAL disposable local Postgres gated on
// TRACK_C_SLICE4_TEST_DATABASE_URL — never a structural mock.
//
// No FK constraints on ada.transfer_headers/transfer_lines (confirmed via
// migrations/015_add_ada_raw_ingestion.sql:124-203, all NOT NULL, no
// REFERENCES). All conflict-key columns are NOT NULL (unlike Slice 2's
// nullable branch_code) — no NULL-conflict-never-fires quirk here.
//
// Materially different from Slice 3 (/sales): /transfers validates the
// ENTIRE payload up front via parseTransferPayload() BEFORE acquiring a DB
// connection at all. An invalid record anywhere -> HTTP 400,
// {"message": "..."} (NOT the 500 {"error":"Internal server error"} shape
// Slice 1-3 used) -> zero DB interaction, not even acquireIngestionDbClient
// is called. parseTransferPayload also resolves a line's missing
// docType/branchCode/warehouseCode/docDate from a matching header (by
// docNo+docType+branchCode, then docNo+docType, then docNo) BEFORE
// validation runs. This implementation reuses parseTransferPayload
// UNCHANGED, so this front-end behavior is preserved by construction, not
// re-implemented — confirmed empirically against the OLD path before
// writing this file (see FINAL_TRACK_C_SLICE4_REVIEW_PACKET.md Phase B).
//
// Duplicate conflict key (either table) -> LAST array occurrence wins,
// acceptedHeaders/acceptedLines = INPUT counts (not de-duped) — same
// pattern as Slice 1-3.
//
// Dedup keys use JSON.stringify(tuple), never string concatenation — the
// exact class of bug Codex's Slice 2 review found, applied proactively
// here from the start (as in Slice 3).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { Pool } = require("pg");
const { createAdaSyncRouter } = require("./sync-ada");

const databaseUrl = process.env.TRACK_C_SLICE4_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

// Pool proxy recording every SQL statement (test #11's query-count
// assertion). Restores the TRUE original client.query/client.release
// references (no rebinding) before the client returns to the shared pool.
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
  // Standalone schema bootstrap (Codex review finding, 2026-08-09): this
  // file previously assumed the target database already had the ada.*
  // schema applied out-of-band. That is not standalone — a genuinely fresh
  // TRACK_C_SLICE4_TEST_DATABASE_URL with no prior schema would fail every
  // test with "relation does not exist" before ever reaching the code under
  // test. migrations/015_add_ada_raw_ingestion.sql is genuinely idempotent
  // (CREATE SCHEMA/TABLE IF NOT EXISTS throughout, wrapped in BEGIN/COMMIT,
  // no bare ALTER) — confirmed by reading the file, not assumed — so it is
  // safe to apply unconditionally here, whether the database is brand new
  // or already migrated.
  const migrationSql = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "..", "migrations", "015_add_ada_raw_ingestion.sql"),
    "utf8",
  );
  await pool.query(migrationSql);
});

test.after(async function () {
  if (pool) await pool.end();
});

function makeApp(db) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/sync/ada", createAdaSyncRouter({ config: { posApiKeys: new Set() }, db }));
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
  await p.query("TRUNCATE ada.transfer_headers, ada.transfer_lines RESTART IDENTITY CASCADE");
}

function canonicalizeRow(r) {
  const out = { ...r };
  for (const key of Object.keys(out)) {
    if (out[key] instanceof Date) out[key] = out[key].toISOString();
  }
  return out;
}
async function dumpHeaders(p = pool) {
  return (await p.query(
    `SELECT doc_no, doc_type, doc_status, process_status, branch_code, branch_code_to,
            warehouse_code, warehouse_code_to, doc_date, doc_time, approved_at, processed_at,
            created_by, approved_by, remark, reference_doc_no, reference_doc_type,
            source_system, source_table, source_synced_at, raw_payload
     FROM ada.transfer_headers ORDER BY doc_no, doc_type, branch_code`,
  )).rows.map(canonicalizeRow);
}
async function dumpLines(p = pool) {
  return (await p.query(
    `SELECT doc_no, doc_type, branch_code, line_no, product_code, barcode, unit_code, unit_name,
            qty, qty_base, stock_factor, lot_no, expiry_date, warehouse_code,
            reference_doc_no, reference_line_no, source_system, source_table, source_synced_at, raw_payload
     FROM ada.transfer_lines ORDER BY doc_no, doc_type, branch_code, line_no, product_code`,
  )).rows.map(canonicalizeRow);
}

const SS = "2026-08-09T01:00:00Z"; // fixed sourceSyncedAt for determinism

// ---- Test 1: mixed INSERT + UPDATE, both headers and lines ----------------
integration("test 1: mixed INSERT + UPDATE (headers and lines) — final values match direct upserts", async () => {
  await reset();
  const seed = await request(makeApp(pool)).post("/api/sync/ada/transfers").send({
    sourceSyncedAt: SS,
    headers: [{ docNo: "UPD", docType: "7", branchCode: "001", remark: "old" }],
    lines: [{ docNo: "UPD", docType: "7", branchCode: "001", lineNo: 1, productCode: "P1", qty: 1 }],
  });
  assert.equal(seed.statusCode, 200);
  const res = await request(makeApp(pool)).post("/api/sync/ada/transfers").send({
    sourceSyncedAt: SS,
    headers: [
      { docNo: "UPD", docType: "7", branchCode: "001", remark: "new" }, // UPDATE
      { docNo: "NEW1", docType: "7", branchCode: "001", remark: "fresh" }, // INSERT
    ],
    lines: [
      { docNo: "UPD", docType: "7", branchCode: "001", lineNo: 1, productCode: "P1", qty: 42 }, // UPDATE
      { docNo: "UPD", docType: "7", branchCode: "001", lineNo: 2, productCode: "P2", qty: 8 }, // INSERT
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acceptedHeaders, 2);
  assert.equal(res.body.acceptedLines, 2);
  const headers = await dumpHeaders();
  const lines = await dumpLines();
  assert.equal(headers.length, 2);
  assert.equal(lines.length, 2);
  const updHeader = headers.find((h) => h.doc_no === "UPD");
  assert.equal(updHeader.remark, "new");
  const updLine = lines.find((l) => l.doc_no === "UPD" && l.line_no === 1);
  assert.equal(Number(updLine.qty), 42);
});

// ---- Test 2: idempotency ---------------------------------------------------
integration("test 2: identical payload POSTed twice → identical final state", async () => {
  await reset();
  const body = {
    sourceSyncedAt: SS,
    headers: [{ docNo: "IDEM", docType: "7", branchCode: "001" }],
    lines: [{ docNo: "IDEM", docType: "7", branchCode: "001", lineNo: 1, productCode: "P1", qty: 3 }],
  };
  const r1 = await request(makeApp(pool)).post("/api/sync/ada/transfers").send(body);
  assert.equal(r1.statusCode, 200);
  const state1 = JSON.stringify([await dumpHeaders(), await dumpLines()]);
  const r2 = await request(makeApp(pool)).post("/api/sync/ada/transfers").send(body);
  assert.equal(r2.statusCode, 200);
  const state2 = JSON.stringify([await dumpHeaders(), await dumpLines()]);
  assert.equal(state1, state2);
});

// ---- Test 3: duplicate conflict keys → last-wins, matches OLD -------------
integration("test 3: duplicate header+line conflict keys in payload → last-wins, matches OLD path", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/transfers").send({
    sourceSyncedAt: SS,
    headers: [
      { docNo: "DUP", docType: "7", branchCode: "001", remark: "first" },
      { docNo: "DUP", docType: "7", branchCode: "001", remark: "second" },
    ],
    lines: [
      { docNo: "DUP", docType: "7", branchCode: "001", lineNo: 1, productCode: "P1", qty: 10 },
      { docNo: "DUP", docType: "7", branchCode: "001", lineNo: 1, productCode: "P1", qty: 20 },
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acceptedHeaders, 2);
  assert.equal(res.body.acceptedLines, 2);
  const h = (await pool.query("SELECT remark FROM ada.transfer_headers WHERE doc_no='DUP'")).rows[0];
  const l = (await pool.query("SELECT qty FROM ada.transfer_lines WHERE doc_no='DUP' AND line_no=1")).rows[0];
  assert.equal(h.remark, "second");
  assert.equal(Number(l.qty), 20);
});

// ---- Test 3c: dedup key must not collide on separator characters ----------
integration("test 3c: separator-colliding field values must NOT be treated as the same conflict key", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/transfers").send({
    sourceSyncedAt: SS,
    headers: [
      { docNo: "A|B", docType: "C", branchCode: "001", remark: "one" },
      { docNo: "A", docType: "B|C", branchCode: "001", remark: "two" },
    ],
    lines: [
      { docNo: "A|B", docType: "C", branchCode: "001", lineNo: 1, productCode: "P1", qty: 111 },
      { docNo: "A", docType: "B|C", branchCode: "001", lineNo: 1, productCode: "P1", qty: 222 },
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acceptedHeaders, 2);
  assert.equal(res.body.acceptedLines, 2);
  const headers = (await pool.query("SELECT doc_no, doc_type FROM ada.transfer_headers ORDER BY doc_no")).rows;
  const lines = (await pool.query("SELECT doc_no, doc_type FROM ada.transfer_lines ORDER BY doc_no")).rows;
  assert.equal(headers.length, 2, "two distinct (doc_no, doc_type, branch_code) header triples must persist as two separate rows");
  assert.equal(lines.length, 2, "two distinct line keys must persist as two separate rows");
});

// ---- Test 3d: line inherits docType/branchCode/warehouseCode/docDate from matching header --
integration("test 3d: line without its own docType/branchCode inherits from the matching header (parseTransferPayload behavior, preserved)", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/transfers").send({
    sourceSyncedAt: SS,
    headers: [{ docNo: "INH", docType: "7", branchCode: "001", warehouseCode: "WH1", docDate: "2026-08-01" }],
    lines: [{ docNo: "INH", lineNo: 1, productCode: "P1", qty: 3 }], // no docType/branchCode/warehouseCode/docDate
  });
  assert.equal(res.statusCode, 200);
  const line = (await pool.query("SELECT doc_type, branch_code, warehouse_code FROM ada.transfer_lines WHERE doc_no='INH'")).rows[0];
  assert.equal(line.doc_type, "7", "inherited from header");
  assert.equal(line.branch_code, "001", "inherited from header");
  assert.equal(line.warehouse_code, "WH1", "inherited from header");
});

// ---- Test 3e: header-lookup key collision fix (fix/transfer-header-index-collision) --
// Real bug, independently reproduced before fixing (see
// _ledger/claude.md CLAIM-X-179/180): buildTransferHeaderIndexes'/
// resolveRelatedTransferHeader's lookup keys were built via string
// concatenation with "|" as a separator, which collided whenever a field
// value itself contained "|". headers (docNo="A|B", docType="C",
// branchCode="001") and (docNo="A", docType="B|C", branchCode="001") both
// concatenated to the identical string "A|B|C|001", so a line matching the
// first header's real identity instead resolved against the second
// header's data. Confirmed via direct reproduction: OLD code returned
// warehouse_code="WH_WRONG" for this exact payload; this test locks in the
// fixed (JSON.stringify-keyed) behavior and must fail if the fix regresses.
integration("test 3e: separator-colliding header lookup keys must resolve to the CORRECT matching header, not a collided one", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/transfers").send({
    sourceSyncedAt: SS,
    headers: [
      { docNo: "A|B", docType: "C", branchCode: "001", warehouseCode: "WH_EXPECTED" },
      { docNo: "A", docType: "B|C", branchCode: "001", warehouseCode: "WH_WRONG" },
    ],
    lines: [
      { docNo: "A|B", docType: "C", branchCode: "001", lineNo: 1, productCode: "P1", qty: 1 }, // no warehouseCode of its own
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acceptedHeaders, 2);
  assert.equal(res.body.acceptedLines, 1);
  const line = (await pool.query(
    "SELECT warehouse_code FROM ada.transfer_lines WHERE doc_no='A|B' AND doc_type='C' AND branch_code='001'",
  )).rows[0];
  assert.equal(line.warehouse_code, "WH_EXPECTED", "must resolve against the header sharing this line's own (docNo,docType,branchCode) identity, not a key-collided one");
});

// ---- Test 4: invalid record → HTTP 400, {message}, zero DB interaction ----
integration("test 4: invalid line (missing lineNo/productCode) → HTTP 400, {message}, never touches DB", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/transfers").send({
    sourceSyncedAt: SS,
    headers: [{ docNo: "OK1", docType: "7", branchCode: "001" }],
    lines: [{ docNo: "OK1", docType: "7", branchCode: "001" }], // missing lineNo/productCode
  });
  assert.equal(res.statusCode, 400, "parseTransferPayload validates up front, before any DB acquisition");
  assert.ok(res.body.message, "400 response uses {message: ...} shape, not {error: ...}");
  assert.equal(res.body.error, undefined, "must NOT use the 500-style {error} field for a 400");
  const hc = (await pool.query("SELECT count(*)::int AS c FROM ada.transfer_headers")).rows[0].c;
  const lc = (await pool.query("SELECT count(*)::int AS c FROM ada.transfer_lines")).rows[0].c;
  assert.equal(hc, 0, "header must never be written — validation happens before DB acquisition");
  assert.equal(lc, 0);
});

// ---- Test 4b: invalid header → same 400 behavior ---------------------------
integration("test 4b: invalid header (missing docType) → HTTP 400, never touches DB", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/transfers").send({
    sourceSyncedAt: SS,
    headers: [{ docNo: "OK2", branchCode: "001" }], // missing docType
    lines: [{ docNo: "OK2", docType: "7", branchCode: "001", lineNo: 1, productCode: "P1", qty: 1 }],
  });
  assert.equal(res.statusCode, 400);
  const hc = (await pool.query("SELECT count(*)::int AS c FROM ada.transfer_headers")).rows[0].c;
  const lc = (await pool.query("SELECT count(*)::int AS c FROM ada.transfer_lines")).rows[0].c;
  assert.equal(hc, 0);
  assert.equal(lc, 0, "line must never be written even though it was individually valid");
});

// ---- Test 5: simulated DB failure mid-batch → rollback, single release ----
integration("test 5: DB query failure → rollback, connection released exactly once (no leak/double-release)", async () => {
  const adminPool = new Pool({ connectionString: databaseUrl, max: 2 });
  await adminPool.query("DROP DATABASE IF EXISTS trackc_slice4_empty");
  await adminPool.query("CREATE DATABASE trackc_slice4_empty");
  await adminPool.end();
  let releaseCount = 0;
  const handlerPool = new Pool({ connectionString: databaseUrl.replace(/\/[^/]*$/, "/trackc_slice4_empty"), max: 2 });
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
    const res = await request(makeApp(instrumented)).post("/api/sync/ada/transfers").send({
      sourceSyncedAt: SS,
      headers: [{ docNo: "FAIL", docType: "7", branchCode: "001" }],
      lines: [{ docNo: "FAIL", docType: "7", branchCode: "001", lineNo: 1, productCode: "P1", qty: 1 }],
    });
    assert.equal(res.statusCode, 500, "a genuine DB failure (valid payload, DB unreachable schema) must surface as a server error");
    assert.equal(releaseCount, 1, "connection must be released exactly once, no leak, no double-release");
  } finally {
    await handlerPool.end();
    const cleanup = new Pool({ connectionString: databaseUrl, max: 2 });
    await cleanup.query("DROP DATABASE IF EXISTS trackc_slice4_empty");
    await cleanup.end();
  }
});

// ---- Test 6: empty headers/lines -------------------------------------------
integration("test 6: empty headers/lines → 200, acceptedHeaders:0, acceptedLines:0, no error", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/transfers").send({ sourceSyncedAt: SS, headers: [], lines: [] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acceptedHeaders, 0);
  assert.equal(res.body.acceptedLines, 0);
});

// ---- Test 7: normalization / AdaAcc aliases --------------------------------
integration("test 7: field normalization and AdaAcc field aliases match OLD defaults", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/ada/transfers").send({
    sourceSyncedAt: SS,
    headers: [{ FTPthDocNo: "ALIAS", FTPthDocType: "7", FTBchCode: "001", FCShdGndAmt: 1 }],
    lines: [
      { FTPthDocNo: "ALIAS", FTPthDocType: "7", FTBchCode: "001", FNPtdSeqNo: 1, FTPtdPdtCode: "P1", FCPtdQtyAll: 2.5 },
      { docNo: "ALIAS", docType: "7", branchCode: "001", lineNo: 2, productCode: "P2" }, // all optional fields missing
    ],
  });
  assert.equal(res.statusCode, 200);
  const headers = await dumpHeaders();
  const lines = await dumpLines();
  const h = headers.find((x) => x.doc_no === "ALIAS");
  assert.ok(h, "AdaAcc-alias header fields (FTPthDocNo/FTPthDocType/FTBchCode) must resolve correctly");
  const l1 = lines.find((x) => x.line_no === 1);
  assert.equal(Number(l1.qty), 2.5, "FCPtdQtyAll alias must resolve to qty");
  const l2 = lines.find((x) => x.line_no === 2);
  assert.equal(l2.barcode, null, "missing optional fields default to null");
});

// ---- Test 8: full-fixture business-data equivalence vs OLD path reference -
integration("test 8: mixed fixture → NEW output business-data equivalent to OLD reference", async () => {
  await reset();
  const headers = [];
  const lines = [];
  for (let i = 0; i < 100; i++) headers.push({ docNo: `D${i}`, docType: "7", branchCode: "001", remark: `r${i}` });
  for (let i = 0; i < 50; i++) headers.push({ docNo: `D${i}`, docType: "7", branchCode: "001", remark: `updated${i}` });
  for (let i = 0; i < 100; i++) lines.push({ docNo: `D${i}`, docType: "7", branchCode: "001", lineNo: 1, productCode: "P1", qty: i + 1 });
  for (let i = 0; i < 50; i++) lines.push({ docNo: `D${i}`, docType: "7", branchCode: "001", lineNo: 1, productCode: "P1", qty: 2000 + i });
  const res = await request(makeApp(pool)).post("/api/sync/ada/transfers").send({ sourceSyncedAt: SS, headers, lines });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acceptedHeaders, headers.length);
  assert.equal(res.body.acceptedLines, lines.length);
  const newHeaders = await dumpHeaders();
  const newLines = await dumpLines();
  const refPath = path.join(__dirname, "..", "..", "test", "fixtures", "track_c_slice4_transfers_ref.json");
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

// ---- Test 9: real Postgres — implicit in all above -------------------------

// ---- Test 10: other routes unaffected — covered by rerunning the full ------
// admin-api suite in Phase F, not duplicated here.

// ---- Test 11: query count — NEW path O(1) vs OLD path O(N) ----------------
integration("test 11: query count — batch path issues a small constant number of INSERTs for N headers+lines", async () => {
  await reset();
  countingPool.statements.length = 0;
  const headers = Array.from({ length: 50 }, (_, i) => ({ docNo: `QC${i}`, docType: "7", branchCode: "001" }));
  const lines = Array.from({ length: 50 }, (_, i) => ({ docNo: `QC${i}`, docType: "7", branchCode: "001", lineNo: 1, productCode: "P1", qty: i }));
  const res = await request(makeApp(countingPool)).post("/api/sync/ada/transfers").send({ sourceSyncedAt: SS, headers, lines });
  assert.equal(res.statusCode, 200);
  const headerInserts = countingPool.statements.filter((s) => /INSERT INTO ada\.transfer_headers/i.test(s));
  const lineInserts = countingPool.statements.filter((s) => /INSERT INTO ada\.transfer_lines/i.test(s));
  assert.ok(headerInserts.length <= 2, `header path must issue <=2 INSERTs, got ${headerInserts.length} for 50 headers`);
  assert.ok(lineInserts.length <= 2, `line path must issue <=2 INSERTs, got ${lineInserts.length} for 50 lines`);
  assert.ok(headerInserts.length >= 1 && lineInserts.length >= 1, "must issue at least one INSERT per table");
});

// ---- Test 12: production-representative payload size -----------------------
integration("test 12: 1000 headers + 1000 lines in one POST — succeeds", async () => {
  await reset();
  const headers = Array.from({ length: 1000 }, (_, i) => ({ docNo: `BIG${i}`, docType: "7", branchCode: "001" }));
  const lines = Array.from({ length: 1000 }, (_, i) => ({ docNo: `BIG${i}`, docType: "7", branchCode: "001", lineNo: 1, productCode: "P1", qty: i }));
  const res = await request(makeApp(pool)).post("/api/sync/ada/transfers").send({ sourceSyncedAt: SS, headers, lines });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acceptedHeaders, 1000);
  assert.equal(res.body.acceptedLines, 1000);
  const hc = (await pool.query("SELECT count(*)::int AS c FROM ada.transfer_headers")).rows[0].c;
  const lc = (await pool.query("SELECT count(*)::int AS c FROM ada.transfer_lines")).rows[0].c;
  assert.equal(hc, 1000);
  assert.equal(lc, 1000);
});

// ---- Test 13: counting-pool helper returns TRUE original references -------
// (structural check, not behavioral — asserts the fix Codex's Slice 2
// review required is actually present in this file, not just "seems to
// work." A re-bound copy would also pass tests 1-12; this test specifically
// guards against regressing to that pattern.)
test("test 13: makeCountingPool restores the true original client.query/release references, not a rebound copy", () => {
  const fakeQuery = function originalQuery() {};
  const fakeRelease = function originalRelease() {};
  const fakeClient = { query: fakeQuery, release: fakeRelease };
  const fakeRealPool = { connect: async () => fakeClient, query: async () => {}, end: async () => {} };
  return (async () => {
    const wrapped = makeCountingPool(fakeRealPool);
    const client = await wrapped.connect();
    assert.notEqual(client.query, fakeQuery, "query should be patched while checked out");
    client.release();
    assert.equal(client.query, fakeQuery, "release() must restore the EXACT original query reference (===), not a rebound copy");
    assert.equal(client.release, fakeRelease, "release() must also restore the EXACT original release reference (===)");
  })();
});
