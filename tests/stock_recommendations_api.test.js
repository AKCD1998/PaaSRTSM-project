"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");

const { createApp } = require("../apps/admin-api/src/server");
const { refreshStockRecommendationSnapshots } = require("../apps/admin-api/src/services/stockRecommendations");

function buildConfig() {
  return {
    nodeEnv: "test",
    port: 0,
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    authJwtSecret: "test-jwt-secret",
    cookieName: "admin_session",
    cookieSecure: false,
    cookieSameSite: "lax",
    sessionTtlHours: 12,
    trustProxy: false,
    loginRateLimitMax: 20,
    loginRateLimitWindowMs: 60_000,
    maxUploadBytes: 5 * 1024 * 1024,
    defaultPeriodDays: 30,
    featureStockRequests: true,
    adminUsers: new Set(["admin@example.com"]),
    staffUsers: new Set(["staff003"]),
    branchUsers: new Set(["branch001@example.com"]),
    adminPasswordHash: bcrypt.hashSync("admin-pass-123", 10),
    staffPasswordHash: bcrypt.hashSync("staff-pass-123", 10),
    branchUserBranches: new Map([["branch001@example.com", "001"]]),
    branchUserPasswordHashes: new Map([["branch001@example.com", bcrypt.hashSync("branch-pass-001", 10)]]),
    posApiKeys: new Set(["test-pos-key"]),
  };
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function createMockDb() {
  const state = {
    auditActions: [],
    queryLog: [],
    reconciliationStatus003: "pass",
    comparisonPersistenceFails: false,
    normalizedLoaderFails: false,
    precomputedEnabled: false,
    expiredComparisonCount: 0,
    comparisonLinks: [],
    comparisonRecords: [],
    normalizedCandidateParams: null,
    normalizedCandidateCalls: [],
    normalizedLoaderParams: null,
    normalizedLoaderCalls: [],
    legacyLoaderCalls: [],
    salesAggCalls: [],
    incomingAggCalls: [],
    broadIncomingDiscoveryCount: 0,
    activeBranches: [
      { branch_code: "001", branch_name: "Branch 001", is_active: true, is_hq: false },
      { branch_code: "003", branch_name: "Branch 003", is_active: true, is_hq: false },
    ],
    branchLookup: new Map([
      ["001", { branch_code: "001", branch_name: "Branch 001", is_active: true, is_hq: false }],
      ["003", { branch_code: "003", branch_name: "Branch 003", is_active: true, is_hq: false }],
    ]),
    stockRows: [
      {
        product_code: "P1",
        product_name_thai: "สินค้าตัวที่หนึ่ง",
        product_name_eng: "Product One",
        barcode: "111",
        unit: "ชิ้น",
        qty_branch_000: 0,
        qty_branch_001: 10,
        qty_branch_002: 0,
        qty_branch_003: 100,
        qty_branch_004: 0,
        qty_branch_005: 0,
        cost_avg_branch_000: null,
        cost_avg_branch_001: 10,
        cost_avg_branch_002: null,
        cost_avg_branch_003: 10,
        cost_avg_branch_004: null,
        cost_avg_branch_005: null,
        synced_at: "2026-07-12T01:00:00.000Z",
      },
      {
        product_code: "P2",
        product_name_thai: "สินค้าตัวที่สอง",
        product_name_eng: "Product Two",
        barcode: "222",
        unit: "กล่อง",
        qty_branch_000: 0,
        qty_branch_001: 2,
        qty_branch_002: 0,
        qty_branch_003: 0,
        qty_branch_004: 0,
        qty_branch_005: 0,
        cost_avg_branch_000: null,
        cost_avg_branch_001: 5,
        cost_avg_branch_002: null,
        cost_avg_branch_003: 0,
        cost_avg_branch_004: null,
        cost_avg_branch_005: null,
        synced_at: "2026-07-12T01:00:00.000Z",
      },
      {
        product_code: "P3",
        product_name_thai: "สินค้าหมุนช้า",
        product_name_eng: "Slow Product",
        barcode: "333",
        unit: "ขวด",
        qty_branch_000: 0,
        qty_branch_001: 5,
        qty_branch_002: 0,
        qty_branch_003: 0,
        qty_branch_004: 0,
        qty_branch_005: 0,
        cost_avg_branch_000: null,
        cost_avg_branch_001: 12,
        cost_avg_branch_002: null,
        cost_avg_branch_003: 0,
        cost_avg_branch_004: null,
        cost_avg_branch_005: null,
        synced_at: "2026-07-12T01:00:00.000Z",
      },
    ],
    salesAggRows: [
      { product_code: "P1", branch_code: "001", sold_qty_30d: 15, sold_qty_90d: 45 },
      { product_code: "P1", branch_code: "003", sold_qty_30d: 3, sold_qty_90d: 9 },
      { product_code: "P2", branch_code: "001", sold_qty_30d: 6, sold_qty_90d: 18 },
      { product_code: "P3", branch_code: "001", sold_qty_30d: 0, sold_qty_90d: 0 },
    ],
    incomingRows: [
      { product_code: "P2", incoming_qty_total: 10 },
    ],
    precomputedRow: {
      branch_code: "001",
      branch_label: "Branch 001",
      product_code: "P-CACHED",
      product_name_thai: "Cached product",
      product_name_eng: "Cached product",
      barcode: "CACHED",
      unit: "ชิ้น",
      current_stock: 1,
      unit_cost_avg: 2,
      target_qty: 3,
      action: "PURCHASE",
      recommendation_flags: [],
      donors_json: [],
    },
  };

  for (const stockRow of state.stockRows) {
    Object.assign(stockRow, {
      full_sync_run_id_branch_001: "201",
      full_sync_run_id_branch_003: "203",
      synced_at_branch_001: stockRow.synced_at,
      synced_at_branch_003: stockRow.synced_at,
    });
  }

  state.normalizedRows = state.stockRows.flatMap((stockRow) => (
    ["001", "003"].map((branchCode) => ({
      product_code: stockRow.product_code,
      product_name_thai: stockRow.product_name_thai,
      product_name_eng: stockRow.product_name_eng,
      barcode: stockRow.barcode,
      unit: stockRow.unit,
      branch_code: branchCode,
      eligible_sync_run_id: branchCode === "001" ? "201" : "203",
      stock_product_code: stockRow.product_code,
      qty: stockRow[`qty_branch_${branchCode}`],
      cost_avg: stockRow[`cost_avg_branch_${branchCode}`],
      synced_at: stockRow.synced_at,
      last_full_sync_run_id: branchCode === "001" ? "201" : "203",
    }))
  ));

  const db = {
    state,
    connect() {
      return {
        query: db.query.bind(db),
        async release() {},
      };
    },
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);
      state.queryLog.push(normalized);

      if ([
        "begin",
        "begin isolation level repeatable read read only",
        "commit",
        "rollback",
      ].includes(normalized)) {
        return { rowCount: 0, rows: [] };
      }
      if (normalized === "select txid_current_snapshot()::text as source_snapshot") {
        return { rowCount: 1, rows: [{ source_snapshot: "100:100:" }] };
      }
      if (normalized.startsWith("insert into ordering.stock_recommendation_reader_comparisons")) {
        if (state.comparisonPersistenceFails) throw new Error("synthetic persistence failure");
        state.comparisonRecords.push(params);
        return { rowCount: 1, rows: [] };
      }
      if (normalized.startsWith("delete from ordering.stock_recommendation_reader_comparisons")) {
        const rowCount = state.expiredComparisonCount;
        state.expiredComparisonCount = 0;
        return { rowCount, rows: [] };
      }
      if (normalized.startsWith("update ordering.stock_recommendation_reader_comparisons")) {
        state.comparisonLinks.push(params);
        return { rowCount: 1, rows: [] };
      }
      if (
        normalized.startsWith("delete from ordering.stock_recommendation_snapshots")
        || normalized.startsWith("insert into ordering.stock_recommendation_snapshots")
      ) {
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith("insert into public.audit_logs")) {
        state.auditActions.push(params[2]);
        return {
          rowCount: 1,
          rows: [{ audit_id: state.auditActions.length, event_time: new Date().toISOString() }],
        };
      }

      if (
        normalized.includes("select branch_code, branch_name, is_active, is_hq") &&
        normalized.includes("from core.branches") &&
        normalized.includes("where branch_code = $1")
      ) {
        const row = state.branchLookup.get(String(params[0] || "")) || null;
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }

      if (
        normalized.includes("select branch_code, branch_name, is_hq") &&
        normalized.includes("from core.branches") &&
        normalized.includes("where is_active = true")
      ) {
        return {
          rowCount: state.activeBranches.length,
          rows: state.activeBranches.map((row) => ({
            branch_code: row.branch_code,
            branch_name: row.branch_name,
            is_hq: row.is_hq,
          })),
        };
      }

      if (
        normalized.includes("from core.branches branch")
        && normalized.includes("from ingest.sync_runs run")
      ) {
        return {
          rowCount: state.activeBranches.length,
          rows: state.activeBranches.map((row) => ({
            branch_code: row.branch_code,
            branch_name: row.branch_name,
            is_hq: row.is_hq,
          })),
        };
      }

      if (normalized.includes("with required(branch_code) as (select unnest($1::text[]))")) {
        const mismatchSummary = {
          generationMembership: { matches: true },
          normalizedVsWide: { matches: true },
          normalizedVsWideRows: { mismatchCount: 0 },
        };
        const rows = state.activeBranches.map((branch) => {
          const branchCode = String(branch.branch_code);
          const syncRunId = String(200 + Number(branchCode));
          return {
            branch_code: branchCode, sync_run_id: syncRunId, run_status: "success",
            ingestion_mode: "hybrid_v2", snapshot_mode: "full",
            handoff_status: "success", apply_status: "applied",
            finalized_at: "2026-07-12T01:01:00.000Z", finished_at: "2026-07-12T01:01:00.000Z",
            retirement_status: "done", expected_membership_count: state.stockRows.length,
            actual_membership_count: state.stockRows.length,
            reconciliation_status: branchCode === "003" ? state.reconciliationStatus003 : "pass",
            mismatch_summary: mismatchSummary, generation_row_count: state.stockRows.length,
            min_stock_synced_at: "2026-07-12T01:00:00.000Z",
            max_stock_synced_at: "2026-07-12T01:00:00.000Z",
          };
        });
        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (
        normalized.includes("from ordering.stock_recommendation_snapshots") &&
        normalized.includes("max(anchor_date)::date as latest_anchor_date")
      ) {
        return {
          rowCount: 1,
          rows: [{
            latest_anchor_date: state.precomputedEnabled
              ? new Date("2026-07-12T00:00:00.000Z")
              : null,
          }],
        };
      }

      if (
        normalized.startsWith("select 1") &&
        normalized.includes("from analytics.product_sales_summary_periods") &&
        normalized.includes("period_end = $1::date")
      ) {
        return { rowCount: 0, rows: [] };
      }

      if (
        state.precomputedEnabled
        && normalized.includes("with filtered as (")
        && normalized.includes("count(*)::int as sku_count")
      ) {
        return {
          rowCount: 1,
          rows: [{
            sku_count: 1,
            recommend_transfer_count: 0,
            recommend_purchase_count: 1,
            recommend_mixed_count: 0,
            slow_moving_count: 0,
            current_inventory_value: 2,
            projected_inventory_value_at_target: 6,
            potential_reduction_value: 0,
          }],
        };
      }

      if (
        state.precomputedEnabled
        && normalized.startsWith("select * from ordering.stock_recommendation_snapshots")
      ) {
        return { rowCount: 1, rows: [state.precomputedRow] };
      }

      if (normalized.startsWith("select max(period_end)::date as latest_date from analytics.product_sales_summary_periods")) {
        return { rowCount: 1, rows: [{ latest_date: new Date("2026-07-12T00:00:00.000Z") }] };
      }

      if (normalized.startsWith("select max(doc_date)::date as latest_date from ada.sales_headers")) {
        return { rowCount: 1, rows: [{ latest_date: null }] };
      }

      if (
        normalized.includes("from ordering.stock_recommendation_snapshots") &&
        normalized.includes("count(*)::int as row_count")
      ) {
        return state.precomputedEnabled
          ? { rowCount: 1, rows: [{ row_count: 1, generated_at: "2026-07-12T02:00:00.000Z" }] }
          : { rowCount: 0, rows: [] };
      }

      if (
        normalized.includes("select distinct bs.product_code") &&
        normalized.includes("from ada.branch_stock_snapshots bs")
      ) {
        const search = String(params[0] || "").toLowerCase();
        const rows = state.stockRows.filter((row) => {
          if (!search) return true;
          return [row.product_code, row.product_name_thai, row.product_name_eng, row.barcode]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(search));
        }).map((row) => ({ product_code: row.product_code }));
        return { rowCount: rows.length, rows };
      }

      if (
        normalized.includes("select distinct current.product_code")
        && normalized.includes("from ada.branch_stock_current current")
      ) {
        state.normalizedCandidateParams = params;
        state.normalizedCandidateCalls.push({ sql: normalized, params });
        return {
          rowCount: state.stockRows.length,
          rows: state.stockRows.map((row) => ({ product_code: row.product_code })),
        };
      }

      if (
        normalized.includes("from ada.branch_stock_snapshots bs") &&
        normalized.includes("select bs.product_code") &&
        normalized.includes("coalesce(bs.qty_branch_")
      ) {
        const branchMatches = [...normalized.matchAll(/qty_branch_(\d{3})/g)].map((match) => match[1]);
        const rows = state.stockRows
          .filter((row) => branchMatches.some((branchCode) => Number(row[`qty_branch_${branchCode}`] || 0) > 0))
          .map((row) => ({ product_code: row.product_code }));
        return { rowCount: rows.length, rows };
      }

      if (
        normalized.includes("with candidates(product_code) as")
        && normalized.includes("left join ada.branch_stock_snapshots bs")
        && !normalized.includes("branch_stock_current")
      ) {
        const productCodes = Array.isArray(params[0]) ? params[0] : [];
        const search = String(params[1] || "").toLowerCase();
        const rows = state.stockRows.filter((row) => {
          if (!productCodes.includes(row.product_code)) return false;
          if (!search) return true;
          return [row.product_code, row.product_name_thai, row.product_name_eng, row.barcode]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(search));
        }).map((row) => ({
          product_code: row.product_code,
          product_name_thai: row.product_name_thai,
          product_name_eng: row.product_name_eng,
          barcode: row.barcode,
          unit: row.unit,
        }));
        return { rowCount: rows.length, rows };
      }

      if (
        normalized.includes("with candidates(product_code) as")
        && normalized.includes("left join ada.branch_stock_current current")
      ) {
        state.normalizedLoaderParams = params;
        state.normalizedLoaderCalls.push({ sql: normalized, params });
        if (state.normalizedLoaderFails) throw new Error("synthetic normalized failure");
        const productCodes = Array.isArray(params[0]) ? params[0] : [];
        const rows = state.normalizedRows.filter((row) => productCodes.includes(row.product_code));
        return { rowCount: rows.length, rows };
      }

      if (
        normalized.includes("select distinct product_code") &&
        normalized.includes("from ( select l.product_code from ada.pending_receipt_lines l")
      ) {
        state.broadIncomingDiscoveryCount += 1;
        const rows = state.incomingRows.map((row) => ({ product_code: row.product_code }));
        return { rowCount: rows.length, rows };
      }

      if (
        normalized.includes("from ada.branch_stock_snapshots bs") &&
        normalized.includes("where bs.product_code = any($1::text[])") &&
        normalized.includes("order by bs.product_code asc")
      ) {
        const productCodes = Array.isArray(params[0]) ? params[0] : [];
        state.legacyLoaderCalls.push({ sql: normalized, params });
        const rows = state.stockRows.filter((row) => {
          if (!productCodes.includes(row.product_code)) return false;
          return true;
        });
        return { rowCount: rows.length, rows };
      }

      if (
        normalized.includes("from ada.sales_headers sh") &&
        normalized.includes("join ada.sales_lines sl")
      ) {
        const branchCodes = Array.isArray(params[0]) ? params[0] : [];
        const exactProductCode = params.length >= 5 ? String(params[4]) : null;
        state.salesAggCalls.push({ sql: normalized, params });
        const rows = state.salesAggRows.filter((row) => (
          branchCodes.includes(row.branch_code)
          && (!exactProductCode || row.product_code === exactProductCode)
        ));
        return { rowCount: rows.length, rows };
      }

      if (normalized.includes("with incoming_lines as (")) {
        const productCodes = Array.isArray(params[0]) ? params[0] : [];
        state.incomingAggCalls.push({ sql: normalized, params });
        const rows = state.incomingRows.filter((row) => productCodes.includes(row.product_code));
        return { rowCount: rows.length, rows };
      }

      throw new Error(`Unhandled mock query: ${normalized}`);
    },
    async end() {},
  };

  return db;
}

