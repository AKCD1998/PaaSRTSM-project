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
    adminUsers: new Set(["admin@example.com"]),
    staffUsers: new Set(["staff@example.com"]),
    adminPasswordHash: bcrypt.hashSync("admin-pass-123", 10),
    staffPasswordHash: bcrypt.hashSync("staff-pass-123", 10),
    posApiKeys: new Set(["test-pos-key"]),
  };
}

function createMockDb() {
  const state = {
    member: {
      id: "mem_demo_001",
      member_code: "M000001",
      display_name: "สมชาย ใจดี",
      first_name: "สมชาย",
      last_name: "ใจดี",
      phone: "0831234567",
      email: "somchai@example.com",
      sex: null,
      dob: null,
      remark: null,
      thai_id: null,
      current_points: 0,
      created_at: "2026-06-03T09:32:30.691Z",
      updated_at: "2026-06-03T09:32:30.691Z",
    },
  };

  return {
    state,
    connect() {
      return {
        query: this.query.bind(this),
        async release() {},
      };
    },
    async query(sql, params) {
      const normalizedSql = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

      if (normalizedSql.includes("from public.members") && normalizedSql.includes("where id = $1")) {
        if (params[0] !== state.member.id) {
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 1, rows: [state.member] };
      }

      if (normalizedSql.startsWith("update public.members set")) {
        if (params[0] !== state.member.id) {
          return { rowCount: 0, rows: [] };
        }
        state.member = {
          ...state.member,
          display_name: params[1] ?? state.member.display_name,
          phone: params[2] ?? state.member.phone,
          email: params[3] ?? state.member.email,
          sex: params[4] ?? state.member.sex,
          dob: params[5] ?? state.member.dob,
          remark: params[6] ?? state.member.remark,
          updated_at: "2026-06-04T00:00:00.000Z",
        };
        return { rowCount: 1, rows: [state.member] };
      }

      throw new Error(`Unhandled SQL in members_api.test.js: ${normalizedSql}`);
    },
  };
}

function createTestApp() {
  const db = createMockDb();
  const { app } = createApp({
    config: buildConfig(),
    db,
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
  });
  return { app, db };
}

test("members GET endpoint returns member for POS api key", async () => {
  const { app } = createTestApp();

  const response = await request(app)
    .get("/api/members/mem_demo_001")
    .set("x-pos-api-key", "test-pos-key");

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.member.id, "mem_demo_001");
  assert.equal(response.body.member.display_name, "สมชาย ใจดี");
});

test("members PUT endpoint updates supported profile fields", async () => {
  const { app, db } = createTestApp();

  const response = await request(app)
    .put("/api/members/mem_demo_001")
    .set("x-pos-api-key", "test-pos-key")
    .send({
      name: "สมชาย ใหม่",
      phone: "0810000000",
      email: "new@example.com",
      sex: "M",
      dob: "1990-01-02",
      remark: "updated by pos",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.member.display_name, "สมชาย ใหม่");
  assert.equal(response.body.member.phone, "0810000000");
  assert.equal(response.body.member.email, "new@example.com");
  assert.equal(response.body.member.sex, "M");
  assert.equal(response.body.member.dob, "1990-01-02");
  assert.equal(response.body.member.remark, "updated by pos");
  assert.equal(db.state.member.display_name, "สมชาย ใหม่");
});

test("members endpoints require POS api key", async () => {
  const { app } = createTestApp();

  const response = await request(app).get("/api/members/mem_demo_001");

  assert.equal(response.status, 401);
});

test("members PUT validates dob format", async () => {
  const { app } = createTestApp();

  const response = await request(app)
    .put("/api/members/mem_demo_001")
    .set("x-pos-api-key", "test-pos-key")
    .send({
      dob: "02/01/1990",
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "dob must be in YYYY-MM-DD format");
});
