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
    staffUsers: new Set(["staff@example.com"]),
    adminPasswordHash: bcrypt.hashSync("admin-pass-123", 10),
    staffPasswordHash: bcrypt.hashSync("staff-pass-123", 10),
    posApiKeys: new Set(["test-pos-key"]),
  };
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function createBranchStockMockDb() {
  const state = {
    snapshots: new Map(),
    txLog: [],
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

      if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
        state.txLog.push(normalized);
        return { rowCount: 0, rows: [] };
      }

      if (normalized.startsWith("insert into public.audit_logs")) {
        return {
          rowCount: 1,
          rows: [{ audit_id: 1, event_time: new Date().toISOString() }],
        };
      }

      if (normalized.startsWith("insert into ada.branch_stock_snapshots")) {
        state.snapshots.set(params[0], {
          product_code: params[0],
          product_name_thai: params[1],
          product_name_eng: params[2],
          barcode: params[3],
          unit: params[4],
          qty_branch_000: params[5],
          qty_branch_001: params[6],
          qty_branch_002: params[7],
          qty_branch_003: params[8],
          qty_branch_004: params[9],
          qty_branch_005: params[10],
          qty_total_all_branches: params[11],
          synced_at: params[12],
        });
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith("select count(*)::int as total from ada.branch_stock_snapshots")) {
        const search = String(params[0] || "").toLowerCase();
        const matches = [...state.snapshots.values()].filter((row) => {
          if (!search) return true;
          return [
            row.product_code,
            row.product_name_thai,
            row.product_name_eng,
            row.barcode,
          ]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(search));
        });
        return { rowCount: 1, rows: [{ total: matches.length }] };
      }

      if (normalized.startsWith("select product_code, product_name_thai")) {
        const search = String(params[0] || "").toLowerCase();
        const limit = Number(params[1]);
        const offset = Number(params[2]);
        const rows = [...state.snapshots.values()]
          .filter((row) => {
            if (!search) return true;
            return [
              row.product_code,
              row.product_name_thai,
              row.product_name_eng,
              row.barcode,
            ]
              .filter(Boolean)
              .some((field) => String(field).toLowerCase().includes(search));
          })
          .sort((left, right) => left.product_code.localeCompare(right.product_code))
          .slice(offset, offset + limit);
        return { rowCount: rows.length, rows };
      }

      throw new Error(`Unhandled mock query: ${normalized}`);
    },
    async end() {},
  };

  return db;
}

function createTestApp() {
  const db = createBranchStockMockDb();
  const { app } = createApp({
    config: buildConfig(),
    db,
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
  });
  return { app, db };
}

async function loginAsAdmin(agent) {
  const response = await agent.post("/admin/auth/login").send({
    username: "admin@example.com",
    password: "admin-pass-123",
  });
  assert.equal(response.status, 200);
}

test("branch stock sync and listing routes work on the shared backend", async () => {
  const { app, db } = createTestApp();

  const syncResponse = await request(app)
    .post("/api/branch-stock/sync")
    .set("x-api-key", "test-pos-key")
    .send({
      records: [
        {
          product_code: "630010001",
          product_name_thai: "เซทิริซีน",
          product_name_eng: "Cetirizine",
          barcode: "885000000001",
          unit: "BOX",
          qty_branch_000: 10,
          qty_branch_001: 5,
          qty_branch_002: 3,
          qty_branch_003: 4,
          qty_branch_004: 2,
          qty_branch_005: 8,
          qty_total_all_branches: 32,
          synced_at: "2026-05-25T08:00:00.000Z",
        },
      ],
    });

  assert.equal(syncResponse.status, 200);
  assert.equal(syncResponse.body.accepted, 1);
  assert.equal(syncResponse.body.insertedOrUpdated, 1);
  assert.equal(db.state.snapshots.size, 1);

  const legacySyncResponse = await request(app)
    .post("/api/sync/ada/branch-stock")
    .set("x-api-key", "test-pos-key")
    .send({
      records: [
        {
          product_code: "630010002",
          product_name_thai: "ลอราทาดีน",
          product_name_eng: "Loratadine",
          barcode: "885000000002",
          unit: "BOX",
          qty_branch_000: 1,
          qty_branch_001: 2,
          qty_branch_002: 0,
          qty_branch_003: 3,
          qty_branch_004: 4,
          qty_branch_005: 5,
          qty_total_all_branches: 15,
          synced_at: "2026-05-25T08:05:00.000Z",
        },
      ],
    });

  assert.equal(legacySyncResponse.status, 200);
  assert.equal(legacySyncResponse.body.accepted, 1);
  assert.equal(db.state.snapshots.size, 2);

  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const listResponse = await agent.get("/api/branch-stock?search=loratadine&limit=25&offset=0");
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.body.records.length, 1);
  assert.equal(listResponse.body.records[0].productCode, "630010002");
  assert.equal(listResponse.body.records[0].qtyBranch002, 0);
  assert.equal(listResponse.body.pagination.total, 1);

  assert.deepEqual(db.state.txLog, ["begin", "commit", "begin", "commit"]);
});
