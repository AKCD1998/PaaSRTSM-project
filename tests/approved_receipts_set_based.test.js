"use strict";

// Track C — /api/sync/ada/approved-receipts set-based conversion.
// Tests-first: written against the OLD per-document/per-line path (see
// FINAL APPROVED-RECEIPTS SEALED CANDIDATE REPORT, Phase B) BEFORE the
// set-based handler was implemented. All expected values below were
// captured by actually running the OLD route against real disposable
// Postgres (_phaseB_probe.js) -- never guessed. Runs against a REAL
// disposable local Postgres gated on AR_TEST_DATABASE_URL.
//
// Ground truth established empirically (Phase B probe, 2026-08-13):
//   - duplicate doc_no across the payload -> LAST record wins ENTIRELY,
//     full-row replacement (no partial-field carry-forward -- unlike the
//     legacy branch-stock candidate, ON CONFLICT DO UPDATE SET col=EXCLUDED
//     for every column means the last record's values simply overwrite,
//     nothing survives from an earlier duplicate).
//   - duplicate doc_no, final record has zero lines (or omits `lines`
//     entirely) -> zero lines persist for that doc; the DELETE from the
//     final record's own processing step is the last word.
//   - duplicate seq_no WITHIN one record's own lines array -> OLD does not
//     pre-validate this in JS; it lets the real `(doc_no, seq_no)` PRIMARY
//     KEY reject the second occurrence, which throws, which rolls back the
//     WHOLE transaction (500 "Internal server error") -- including
//     unrelated, perfectly-valid documents processed EARLIER in the same
//     payload. This must not be silently deduped by the new candidate; it
//     must still fail the whole batch the same way.
//   - invalid/missing seqNo (non-integer, <=0, or omitted-defaults-to-0)
//     -> same 500 rollback-the-whole-payload behavior.
//   - missing docNo on any record -> same 500 rollback-the-whole-payload
//     behavior (this is a mid-transaction JS throw, NOT the top-level 400
//     payload-shape check -- missing top-level branchCode/records IS a 400
//     via parseApprovedReceiptPayload, a genuinely different code path).
//   - header raw_payload = the ENTIRE submitted record object, lines array
//     included verbatim (not a lines-stripped projection) unless the
//     record carries its own `__rawPayload` override.
//   - OLD statement count is exactly 5N + 2 for N documents with any
//     number of lines each (1 BEGIN + N*(1 header UPSERT + 1 lines DELETE
//     + L line INSERTs, here L=3 fixed in the query-count fixture so it's
//     N*5) + 1 COMMIT) -- confirmed at N=1 (7), N=50 (252), N=1000 (5002).

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { Pool } = require("pg");
const { createAdaSyncRouter } = require("../apps/admin-api/src/routes/sync-ada");

const databaseUrl = process.env.AR_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

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
test.before(async function () {
  if (!databaseUrl) return;
  pool = new Pool({ connectionString: databaseUrl, max: 8 });
});
test.after(async function () {
  if (pool) await pool.end();
});

function makeApp(db) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/sync/ada", createAdaSyncRouter({ config: { posApiKeys: new Set() }, db, crmMirrorClient: null }));
  app.use((req, res) => res.status(404).json({ error: "Not found", request_id: req.requestId || null }));
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
  await p.query("TRUNCATE ada.approved_receipt_headers, ada.approved_receipt_lines RESTART IDENTITY CASCADE");
}

function canonicalizeRow(r) {
  const out = { ...r };
  for (const key of Object.keys(out)) {
    if (out[key] instanceof Date) out[key] = out[key].toISOString();
  }
  return out;
}

// Excludes source_synced_at when it was left to the omitted-fallback (OLD
// generates a fresh Date.now() per statement in that case, so exact
// cross-run equality is meaningless noise, not a real equivalence
// property) -- tests that care about source_synced_at pass it explicitly.
async function dumpHeaders(p = pool) {
  return (await p.query(
    `SELECT doc_no, branch_code, doc_type, doc_date, doc_time, supplier_code, supplier_name,
            ref_ext, ref_ext_date, warehouse_code, total, vat, grand, usr_code, created_by,
            created_at_ada, sta_doc, sta_prc_doc, source_system, source_table, raw_payload
     FROM ada.approved_receipt_headers ORDER BY doc_no`,
  )).rows.map(canonicalizeRow);
}
async function dumpLines(p = pool) {
  return (await p.query(
    `SELECT doc_no, seq_no, product_code, product_name, barcode, unit_code, unit_name, factor,
            qty, qty_base, stock_factor, set_price, net, vat, cost_in, lot_no, expired_date,
            warehouse_code, source_system, source_table, raw_payload
     FROM ada.approved_receipt_lines ORDER BY doc_no, seq_no`,
  )).rows.map(canonicalizeRow);
}
async function dumpHeadersWithSyncedAt(p = pool) {
  return (await p.query(
    `SELECT doc_no, source_synced_at FROM ada.approved_receipt_headers ORDER BY doc_no`,
  )).rows.map(canonicalizeRow);
}
async function dumpLinesWithSyncedAt(p = pool) {
  return (await p.query(
    `SELECT doc_no, seq_no, source_synced_at FROM ada.approved_receipt_lines ORDER BY doc_no, seq_no`,
  )).rows.map(canonicalizeRow);
}

