"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const XLSX = require("xlsx");
const { createHourly004StockDisplay, EXPECTED_PRODUCTS } = require("../apps/admin-api/src/services/hourly004StockDisplay");
const { buildCohortCoverage } = require("../apps/admin-api/src/services/hourlyCohortCoverage");
const { createBranchStockRouter } = require("../apps/admin-api/src/routes/branch-stock");

function fixture() {
  const codes = Array.from({ length: EXPECTED_PRODUCTS }, (_, i) => `TEST-${String(i).padStart(5, "0")}`);
  const rows = codes.map(product_code => ({ product_code }));
  const header = { capture_id: "internal-fixture-only", record_count: EXPECTED_PRODUCTS,
    captured_at: "2026-10-22T06:02:00.000Z", planned_slot: "2026-10-22T13:00:00+07:00" };
  const meta = {
    coverage: buildCohortCoverage({ expectedProductCodes: codes, rows, observationKind: "intraday",
      readBatchSize: 200, readBatchCount: 35, observationWindowMs: 120000 }),
    derived: { schemaVersion: "adapos-ordinary16-derived-v1", estimateBasis: "retail-plus-wholesale-plus-ordinary16",
      sampleCount: 2, consistency: "unverified", qualifying: false, businessCutoffAt: null,
      readStartedAt: "2026-10-22T06:00:00.000Z", readCompletedAt: "2026-10-22T06:02:00.000Z",
      records: codes.map((productCode, i) => ({ productCode, derivedOnHand: i - 1, reason: "observed-unverified" })) },
  };
  const state = { header, meta, rows, calls: [], fail: false };
  const config = { featureHourlyStockEvidence: true, featureHourlyStockEvidenceCompleteCohort: true };
  const sources = codes.map(product_code => ({ product_code, full_sync_at_004: "2026-10-22T01:22:00.000Z",
    qty_branch_004: 100, qty_branch_001: 7, qty_total_all_branches: 107 }));
  const records = codes.map(productCode => ({ productCode, qtyBranch004: 100, qtyBranch001: 7, qtyTotalAllBranches: 107 }));
  const db = { query: async (sql, params) => {
    state.calls.push({ sql, params });
    if (sql.includes("hourly_stock_capture_runs") && sql.includes("ORDER BY planned_for")) {
      if (state.fail) throw new Error("private database details must not escape");
      return { rows: state.header ? [state.header] : [] };
    }
    if (sql.includes("client_meta->'cohortCoverage'")) return { rows: [state.meta] };
    if (sql.includes("hourly_stock_capture_rows")) return { rows: state.rows };
    if (sql.includes("COUNT(*)::int AS total FROM ada.branch_stock_snapshots")) return { rows: [{ total: sources.length }] };
    if (sql.includes("FROM ada.branch_stock_snapshots bs")) return { rows: sources };
    throw new Error("Unexpected SQL in display test");
  } };
  const deps = { db, config, now: () => new Date("2026-10-22T06:20:00.000Z") };
  return { ...deps, sources, records, state, project: createHourly004StockDisplay(deps) };
}

test("all 6,835 derived quantities, including zero and negatives, replace only 004 in the opted-in read view", async () => {
  const f = fixture();
  const original = structuredClone(f.records);
  const result = await f.project(f.records, f.sources);
  assert.equal(result.hourlyStock004.pageHourlyProducts, EXPECTED_PRODUCTS);
  assert.equal(result.records[0].qtyBranch004, -1);
  assert.equal(result.records[1].qtyBranch004, 0);
  assert.equal(result.records[1].qtyBranch001, 7);
  assert.equal(result.records[1].qtyTotalAllBranches, 7);
  assert.equal(result.records[1].fullSyncQtyBranch004, 100);
  assert.deepEqual(f.records, original);
  assert.equal(result.hourlyStock004.atomicSnapshotVerified, false);
  assert.equal(result.hourlyStock004.businessFreshnessQualified, false);
  assert.ok(!JSON.stringify(result).includes(f.state.header.capture_id));
  assert.ok(!JSON.stringify(result).includes("cohortSha256"));
  assert.ok(f.state.calls.every(call => /^SELECT/.test(call.sql.trim())));
});

test("disabled flags do not query evidence; each flag is required", async () => {
  for (const key of ["featureHourlyStockEvidence", "featureHourlyStockEvidenceCompleteCohort"]) {
    const f = fixture(); f.config[key] = false;
    const result = await f.project(f.records, f.sources);
    assert.equal(result.hourlyStock004.status, "disabled");
    assert.equal(result.records[0].qtyBranch004, 100);
    assert.equal(f.state.calls.length, 0);
  }
});

test("selects today's latest slot without reusing yesterday, future slots, or old captures", async () => {
  const f = fixture(); f.state.header = null;
  const result = await f.project(f.records, f.sources);
  assert.equal(result.hourlyStock004.status, "no-today-capture");
  const call = f.state.calls[0];
  assert.deepEqual(call.params, ["2026-10-22T00:00:00+07:00", "2026-10-22T06:20:00.000Z"]);
  assert.match(call.sql, /planned_for >=/);
  assert.match(call.sql, /captured_at <=/);
  assert.match(call.sql, /ORDER BY planned_for DESC, captured_at DESC/);
});

