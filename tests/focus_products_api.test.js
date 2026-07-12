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
        branch_targets: null,
        assigned_person_name: "กนกวรา มันทะเสน",
        note: "โปรโมชั่นเดือนกรกฎาคม",
        is_active: true,
        created_by: "admin@example.com",
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z",
        frozen_sold_by_branch: null,
        frozen_total_sold: null,
        frozen_at: null,
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
        // Batched query: WHERE sl.product_code = ANY($1) — echo the same fixed
        // sold-qty shape (001:10, 003:5) for every requested product code.
        const codes = Array.isArray(params[0]) ? params[0] : [params[0]];
        const rows = codes.flatMap((code) => [
          { product_code: code, branch_code: "001", sold_qty: "10" },
          { product_code: code, branch_code: "003", sold_qty: "5" },
        ]);
        return { rowCount: rows.length, rows };
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
          assigned_person_name: params[8] || null,
          branch_targets: params[9] ? JSON.parse(params[9]) : null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          frozen_sold_by_branch: null,
          frozen_total_sold: null,
          frozen_at: null,
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
            assigned_person_name: params[9] || null,
            branch_targets: params[10] ? JSON.parse(params[10]) : null,
            updated_at: new Date().toISOString(),
          });
          if (q.includes("frozen_at = null")) {
            Object.assign(row, { frozen_sold_by_branch: null, frozen_total_sold: null, frozen_at: null });
          }
        }
        return { rowCount: row ? 1 : 0, rows: [] };
      }
      if (q.startsWith("update focus.focus_products set is_active = false")) {
        const id = Number(params[0]);
        const row = state.rows.get(id);
        if (row) row.is_active = false;
        return { rowCount: row ? 1 : 0, rows: [] };
      }
      if (q.startsWith("update focus.focus_products set frozen_sold_by_branch")) {
        const id = Number(params[0]);
        const row = state.rows.get(id);
        if (row && !row.frozen_at) {
          row.frozen_sold_by_branch = JSON.parse(params[1]);
          row.frozen_total_sold = params[2];
          row.frozen_at = new Date().toISOString();
          return { rowCount: 1, rows: [{ frozen_sold_by_branch: row.frozen_sold_by_branch, frozen_total_sold: row.frozen_total_sold, frozen_at: row.frozen_at }] };
        }
        return { rowCount: 0, rows: [] };
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

test("salesperson row surfaces the assigned employee name", async () => {
  const { app } = createTestApp();
  const staff = request.agent(app);
  await loginAs(staff, "staff@example.com", "staff-pass-123");

  const res = await staff.get("/api/focus-products");
  assert.equal(res.body.focusProducts[0].assignedPersonName, "กนกวรา มันทะเสน");
});

test("a focus row whose date_to has already passed is frozen on first read", async () => {
  const { app, db } = createTestApp();
  db.state.rows.get(1).date_from = "2026-01-01";
  db.state.rows.get(1).date_to = "2026-01-31"; // well in the past relative to test run time

  const staff = request.agent(app);
  await loginAs(staff, "staff@example.com", "staff-pass-123");

  const first = await staff.get("/api/focus-products");
  const row = first.body.focusProducts[0];
  assert.equal(row.isFrozen, true);
  assert.ok(row.frozenAt);
  assert.equal(row.totalSold, 15); // 10 (001) + 5 (003) from the mock sales query

  // Mutate the mock's live sales query response to prove the frozen row no
  // longer re-queries — a later AdaPOS correction must not change history.
  const originalQuery = db.query.bind(db);
  db.query = async (sql, params) => {
    if (String(sql).toLowerCase().includes("from ada.sales_lines sl")) {
      return { rowCount: 1, rows: [{ branch_code: "001", sold_qty: "999" }] };
    }
    return originalQuery(sql, params);
  };

  const second = await staff.get("/api/focus-products");
  assert.equal(second.body.focusProducts[0].totalSold, 15); // unchanged — still frozen
});

test("editing a frozen row's date range clears the freeze so it re-evaluates", async () => {
  const { app, db } = createTestApp();
  db.state.rows.get(1).date_from = "2026-01-01";
  db.state.rows.get(1).date_to = "2026-01-31";

  const admin = request.agent(app);
  const csrf = await loginAs(admin);
  await admin.get("/api/admin/focus-products"); // triggers freeze-on-read
  assert.ok(db.state.rows.get(1).frozen_at);

  // Extend dateTo into the future — the row is "still open" again, so
  // attachProgress (called at the end of updateFocusProduct) must not
  // immediately re-freeze it.
  const updated = await admin
    .patch("/api/admin/focus-products/1")
    .set("x-csrf-token", csrf)
    .send({ dateTo: "2026-08-31" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.focusProduct.isFrozen, false);
  assert.equal(db.state.rows.get(1).frozen_at, null);
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

test("group_manager branchTargets overrides the global target per branch", async () => {
  const { app, db } = createTestApp();
  db.state.rows.get(1).focus_type = "group_manager";
  db.state.rows.get(1).target_qty = "3"; // fallback for branches without an override
  db.state.rows.get(1).branch_targets = { "001": 8, "003": 6 }; // 001 mock sells 10, 003 sells 5

  const staff = request.agent(app);
  await loginAs(staff, "staff@example.com", "staff-pass-123");
  const res = await staff.get("/api/focus-products");
  const row = res.body.focusProducts[0];

  assert.equal(row.branchTargetsEffective["001"], 8);
  assert.equal(row.branchTargetsEffective["003"], 6);
  assert.equal(row.branchTargetsEffective["005"], 3); // no override -> falls back to target_qty
  assert.equal(row.branchAchieved["001"], true);  // 10 >= 8
  assert.equal(row.branchAchieved["003"], false); // 5 < 6
  assert.equal(row.branchAchieved["005"], false); // 0 < 3
  assert.equal(row.achieved, false);
});

test("admin can set branchTargets on create and it round-trips", async () => {
  const { app } = createTestApp();
  const admin = request.agent(app);
  const csrf = await loginAs(admin);

  const created = await admin
    .post("/api/admin/focus-products")
    .set("x-csrf-token", csrf)
    .send({
      productCode: "IC-004615",
      focusType: "group_manager",
      targetQty: 3,
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      branchCodes: ["001", "005"],
      branchTargets: { "001": 8, "005": 3 },
    });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.focusProduct.branchTargets, { "001": 8, "005": 3 });
  assert.equal(created.body.focusProduct.branchTargetsEffective["001"], 8);
  assert.equal(created.body.focusProduct.branchTargetsEffective["005"], 3);
});

test("branchTargets rejects negative values but allows zero as a placeholder", async () => {
  const { app } = createTestApp();
  const admin = request.agent(app);
  const csrf = await loginAs(admin);

  const bad = await admin
    .post("/api/admin/focus-products")
    .set("x-csrf-token", csrf)
    .send({
      productCode: "IC-1",
      focusType: "group_manager",
      targetQty: 3,
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      branchTargets: { "001": -1 },
    });
  assert.equal(bad.status, 400);

  // Zero means "target not known yet" — a legitimate placeholder for a
  // branch that hasn't been assigned a real number.
  const ok = await admin
    .post("/api/admin/focus-products")
    .set("x-csrf-token", csrf)
    .send({
      productCode: "IC-2",
      focusType: "pharmacist",
      targetQty: 5,
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      branchCodes: ["001", "005"],
      branchTargets: { "001": 0 },
    });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.focusProduct.branchTargetsEffective["001"], 0);
  assert.equal(ok.body.focusProduct.branchTargetsEffective["005"], 5);
});
