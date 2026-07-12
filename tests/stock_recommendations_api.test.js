"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");

const { createApp } = require("../apps/admin-api/src/server");

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
        cost_avg_branch_003: null,
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
        cost_avg_branch_003: null,
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
  };

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

      if (normalized.startsWith("select max(doc_date)::date as latest_date from ada.sales_headers")) {
        return { rowCount: 1, rows: [{ latest_date: new Date("2026-07-12T00:00:00.000Z") }] };
      }

      if (normalized.includes("from ada.branch_stock_snapshots bs") && normalized.includes("order by bs.product_code asc")) {
        const search = String(params[0] || "").toLowerCase();
        const rows = state.stockRows.filter((row) => {
          if (!search) return true;
          return [row.product_code, row.product_name_thai, row.product_name_eng, row.barcode]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(search));
        });
        return { rowCount: rows.length, rows };
      }

      if (normalized.includes("with filtered_sales as (") && normalized.includes("sum(qty) filter")) {
        const branchCodes = Array.isArray(params[0]) ? params[0] : [];
        const productCodes = Array.isArray(params[1]) ? params[1] : [];
        const rows = state.salesAggRows.filter(
          (row) => branchCodes.includes(row.branch_code) && productCodes.includes(row.product_code),
        );
        return { rowCount: rows.length, rows };
      }

      if (normalized.includes("with incoming_lines as (")) {
        const productCodes = Array.isArray(params[0]) ? params[0] : [];
        const rows = state.incomingRows.filter((row) => productCodes.includes(row.product_code));
        return { rowCount: rows.length, rows };
      }

      throw new Error(`Unhandled mock query: ${normalized}`);
    },
    async end() {},
  };

  return db;
}

function createTestApp() {
  const config = buildConfig();
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
  const { app } = createTestApp();
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

  const rows = response.body.rows;
  assert.equal(rows.length, 3);

  const transferRow = rows.find((row) => row.productCode === "P1");
  assert.equal(transferRow.action, "TRANSFER_IN");
  assert.equal(transferRow.transferPlanQty, 35);
  assert.equal(transferRow.purchaseQty, 0);
  assert.equal(transferRow.primarySuggestedDonorBranchCode, "003");

  const purchaseRow = rows.find((row) => row.productCode === "P2");
  assert.equal(purchaseRow.action, "PURCHASE");
  assert.equal(purchaseRow.incomingPoAllocationQty, 5);
  assert.equal(purchaseRow.purchaseQty, 11);

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

test("recommendation detail returns the computed row for one branch/product", async () => {
  const { app } = createTestApp();
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
});
