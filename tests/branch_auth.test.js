"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const express = require("express");
const cookieParser = require("cookie-parser");
const request = require("supertest");

const { createApp } = require("../apps/admin-api/src/server");
const {
  requireAuth,
  requireCsrf,
  requireBranchIdentity,
  getAuthenticatedBranch,
} = require("../apps/admin-api/src/auth/middleware");

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
    featureStockRequests: true,
    adminUsers: new Set(["admin@example.com"]),
    staffUsers: new Set(["staff@example.com"]),
    branchUsers: new Set(["branch001@example.com", "branch005@example.com"]),
    adminPasswordHash: bcrypt.hashSync("admin-pass-123", 10),
    staffPasswordHash: bcrypt.hashSync("staff-pass-123", 10),
    branchUserBranches: new Map([
      ["branch001@example.com", "001"],
      ["branch005@example.com", "005"],
    ]),
    branchUserPasswordHashes: new Map([
      ["branch001@example.com", bcrypt.hashSync("branch-pass-001", 10)],
      ["branch005@example.com", bcrypt.hashSync("branch-pass-005", 10)],
    ]),
    posApiKeys: new Set(["test-pos-key"]),
  };
}

function createMockDb() {
  const state = {
    auditActions: [],
    branches: new Map([
      ["000", { branch_code: "000", branch_name: "HQ", is_active: true, is_hq: true }],
      ["001", { branch_code: "001", branch_name: "Branch 001", is_active: true, is_hq: false }],
      ["005", { branch_code: "005", branch_name: "Branch 005", is_active: false, is_hq: false }],
    ]),
  };

  return {
    state,
    connect() {
      return {
        query: this.query.bind(this),
        async release() {},
      };
    },
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

      if (normalized.startsWith("insert into public.audit_logs")) {
        state.auditActions.push(params[2]);
        return {
          rowCount: 1,
          rows: [{ audit_id: state.auditActions.length, event_time: new Date().toISOString() }],
        };
      }

      if (
        normalized.includes("select branch_code, branch_name, is_active, is_hq") &&
        normalized.includes("from core.branches") &&
        normalized.includes("where branch_code = $1")
      ) {
        const branch = state.branches.get(String(params[0] || "")) || null;
        return { rowCount: branch ? 1 : 0, rows: branch ? [branch] : [] };
      }

      throw new Error(`Unhandled mock query: ${normalized}`);
    },
    async end() {},
  };
}

function createTestApp() {
  const config = buildConfig();
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

  app.post(
    "/test/branch-only",
    requireAuth(config),
    requireCsrf,
    requireBranchIdentity,
    (req, res) => {
      return res.json({
        ok: true,
        request_id: req.requestId,
        auth: {
          userId: req.auth.userId,
          role: req.auth.role,
          actorBranchCode: req.auth.actorBranchCode,
          effectiveBranchCode: getAuthenticatedBranch(req),
          isBranchOverride: req.auth.isBranchOverride,
        },
        bodyBranchCode: req.body?.branchCode || null,
      });
    },
  );
  app.use(baseApp);

  return { app, db, config };
}

async function loginAs(agent, credentials) {
  const response = await agent.post("/admin/auth/login").send(credentials);
  return response;
}

test("branch login returns trusted branch identity and /admin/me exposes it", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);

  const loginResponse = await loginAs(agent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });

  assert.equal(loginResponse.status, 200);
  assert.equal(loginResponse.body.user.role, "branch");
  assert.equal(loginResponse.body.user.branch_code, "001");
  assert.equal(loginResponse.body.user.actor_branch_code, "001");
  assert.equal(loginResponse.body.user.effective_branch_code, "001");
  assert.equal(loginResponse.body.user.is_branch_override, false);

  const meResponse = await agent.get("/admin/me");
  assert.equal(meResponse.status, 200);
  assert.equal(meResponse.body.user.role, "branch");
  assert.equal(meResponse.body.user.branch_code, "001");
  assert.equal(meResponse.body.user.actor_branch_code, "001");
  assert.equal(meResponse.body.user.effective_branch_code, "001");
  assert.ok(!("password_hash" in meResponse.body.user));
  assert.ok(db.state.auditActions.includes("auth.login_success"));
});

