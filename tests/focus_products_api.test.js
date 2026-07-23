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
    staffUsers: new Set(["staff@example.com", "staff003@example.com"]),
    adminPasswordHash: bcrypt.hashSync("admin-pass-123", 10),
    staffPasswordHash: bcrypt.hashSync("staff-pass-123", 10),
    posApiKeys: new Set(["test-pos-key"]),
    r2BucketName: "test-line-packages",
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
        publication_status: "published",
        scheduled_publish_at: null,
        published_at: "2026-07-01T00:00:00.000Z",
        published_by: "admin@example.com",
      }],
    ]),
    linePackages: new Map(),
  };

  const db = {
    state,
    connect() {
      return { query: db.query.bind(db), async release() {} };
    },
    async query(sql, params = []) {
      const q = normalizeSql(sql);

      if (q.startsWith("select * from focus.focus_products where is_active = true")) {
        const now = Date.now();
        const rows = [...state.rows.values()].filter((r) => r.is_active && (
          (r.publication_status || "published") === "published"
          || ((r.publication_status || "published") === "scheduled"
            && new Date(r.scheduled_publish_at).getTime() <= now)
        ));
        return { rowCount: rows.length, rows };
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
      if (q.startsWith("select branch_code, branch_name, is_active, is_hq from core.branches where branch_code = $1")) {
        const branchCode = params[0];
        return {
          rowCount: 1,
          rows: [{ branch_code: branchCode, branch_name: `Branch ${branchCode}`, is_active: true, is_hq: false }],
        };
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
          product_codes: params[15], // $16 — every code sharing this row's target
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
          publication_status: params[10],
          scheduled_publish_at: params[11],
          published_at: params[12],
          published_by: params[13],
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
            product_codes: params[16], // $17
            focus_type: params[2],
            target_qty: String(params[3]),
            date_from: params[4],
            date_to: params[5],
            branch_codes: params[6],
            note: params[7],
            is_active: params[8],
            assigned_person_name: params[9] || null,
            branch_targets: params[10] ? JSON.parse(params[10]) : null,
            publication_status: params[11],
            scheduled_publish_at: params[12],
            published_at: params[13],
            published_by: params[14],
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
      if (q.startsWith("select * from focus.line_chat_packages where package_key = $1")) {
        const row = state.linePackages.get(params[0]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }
      if (q.startsWith("insert into focus.line_chat_packages")) {
        if (state.linePackages.has(params[0])) {
          return { rowCount: 0, rows: [] };
        }
        const row = {
          id: state.linePackages.size + 1,
          package_key: params[0],
          focus_type: params[1],
          branch_code: params[2],
          date_from: params[3],
          date_to: params[4],
          ci_count: params[5],
          message_text: params[6],
          row_fingerprint: params[7],
          image_sha256: params[8],
          bucket_name: params[9],
          object_key: params[10],
          mime_type: "image/png",
          size_bytes: params[11],
          created_by: params[12],
          expires_at: params[13],
          created_at: new Date().toISOString(),
          upload_state: "ready",
        };
        state.linePackages.set(row.package_key, row);
        return { rowCount: 1, rows: [row] };
      }

      throw new Error(`Unhandled mock query: ${q}`);
    },
    async end() {},
  };

  return db;
}

function createTestApp() {
  const db = createMockDb();
  const storageProvider = {
    uploaded: [],
    async putObject(object) {
      this.uploaded.push(object);
      return { ETag: "\"test\"" };
    },
    async headObject(key) {
      const uploaded = this.uploaded.find((object) => object.key === key);
      return { ContentLength: uploaded?.body?.length || 0, ETag: "\"test\"" };
    },
    async createSignedGetUrl(key) {
      return `https://r2.example.test/${encodeURIComponent(key)}`;
    },
  };
  const { app } = createApp({
    config: buildConfig(),
    db,
    r2StorageProvider: storageProvider,
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
  });
  return { app, db, storageProvider };
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
      branchCodes: ["001", "003", "004", "005"],
      branchTargets: { "001": 5, "003": 5, "004": 5, "005": 5 },
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

test("admin can save a LINE package and duplicate saves reuse it", async () => {
  const { app, storageProvider } = createTestApp();
  const admin = request.agent(app);
  const csrf = await loginAs(admin);
  const payload = {
    focusType: "pharmacist",
    branchCode: "003",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-23",
    ciCount: 16,
    messageText: "รายงานยอดขาย\nสาขา 003",
    rowFingerprint: JSON.stringify([{ code: "IC-004615", target: 8, sold: 4 }]),
    imageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  };

  const first = await admin
    .post("/api/admin/focus-products/line-packages")
    .set("x-csrf-token", csrf)
    .send(payload);
  assert.equal(first.status, 201);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.duplicate, false);
  assert.equal(first.body.linePackage.branchCode, "003");
  assert.equal(storageProvider.uploaded.length, 1);

  const second = await admin
    .post("/api/admin/focus-products/line-packages")
    .set("x-csrf-token", csrf)
    .send(payload);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.linePackage.packageKey, first.body.linePackage.packageKey);
  assert.equal(storageProvider.uploaded.length, 1);
});

test("staff can save LINE packages only for their effective branch", async () => {
  const { app, storageProvider } = createTestApp();
  const staff = request.agent(app);
  const csrf = await loginAs(staff, "staff003@example.com", "staff-pass-123");
  const payload = {
    focusType: "group_manager",
    branchCode: "003",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-23",
    ciCount: 16,
    messageText: "รายงานยอดขาย\nสาขา 003",
    rowFingerprint: JSON.stringify({ branchCode: "003", hash: "abc123" }),
    imageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  };

  const ownBranch = await staff
    .post("/api/admin/focus-products/line-packages")
    .set("x-csrf-token", csrf)
    .send(payload);
  assert.equal(ownBranch.status, 201);
  assert.equal(ownBranch.body.linePackage.branchCode, "003");
  assert.equal(storageProvider.uploaded.length, 1);

  const otherBranch = await staff
    .post("/api/admin/focus-products/line-packages")
    .set("x-csrf-token", csrf)
    .send({ ...payload, branchCode: "001" });
  assert.equal(otherBranch.status, 403);
  assert.equal(storageProvider.uploaded.length, 1);
});

test("admin can save a draft and publish it when ready", async () => {
  const { app } = createTestApp();
  const admin = request.agent(app);
  const staff = request.agent(app);
  const csrf = await loginAs(admin);
  await loginAs(staff, "staff@example.com", "staff-pass-123");

  const created = await admin
    .post("/api/admin/focus-products")
    .set("x-csrf-token", csrf)
    .send({
      productCode: "IC-DRAFT-001",
      focusType: "store_manager",
      targetQty: 10,
      dateFrom: "2027-01-01",
      dateTo: "2027-01-31",
      branchCodes: ["001", "003", "004", "005"],
      branchTargets: { "001": 10, "003": 10, "004": 10, "005": 10 },
      publicationStatus: "draft",
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.focusProduct.publicationStatus, "draft");

  const hidden = await staff.get("/api/focus-products");
  assert.ok(!hidden.body.focusProducts.some((row) => row.id === created.body.focusProduct.id));

  const published = await admin
    .patch(`/api/admin/focus-products/${created.body.focusProduct.id}`)
    .set("x-csrf-token", csrf)
    .send({ publicationStatus: "published" });
  assert.equal(published.status, 200);
  assert.equal(published.body.focusProduct.publicationState, "published");

  const visible = await staff.get("/api/focus-products");
  assert.ok(visible.body.focusProducts.some((row) => row.id === created.body.focusProduct.id));
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
      branchCodes: ["001", "003", "004", "005"],
      branchTargets: { "001": 8, "003": 3, "004": 3, "005": 3 },
    });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.focusProduct.branchTargets, { "001": 8, "003": 3, "004": 3, "005": 3 });
  assert.equal(created.body.focusProduct.branchTargetsEffective["001"], 8);
  assert.equal(created.body.focusProduct.branchTargetsEffective["005"], 3);
});