function createTestApp(configOverrides = {}) {
  const config = { ...buildConfig(), ...configOverrides };
  const db = createMockDb();
  const { app } = createApp({
    config,
    db,
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
  });
  return { app, db };
}

async function loginAs(agent, credentials) {
  const response = await agent.post("/admin/auth/login").send(credentials);
  assert.equal(response.status, 200);
  return response.body.csrf_token;
}

test("GET /api/admin/stock-recommendations requires auth", async () => {
  const { app } = createTestApp();

  const response = await request(app).get("/api/admin/stock-recommendations");
  assert.equal(response.status, 401);
});

test("branch user recommendation list is forced to its own branch scope and returns computed actions", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);

  await loginAs(agent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });

  const response = await agent.get("/api/admin/stock-recommendations?branchCode=all&pageSize=20");
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.branchCode, "001");
  assert.equal(response.body.meta.isAllBranches, false);
  assert.deepEqual(response.body.meta.branchCodesInScope, ["001"]);
  assert.equal("reader" in response.body.meta, false, "legacy response shape stays unchanged");
  assert.equal(
    db.state.queryLog.some((sql) => sql.includes("branch_stock_current") || sql.includes("branch_stock_reconciliations")),
    false,
    "legacy mode never touches normalized evidence or stock",
  );

  const rows = response.body.rows;
  assert.equal(rows.length, 3);

  const transferRow = rows.find((row) => row.productCode === "P1");
  assert.equal(transferRow.action, "TRANSFER_IN");
  assert.equal(transferRow.transferPlanQty, 35);
  assert.equal(transferRow.purchaseQty, 0);
  assert.equal(transferRow.primarySuggestedDonorBranchCode, "003");

  const purchaseRow = rows.find((row) => row.productCode === "P2");
  assert.equal(purchaseRow.action, "PURCHASE");
  // Branch 003 has no sales/shortage for P2, so shortage-weighted allocation
  // (replacing the old equal_split) routes the whole incoming shipment to
  // branch 001, which actually needs it.
  assert.equal(purchaseRow.incomingPoAllocationQty, 10);
  assert.equal(purchaseRow.purchaseQty, 6);

  const slowRow = rows.find((row) => row.productCode === "P3");
  assert.equal(slowRow.action, "NO_PURCHASE_SLOW_MOVING");
  assert.match(slowRow.reason, /90 วันที่ผ่านมาไม่มีการขาย/);
});

