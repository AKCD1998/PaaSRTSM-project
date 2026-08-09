"use strict";

// Track C Slice 2 — tests for POST /api/sync/sales-summary set-based UPSERT.
// Tests-first: written BEFORE the set-based handler implementation, against
// the OLD per-record path first to establish ground truth, then used
// unchanged to verify the NEW path matches it. All tests run against a REAL
// disposable local Postgres gated on TRACK_C_SLICE2_TEST_DATABASE_URL — never
// a structural mock. The route is exercised end-to-end via supertest with a
// real pg.Pool, so ON CONFLICT, FK constraint, and type-cast behavior are all
// exercised for real.
//
// analytics.product_sales_summary_periods has FK constraints Slice 1's table
// did not: product_code -> public.skus(company_code), branch_code ->
// core.branches(branch_code). Fixtures must seed items+skus+branches first.
//
// Duplicate-key and error-shape ground truth were established empirically
// against the OLD path before writing this file (see
// FINAL_TRACK_C_SLICE2_REVIEW_PACKET.md Phase B): duplicate conflict key
// (product_code, branch_code, period_start, period_end, source_name) in
// one payload -> LAST array occurrence wins, accepted = INPUT record count.
// A thrown validation error -> HTTP 500, body
// {"error":"Internal server error","request_id":...}, full rollback (0 rows).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { Pool } = require("pg");
const { createSyncRouter } = require("./sync");

const databaseUrl = process.env.TRACK_C_SLICE2_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

// A Pool proxy that records every SQL statement issued, for query-count
// assertions (test #9). Lesson carried over from Track C Slice 1 (a real
// hang there was root-caused to this exact pattern): client.query is
// patched per-connect(), but MUST be restored before release() hands the
// client back to the shared pool — otherwise a later, unrelated
// pool.connect() (e.g. the 1000-record test) can receive the same mutated
// client and hang the process.
//
// Codex review fix (2026-08-09): the first version captured
// `client.query.bind(client)` and restored THAT bound copy on release —
// behaviorally equivalent when invoked as client.query(...), but not the
// literal original function reference (a fresh bound wrapper is a distinct
// function object, not === to whatever was on the client before patching).
// Fixed to capture the true original reference with no rebinding, and
// invoke it via .call(client, ...) instead — so restoring on release
// assigns back the exact original reference, not a proxy that merely
// behaves the same.
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
  // file previously assumed the target database already had the full FK
  // chain (public.items -> public.skus -> analytics.product_sales_summary_periods,
  // core.branches) applied out-of-band. This route's table has FK
  // constraints Slice 1/3/4's ada.* tables do not, so the bootstrap here
  // needs the official baseline schema plus migrations through 014 (which
  // adds the skus_company_code_key UNIQUE constraint, core.branches, and
  // analytics.product_sales_summary_periods itself) — not just one
  // migration file. Applied in the same numeric order the project's own
  // scripts/db_migrate.js uses. Every one of these files is genuinely
  // idempotent (CREATE ... IF NOT EXISTS throughout — confirmed by reading
  // them, not assumed), so this is safe to run unconditionally whether the
  // database is brand new or already migrated. Migration 012 is skipped: it
  // requires the "vector" Postgres extension, which is not installed on
  // this disposable local cluster and is unrelated to sales-summary — its
  // own file is wrapped in BEGIN/COMMIT, so a failed statement inside it
  // rolls back cleanly with no partial effect, confirmed empirically during
  // Slice 2's original Phase B setup.
  const rootDir = path.join(__dirname, "..", "..", "..", "..");
  // stripBom: 001_inventory_schema.sql (and only that file among the ones
  // this bootstrap reads — confirmed by checking every file's first 3 bytes
  // directly, not assumed) starts with a UTF-8 byte-order-mark (EF BB BF).
  // Node's fs.readFileSync does NOT strip a BOM even with "utf8" encoding,
  // so the raw ﻿ character was being sent to Postgres as literal SQL
  // text, producing "syntax error at or near BEGIN" the first time this
  // bootstrap was actually exercised against a fresh database (a real,
  // previously-undetected bug — Slice 1/3/4's bootstraps never read this
  // particular file, so they never hit it).
  const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const baselineSql = stripBom(fs.readFileSync(path.join(rootDir, "001_inventory_schema.sql"), "utf8"));
  await pool.query(baselineSql);
  const migrationOrder = [
    "002_add_sku_price_tiers.sql",
    "003_add_product_fields.sql",
    "004_add_enrichment_workflow.sql",
    "005_add_sales_daily.sql",
    "010_add_audit_logs.sql",
    "011_add_sku_unit_prices.sql",
    // 012_add_sku_embeddings.sql intentionally skipped — requires the
    // "vector" extension, not installed on this disposable cluster, and
    // unrelated to analytics.product_sales_summary_periods.
    "013_add_embedding_sync_jobs.sql",
    "014_add_shared_ordering_and_sync.sql",
  ];
  for (const file of migrationOrder) {
    const sql = stripBom(fs.readFileSync(path.join(rootDir, "migrations", file), "utf8"));
    // eslint-disable-next-line no-await-in-loop -- one-time test bootstrap, not the code under test
    await pool.query(sql);
  }
});