// Multi-product focus groups: several product codes share ONE target and staff
// may sell any mix of them. The mock returns 001:10 / 003:5 for every requested
// code, so a two-code group must report exactly double a one-code group.
test("a focus row spanning several product codes counts their sales together", async () => {
  const { app, db } = createTestApp();
  db.state.rows.get(1).target_qty = "20";
  db.state.rows.get(1).product_codes = ["IC-004754", "IC-004755"];

  const staff = request.agent(app);
  await loginAs(staff, "staff@example.com", "staff-pass-123");
  const res = await staff.get("/api/focus-products");
  const row = res.body.focusProducts[0];

  assert.equal(row.soldByBranch["001"], 20); // 10 + 10
  assert.equal(row.soldByBranch["003"], 10); // 5 + 5
  assert.equal(row.totalSold, 30);
  // The regression this guards: counting only the leading code gives 15, which
  // misses the target of 20 and wrongly reports the group as failed.
  assert.equal(row.achieved, true);
  assert.deepEqual(row.productCodes, ["IC-004754", "IC-004755"]);
  assert.deepEqual(row.products.map((p) => p.productCode), ["IC-004754", "IC-004755"]);
});

test("a row with no product_codes array falls back to the legacy single code", async () => {
  const { app, db } = createTestApp();
  db.state.rows.get(1).target_qty = "20";
  delete db.state.rows.get(1).product_codes;

  const staff = request.agent(app);
  await loginAs(staff, "staff@example.com", "staff-pass-123");
  const res = await staff.get("/api/focus-products");
  const row = res.body.focusProducts[0];

  assert.equal(row.totalSold, 15); // 10 + 5 from the one code only
  assert.equal(row.achieved, false);
  assert.deepEqual(row.productCodes, ["IC-005834"]);
});

