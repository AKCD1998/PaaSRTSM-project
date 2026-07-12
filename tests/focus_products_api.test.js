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
    loginRateLimitMax: 50,
    loginRateLimitWindowMs: 60_000,
    maxUploadBytes: 5 * 1024 * 1024,
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

function createMockDb() {
  const state = {
    nextId: 2,
    rows: new Map([
      [1, {
        id: 1,
        product_code: "IC-005834",
        focus_type: "salesperson",
        target_qty: "20",
        date_from: "2026-07-01",
        date_to: "2026-07-31",
        branch_codes: null,
        note: "โปรโมชั่นเดือนกรกฎาคม",
        is_active: true,
        created_by: "admin@example.com",
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z",
      }],
    ]),
  };

  const db = {
    state,
    connect() {
      return { query: db.query.bind(db), async release() {} };
    },
    async query(sql, params = []) {
      const q = normalizeSql(sql);

      if (q.startsWith("select * from focus.focus_products where is_active = true order by created_at desc")) {
        return { rowCount: state.rows.size, rows: [...state.rows.values()].filter((r) => r.is_active) };
      }
      if (q.startsWith("select * from focus.focus_products order by created_at desc")) {
        return { rowCount: state.rows.size, rows: [...state.rows.values()] };
      }
      if (q.startsWith("select * from focus.focus_products where id = $1")) {
        const row = state.rows.get(Number(params[0]));
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }
      if (q.startsWith("select branch_code from core.branches where is_active = true")) {
        return { rowCount: 3, rows: [{ branch_code: "001" }, { branch_code: "003" }, { branch_code: "005" }] };
      }
      if (q.includes("unnest($1::text[])")) {
        return { rowCount: 1, rows: [{ product_code: params[0][0], product_name: "สาบัญ ทูน่า วิ๊ส" }] };
      }
      if (q.includes("from ada.sales_lines sl")) {
        return { rowCount: 2, rows: [{ branch_code: "001", sold_qty: "10" }, { branch_code: "003", sold_qty: "5" }] };
      }
      if (q.startsWith("insert into focus.focus_products")) {
        const id = state.nextId++;
        const row = {
          id,
          product_code: params[0],
          focus_type: params[1],
          target_qty: String(params[2]),
          date_from: params[3],
          date_to: params[4],
          branch_codes: params[5],
          note: params[6],
          is_active: true,
          created_by: params[7],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        state.rows.set(id, row);
        return { rowCount: 1, rows: [{ id }] };
      }
      if (q.startsWith("update focus.focus_products set product_code")) {
        const id = Number(params[0]);
        const row = state.rows.get(id);
        if (row) {
          Object.assign(row, {
            product_code: params[1],
            focus_type: params[2],
            target_qty: String(params[3]),
            date_from: params[4],
            date_to: params[5],
            branch_codes: params[6],
            note: params[7],
            is_active: params[8],
            updated_at: new Date().toISOString(),
          });
        }
        return { rowCount: row ? 1 : 0, rows: [] };
      }
      if (q.startsWith("update focus.focus_products set is_active = false")) {
        const id = Number(params[0]);
        const row = state.rows.get(id);
        if (row) row.is_active = false;
        return { rowCount: row ? 1 : 0, rows: [] };
      }

      throw new Error(`Unhandled mock query: ${q}`);
    },
    async end() {},
  };

  return db;
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

async function loginAs(agent, username = "admin@example.com", password = "admin-pass-123") {
  const response = await agent.post("/admin/auth/login").send({ username, password });
  assert.equal(response.status, 200);
  return response.body.csrf_token;
}

test("GET /api/focus-products requires auth but no specific role", async () => {
  const { app } = createTestApp();

  const unauth = await request(app).get("/api/focus-products");
  assert.equal(unauth.status, 401);

  const staff = request.agent(app);
  await loginAs(staff, "staff@example.com", "staff-pass-123");
  const res = await staff.get("/api/focus-products");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.focusProducts.length, 1);
});

test("staff sees computed progress for every focus type", async () => {
  const { app } = createTestApp();
  const staff = request.agent(app);
  await loginAs(staff, "staff@example.com", "staff-pass-123");

  const res = await staff.get("/api/focus-products");
  const row = res.body.focusProducts[0];
  assert.equal(row.focusType, "salesperson");
  assert.equal(row.totalSold, 15);
  assert.equal(row.achieved, false); // 15 < target 20
  assert.deepEqual(row.branchCodes, ["001", "003", "005"]);
});

test("admin CRUD requires admin role and CSRF for writes", async () => {
  const { app } = createTestApp();

  const staff = request.agent(app);
  await loginAs(staff, "staff@example.com", "staff-pass-123");
  const forbidden = await staff.get("/api/admin/focus-products");
  assert.equal(forbidden.status, 403);

  const admin = request.agent(app);
  const csrf = await loginAs(admin);

  const noCsrf = await admin.post("/api/admin/focus-products").send({
    productCode: "IC-000700",
    focusType: "pharmacist",
    targetQty: 5,
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
  });
  assert.equal(noCsrf.status, 403);

  const created = await admin
    .post("/api/admin/focus-products")
    .set("x-csrf-token", csrf)
    .send({
      productCode: "IC-000700",
      focusType: "pharmacist",
      targetQty: 5,
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.focusProduct.focusType, "pharmacist");
  assert.equal(created.body.focusProduct.branchAchieved["001"], true); // 10 >= 5
  assert.equal(created.body.focusProduct.branchAchieved["003"], true); // 5 >= 5
  assert.equal(created.body.focusProduct.achieved, null); // pharmacist has no combined verdict

  const updated = await admin
    .patch(`/api/admin/focus-products/${created.body.focusProduct.id}`)
    .set("x-csrf-token", csrf)
    .send({ targetQty: 100 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.focusProduct.targetQty, 100);

  const deleted = await admin
    .delete(`/api/admin/focus-products/${created.body.focusProduct.id}`)
    .set("x-csrf-token", csrf);
  assert.equal(deleted.status, 200);

  const afterDelete = await admin.get("/api/focus-products");
  assert.ok(!afterDelete.body.focusProducts.some((r) => r.id === created.body.focusProduct.id));
});

test("create rejects invalid focusType, non-positive targetQty, and inverted date range", async () => {
  const { app } = createTestApp();
  const admin = request.agent(app);
  const csrf = await loginAs(admin);

  const badType = await admin
    .post("/api/admin/focus-products")
    .set("x-csrf-token", csrf)
    .send({ productCode: "IC-1", focusType: "manager", targetQty: 5, dateFrom: "2026-07-01", dateTo: "2026-07-31" });
  assert.equal(badType.status, 400);

  const badQty = await admin
    .post("/api/admin/focus-products")
    .set("x-csrf-token", csrf)
    .send({ productCode: "IC-1", focusType: "pharmacist", targetQty: 0, dateFrom: "2026-07-01", dateTo: "2026-07-31" });
  assert.equal(badQty.status, 400);

  const badRange = await admin
    .post("/api/admin/focus-products")
    .set("x-csrf-token", csrf)
    .send({ productCode: "IC-1", focusType: "pharmacist", targetQty: 5, dateFrom: "2026-07-31", dateTo: "2026-07-01" });
  assert.equal(badRange.status, 400);
});

test("group_manager achieved is true only when every branch clears the target", async () => {
  const { app, db } = createTestApp();
  db.state.rows.get(1).focus_type = "group_manager";
  db.state.rows.get(1).target_qty = "3";

  const staff = request.agent(app);
  await loginAs(staff, "staff@example.com", "staff-pass-123");
  const res = await staff.get("/api/focus-products");
  const row = res.body.focusProducts[0];
  // branch 005 has no sales row in the mock -> 0 sold, fails the target
  assert.equal(row.branchAchieved["001"], true);
  assert.equal(row.branchAchieved["003"], true);
  assert.equal(row.branchAchieved["005"], false);
  assert.equal(row.achieved, false);
});