test("admin recommendation summary can query all branches", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);

  await loginAs(agent, {
    username: "admin@example.com",
    password: "admin-pass-123",
  });

  const response = await agent.get("/api/admin/stock-recommendations/summary?branchCode=all");
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.branchCode, "all");
  assert.equal(response.body.meta.isAllBranches, true);
  assert.equal(response.body.branches.length, 2);
  assert.equal(response.body.company.skuCountRecommendTransfer, 1);
  assert.equal(response.body.company.skuCountRecommendPurchase, 1);
  assert.equal(typeof response.body.company.currentInventoryValue, "number");
});

test("by-product pivot groups the live-computed rows into one row per product with nested branches", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);

  await loginAs(agent, {
    username: "admin@example.com",
    password: "admin-pass-123",
  });

  const response = await agent.get("/api/admin/stock-recommendations/by-product?branchCode=all&sort=product_code_asc");
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.meta.source, "live");
  assert.deepEqual(response.body.rows.map((row) => row.productCode), ["P1", "P2", "P3"]);

  // P1 has real sales at both branch 001 and 003, so it pivots into a row
  // carrying both branches' recommendations, not just the flattened
  // per-branch rows the plain list endpoint returns.
  const p1 = response.body.rows.find((row) => row.productCode === "P1");
  const p1BranchCodes = p1.branches.map((branch) => branch.branchCode).sort();
  assert.deepEqual(p1BranchCodes, ["001", "003"]);
  const p1Branch001 = p1.branches.find((branch) => branch.branchCode === "001");
  assert.equal(p1Branch001.action, "TRANSFER_IN");
  assert.equal(p1.totalCurrentStock, 10 + 100);
});

