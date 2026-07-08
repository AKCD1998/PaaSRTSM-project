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
    adminUsers: new Set(["admin@example.com"]),
    staffUsers: new Set(),
    adminPasswordHash: bcrypt.hashSync("admin-pass-123", 10),
    staffPasswordHash: bcrypt.hashSync("staff-pass-123", 10),
    posApiKeys: new Set(["test-pos-key"]),
  };
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

async function loginAsAdmin(agent) {
  const response = await agent.post("/admin/auth/login").send({
    username: "admin@example.com",
    password: "admin-pass-123",
  });
  assert.equal(response.status, 200);
  return response.body.csrf_token;
}

function createMockDb() {
  return {
    async connect() {
      return { query: this.query.bind(this), release: async () => {} };
    },
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);

      // The wide sold-qty summary query. Assert it drives the product list
      // from ada.branch_stock_snapshots (the bug fix), never ada.products.
      if (normalized.includes("from product_master pm") && normalized.includes("select *, count(*) over()")) {
        assert.ok(
          normalized.includes("from ada.branch_stock_snapshots bss"),
          "product list must be driven by ada.branch_stock_snapshots, not ada.products",
        );
        const rows = [
          {
            product_code: "IC-002604",
            product_name: "เภสัช ดูโอเซท 10 เม็ด",
            product_name_thai: "เภสัช ดูโอเซท 10 เม็ด",
            product_name_eng: null,
            barcode: "8850769018431",
            unit: "แผง",
            qty_total: 15,
            qty_branch_000: 0,
            qty_branch_001: 5,
            qty_branch_003: 0,
            qty_branch_004: 0,
            qty_branch_005: 10,
            total_count: 2,
          },
          {
            product_code: "630010001",
            product_name: "630010001",
            product_name_thai: null,
            product_name_eng: null,
            barcode: null,
            unit: null,
            qty_total: 0,
            qty_branch_000: 0,
            qty_branch_001: 0,
            qty_branch_003: 0,
            qty_branch_004: 0,
            qty_branch_005: 0,
            total_count: 2,
          },
        ];
        return { rowCount: rows.length, rows };
      }

      if (normalized.startsWith("select branch_code, min(doc_date)")) {
        const rows = [
          { branch_code: "001", earliest_date: "2026-05-01", latest_date: "2026-07-07", bill_count: 100 },
          { branch_code: "005", earliest_date: "2026-05-01", latest_date: "2026-07-07", bill_count: 5034 },
        ];
        return { rowCount: rows.length, rows };
      }

      if (normalized.startsWith("select sh.branch_code, sh.doc_no as bill_no")) {
        const [branchCode, productCode, , , sqlLimit] = params;
        if (productCode === "IC-MANYBILLS") {
          // Simulate a hot-selling product with more bills than the cap —
          // the mock DB honors LIMIT $5 just like real Postgres would, so
          // the route's own truncation logic (slice to BILLS_CAP, set
          // truncated=true) is what's actually under test here.
          const manyRows = Array.from({ length: 600 }, (_, i) => ({
            branch_code: "005",
            bill_no: `S${String(i).padStart(4, "0")}`,
            sale_date: "2026-07-01",
            sale_time: "10:00:00",
            cashier_code: null,
            customer_code: null,
            line_count: 1,
            qty_total: 1,
            net_amount_total: 10,
            unit_name: null,
            product_name: null,
          })).slice(0, sqlLimit);
          return { rowCount: manyRows.length, rows: manyRows };
        }
        assert.equal(productCode, "IC-002604");
        const allBills = [
          { branch_code: "001", bill_no: "S001-01", sale_date: "2026-07-05", sale_time: "10:00:00", cashier_code: "u1", customer_code: null, line_count: 1, qty_total: 5, net_amount_total: 100, unit_name: "แผง", product_name: "เภสัช ดูโอเซท 10 เม็ด" },
          { branch_code: "005", bill_no: "S005-01", sale_date: "2026-07-06", sale_time: "12:00:00", cashier_code: "u2", customer_code: null, line_count: 1, qty_total: 10, net_amount_total: 200, unit_name: "แผง", product_name: "เภสัช ดูโอเซท 10 เม็ด" },
        ];
        const rows = branchCode ? allBills.filter((b) => b.branch_code === branchCode) : allBills;
        return { rowCount: rows.length, rows };
      }

      throw new Error(`Unhandled mock query: ${normalized}`);
    },
  };
}

function createTestApp() {
  const db = createMockDb();
  const { app } = createApp({ config: buildConfig(), db });
  return { app, db };
}

test("branch-product-sales returns a wide row per product across branches, no branch_code required", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const response = await agent.get("/api/admin/branch-product-sales?date_from=2026-07-01&date_to=2026-07-07");
  assert.equal(response.status, 200);
  assert.equal(response.body.products.length, 2);
  const duocetz = response.body.products.find((p) => p.product_code === "IC-002604");
  assert.equal(duocetz.qty_branch_001, 5);
  assert.equal(duocetz.qty_branch_005, 10);
  assert.equal(duocetz.qty_total, 15);
  // Zero-sale product still shows up as an explicit 0, not omitted.
  const zeroSale = response.body.products.find((p) => p.product_code === "630010001");
  assert.equal(zeroSale.qty_total, 0);
});

test("sales-sync-coverage reports per-branch earliest/latest synced date, independent of any date filter", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const response = await agent.get("/api/admin/sales-sync-coverage");
  assert.equal(response.status, 200);
  const coverage005 = response.body.data_coverage_by_branch.find((c) => c.branch_code === "005");
  assert.equal(coverage005.earliest_date, "2026-05-01");
  assert.equal(coverage005.latest_date, "2026-07-07");
  assert.equal(coverage005.bill_count, 5034);
});

test("branch-product-sales bills drilldown shows all branches when branch_code is omitted, or one branch when given", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const allBranches = await agent.get("/api/admin/branch-product-sales/IC-002604/bills?date_from=2026-07-01&date_to=2026-07-07");
  assert.equal(allBranches.status, 200);
  assert.equal(allBranches.body.bills.length, 2);

  const oneBranch = await agent.get("/api/admin/branch-product-sales/IC-002604/bills?branch_code=005&date_from=2026-07-01&date_to=2026-07-07");
  assert.equal(oneBranch.status, 200);
  assert.equal(oneBranch.body.bills.length, 1);
  assert.equal(oneBranch.body.bills[0].branch_code, "005");
});

test("branch-product-sales bills drilldown caps at 500 rows for a hot-selling product", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const response = await agent.get("/api/admin/branch-product-sales/IC-MANYBILLS/bills?date_from=2026-07-01&date_to=2026-07-07");
  assert.equal(response.status, 200);
  assert.equal(response.body.bills.length, 500);
  assert.equal(response.body.truncated, true);
  assert.equal(response.body.cap, 500);
});