test("unknown members, suppressed quantities, and newer Full Sync fall back individually and adjust totals", async () => {
  const f = fixture();
  f.state.meta.derived.records[0] = { productCode: f.records[0].productCode, derivedOnHand: null, reason: "changed-between-reads" };
  f.sources[1].full_sync_at_004 = "2026-10-22T06:01:00.000Z";
  f.sources[2].full_sync_at_004 = null;
  f.records.push({ productCode: "NEW-OUTSIDE", qtyBranch004: 4, qtyTotalAllBranches: 9 });
  const result = await f.project(f.records, f.sources);
  assert.equal(result.records[0].stock004.reason, "changed-between-reads");
  assert.equal(result.records[1].stock004.reason, "full-sync-newer");
  assert.equal(result.records[2].stock004.reason, "full-sync-time-unknown");
  assert.equal(result.records.at(-1).stock004.reason, "not-in-cohort");
  assert.equal(result.hourlyStock004.suppressedProducts, 1);
  assert.equal(result.hourlyStock004.pageFallbackProducts, 4);
  assert.equal(result.records[0].qtyTotalAllBranches, 107);
});

test("malformed/incomplete/duplicate/clock-invalid latest capture cannot fall back to an older quantity", async () => {
  const faults = [
    f => { f.state.header.record_count = 50; },
    f => { f.state.rows.pop(); },
    f => { f.state.rows[1] = f.state.rows[0]; },
    f => { f.state.meta.derived.records[1] = f.state.meta.derived.records[0]; },
    f => { f.state.meta.derived.records[0].derivedOnHand = "0"; },
    f => { f.state.meta.derived.readCompletedAt = "2026-10-22T06:03:00.000Z"; },
    f => { f.state.meta.coverage = null; },
    f => { f.state.meta.derived = null; },
  ];
  for (const fault of faults) {
    const f = fixture(); fault(f);
    const result = await f.project(f.records, f.sources);
    assert.equal(result.hourlyStock004.status, "invalid-capture");
    assert.equal(result.hourlyStock004.pageHourlyProducts, 0);
    assert.equal(result.records[0].qtyBranch004, 100);
  }
});

test("capture data is cached, next slot refreshes, and failed lookup does not serve cached evidence", async () => {
  const f = fixture();
  await f.project(f.records, f.sources);
  await f.project(f.records, f.sources);
  assert.equal(f.state.calls.filter(call => call.sql.includes("client_meta->")).length, 1);
  f.state.header = { ...f.state.header, capture_id: "internal-next-fixture" };
  f.state.meta.derived.records[0].derivedOnHand = 42;
  assert.equal((await f.project(f.records, f.sources)).records[0].qtyBranch004, 42);
  f.state.fail = true;
  const failed = await f.project(f.records, f.sources);
  assert.equal(failed.hourlyStock004.status, "unavailable");
  assert.equal(failed.records[0].qtyBranch004, 100);
  assert.ok(!JSON.stringify(failed).includes("private database"));
});

function appFor(f, authorized = true) {
  const app = express();
  app.use(createBranchStockRouter({ ...f,
    requireAuthMiddleware: (req, res, next) => authorized ? next() : res.sendStatus(401),
    requireRoleMiddleware: () => (req, res, next) => next(),
    requireCsrfMiddleware: (req, res, next) => next(),
  }));
  return app;
}

test("existing API stays unchanged; authenticated opt-in page returns calculated stock and original baseline", async () => {
  const f = fixture(); const app = appFor(f);
  const legacy = await request(app).get("/branch-stock").expect(200);
  assert.equal(legacy.body.records[1].qtyBranch004, 100);
  assert.equal(legacy.body.hourlyStock004, undefined);
  assert.equal(f.state.calls.some(call => call.sql.includes("evidence.")), false);
  const displayed = await request(app).get("/branch-stock?stockView=hourly004&limit=10000").expect(200);
  assert.equal(displayed.body.records[1].qtyBranch004, 0);
  assert.equal(displayed.body.records[1].fullSyncQtyBranch004, 100);
  assert.equal(displayed.body.hourlyStock004.pageHourlyProducts, EXPECTED_PRODUCTS);
  await request(appFor(fixture(), false)).get("/branch-stock?stockView=hourly004").expect(401);
});

test("004 Excel export uses the same view with source notes; another branch export never reads evidence", async () => {
  const f = fixture(); const app = appFor(f);
  const result = await request(app).get("/branch-stock/export.xlsx?branchCode=004&stockView=hourly004")
    .buffer(true).parse((res, done) => { const chunks = []; res.on("data", data => chunks.push(data)); res.on("end", () => done(null, Buffer.concat(chunks))); }).expect(200);
  const book = XLSX.read(result.body, { type: "buffer" });
  assert.ok(book.SheetNames.includes("ที่มาสต็อก004"));
  const notes = XLSX.utils.sheet_to_json(book.Sheets["ที่มาสต็อก004"]);
  assert.equal(notes[1]["ยอด Full Sync 004"], 100);
  assert.equal(notes[1]["แหล่งยอด 004"], "hourly-calculated");
  f.state.calls = [];
  await request(app).get("/branch-stock/export.xlsx?branchCode=001&stockView=hourly004").expect(200);
  assert.equal(f.state.calls.some(call => call.sql.includes("evidence.")), false);
});