test("by-product action filter only returns products where some branch matches, and pagination totals distinct products", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);

  await loginAs(agent, {
    username: "admin@example.com",
    password: "admin-pass-123",
  });

  const response = await agent.get("/api/admin/stock-recommendations/by-product?branchCode=all&action=TRANSFER_IN");
  assert.equal(response.status, 200);
  assert.equal(response.body.rows.length, 1);
  assert.equal(response.body.rows[0].productCode, "P1");
  assert.equal(response.body.pagination.total, 1);
});

test("recommendation detail returns the computed row for one branch/product", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);

  await loginAs(agent, {
    username: "admin@example.com",
    password: "admin-pass-123",
  });

  const response = await agent.get("/api/admin/stock-recommendations/001/P1");
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.branchCode, "001");
  assert.equal(response.body.productCode, "P1");
  assert.equal(response.body.recommendation.productCode, "P1");
  assert.equal(response.body.recommendation.action, "TRANSFER_IN");
  assert.equal(response.body.recommendation.donors[0].branchCode, "003");
  assert.deepEqual(db.state.legacyLoaderCalls.at(-1).params[0], ["P1"]);
  assert.match(db.state.salesAggCalls.at(-1).sql, /sl\.product_code = \$5::text/);
  assert.equal(db.state.salesAggCalls.at(-1).params[4], "P1");
  assert.deepEqual(db.state.incomingAggCalls.at(-1).params[0], ["P1"]);
  assert.equal(db.state.broadIncomingDiscoveryCount, 0);
});