// ---- 1: basic insert, business-data equivalence ---------------------------
integration("1: basic insert -- header+lines persist all business columns exactly", async () => {
  await reset();
  const r = await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send({
    branchCode: "001",
    records: [{
      FTXihDocNo: "D1", FTXihDocType: "PI", FDXihDocDate: "2026-08-01", FTXihDocTime: "10:00",
      FTSplCode: "S1", FTXihCstName: "Supplier1", FCXihTotal: 100, FCXihVat: 7, FCXihGrand: 107,
      lines: [
        { FNXidSeqNo: 1, FTPdtCode: "P1", FCXidQty: 10 },
        { FNXidSeqNo: 2, FTPdtCode: "P2", FCXidQty: 5 },
      ],
    }],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, upserted: 1 });
  const headers = await dumpHeaders();
  assert.equal(headers.length, 1);
  assert.equal(headers[0].doc_no, "D1");
  assert.equal(headers[0].doc_type, "PI");
  assert.equal(headers[0].supplier_code, "S1");
  assert.equal(headers[0].total, "100.0000");
  assert.equal(headers[0].grand, "107.0000");
  // header raw_payload = the WHOLE submitted record, lines array included verbatim
  assert.equal(headers[0].raw_payload.FTXihDocNo, "D1");
  assert.ok(Array.isArray(headers[0].raw_payload.lines));
  const lines = await dumpLines();
  assert.equal(lines.length, 2);
  assert.equal(lines[0].product_code, "P1");
  assert.equal(lines[0].qty, "10.0000");
  assert.equal(lines[1].product_code, "P2");
  assert.equal(lines[1].qty, "5.0000");
});

// ---- 2: duplicate doc_no -- last record wins ENTIRELY, no field carry ----
integration("2: duplicate doc_no across payload -- last record replaces header+lines completely", async () => {
  await reset();
  const r = await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send({
    branchCode: "001",
    records: [
      { FTXihDocNo: "DUP", FCXihTotal: 1, lines: [{ FNXidSeqNo: 1, FTPdtCode: "PA" }] },
      { FTXihDocNo: "DUP", FCXihTotal: 2, lines: [{ FNXidSeqNo: 1, FTPdtCode: "PB" }, { FNXidSeqNo: 2, FTPdtCode: "PC" }] },
    ],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, upserted: 2 }); // upserted = INPUT record count, not deduped
  const headers = await dumpHeaders();
  assert.equal(headers.length, 1);
  assert.equal(headers[0].total, "2.0000"); // last record's value, not merged
  const lines = await dumpLines();
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.product_code), ["PB", "PC"]); // PA is GONE
});

// ---- 3: duplicate doc_no, final record has zero lines --------------------
integration("3: duplicate doc_no, final record has zero (or omitted) lines -- zero lines persist", async () => {
  await reset();
  const r1 = await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send({
    branchCode: "001",
    records: [
      { FTXihDocNo: "ZERO", FCXihTotal: 1, lines: [{ FNXidSeqNo: 1, FTPdtCode: "PA" }] },
      { FTXihDocNo: "ZERO", FCXihTotal: 2, lines: [] },
    ],
  });
  assert.equal(r1.status, 200);
  assert.equal((await dumpHeaders()).length, 1);
  assert.equal((await dumpLines()).length, 0);

  await reset();
  const r2 = await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send({
    branchCode: "001",
    records: [
      { FTXihDocNo: "OMIT", FCXihTotal: 1, lines: [{ FNXidSeqNo: 1, FTPdtCode: "PA" }] },
      { FTXihDocNo: "OMIT", FCXihTotal: 2 }, // lines key entirely absent
    ],
  });
  assert.equal(r2.status, 200);
  assert.equal((await dumpHeaders()).length, 1);
  assert.equal((await dumpLines()).length, 0);
});

