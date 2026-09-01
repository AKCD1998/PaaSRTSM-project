"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const currentService = require("../apps/admin-api/src/services/stockRecommendations");
const baselineFixture = require("./fixtures/stock_recommendations_legacy_baseline.json");

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function createFixtureDb() {
  const queryLog = [];
  const db = {
    queryLog,
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);
      queryLog.push(normalized);
      if (
        normalized.includes("select branch_code, branch_name, is_hq")
        && normalized.includes("from core.branches")
        && normalized.includes("where is_active = true")
      ) {
        return { rows: [{ branch_code: "001", branch_name: "One", is_hq: false }], rowCount: 1 };
      }
      if (
        normalized.includes("max(anchor_date)::date as latest_anchor_date")
        && normalized.includes("ordering.stock_recommendation_snapshots")
      ) {
        return { rows: [{ latest_anchor_date: null }], rowCount: 1 };
      }
      if (
        normalized.startsWith("select 1")
        && normalized.includes("analytics.product_sales_summary_periods")
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("select max(period_end)::date as latest_date")) {
        return { rows: [{ latest_date: new Date("2026-07-12T00:00:00.000Z") }], rowCount: 1 };
      }
      if (
        normalized.includes("from ada.sales_headers sh")
        && normalized.includes("join ada.sales_lines sl")
      ) {
        return {
          rows: [{ product_code: "P1", branch_code: "001", sold_qty_30d: 3, sold_qty_90d: 9 }],
          rowCount: 1,
        };
      }
      if (
        normalized.includes("select bs.product_code")
        && normalized.includes("from ada.branch_stock_snapshots bs")
        && normalized.includes("coalesce(bs.qty_branch_001")
      ) {
        return { rows: [{ product_code: "P1" }], rowCount: 1 };
      }
      if (
        normalized.includes("select distinct product_code")
        && normalized.includes("from ( select l.product_code from ada.pending_receipt_lines")
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (
        normalized.includes("from ada.branch_stock_snapshots bs")
        && normalized.includes("where bs.product_code = any($1::text[])")
      ) {
        assert.deepEqual(params, [["P1"]]);
        return {
          rows: [{
            product_code: "P1",
            product_name_thai: "หนึ่ง",
            product_name_eng: "One",
            barcode: "111",
            unit: "EA",
            qty_branch_000: 0,
            qty_branch_001: 2,
            qty_branch_002: 0,
            qty_branch_003: 0,
            qty_branch_004: 0,
            qty_branch_005: 0,
            cost_avg_branch_000: null,
            cost_avg_branch_001: null,
            cost_avg_branch_002: null,
            cost_avg_branch_003: null,
            cost_avg_branch_004: null,
            cost_avg_branch_005: null,
            synced_at: "2026-07-12T01:00:00.000Z",
          }],
          rowCount: 1,
        };
      }
      if (normalized.includes("with incoming_lines as (")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unhandled equivalence query: ${normalized}`);
    },
  };
  return db;
}

function stableResponse(value) {
  return {
    ...value,
    generatedAt: "<dynamic>",
  };
}

test("legacy default matches the checked-in origin/main response and SQL fixture without Git history", async () => {
  const currentDb = createFixtureDb();
  const args = {
    auth: { role: "admin" },
    filters: { branchCode: "all", pageSize: 20, sort: "product_code_asc" },
  };
  const current = await currentService.listStockRecommendations({
    db: currentDb,
    config: {},
    ...args,
  });
  assert.equal(baselineFixture.baselineSha, "bbfca5c14cec95c351b9e9a4cdb13b4c7c5683ee");
  assert.deepEqual(stableResponse(current), baselineFixture.response);
  assert.deepEqual(
    currentDb.queryLog.map((sql) => crypto.createHash("sha256").update(sql).digest("hex")),
    baselineFixture.normalizedSqlSha256,
  );
  assert.equal(currentDb.queryLog.some((sql) => sql.includes("branch_stock_current")), false);
  assert.equal("reader" in current.meta, false);
});