test("normalized reader fails closed with bounded 503 evidence and never queries the wide table", async () => {
  const { app, db } = createTestApp({
    stockRecommendationReaderMode: "normalized",
    stockRecommendationMaxStockAgeHours: 10000,
    stockRecommendationNormalizedCanaryBranches: ["all"],
  });
  db.state.reconciliationStatus003 = "pending";
  const agent = request.agent(app);
  await loginAs(agent, { username: "admin@example.com", password: "admin-pass-123" });

  const response = await agent.get("/api/admin/stock-recommendations?branchCode=all");
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "STOCK_RECOMMENDATION_INPUT_UNAVAILABLE");
  assert.deepEqual(
    response.body.availability.failures.find((item) => item.branchCode === "003"),
    { branchCode: "003", reason: "RECONCILIATION_NOT_PASS", status: "pending" },
  );
  assert.equal(JSON.stringify(response.body).includes("synthetic"), false);
  assert.equal(db.state.queryLog.some((sql) => sql.includes("from ada.branch_stock_snapshots bs")), false);
  assert.ok(db.state.queryLog.includes("rollback"));
});

test("normalized reader serves current-table stock with legacy-compatible visible metadata and traces every generation", async () => {
  const { app, db } = createTestApp({
    stockRecommendationReaderMode: "normalized",
    stockRecommendationMaxStockAgeHours: 10000,
    stockRecommendationNormalizedCanaryBranches: ["all"],
  });
  const agent = request.agent(app);
  await loginAs(agent, { username: "admin@example.com", password: "admin-pass-123" });

  const response = await agent.get("/api/admin/stock-recommendations?branchCode=all&pageSize=20");
  assert.equal(response.status, 200);
  assert.equal(response.body.meta.reader.servedReader, "normalized");
  assert.deepEqual(
    response.body.meta.reader.inputGenerations.map((item) => [item.branchCode, item.syncRunId]),
    [["001", "201"], ["003", "203"]],
  );
  assert.equal(response.body.meta.reader.sourceSnapshot, "100:100:");
  const p1 = response.body.rows.find((row) => row.productCode === "P1");
  assert.deepEqual(
    [p1.productNameThai, p1.productNameEng, p1.barcode, p1.unit],
    ["สินค้าตัวที่หนึ่ง", "Product One", "111", "ชิ้น"],
  );
  const stockSql = db.state.queryLog.find((sql) => (
    sql.includes("with candidates(product_code) as")
    && sql.includes("left join ada.branch_stock_current current")
  ));
  const metadataSql = db.state.queryLog.find((sql) => (
    sql.includes("with candidates(product_code) as")
    && sql.includes("left join ada.branch_stock_snapshots bs")
  ));
  assert.ok(stockSql);
  assert.equal(stockSql.includes("qty_branch_"), false);
  assert.equal(stockSql.includes("branch_stock_snapshots"), false);
  assert.ok(metadataSql);
  assert.equal(metadataSql.includes("qty_branch_"), false);
  assert.equal(metadataSql.includes("branch_stock_current"), false);
  assert.ok(db.state.queryLog.includes("commit"));
});