test("admin can create a focus row spanning several product codes", async () => {
  const { app } = createTestApp();
  const admin = request.agent(app);
  const csrf = await loginAs(admin);

  const created = await admin
    .post("/api/admin/focus-products")
    .set("x-csrf-token", csrf)
    .send({
      productCode: "IC-004754",
      // The leading code is implied; listing it again must not double-count.
      productCodes: ["IC-004754", "IC-004755"],
      focusType: "store_manager",
      targetQty: 50,
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      branchCodes: ["001", "003", "004", "005"],
      branchTargets: { "001": 50, "003": 50, "004": 20, "005": 20 },
    });

  assert.equal(created.status, 201);
  assert.equal(created.body.focusProduct.productCode, "IC-004754");
  assert.deepEqual(created.body.focusProduct.productCodes, ["IC-004754", "IC-004755"]);
});

test("branchTargets rejects negative and incomplete/zero targets", async () => {
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

  const incomplete = await admin
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
  assert.equal(incomplete.status, 400);
});

// Batch (barcode) creation can merge scanned rows so they share one target.
// validateBulkRows is exercised directly: it owns the cross-row duplicate rule,
// which now has to compare every code in a group, not just the leading one.
test("bulk validation groups merged product codes onto one target", () => {
  const { validateBulkRows } = require("../apps/admin-api/src/services/focusProducts");

  const [row] = validateBulkRows([{
    productCode: "IC-004754",
    productCodes: ["IC-004754", "IC-004755"],
    focusType: "store_manager",
    targetQty: 50,
    branchCodes: ["001", "003", "004", "005"],
    branchTargets: { "001": 50, "003": 50, "004": 20, "005": 20 },
  }]);

  assert.equal(row.productCode, "IC-004754");
  assert.deepEqual(row.productCodes, ["IC-004754", "IC-004755"]);
});

test("bulk validation rejects a product claimed by two targets in the same batch", () => {
  const { validateBulkRows } = require("../apps/admin-api/src/services/focusProducts");

  const branchTargets = { "001": 5, "003": 5, "004": 5, "005": 5 };
  const base = {
    focusType: "store_manager",
    targetQty: 5,
    branchCodes: ["001", "003", "004", "005"],
    branchTargets,
  };

  // IC-004755 appears as a secondary code on row 1 and the primary on row 2 —
  // left unchecked its sales would count toward both targets.
  assert.throws(
    () => validateBulkRows([
      { ...base, productCode: "IC-004754", productCodes: ["IC-004754", "IC-004755"] },
      { ...base, productCode: "IC-004755" },
    ]),
    (error) => error.statusCode === 409,
  );
});
