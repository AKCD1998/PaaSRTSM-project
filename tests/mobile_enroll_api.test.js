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

function createMockDb() {
  const state = {
    auditActions: [],
    branches: new Map([
      ["000", { branch_code: "000", branch_name: "HQ", is_active: true, is_hq: true }],
      ["001", { branch_code: "001", branch_name: "Branch 001", is_active: true, is_hq: false }],
    ]),
    branchStaff: [
      { staff_id: 10, branch_code: "001", display_name: "Som Sales", role: "sales", is_active: true, is_probationary: false },
      { staff_id: 11, branch_code: "001", display_name: "Mana Manager", role: "manager", is_active: true, is_probationary: false },
      { staff_id: 12, branch_code: "001", display_name: "Probie", role: "sales", is_active: true, is_probationary: true },
    ],
    codes: [],
    devices: [],
    codeSeq: 0,
    deviceSeq: 0,
  };

  function parseIntervalSeconds(value) {
    return Number(value) || 0;
  }

  async function query(sql, params = []) {
    const n = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

    if (n === "begin" || n === "commit" || n === "rollback") {
      return { rowCount: 0, rows: [] };
    }

    if (n.startsWith("insert into public.audit_logs")) {
      state.auditActions.push(params[2]);
      return { rowCount: 1, rows: [{ audit_id: state.auditActions.length, event_time: new Date().toISOString() }] };
    }

    if (
      n.includes("select branch_code, branch_name, is_active, is_hq") &&
      n.includes("from core.branches")
    ) {
      const branch = state.branches.get(String(params[0] || "")) || null;
      return { rowCount: branch ? 1 : 0, rows: branch ? [branch] : [] };
    }

    if (n.startsWith("insert into ordering.enrollment_codes")) {
      state.codeSeq += 1;
      const ttl = parseIntervalSeconds(params[3]);
      const row = {
        code_id: state.codeSeq,
        code: params[0],
        branch_code: params[1],
        issued_by: params[2],
        expires_at: new Date(Date.now() + ttl * 1000),
        used_at: null,
        redeemed_staff_id: null,
        redeemed_device_id: null,
      };
      state.codes.push(row);
      return { rowCount: 1, rows: [{ code: row.code, expires_at: row.expires_at }] };
    }

    if (
      n.includes("select branch_code from ordering.enrollment_codes") &&
      n.includes("where code = $1")
    ) {
      const row = state.codes.find(
        (c) => c.code === params[0] && !c.used_at && c.expires_at > new Date(),
      );
      return { rowCount: row ? 1 : 0, rows: row ? [{ branch_code: row.branch_code }] : [] };
    }

    if (
      n.includes("select code_id, branch_code from ordering.enrollment_codes") &&
      n.includes("for update")
    ) {
      const row = state.codes.find(
        (c) => c.code === params[0] && !c.used_at && c.expires_at > new Date(),
      );
      return { rowCount: row ? 1 : 0, rows: row ? [{ code_id: row.code_id, branch_code: row.branch_code }] : [] };
    }

    if (
      n.includes("from core.branch_staff") &&
      n.includes("where branch_code = $1") &&
      n.includes("is_probationary = false") &&
      !n.includes("staff_id = $1")
    ) {
      const rows = state.branchStaff
        .filter((s) => s.branch_code === params[0] && s.is_active && !s.is_probationary)
        .map((s) => ({ staff_id: s.staff_id, display_name: s.display_name, role: s.role }));
      return { rowCount: rows.length, rows };
    }

    if (
      n.includes("from core.branch_staff") &&
      n.includes("where staff_id = $1") &&
      n.includes("branch_code = $2")
    ) {
      const s = state.branchStaff.find(
        (x) =>
          String(x.staff_id) === String(params[0]) &&
          x.branch_code === params[1] &&
          x.is_active &&
          !x.is_probationary,
      );
      return { rowCount: s ? 1 : 0, rows: s ? [{ staff_id: s.staff_id, display_name: s.display_name, role: s.role }] : [] };
    }

    if (n.startsWith("insert into ordering.enrolled_devices")) {
      state.deviceSeq += 1;
      const ttlHours = Number(params[6]) || 24;
      const row = {
        enrollment_id: state.deviceSeq,
        device_id: params[0],
        branch_code: params[1],
        staff_id: params[2],
        role: params[3],
        enrolled_by: params[4],
        device_label: params[5],
        expires_at: new Date(Date.now() + ttlHours * 3600 * 1000),
        revoked_at: null,
        revoked_by: null,
        enrolled_at: new Date(),
        last_seen_at: null,
      };
      state.devices.push(row);
      return { rowCount: 1, rows: [{ enrollment_id: row.enrollment_id, expires_at: row.expires_at }] };
    }

    if (n.startsWith("update ordering.enrollment_codes set used_at")) {
      const row = state.codes.find((c) => c.code_id === params[0]);
      if (row) {
        row.used_at = new Date();
        row.redeemed_staff_id = params[1];
        row.redeemed_device_id = params[2];
      }
      return { rowCount: row ? 1 : 0, rows: [] };
    }

    if (
      n.includes("from ordering.enrolled_devices") &&
      n.includes("where enrollment_id = $1") &&
      n.includes("revoked_at, expires_at")
    ) {
      const row = state.devices.find((d) => String(d.enrollment_id) === String(params[0])) || null;
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }

    if (
      n.includes("from ordering.enrolled_devices d") &&
      n.includes("left join core.branch_staff")
    ) {
      const rows = state.devices
        .filter((d) => d.branch_code === params[0] && !d.revoked_at && d.expires_at > new Date())
        .map((d) => {
          const s = state.branchStaff.find((x) => x.staff_id === d.staff_id);
          return {
            enrollment_id: d.enrollment_id,
            device_id: d.device_id,
            device_label: d.device_label,
            role: d.role,
            staff_id: d.staff_id,
            staff_name: s ? s.display_name : null,
            enrolled_at: d.enrolled_at,
            expires_at: d.expires_at,
            last_seen_at: d.last_seen_at,
          };
        });
      return { rowCount: rows.length, rows };
    }

    if (n.startsWith("update ordering.enrolled_devices set revoked_at")) {
      const row = state.devices.find(
        (d) =>
          String(d.enrollment_id) === String(params[0]) &&
          d.branch_code === params[2] &&
          !d.revoked_at,
      );
      if (row) {
        row.revoked_at = new Date();
        row.revoked_by = params[1];
      }
      return { rowCount: row ? 1 : 0, rows: row ? [{ enrollment_id: row.enrollment_id }] : [] };
    }

    throw new Error(`Unhandled mock query: ${n}`);
  }

  return {
    state,
    query,
    connect() {
      return { query, async release() {} };
    },
    async end() {},
  };
}