test("shadow requests serve the exact legacy cache and never run comparison work inline", async () => {
  const { app, db } = createTestApp({ stockRecommendationReaderMode: "shadow" });
  db.state.precomputedEnabled = true;
  const agent = request.agent(app);
  await loginAs(agent, { username: "admin@example.com", password: "admin-pass-123" });

  const response = await agent.get("/api/admin/stock-recommendations?branchCode=all&pageSize=20");
  assert.equal(response.status, 200);
  assert.equal(response.body.meta.reader.servedReader, "legacy");
  assert.equal(response.body.meta.reader.comparisonStatus, "refresh_only");
  assert.equal(response.body.meta.source, "precomputed");
  assert.equal(response.body.rows[0].productCode, "P-CACHED");
  assert.equal(response.body.generatedAt, "2026-07-12T02:00:00.000Z");
  assert.equal(db.state.queryLog.some((sql) => sql.includes("from ada.branch_stock_snapshots bs")), false);
  assert.equal(db.state.queryLog.some((sql) => sql.includes("branch_stock_current")), false);
  assert.equal(db.state.queryLog.includes("begin isolation level repeatable read read only"), false);
});

test("even a 100% shadow sample rate adds no normalized query or transaction to request latency", async () => {
  const { app, db } = createTestApp({
    stockRecommendationReaderMode: "shadow",
    stockRecommendationMaxStockAgeHours: 10000,
    stockRecommendationShadowSampleRate: 1,
    stockRecommendationShadowRetentionDays: 7,
  });
  db.state.precomputedEnabled = true;
  const agent = request.agent(app);
  await loginAs(agent, { username: "admin@example.com", password: "admin-pass-123" });

  const response = await agent.get("/api/admin/stock-recommendations?branchCode=all&pageSize=20");
  assert.equal(response.status, 200);
  assert.equal(response.body.meta.reader.servedReader, "legacy");
  assert.equal(response.body.meta.reader.comparisonStatus, "refresh_only");
  assert.equal(response.body.meta.source, "precomputed");
  assert.equal(response.body.rows[0].productCode, "P-CACHED");
  assert.equal(db.state.queryLog.includes("begin isolation level repeatable read read only"), false);
  assert.equal(db.state.queryLog.some((sql) => sql.includes("branch_stock_current")), false);
  assert.equal(db.state.queryLog.some((sql) => sql.startsWith("insert into ordering.stock_recommendation_reader_comparisons")), false);
});

test("shadow request serving is independent of normalized and evidence persistence availability", async () => {
  const { app, db } = createTestApp({
    stockRecommendationReaderMode: "shadow",
    stockRecommendationMaxStockAgeHours: 10000,
    stockRecommendationShadowSampleRate: 1,
  });
  db.state.normalizedLoaderFails = true;
  db.state.comparisonPersistenceFails = true;
  db.state.precomputedEnabled = true;
  const agent = request.agent(app);
  await loginAs(agent, { username: "branch001@example.com", password: "branch-pass-001" });

  const response = await agent.get("/api/admin/stock-recommendations?branchCode=all&pageSize=20");
  assert.equal(response.status, 200);
  assert.equal(response.body.branchCode, "001");
  assert.equal(response.body.meta.source, "precomputed");
  assert.equal(response.body.rows[0].productCode, "P-CACHED");
  assert.equal(response.body.rows[0].action, "PURCHASE");
  assert.equal(response.body.meta.reader.servedReader, "legacy");
  assert.equal(response.body.meta.reader.comparisonStatus, "refresh_only");
  assert.equal(db.state.queryLog.some((sql) => sql.includes("branch_stock_current")), false);
  assert.equal(db.state.queryLog.includes("rollback"), false);
});

test("shadow refresh compares one snapshot and atomically links evidence to the exact cache batch it writes", async () => {
  const db = createMockDb();
  db.state.expiredComparisonCount = 2;
  const result = await refreshStockRecommendationSnapshots(db, {
    targetDays: 90,
    config: {
      stockRecommendationReaderMode: "shadow",
      stockRecommendationMaxStockAgeHours: 10000,
      stockRecommendationShadowSampleRate: 1,
      stockRecommendationShadowRetentionDays: 7,
    },
  });
  assert.equal(result.source, "live_to_snapshot");
  assert.equal(result.reader.servedReader, "legacy");
  assert.equal(result.reader.comparisonStatus, "match");
  assert.equal(result.reader.evidencePersisted, true);
  assert.deepEqual(db.state.comparisonRecords[0][4], ["001", "003"]);
  assert.equal(db.state.comparisonRecords[0][4].includes("002"), false);
  assert.equal(result.expiredComparisonCount, 2);
  assert.equal(result.shadowEvidenceLinked, true);
  assert.equal(db.state.comparisonLinks.length, 1);
  assert.equal(db.state.comparisonLinks[0][1], result.anchorDate);
  assert.equal(db.state.comparisonLinks[0][2], 90);
  assert.equal(db.state.comparisonLinks[0][3], result.generatedAt);
  assert.equal(db.state.comparisonLinks[0][4], result.rowCount);
  const compareCommit = db.state.queryLog.indexOf("commit");
  const snapshotInsert = db.state.queryLog.findIndex((sql) => (
    sql.startsWith("insert into ordering.stock_recommendation_snapshots")
  ));
  const evidenceLink = db.state.queryLog.findIndex((sql) => (
    sql.startsWith("update ordering.stock_recommendation_reader_comparisons")
  ));
  assert.ok(compareCommit >= 0 && compareCommit < snapshotInsert && snapshotInsert < evidenceLink);
});

