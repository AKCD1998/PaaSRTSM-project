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

const PRODUCT_ROW = {
  barcode: "8850999012345",
  product_code: "IC-005089",
  name_th: "โค้กกระป๋อง",
  name_en: "Coke Can",
  unit_small: "แผง",
  factor_small: "1",
  unit_medium: "โหล",
  factor_medium: "12",
  unit_large: "กล่อง",
  factor_large: "48",
  branch_qty: "120",
  qty_total_all_branches: "223",
  branch_cost: "8.10",
};

const EFFECTIVE_PRICE_ROWS = [
  {
    channel: "retail",
    unit_size: "S",
    price_level: 1,
    price_amount: "20.00",
    price_source: "override",
    unit_name: "แผง",
    factor: "1",
    allow_branch_override: true,
    source_updated_at: "2026-04-22T20:36:49+07:00",
    source_synced_at: "2026-06-23T11:48:00.000Z",
  },
  {
    channel: "retail",
    unit_size: "M",
    price_level: 1,
    price_amount: "300.00",
    price_source: "master",
    unit_name: "โหล",
    factor: "12",
    allow_branch_override: true,
    source_updated_at: null,
    source_synced_at: "2026-06-23T11:48:00.000Z",
  },
  {
    channel: "retail",
    unit_size: "L",
    price_level: 1,
    price_amount: "1180.00",
    price_source: "master",
    unit_name: "กล่อง",
    factor: "48",
    allow_branch_override: true,
    source_updated_at: null,
    source_synced_at: "2026-06-23T11:48:00.000Z",
  },
  {
    channel: "wholesale",
    unit_size: "L",
    price_level: 4,
    price_amount: "1100.00",
    price_source: "master",
    unit_name: "กล่อง",
    factor: "48",
    allow_branch_override: true,
    source_updated_at: null,
    source_synced_at: "2026-06-23T11:48:00.000Z",
  },
];

function createMockDb() {
  async function query(sql, params = []) {
    const n = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

    if (n === "begin" || n === "commit" || n === "rollback") return { rowCount: 0, rows: [] };
    if (n.startsWith("insert into public.audit_logs")) return { rowCount: 1, rows: [{ audit_id: 1 }] };

    if (n.includes("from ordering.enrolled_devices") && n.includes("where enrollment_id = $1")) {
      if (String(params[0]) === "99") {
        return {
          rowCount: 1,
          rows: [{
            enrollment_id: 99,
            device_id: "test-device",
            branch_code: "001",
            staff_id: 10,
            role: "sales",
            revoked_at: null,
            expires_at: new Date(Date.now() + 86400_000),
          }],
        };
      }
      if (String(params[0]) === "88") {
        return {
          rowCount: 1,
          rows: [{
            enrollment_id: 88,
            device_id: "mgr-device",
            branch_code: "001",
            staff_id: 11,
            role: "manager",
            revoked_at: null,
            expires_at: new Date(Date.now() + 86400_000),
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    }

    if (n.includes("from ada.product_barcodes pb") && n.includes("where pb.barcode = $1")) {
      if (params[0] === PRODUCT_ROW.barcode && params[1] === "001") {
        return { rowCount: 1, rows: [PRODUCT_ROW] };
      }
      return { rowCount: 0, rows: [] };
    }

    if (n.includes("from ada.product_effective_branch_prices") && n.includes("where branch_code = $1")) {
      if (params[0] !== "001" || params[1] !== PRODUCT_ROW.product_code) {
        return { rowCount: 0, rows: [] };
      }
      const isManager = Boolean(params[2]);
      return {
        rowCount: isManager ? EFFECTIVE_PRICE_ROWS.length : 3,
        rows: isManager
          ? EFFECTIVE_PRICE_ROWS
          : EFFECTIVE_PRICE_ROWS.filter((row) => row.channel === "retail"),
      };
    }

    throw new Error(`Unhandled mock query: ${n}`);
  }

  return {
    query,
    connect() {
      return { query, async release() {} };
    },
    async end() {},
  };
}

function createTestApp(configOverrides = {}) {
  const config = buildConfig(configOverrides);
  const db = createMockDb();
  const { app: baseApp } = createApp({
    config,
    db,
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
  });
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(baseApp);
  return { app, config };
}

function salesToken(config) {
  const jwt = require("jsonwebtoken");
  return jwt.sign(
    {
      sub: "10",
      kind: "mobile",
      role: "sales",
      branch_code: "001",
      enrollment_id: 99,
      device_id: "test-device",
    },
    config.authJwtSecret,
    { expiresIn: "24h" },
  );
}

function managerToken(config) {
  const jwt = require("jsonwebtoken");
  return jwt.sign(
    {
      sub: "11",
      kind: "mobile",
      role: "manager",
      branch_code: "001",
      enrollment_id: 88,
      device_id: "mgr-device",
    },
    config.authJwtSecret,
    { expiresIn: "24h" },
  );
}

test("GET /api/mobile/products/by-barcode returns branch-scoped retail prices for sales token", async () => {
  const { app, config } = createTestApp();
  const token = salesToken(config);

  const res = await request(app)
    .get(`/api/mobile/products/by-barcode/${PRODUCT_ROW.barcode}`)
    .set("authorization", `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.barcode, PRODUCT_ROW.barcode);
  assert.equal(res.body.branchCode, "001");
  assert.equal(res.body.productCode, PRODUCT_ROW.product_code);
  assert.equal(res.body.nameTh, PRODUCT_ROW.name_th);
  assert.equal(res.body.retailPrice, 20);
  assert.equal(res.body.unitPrices.length, 3);
  assert.deepEqual(res.body.unitPrices.map((row) => row.unitSize), ["S", "M", "L"]);
  assert.equal(res.body.unitPrices[0].priceSource, "override");
  assert.equal(res.body.stockByBranch["001"], 120);
  assert.equal(res.body.stockByBranch["000"], undefined);
  assert.equal(res.body.costByBranch, undefined);
});

test("GET /api/pda/products/scan returns wholesale and branch cost for manager token", async () => {
  const { app, config } = createTestApp();
  const token = managerToken(config);

  const res = await request(app)
    .get(`/api/pda/products/scan?barcode=${PRODUCT_ROW.barcode}`)
    .set("authorization", `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.unitPrices.length, 4);
  assert.equal(res.body.unitPrices[3].channel, "wholesale");
  assert.equal(res.body.unitPrices[3].priceLevel, 4);
  assert.ok(res.body.costByBranch);
  assert.equal(res.body.costByBranch["001"], 8.1);
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

test("mobile and pda product endpoints 404 when FEATURE_MOBILE_PDA is off", async () => {
  const { app, config } = createTestApp({ featureMobilePda: false });
  const token = salesToken(config);

  const mobileRes = await request(app)
    .get(`/api/mobile/products/by-barcode/${PRODUCT_ROW.barcode}`)
    .set("authorization", `Bearer ${token}`);
  assert.equal(mobileRes.status, 404);

  const pdaRes = await request(app)
    .get(`/api/pda/products/scan?barcode=${PRODUCT_ROW.barcode}`)
    .set("authorization", `Bearer ${token}`);
  assert.equal(pdaRes.status, 404);
});