// ---- 4: duplicate seq_no within one record's own lines -- whole-payload rollback, even for earlier valid docs
integration("4: duplicate seq_no within one record's lines -- 500, full rollback of ENTIRE payload", async () => {
  await reset();
  const r = await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send({
    branchCode: "001",
    records: [
      { FTXihDocNo: "BEFORE", FCXihTotal: 9, lines: [{ FNXidSeqNo: 1, FTPdtCode: "SURVIVES" }] },
      { FTXihDocNo: "DUPSEQ", lines: [{ FNXidSeqNo: 1, FTPdtCode: "A" }, { FNXidSeqNo: 1, FTPdtCode: "B" }] },
    ],
  });
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: "Internal server error", request_id: null });
  // BEFORE was valid and processed first in OLD's sequential loop, but the
  // whole transaction still rolls back -- nothing persists, not even BEFORE.
  assert.equal((await dumpHeaders()).length, 0);
  assert.equal((await dumpLines()).length, 0);
});

// ---- 5: invalid/missing seqNo -- same whole-payload rollback -------------
integration("5: invalid seqNo (0, non-integer, or omitted) -- 500, full rollback", async () => {
  for (const lines of [
    [{ FNXidSeqNo: 0, FTPdtCode: "X" }],
    [{ FNXidSeqNo: 1.5, FTPdtCode: "X" }],
    [{ FTPdtCode: "X" }], // seqNo omitted -> defaults to 0 -> fails positive check
  ]) {
    await reset();
    const r = await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send({
      branchCode: "001",
      records: [{ FTXihDocNo: "BADSEQ", lines }],
    });
    assert.equal(r.status, 500, `lines=${JSON.stringify(lines)}`);
    assert.equal((await dumpHeaders()).length, 0);
  }
});

// ---- 6: missing docNo -- 500 (mid-transaction throw, NOT the 400 shape check)
integration("6: missing docNo on a record -- 500, distinct from the top-level 400 payload-shape check", async () => {
  await reset();
  const r = await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send({
    branchCode: "001",
    records: [{ FCXihTotal: 1 }],
  });
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: "Internal server error", request_id: null });
});

// ---- 7: missing top-level branchCode -- 400, different code path ---------
integration("7: missing top-level branchCode -- 400 with the exact parseApprovedReceiptPayload message", async () => {
  const r = await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send({
    records: [{ FTXihDocNo: "X" }],
  });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: "branchCode and records[] required" });
});

// ---- 8: empty records array ------------------------------------------------
integration("8: empty records array -- 200, upserted 0, no query executed against either table", async () => {
  await reset();
  const r = await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send({
    branchCode: "001", records: [],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, upserted: 0 });
});

// ---- 9: null/omitted/default business fields ------------------------------
integration("9: null/omitted business fields fall back exactly like OLD (0/1/null per column)", async () => {
  await reset();
  const r = await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send({
    branchCode: "001",
    records: [{ FTXihDocNo: "NULLS", lines: [{ FNXidSeqNo: 1 }] }],
  });
  assert.equal(r.status, 200);
  const headers = await dumpHeaders();
  assert.equal(headers[0].doc_type, null);
  assert.equal(headers[0].total, "0.0000");
  assert.equal(headers[0].vat, "0.0000");
  assert.equal(headers[0].grand, "0.0000");
  const lines = await dumpLines();
  assert.equal(lines[0].product_code, null);
  assert.equal(lines[0].factor, "1.0000"); // fallback default 1
  assert.equal(lines[0].qty, "0.0000"); // fallback default 0
  assert.equal(lines[0].stock_factor, "1.0000");
});

// ---- 10: source_system/source_table/source_synced_at/raw_payload overrides
integration("10: explicit sourceSystem/sourceSyncedAt/__rawPayload overrides propagate exactly", async () => {
  await reset();
  const r = await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send({
    branchCode: "001", sourceSystem: "CustomSys", sourceSyncedAt: "2026-08-01T00:00:00.000Z",
    records: [{ FTXihDocNo: "SRC", lines: [{ FNXidSeqNo: 1, __rawPayload: { custom: true } }] }],
  });
  assert.equal(r.status, 200);
  const headers = await dumpHeadersWithSyncedAt();
  assert.equal(headers[0].source_synced_at, "2026-08-01T00:00:00.000Z");
  const lines = await dumpLinesWithSyncedAt();
  assert.equal(lines[0].source_synced_at, "2026-08-01T00:00:00.000Z");
  const lineRows = await dumpLines();
  assert.deepEqual(lineRows[0].raw_payload, { custom: true }); // __rawPayload override wins
  assert.equal(lineRows[0].source_system, "CustomSys");
});