function createTestApp(configOverrides) {
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
  return { app, db, config };
}

async function masterStart(app) {
  const agent = request.agent(app);
  const login = await agent
    .post("/admin/auth/login")
    .send({ username: "branch001@example.com", password: "branch-pass-001" });
  assert.equal(login.status, 200);
  const start = await agent
    .post("/api/mobile/enroll/start")
    .set("x-csrf-token", login.body.csrf_token)
    .send({});
  return { agent, csrf: login.body.csrf_token, start };
}

test("master mints a code; roster hides probationary staff", async () => {
  const { app } = createTestApp();
  const { start } = await masterStart(app);

  assert.equal(start.status, 201);
  assert.ok(start.body.code);
  assert.equal(start.body.branchCode, "001");

  const roster = await request(app).get(`/api/mobile/enroll/roster?code=${start.body.code}`);
  assert.equal(roster.status, 200);
  const ids = roster.body.staff.map((s) => s.staffId).sort();
  assert.deepEqual(ids, ["10", "11"]); // probationary staff 12 is excluded
});

test("redeem issues a 24h mobile token usable on PDA endpoints", async () => {
  const { app } = createTestApp();
  const { start } = await masterStart(app);

  const redeem = await request(app)
    .post("/api/mobile/enroll/redeem")
    .send({ code: start.body.code, staffId: "11", deviceId: "device-abc" });

  assert.equal(redeem.status, 201);
  assert.ok(redeem.body.token);
  assert.equal(redeem.body.role, "manager");
  assert.equal(redeem.body.branchCode, "001");

  // manager token can list devices for its branch
  const devices = await request(app)
    .get("/api/mobile/devices")
    .set("authorization", `Bearer ${redeem.body.token}`);
  assert.equal(devices.status, 200);
  assert.equal(devices.body.devices.length, 1);
  assert.equal(devices.body.devices[0].deviceId, "device-abc");
});