test("branch-scoped middleware ignores client branchCode and keeps the signed session branch", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);

  const loginResponse = await loginAs(agent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });
  const csrfToken = loginResponse.body.csrf_token;

  const response = await agent
    .post("/test/branch-only")
    .set("x-csrf-token", csrfToken)
    .send({ branchCode: "000" });

  assert.equal(response.status, 200);
  assert.equal(response.body.bodyBranchCode, "000");
  assert.equal(response.body.auth.actorBranchCode, "001");
  assert.equal(response.body.auth.effectiveBranchCode, "001");
  assert.equal(response.body.auth.isBranchOverride, false);
});

test("users without a branch assignment are rejected by requireBranchIdentity and unauthenticated users are rejected earlier", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);

  const unauthenticated = await agent.post("/test/branch-only").send({});
  assert.equal(unauthenticated.status, 401);

  const loginResponse = await loginAs(agent, {
    username: "staff@example.com",
    password: "staff-pass-123",
  });
  const csrfToken = loginResponse.body.csrf_token;

  const noBranch = await agent
    .post("/test/branch-only")
    .set("x-csrf-token", csrfToken)
    .send({});
  assert.equal(noBranch.status, 403);
  assert.equal(noBranch.body.error, "Branch identity required");
});

test("branch users cannot invoke admin branch override", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);

  const loginResponse = await loginAs(agent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });
  const csrfToken = loginResponse.body.csrf_token;

  const response = await agent
    .post("/admin/auth/branch-override")
    .set("x-csrf-token", csrfToken)
    .send({ branchCode: "000" });

  assert.equal(response.status, 403);
  assert.ok(db.state.auditActions.includes("auth.branch_override_denied"));

  const meResponse = await agent.get("/admin/me");
  assert.equal(meResponse.body.user.effective_branch_code, "001");
});

test("admins can set and clear explicit branch override and csrf stays enforced", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);

  const loginResponse = await loginAs(agent, {
    username: "admin@example.com",
    password: "admin-pass-123",
  });
  const csrfToken = loginResponse.body.csrf_token;

  const csrfFailure = await agent.post("/admin/auth/branch-override").send({ branchCode: "000" });
  assert.equal(csrfFailure.status, 403);
  assert.equal(csrfFailure.body.error, "CSRF token invalid");

  const overrideResponse = await agent
    .post("/admin/auth/branch-override")
    .set("x-csrf-token", csrfToken)
    .send({ branchCode: "000" });

  assert.equal(overrideResponse.status, 200);
  assert.equal(overrideResponse.body.user.role, "admin");
  assert.equal(overrideResponse.body.user.actor_branch_code, null);
  assert.equal(overrideResponse.body.user.effective_branch_code, "000");
  assert.equal(overrideResponse.body.user.is_branch_override, true);

  const meResponse = await agent.get("/admin/me");
  assert.equal(meResponse.status, 200);
  assert.equal(meResponse.body.user.effective_branch_code, "000");
  assert.equal(meResponse.body.user.is_branch_override, true);

  const clearResponse = await agent
    .delete("/admin/auth/branch-override")
    .set("x-csrf-token", csrfToken);

  assert.equal(clearResponse.status, 200);
  assert.equal(clearResponse.body.user.effective_branch_code, null);
  assert.equal(clearResponse.body.user.is_branch_override, false);
  assert.ok(db.state.auditActions.includes("auth.branch_override_set"));
  assert.ok(db.state.auditActions.includes("auth.branch_override_cleared"));
});

test("inactive branch assignments and invalid override branch codes are rejected", async () => {
  const { app } = createTestApp();
  const inactiveAgent = request.agent(app);

  const inactiveLogin = await loginAs(inactiveAgent, {
    username: "branch005@example.com",
    password: "branch-pass-005",
  });
  assert.equal(inactiveLogin.status, 403);
  assert.equal(inactiveLogin.body.error, "Branch inactive");

  const adminAgent = request.agent(app);
  const adminLogin = await loginAs(adminAgent, {
    username: "admin@example.com",
    password: "admin-pass-123",
  });

  const invalidOverride = await adminAgent
    .post("/admin/auth/branch-override")
    .set("x-csrf-token", adminLogin.body.csrf_token)
    .send({ branchCode: "999" });
  assert.equal(invalidOverride.status, 400);
  assert.equal(invalidOverride.body.error, "Invalid branch code");
});

test("logout clears the authenticated branch context with the session cookie", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);

  const loginResponse = await loginAs(agent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });
  const csrfToken = loginResponse.body.csrf_token;

  const logoutResponse = await agent
    .post("/admin/auth/logout")
    .set("x-csrf-token", csrfToken)
    .send({});
  assert.equal(logoutResponse.status, 200);

  const meResponse = await agent.get("/admin/me");
  assert.equal(meResponse.status, 401);
});
