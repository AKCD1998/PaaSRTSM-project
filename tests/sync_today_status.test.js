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

function createMockDb(syncRuns) {
  return {
    async connect() {
      return { query: this.query.bind(this), release: async () => {} };
    },
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);
      if (normalized.startsWith("select 1 from ingest.sync_runs")) {
        const [syncType, datasetTag] = params;
        // The real query also scopes to today's Bangkok date via NOW(); this mock
        // assumes all seeded rows are "today" and only checks type/status/message,
        // since the date-window SQL itself isn't something a JS mock re-verifies.
        const match = syncRuns.some(
          (run) => run.sync_type === syncType && run.status === "success" && run.message.includes(datasetTag),
        );
        return { rows: match ? [{ "?column?": 1 }] : [] };
      }
      throw new Error(`Unhandled mock query: ${normalized}`);
    },
  };
}

test("GET /api/sync/today-status reports true only when a success run for that dataset landed today", async () => {
  const syncRuns = [
    {
      sync_type: "adapos_branch_005",
      status: "success",
      message: "datasets=products,branch_stock,branch_stock_history posted for branch 005.",
    },
  ];
  const db = createMockDb(syncRuns);
  const { app } = createApp({ config: buildConfig(), db });

  const hit = await request(app)
    .get("/api/sync/today-status?branchCode=005&datasetTag=branch_stock_history")
    .set("x-api-key", "test-pos-key");
  assert.equal(hit.status, 200);
  assert.equal(hit.body.hasSuccessToday, true);

  const miss = await request(app)
    .get("/api/sync/today-status?branchCode=005&datasetTag=sales_detail")
    .set("x-api-key", "test-pos-key");
  assert.equal(miss.status, 200);
  assert.equal(miss.body.hasSuccessToday, false);

  const unauthorized = await request(app).get(
    "/api/sync/today-status?branchCode=005&datasetTag=branch_stock_history",
  );
  assert.equal(unauthorized.status, 401);

  const badRequest = await request(app)
    .get("/api/sync/today-status?branchCode=005")
    .set("x-api-key", "test-pos-key");
  assert.equal(badRequest.status, 400);
});