test("a used code cannot be redeemed twice", async () => {
  const { app } = createTestApp();
  const { start } = await masterStart(app);

  const first = await request(app)
    .post("/api/mobile/enroll/redeem")
    .send({ code: start.body.code, staffId: "10", deviceId: "dev-1" });
  assert.equal(first.status, 201);

  const second = await request(app)
    .post("/api/mobile/enroll/redeem")
    .send({ code: start.body.code, staffId: "10", deviceId: "dev-2" });
  assert.equal(second.status, 404);
});

test("probationary staff cannot redeem", async () => {
  const { app } = createTestApp();
  const { start } = await masterStart(app);

  const redeem = await request(app)
    .post("/api/mobile/enroll/redeem")
    .send({ code: start.body.code, staffId: "12", deviceId: "dev-x" });
  assert.equal(redeem.status, 403);
});

test("sales role cannot list devices; manager can revoke and revocation is immediate", async () => {
  const { app } = createTestApp();

  // enroll a sales device
  const salesStart = await masterStart(app);
  const salesRedeem = await request(app)
    .post("/api/mobile/enroll/redeem")
    .send({ code: salesStart.start.body.code, staffId: "10", deviceId: "sales-dev" });
  assert.equal(salesRedeem.status, 201);
  const salesToken = salesRedeem.body.token;

  // sales is forbidden from device management
  const forbidden = await request(app)
    .get("/api/mobile/devices")
    .set("authorization", `Bearer ${salesToken}`);
  assert.equal(forbidden.status, 403);

  // enroll a manager device
  const mgrStart = await masterStart(app);
  const mgrRedeem = await request(app)
    .post("/api/mobile/enroll/redeem")
    .send({ code: mgrStart.start.body.code, staffId: "11", deviceId: "mgr-dev" });
  const mgrToken = mgrRedeem.body.token;

  // find the sales enrollment id
  const list = await request(app).get("/api/mobile/devices").set("authorization", `Bearer ${mgrToken}`);
  const salesDevice = list.body.devices.find((d) => d.deviceId === "sales-dev");
  assert.ok(salesDevice);

  // manager revokes the sales device
  const revoke = await request(app)
    .post("/api/mobile/enroll/revoke")
    .set("authorization", `Bearer ${mgrToken}`)
    .send({ enrollmentId: salesDevice.enrollmentId });
  assert.equal(revoke.status, 200);

  // the sales token is rejected immediately (not waiting for 24h expiry)
  const afterRevoke = await request(app)
    .get("/api/mobile/devices")
    .set("authorization", `Bearer ${salesToken}`);
  assert.equal(afterRevoke.status, 401);
});

test("mobile endpoints 404 when FEATURE_MOBILE_PDA is off", async () => {
  const { app } = createTestApp({ featureMobilePda: false });
  const roster = await request(app).get("/api/mobile/enroll/roster?code=anything");
  assert.equal(roster.status, 404);
});

test("invalid/expired code is rejected by roster and redeem", async () => {
  const { app, db } = createTestApp();
  // seed an already-expired code directly
  db.state.codeSeq += 1;
  db.state.codes.push({
    code_id: db.state.codeSeq,
    code: "expired-code",
    branch_code: "001",
    issued_by: "branch001@example.com",
    expires_at: new Date(Date.now() - 1000),
    used_at: null,
  });

  const roster = await request(app).get("/api/mobile/enroll/roster?code=expired-code");
  assert.equal(roster.status, 404);

  const redeem = await request(app)
    .post("/api/mobile/enroll/redeem")
    .send({ code: "expired-code", staffId: "10", deviceId: "dev" });
  assert.equal(redeem.status, 404);
});