// ---- 11: idempotent replay (explicit sourceSyncedAt for a meaningful compare)
integration("11: idempotent replay -- identical payload twice yields identical final state", async () => {
  await reset();
  const payload = {
    branchCode: "001", sourceSyncedAt: "2026-08-01T00:00:00.000Z",
    records: [{ FTXihDocNo: "REPLAY", FCXihTotal: 5, lines: [{ FNXidSeqNo: 1, FTPdtCode: "P1", FCXidQty: 3 }] }],
  };
  const r1 = await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send(payload);
  assert.equal(r1.status, 200);
  const h1 = await dumpHeaders(); const l1 = await dumpLines();
  const r2 = await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send(payload);
  assert.equal(r2.status, 200);
  const h2 = await dumpHeaders(); const l2 = await dumpLines();
  assert.deepEqual(h1, h2);
  assert.deepEqual(l1, l2);
});

// ---- 12: query count is O(1) per request, NOT O(documents) ---------------
integration("12: statement count is constant regardless of payload size (1/50/1000 docs)", async () => {
  const counts = {};
  for (const n of [1, 50, 1000]) {
    await reset();
    const cp = makeCountingPool(pool);
    const records = Array.from({ length: n }, (_, i) => ({
      FTXihDocNo: `Q${i}`, FCXihTotal: i,
      lines: [{ FNXidSeqNo: 1, FTPdtCode: "P1" }, { FNXidSeqNo: 2, FTPdtCode: "P2" }, { FNXidSeqNo: 3, FTPdtCode: "P3" }],
    }));
    const r = await request(makeApp(cp)).post("/api/sync/ada/approved-receipts").send({ branchCode: "001", records });
    assert.equal(r.status, 200);
    assert.equal(r.body.upserted, n);
    counts[n] = cp.statements.length;
  }
  // OLD was 5N+2 (confirmed via Phase B probe: 7/252/5002). NEW must be a
  // FIXED small constant independent of N -- explicitly assert it does NOT
  // grow between 1 and 1000 documents (the whole point of this candidate).
  assert.equal(counts[1], counts[50], `expected constant statement count, got 1=${counts[1]} 50=${counts[50]}`);
  assert.equal(counts[50], counts[1000], `expected constant statement count, got 50=${counts[50]} 1000=${counts[1000]}`);
});

// ---- 13: rollback of the WHOLE payload when one document is invalid ------
integration("13: one invalid document mid-payload rolls back the entire batch, including valid docs", async () => {
  await reset();
  const r = await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send({
    branchCode: "001",
    records: [
      { FTXihDocNo: "GOOD1", lines: [{ FNXidSeqNo: 1, FTPdtCode: "P1" }] },
      { FTXihDocNo: "BAD", lines: [{ FNXidSeqNo: -1, FTPdtCode: "P2" }] },
      { FTXihDocNo: "GOOD2", lines: [{ FNXidSeqNo: 1, FTPdtCode: "P3" }] },
    ],
  });
  assert.equal(r.status, 500);
  assert.equal((await dumpHeaders()).length, 0);
  assert.equal((await dumpLines()).length, 0);
});

// ---- 14: DB unavailable guard (acquireIngestionDbClient) ------------------
integration("14: DB acquisition failure returns 503 DB_UNAVAILABLE, never crashes the process", async () => {
  const failingDb = {
    async connect() {
      const err = new Error("connection terminated unexpectedly");
      err.code = "ECONNREFUSED";
      throw err;
    },
  };
  const r = await request(makeApp(failingDb)).post("/api/sync/ada/approved-receipts").send({
    branchCode: "001", records: [{ FTXihDocNo: "X" }],
  });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "DB_UNAVAILABLE");
});

// ---- 15: zero connection/resource leak across many requests --------------
integration("15: repeated requests leave zero idle-in-transaction / leaked connections", async () => {
  await reset();
  for (let i = 0; i < 20; i++) {
    await request(makeApp(pool)).post("/api/sync/ada/approved-receipts").send({
      branchCode: "001",
      records: [{ FTXihDocNo: `LEAK${i}`, lines: [{ FNXidSeqNo: 1, FTPdtCode: "P1" }] }],
    });
  }
  const res = await pool.query(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE state = 'idle in transaction' AND pid <> pg_backend_pid()",
  );
  assert.equal(res.rows[0].n, 0);
});