test("shadow refresh does not persist a false mismatch for a stale active-branch wide placeholder", async () => {
  const db = createMockDb();
  const legacyPlaceholder = db.state.stockRows.find((row) => row.product_code === "P3");
  legacyPlaceholder.full_sync_run_id_branch_003 = "202";
  legacyPlaceholder.synced_at_branch_003 = "2026-07-11T01:00:00.000Z";
  const normalizedPlaceholder = db.state.normalizedRows.find((row) => (
    row.product_code === "P3" && row.branch_code === "003"
  ));
  Object.assign(normalizedPlaceholder, {
    stock_product_code: null,
    qty: null,
    cost_avg: null,
    synced_at: null,
    last_full_sync_run_id: null,
  });

  const result = await refreshStockRecommendationSnapshots(db, {
    targetDays: 90,
    config: {
      stockRecommendationReaderMode: "shadow",
      stockRecommendationMaxStockAgeHours: 10000,
      stockRecommendationShadowSampleRate: 1,
      stockRecommendationShadowRetentionDays: 7,
    },
  });

  assert.equal(result.reader.comparisonStatus, "match");
  assert.equal(db.state.comparisonRecords[0][3], "match");
  assert.equal(db.state.comparisonRecords[0][5], db.state.comparisonRecords[0][6]);
  const mismatchCounts = JSON.parse(db.state.comparisonRecords[0][7]);
  assert.equal(Object.values(mismatchCounts).every((count) => count === 0), true);
});

test("legacy refresh still prunes expired shadow evidence after shadow is disabled", async () => {
  const db = createMockDb();
  db.state.expiredComparisonCount = 3;
  const result = await refreshStockRecommendationSnapshots(db, {
    targetDays: 90,
    config: { stockRecommendationReaderMode: "legacy" },
  });
  assert.equal(result.expiredComparisonCount, 3);
  assert.equal(result.shadowEvidenceLinked, false);
  assert.equal(db.state.queryLog.some((sql) => sql.includes("branch_stock_current")), false);
  assert.equal(db.state.queryLog.some((sql) => (
    sql.startsWith("insert into ordering.stock_recommendation_reader_comparisons")
  )), false);
});