test.after(async function () {
  if (pool) await pool.end();
});

function makeApp(db) {
  const app = express();
  app.use(express.json());
  app.use("/api/sync", createSyncRouter({ config: { posApiKeys: new Set() }, db }));
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
  await p.query("TRUNCATE analytics.product_sales_summary_periods, public.skus, public.items, core.branches RESTART IDENTITY CASCADE");
}

let skuSeq = 0;
async function seedSku(p, companyCode) {
  skuSeq += 1;
  const item = await p.query(
    "INSERT INTO public.items (generic_name) VALUES ($1) RETURNING item_id",
    [`slice2-item-${skuSeq}-${companyCode}`],
  );
  await p.query(
    "INSERT INTO public.skus (item_id, qty_in_base, company_code) VALUES ($1, 1, $2)",
    [item.rows[0].item_id, companyCode],
  );
}

async function seedSkus(p, companyCodes) {
  for (const code of companyCodes) {
    // eslint-disable-next-line no-await-in-loop -- test setup, not the code under test
    await seedSku(p, code);
  }
}

async function seedBranch(p, branchCode) {
  await p.query(
    "INSERT INTO core.branches (branch_code, branch_name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [branchCode, `branch-${branchCode}`],
  );
}

// Canonical column dump for business-data equivalence. Excludes
// sales_summary_id (surrogate PK) and created_at (runtime default) —
// neither is ever written by the route on either path, so dumpRows() never
// selects them; this is why they are not part of the comparison, not
// because they were compared and ignored.
async function dumpRows(p = pool) {
  return (await p.query(
    `SELECT product_code, branch_code, period_start, period_end, period_days,
            sold_qty_base, avg_daily_usage, source_name
     FROM analytics.product_sales_summary_periods
     ORDER BY product_code, branch_code, period_start, period_end`,
  )).rows.map((r) => {
    const out = { ...r };
    if (out.period_start instanceof Date) out.period_start = out.period_start.toISOString();
    if (out.period_end instanceof Date) out.period_end = out.period_end.toISOString();
    return out;
  });
}

