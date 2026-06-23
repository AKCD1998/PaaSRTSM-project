"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const express = require("express");
const cookieParser = require("cookie-parser");
const request = require("supertest");

const { createApp } = require("../apps/admin-api/src/server");

function buildConfig(overrides = {}) {
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
    loginRateLimitMax: 50,
    loginRateLimitWindowMs: 60_000,
    maxUploadBytes: 5 * 1024 * 1024,
    defaultPeriodDays: 30,
    featureStockRequests: true,
    featureMobilePda: true,
    mobileEnrollCodeTtlSeconds: 60,
    mobileTokenTtlHours: 24,
    adminUsers: new Set(["admin@example.com"]),
    staffUsers: new Set(),
    branchUsers: new Set(["branch001@example.com"]),
    adminPasswordHash: bcrypt.hashSync("admin-pass-123", 10),
    staffPasswordHash: "",
    branchUserBranches: new Map([["branch001@example.com", "001"]]),
    branchUserPasswordHashes: new Map([
      ["branch001@example.com", bcrypt.hashSync("branch-pass-001", 10)],
    ]),
    posApiKeys: new Set(),
    ...overrides,
  };
}

// Product fixtures
const PRODUCT_ROW = {
  barcode: "8850999012345",
  product_code: "630010001",
  name_th: "พาราเซตามอล 500 มก.",
  name_en: "Paracetamol 500mg",
  unit: "TAB",
  price_id: 1,
  retail_price: "12.50",
  qty_branch_000: "50", qty_branch_001: "120", qty_branch_002: "0",
  qty_branch_003: "30", qty_branch_004: "15", qty_branch_005: "8",
  qty_total_all_branches: "223",
  cost_avg_branch_000: "8.20", cost_avg_branch_001: "8.10", cost_avg_branch_002: null,
  cost_avg_branch_003: "8.30", cost_avg_branch_004: "8.25", cost_avg_branch_005: "8.15",
};

const TIER_ROWS = [
  { tier: 2, price: "11.00" },
  { tier: 3, price: "10.00" },
];

function createMockDb() {
  async function query(sql, params = []) {
    const n = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

    if (n === "begin" || n === "commit" || n === "rollback") return { rowCount: 0, rows: [] };

    if (n.startsWith("insert into public.audit_logs")) return { rowCount: 1, rows: [{ audit_id: 1 }] };

    // enrolled_devices lookup (requireMobileToken)
    if (n.includes("from ordering.enrolled_devices") && n.includes("where enrollment_id = $1")) {
      if (String(params[0]) === "99") {
        return {
          rowCount: 1,
          rows: [{
            enrollment_id: 99, device_id: "test-device", branch_code: "001",
            staff_id: 10, role: "sales", revoked_at: null,
            expires_at: new Date(Date.now() + 86400_000),
          }],
        };
      }
      if (String(params[0]) === "88") {
        return {
          rowCount: 1,
          rows: [{
            enrollment_id: 88, device_id: "mgr-device", branch_code: "001",
            staff_id: 11, role: "manager", revoked_at: null,
            expires_at: new Date(Date.now() + 86400_000),
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    }

    // by-barcode main query
    if (n.includes("from public.barcodes b") && n.includes("where b.barcode = $1")) {
      if (params[0] === PRODUCT_ROW.barcode) return { rowCount: 1, rows: [PRODUCT_ROW] };
      return { rowCount: 0, rows: [] };
    }

    // price tiers
    if (n.includes("from public.sku_unit_price_tiers") && n.includes("where sku_unit_price_id = $1")) {
      if (Number(params[0]) === 1) return { rowCount: 2, rows: TIER_ROWS };
      return { rowCount: 0, rows: [] };
    }

    throw new Error(`Unhandled mock query: ${n}`);
  }

  return {
    query,
    connect() { return { query, async release() {} }; },
    async end() {},
  };
}

function makeToken(jwt, secret, payload) {
  return jwt.sign(payload, secret, { expiresIn: "24h" });
}

function createTestApp() {
  const config = buildConfig();
  const db = createMockDb();
  const { app: baseApp } = createApp({ config, db, runImporter: async () => ({}), runExcelPriceImporter: async () => ({}), runRuleApplication: async () => ({}) });
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(baseApp);
  return { app, config };
}

function salesToken(config) {
  const jwt = require("jsonwebtoken");
  return jwt.sign({ sub: "10", kind: "mobile", role: "sales", branch_code: "001", enrollment_id: 99, device_id: "test-device" }, config.authJwtSecret, { expiresIn: "24h" });
}

function managerToken(config) {
  const jwt = require("jsonwebtoken");
  return jwt.sign({ sub: "11", kind: "mobile", role: "manager", branch_code: "001", enrollment_id: 88, device_id: "mgr-device" }, config.authJwtSecret, { expiresIn: "24h" });
}

test("GET /api/mobile/products/by-barcode returns product for sales token (no cost)", async () => {
  const { app, config } = createTestApp();
  const token = salesToken(config);

  const res = await request(app)
    .get(`/api/mobile/products/by-barcode/${PRODUCT_ROW.barcode}`)
    .set("authorization", `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.barcode, PRODUCT_ROW.barcode);
  assert.equal(res.body.productCode, "630010001");
  assert.equal(res.body.nameTh, "พาราเซตามอล 500 มก.");
  assert.equal(res.body.retailPrice, 12.5);
  assert.equal(res.body.priceTiers.length, 2);
  assert.equal(res.body.priceTiers[0].tier, 2);
  assert.equal(res.body.stockByBranch["001"], 120);
  assert.equal(res.body.stockByBranch.total, 223);
  // sales must NOT see cost
  assert.equal(res.body.costByBranch, undefined);
});

test("GET /api/mobile/products/by-barcode returns costByBranch for manager token", async () => {
  const { app, config } = createTestApp();
  const token = managerToken(config);

  const res = await request(app)
    .get(`/api/mobile/products/by-barcode/${PRODUCT_ROW.barcode}`)
    .set("authorization", `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.ok(res.body.costByBranch, "manager should see costByBranch");
  assert.equal(res.body.costByBranch["000"], 8.2);
  assert.equal(res.body.costByBranch["002"], null);
});

test("GET /api/mobile/products/by-barcode returns 404 for unknown barcode", async () => {
  const { app, config } = createTestApp();
  const token = salesToken(config);

  const res = await request(app)
    .get("/api/mobile/products/by-barcode/0000000000000")
    .set("authorization", `Bearer ${token}`);

  assert.equal(res.status, 404);
});

test("GET /api/mobile/products/by-barcode returns 401 without token", async () => {
  const { app } = createTestApp();
  const res = await request(app).get(`/api/mobile/products/by-barcode/${PRODUCT_ROW.barcode}`);
  assert.equal(res.status, 401);
});

test("mobile endpoint 404 when FEATURE_MOBILE_PDA is off", async () => {
  const config = buildConfig({ featureMobilePda: false });
  const db = createMockDb();
  const { app: baseApp } = createApp({ config, db, runImporter: async () => ({}), runExcelPriceImporter: async () => ({}), runRuleApplication: async () => ({}) });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(baseApp);

  const res = await request(app).get(`/api/mobile/products/by-barcode/${PRODUCT_ROW.barcode}`);
  assert.equal(res.status, 404);
});