test("normalized canary selects only 004, bounds candidates to 004, and leaves other branches on legacy", async () => {
  const { app, db } = createTestApp({
    stockRecommendationReaderMode: "normalized",
    stockRecommendationMaxStockAgeHours: 10000,
    stockRecommendationNormalizedCanaryBranches: ["004"],
  });
  const branch004 = { branch_code: "004", branch_name: "Branch 004", is_active: true, is_hq: false };
  db.state.activeBranches.push(branch004);
  db.state.branchLookup.set("004", branch004);
  for (const stockRow of db.state.stockRows) {
    db.state.normalizedRows.push({
      product_code: stockRow.product_code,
      branch_code: "004",
      eligible_sync_run_id: "204",
      stock_product_code: stockRow.product_code,
      qty: stockRow.qty_branch_004,
      cost_avg: stockRow.cost_avg_branch_004,
      synced_at: stockRow.synced_at,
      last_full_sync_run_id: "204",
    });
  }
  db.state.salesAggRows.push({
    product_code: "P1",
    branch_code: "004",
    sold_qty_30d: 30,
    sold_qty_90d: 90,
  });
  const agent = request.agent(app);
  await loginAs(agent, { username: "admin@example.com", password: "admin-pass-123" });

  const selected = await agent.get("/api/admin/stock-recommendations?branchCode=004&pageSize=20");
  assert.equal(selected.status, 200);
  assert.equal(selected.body.meta.reader.servedReader, "normalized");
  assert.deepEqual(db.state.normalizedCandidateParams[0], ["004"]);
  assert.deepEqual(db.state.normalizedLoaderParams[0], ["P1", "P2", "P3"]);
  assert.deepEqual(db.state.normalizedLoaderParams[1], ["001", "003", "004"]);
  assert.equal(db.state.salesAggCalls.at(-1).params.length, 4);
  assert.doesNotMatch(db.state.salesAggCalls.at(-1).sql, /sl\.product_code = \$5::text/);
  const catalogSalesCalls = db.state.salesAggCalls.length;
  const selectedAgain = await agent.get("/api/admin/stock-recommendations?branchCode=004&pageSize=20");
  assert.equal(selectedAgain.status, 200);
  assert.equal(db.state.salesAggCalls.length, catalogSalesCalls);

  const callsBeforeDetail = {
    candidate: db.state.normalizedCandidateCalls.length,
    loader: db.state.normalizedLoaderCalls.length,
    sales: db.state.salesAggCalls.length,
    incoming: db.state.incomingAggCalls.length,
    broadIncoming: db.state.broadIncomingDiscoveryCount,
  };
  // Even a conflicting fuzzy search must not replace the path identity or
  // widen exact-product detail execution to P2/P3, which also have positive
  // stock/sales/incoming fixtures in this test database.
  const detail = await agent.get("/api/admin/stock-recommendations/004/P1?search=P2");
  assert.equal(detail.status, 200);
  assert.equal(detail.body.meta.reader.servedReader, "normalized");
  assert.equal(detail.body.targetDays, 90);
  assert.equal(detail.body.productCode, "P1");
  assert.equal(db.state.normalizedCandidateCalls.length, callsBeforeDetail.candidate);
  assert.equal(db.state.broadIncomingDiscoveryCount, callsBeforeDetail.broadIncoming);
  assert.equal(db.state.normalizedLoaderCalls.length, callsBeforeDetail.loader + 1);
  assert.deepEqual(db.state.normalizedLoaderCalls.at(-1).params[0], ["P1"]);
  assert.deepEqual(db.state.normalizedLoaderCalls.at(-1).params[1], ["001", "003", "004"]);
  assert.equal(db.state.salesAggCalls.length, callsBeforeDetail.sales + 1);
  assert.match(db.state.salesAggCalls.at(-1).sql, /sl\.product_code = \$5::text/);
  assert.equal(db.state.salesAggCalls.at(-1).params[4], "P1");
  assert.equal(db.state.incomingAggCalls.length, callsBeforeDetail.incoming + 1);
  assert.deepEqual(db.state.incomingAggCalls.at(-1).params[0], ["P1"]);
  assert.deepEqual(
    {
      currentStock: detail.body.recommendation.currentStock,
      soldQty30d: detail.body.recommendation.soldQty30d,
      soldQty90d: detail.body.recommendation.soldQty90d,
      adu30: detail.body.recommendation.adu30,
      adu90: detail.body.recommendation.adu90,
      adjustedAdu: detail.body.recommendation.adjustedAdu,
      targetQty: detail.body.recommendation.targetQty,
      shortageQty: detail.body.recommendation.shortageQty,
      transferPlanQty: detail.body.recommendation.transferPlanQty,
      purchaseQty: detail.body.recommendation.purchaseQty,
      action: detail.body.recommendation.action,
    },
    {
      currentStock: 0,
      soldQty30d: 30,
      soldQty90d: 90,
      adu30: 1,
      adu90: 1,
      adjustedAdu: 1,
      targetQty: 90,
      shortageQty: 90,
      transferPlanQty: 90,
      purchaseQty: 0,
      action: "TRANSFER_IN",
    },
  );
  assert.deepEqual(detail.body.recommendation.donors, [{
    branchCode: "003",
    qty: 90,
    daysCoverAfterTransfer: 100,
    branchName: "Branch 003",
  }]);

  const exactSalesCallsAfterFirstDetail = db.state.salesAggCalls.length;
  const repeatedDetail = await agent.get("/api/admin/stock-recommendations/004/P1");
  assert.equal(repeatedDetail.status, 200);
  assert.equal(repeatedDetail.body.productCode, "P1");
  assert.equal(db.state.salesAggCalls.length, exactSalesCallsAfterFirstDetail + 1);
  assert.match(db.state.salesAggCalls.at(-1).sql, /sl\.product_code = \$5::text/);
  assert.equal(db.state.salesAggCalls.at(-1).params[4], "P1");

  db.state.queryLog.length = 0;
  db.state.precomputedEnabled = true;
  const outside = await agent.get("/api/admin/stock-recommendations?branchCode=001&pageSize=20");
  assert.equal(outside.status, 200);
  assert.equal(outside.body.meta.reader.servedReader, "legacy");
  assert.equal(outside.body.meta.reader.selectionStatus, "outside_canary");
  assert.equal(outside.body.meta.source, "precomputed");
  assert.equal(db.state.queryLog.some((sql) => sql.includes("branch_stock_current")), false);
});

test("normalized mode without an explicit canary is fail-safe legacy", async () => {
  const { app, db } = createTestApp({
    stockRecommendationReaderMode: "normalized",
    stockRecommendationMaxStockAgeHours: 10000,
  });
  db.state.precomputedEnabled = true;
  const agent = request.agent(app);
  await loginAs(agent, { username: "admin@example.com", password: "admin-pass-123" });
  const response = await agent.get("/api/admin/stock-recommendations?branchCode=all&pageSize=20");
  assert.equal(response.status, 200);
  assert.equal(response.body.meta.reader.servedReader, "legacy");
  assert.equal(response.body.meta.reader.selectionStatus, "canary_configuration_required");
  assert.equal(db.state.queryLog.some((sql) => sql.includes("branch_stock_current")), false);
});

test("normalized refresh never overwrites the unprovenanced legacy snapshot cache", async () => {
  const db = createMockDb();
  const result = await refreshStockRecommendationSnapshots(db, {
    targetDays: 90,
    config: {
      stockRecommendationReaderMode: "normalized",
      stockRecommendationMaxStockAgeHours: 10000,
      stockRecommendationNormalizedCanaryBranches: ["all"],
    },
  });
  assert.equal(result.reader.servedReader, "normalized");
  assert.equal(result.persistedRowCount, 0);
  assert.equal(result.snapshotWrite, "skipped_normalized_reader_without_provenance");
  assert.equal(
    db.state.queryLog.some((sql) => (
      sql.startsWith("delete from ordering.stock_recommendation_snapshots")
      || sql.startsWith("insert into ordering.stock_recommendation_snapshots")
    )),
    false,
  );
});