// ---- Test 1: mixed INSERT + UPDATE in one payload ---------------------------
// NOTE on branchCode in tests 1-3: `branch_code` is part of the unique/
// conflict key `(product_code, branch_code, period_start, period_end,
// source_name)`, but PostgreSQL's plain UNIQUE constraint treats NULL as
// never equal to NULL — so ON CONFLICT never fires for a NULL branch_code,
// and every "duplicate" for a null-branch record silently INSERTS a new row
// instead of updating (verified empirically against the OLD path during
// Phase B, not assumed). Tests 1-3 use an explicit branchCode so they
// exercise the well-defined, deduplicating conflict path. The null-branch
// non-deduplication behavior is its own real, separately preserved
// behavior — see test 3b below, which locks it in rather than silently
// "fixing" it.
integration("test 1: mixed INSERT + UPDATE — final values match direct upserts", async () => {
  await reset();
  await seedSkus(pool, ["UPD", "NEW1", "NEW2"]);
  await seedBranch(pool, "001");
  const seed = await request(makeApp(pool)).post("/api/sync/sales-summary").send({
    records: [{ productCode: "UPD", branchCode: "001", periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: 1, avgDailyUsage: 0.1 }],
  });
  assert.equal(seed.statusCode, 200);
  const res = await request(makeApp(pool)).post("/api/sync/sales-summary").send({
    records: [
      { productCode: "UPD", branchCode: "001", periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: 42, avgDailyUsage: 4.2 }, // UPDATE
      { productCode: "NEW1", branchCode: "001", periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: 7, avgDailyUsage: 0.7 }, // INSERT
      { productCode: "NEW2", branchCode: "001", periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: 8, avgDailyUsage: 0.8 }, // INSERT
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accepted, 3);
  const rows = await dumpRows();
  assert.equal(rows.length, 3, "1 updated + 2 inserted = 3 rows, no duplicate UPD");
  const upd = rows.find((r) => r.product_code === "UPD");
  assert.equal(Number(upd.sold_qty_base), 42, "UPD row must reflect new value");
  assert.equal(Number(upd.avg_daily_usage), 4.2);
});

// ---- Test 2: idempotency — same payload twice → identical state -------------
integration("test 2: identical payload POSTed twice → identical final state", async () => {
  await reset();
  await seedSkus(pool, ["IDEM1", "IDEM2"]);
  await seedBranch(pool, "001");
  const body = {
    records: [
      { productCode: "IDEM1", branchCode: "001", periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: 5 },
      { productCode: "IDEM2", branchCode: "001", periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: 6 },
    ],
  };
  const r1 = await request(makeApp(pool)).post("/api/sync/sales-summary").send(body);
  assert.equal(r1.statusCode, 200);
  const state1 = JSON.stringify(await dumpRows());
  const r2 = await request(makeApp(pool)).post("/api/sync/sales-summary").send(body);
  assert.equal(r2.statusCode, 200);
  const state2 = JSON.stringify(await dumpRows());
  assert.equal(state1, state2, "second POST must leave DB identical to first");
});

// ---- Test 3: duplicate conflict key within one payload — matches OLD --------
// Ground truth established empirically against the OLD path (Phase B, see
// FINAL_TRACK_C_SLICE2_REVIEW_PACKET.md): HTTP 200, accepted = INPUT count
// (2), persisted row = SECOND (last array position) record's values — true
// when branch_code is non-null (the well-defined conflict path).
integration("test 3: duplicate conflict key in payload (non-null branch) → last-wins, matches OLD path", async () => {
  await reset();
  await seedSkus(pool, ["DUP"]);
  await seedBranch(pool, "001");
  const res = await request(makeApp(pool)).post("/api/sync/sales-summary").send({
    records: [
      { productCode: "DUP", branchCode: "001", periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: 10, avgDailyUsage: 1 },
      { productCode: "DUP", branchCode: "001", periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: 20, avgDailyUsage: 2 },
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accepted, 2, "accepted must be INPUT record count, not de-duped");
  const row = (await pool.query("SELECT sold_qty_base, avg_daily_usage FROM analytics.product_sales_summary_periods WHERE product_code='DUP'")).rows[0];
  assert.equal(Number(row.sold_qty_base), 20, "last (second) record must win");
  assert.equal(Number(row.avg_daily_usage), 2);
});

// ---- Test 3c: dedup key must not collide on separator characters --------
// Codex review finding, independently reproduced before fixing (2026-08-09):
// the original dedup key was built via string concatenation with "|" as a
// separator (`${productCode}|${branchCode}|...`). Neither the schema nor
// this route's validation forbids "|" in productCode/branchCode, so
// productCode="A|B", branchCode="C" and productCode="A", branchCode="B|C"
// concatenated to the SAME string ("A|B|C|...") despite being two distinct
// rows under the real (product_code, branch_code, period_start, period_end,
// source_name) unique constraint — collapsing two records into one and
// silently dropping data (reproduced: accepted:2, only 1 row persisted).
// This test locks in the fix (a JSON-encoded tuple key, which cannot
// collide this way) and must keep passing on any future key-construction
// change.
integration("test 3c: separator-colliding field values must NOT be treated as the same conflict key", async () => {
  await reset();
  await seedSkus(pool, ["A|B", "A"]);
  await seedBranch(pool, "C");
  await seedBranch(pool, "B|C");
  const res = await request(makeApp(pool)).post("/api/sync/sales-summary").send({
    records: [
      { productCode: "A|B", branchCode: "C", periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: 111 },
      { productCode: "A", branchCode: "B|C", periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: 222 },
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accepted, 2);
  const rows = await pool.query(
    "SELECT product_code, branch_code, sold_qty_base FROM analytics.product_sales_summary_periods ORDER BY product_code, branch_code",
  );
  assert.equal(rows.rows.length, 2, "two distinct (product_code, branch_code) pairs must persist as two separate rows, not collide into one");
  const ab = rows.rows.find((r) => r.product_code === "A|B" && r.branch_code === "C");
  const aBc = rows.rows.find((r) => r.product_code === "A" && r.branch_code === "B|C");
  assert.ok(ab, "productCode='A|B', branchCode='C' row must exist");
  assert.ok(aBc, "productCode='A', branchCode='B|C' row must exist");
  assert.equal(Number(ab.sold_qty_base), 111);
  assert.equal(Number(aBc.sold_qty_base), 222);
});

// ---- Test 3b: NULL branch_code duplicates do NOT deduplicate — real OLD ----
// quirk, verified empirically (Phase B), must be preserved exactly, not
// silently "fixed" by the set-based rewrite. PostgreSQL's plain UNIQUE
// constraint never matches on NULL, so ON CONFLICT never fires when
// branch_code is null — every occurrence inserts a distinct row.
integration("test 3b: NULL branch_code duplicates insert as separate rows (OLD quirk, preserved)", async () => {
  await reset();
  await seedSkus(pool, ["NULLDUP"]);
  const res = await request(makeApp(pool)).post("/api/sync/sales-summary").send({
    records: [
      { productCode: "NULLDUP", periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: 10 },
      { productCode: "NULLDUP", periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: 20 },
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accepted, 2);
  const rows = (await pool.query("SELECT sold_qty_base FROM analytics.product_sales_summary_periods WHERE product_code='NULLDUP' ORDER BY sales_summary_id")).rows;
  assert.equal(rows.length, 2, "NULL branch_code must NOT deduplicate — two distinct rows, matching OLD behavior exactly");
  assert.equal(Number(rows[0].sold_qty_base), 10);
  assert.equal(Number(rows[1].sold_qty_base), 20);
});

// ---- Test 4: one invalid record rolls back the ENTIRE payload --------------
integration("test 4: invalid record (missing productCode) → full rollback, HTTP 500, matches OLD shape", async () => {
  await reset();
  await seedSkus(pool, ["OK1"]);
  const res = await request(makeApp(pool)).post("/api/sync/sales-summary").send({
    records: [
      { productCode: "OK1", periodStart: "2026-08-01", periodEnd: "2026-08-09" },
      { periodStart: "2026-08-01", periodEnd: "2026-08-09" }, // missing productCode -> throws
    ],
  });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "Internal server error");
  const count = (await pool.query("SELECT count(*)::int AS c FROM analytics.product_sales_summary_periods")).rows[0].c;
  assert.equal(count, 0, "entire payload must roll back");
});

// ---- Test 5: simulated DB failure mid-batch → rollback, single release -----
integration("test 5: DB query failure → rollback, connection released exactly once (no leak/double-release)", async () => {
  // Separate scratch database with no analytics schema at all, so the
  // route's INSERT fails with a genuine Postgres error. Only client.release
  // is wrapped (to count calls) — client.query is never touched, avoiding
  // the Slice 1 hang cause.
  const adminPool = new Pool({ connectionString: databaseUrl, max: 2 });
  await adminPool.query("DROP DATABASE IF EXISTS trackc_slice2_empty");
  await adminPool.query("CREATE DATABASE trackc_slice2_empty");
  await adminPool.end();
  let releaseCount = 0;
  const handlerPool = new Pool({ connectionString: databaseUrl.replace(/\/[^/]*$/, "/trackc_slice2_empty"), max: 2 });
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
    const res = await request(makeApp(instrumented)).post("/api/sync/sales-summary").send({
      records: [{ productCode: "FAIL", periodStart: "2026-08-01", periodEnd: "2026-08-09" }],
    });
    assert.equal(res.statusCode, 500, "must surface as a server error");
    assert.equal(releaseCount, 1, "connection must be released exactly once, no leak, no double-release");
  } finally {
    await handlerPool.end();
    const cleanup = new Pool({ connectionString: databaseUrl, max: 2 });
    await cleanup.query("DROP DATABASE IF EXISTS trackc_slice2_empty");
    await cleanup.end();
  }
});

// ---- Test 6: empty payload -------------------------------------------------
integration("test 6: empty records: [] → 200, accepted:0, no error, no syncRunId field", async () => {
  await reset();
  const res = await request(makeApp(pool)).post("/api/sync/sales-summary").send({ records: [] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accepted, 0);
  assert.equal("syncRunId" in res.body, false, "OLD path never returns syncRunId for this route — must not add one");
});

// ---- Test 7: normalization edge cases match OLD behavior -------------------
integration("test 7: null/decimal/date/timestamp normalization edges match OLD defaults", async () => {
  await reset();
  await seedSkus(pool, ["EDGE", "NULLS"]);
  const res = await request(makeApp(pool)).post("/api/sync/sales-summary").send({
    records: [
      { productCode: "EDGE", periodStart: "2026-08-01", periodEnd: "2026-08-09", periodDays: 9, soldQtyBase: 3.5, avgDailyUsage: 1.25 },
      { productCode: "NULLS" }, // all optional fields missing -> defaults apply
    ],
  });
  assert.equal(res.statusCode, 200);
  const rows = await dumpRows();
  const edge = rows.find((r) => r.product_code === "EDGE");
  assert.equal(Number(edge.sold_qty_base), 3.5);
  assert.equal(Number(edge.avg_daily_usage), 1.25);
  assert.equal(edge.period_days, 9);
  const nulls = rows.find((r) => r.product_code === "NULLS");
  assert.equal(nulls.branch_code, null);
  assert.equal(nulls.period_days, 30, "default periodDays");
  assert.equal(Number(nulls.sold_qty_base), 0, "default soldQtyBase");
  assert.equal(Number(nulls.avg_daily_usage), 0, "default avgDailyUsage");
  assert.equal(nulls.source_name, "adapos_sync");
});

// ---- Test 8: full-fixture business-data equivalence vs OLD path reference --
// Excludes sales_summary_id (surrogate PK) and created_at (runtime default)
// — dumpRows() never selects either, so neither is part of this comparison.
// NOTE: this fixture deliberately does NOT include exact-duplicate
// null-branch rows (same product_code/period_start/period_end, differing
// only in value) — dumpRows()'s ORDER BY has no tiebreaker for rows that
// are identical across every ordered column, so which physical row lands
// "first" between two such rows is not guaranteed to match between the OLD
// per-record loop's strict insertion order and the NEW single-statement
// UNNEST's implementation-defined row-processing order. That specific
// preserved-duplication behavior is already covered unambiguously by test
// 3b above; this fixture instead uses distinct null-branch product codes
// so every row is uniquely identifiable and the comparison is unambiguous.
integration("test 8: 200-record mixed fixture → NEW output business-data equivalent to OLD reference", async () => {
  await reset();
  const productCodes = [];
  for (let i = 0; i < 100; i++) productCodes.push(`P${i}`);
  for (let i = 0; i < 50; i++) productCodes.push(`NB${i}`);
  await seedSkus(pool, productCodes);
  await seedBranch(pool, "001");
  const records = [];
  for (let i = 0; i < 100; i++) records.push({ productCode: `P${i}`, branchCode: "001", periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: i + 1, avgDailyUsage: (i + 1) / 10 });
  for (let i = 0; i < 50; i++) records.push({ productCode: `P${i}`, branchCode: "001", periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: 1000 + i, avgDailyUsage: 9 });
  // Distinct null-branch rows (unique product codes, no exact duplicates).
  for (let i = 0; i < 50; i++) records.push({ productCode: `NB${i}`, periodStart: "2026-08-02", periodEnd: "2026-08-10", soldQtyBase: 7 + i, avgDailyUsage: 0.7 });
  const res = await request(makeApp(pool)).post("/api/sync/sales-summary").send({ records });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accepted, records.length);
  const newRows = await dumpRows();
  const refPath = path.join(__dirname, "..", "..", "test", "fixtures", "track_c_slice2_sales_summary_ref.json");
  const refRows = JSON.parse(fs.readFileSync(refPath, "utf8"));
  assert.equal(newRows.length, refRows.length, `row count mismatch: NEW=${newRows.length} REF=${refRows.length}`);
  for (let i = 0; i < newRows.length; i++) {
    assert.deepStrictEqual(
      newRows[i],
      refRows[i],
      `row ${i} (${newRows[i].product_code}) diverges from the OLD-path reference across one or more business fields`,
    );
  }
});

// ---- Test 9: query count — NEW path O(1) vs OLD path O(N) ------------------
integration("test 9: query count — batch path issues a small constant number of INSERTs for N records", async () => {
  await reset();
  await seedSkus(pool, Array.from({ length: 50 }, (_, i) => `QC${i}`));
  countingPool.statements.length = 0;
  const records = Array.from({ length: 50 }, (_, i) => ({ productCode: `QC${i}`, periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: i }));
  const res = await request(makeApp(countingPool)).post("/api/sync/sales-summary").send({ records });
  assert.equal(res.statusCode, 200);
  const inserts = countingPool.statements.filter((s) => /INSERT INTO analytics\.product_sales_summary_periods/i.test(s));
  assert.ok(
    inserts.length <= 2,
    `NEW path must issue a small constant number of INSERTs (<=2), got ${inserts.length} for 50 records — looks like per-record looping regressed`,
  );
  assert.ok(inserts.length >= 1, "must issue at least one INSERT");
});

// ---- Test 10: real Postgres (not a structural mock) — implicit in all above --
// (every test above exercises real ON CONFLICT, FK constraint, and type-cast
// behavior because it runs through a real pg.Pool against the migrated schema.)

// ---- Test 11: 503 acquisition guard unchanged ------------------------------
integration("test 11: 503 DB_UNAVAILABLE acquisition behavior unchanged for this route", async () => {
  const rejectingDb = {
    async connect() {
      const err = new Error("connection refused");
      err.code = "ECONNREFUSED";
      throw err;
    },
  };
  const res = await request(makeApp(rejectingDb)).post("/api/sync/sales-summary").send({ records: [] });
  assert.equal(res.statusCode, 503);
});

// ---- Test 12: 1000-record production-representative payload ---------------
integration("test 12: 1000-record payload in one POST — succeeds", async () => {
  await reset();
  await seedSkus(pool, Array.from({ length: 1000 }, (_, i) => `BIG${i}`));
  const records = Array.from({ length: 1000 }, (_, i) => ({ productCode: `BIG${i}`, periodStart: "2026-08-01", periodEnd: "2026-08-09", soldQtyBase: i }));
  const res = await request(makeApp(pool)).post("/api/sync/sales-summary").send({ records });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accepted, 1000);
  const count = (await pool.query("SELECT count(*)::int AS c FROM analytics.product_sales_summary_periods")).rows[0].c;
  assert.equal(count, 1000);
});

// ---- (item 12 in the packet's list) other routes unaffected ----------------
// Covered by rerunning the full admin-api regression suite unmodified in
// Phase F, not duplicated here — this file must not wire up unrelated
// routers.
