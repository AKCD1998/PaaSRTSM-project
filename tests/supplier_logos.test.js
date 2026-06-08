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

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function createSupplierLogoMockDb() {
  const state = {
    auditActions: [],
    supplierLogos: new Map(),
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

      if (normalized.startsWith("insert into public.audit_logs")) {
        state.auditActions.push(params[2]);
        return {
          rowCount: 1,
          rows: [{ audit_id: state.auditActions.length, event_time: new Date().toISOString() }],
        };
      }

      if (normalized.startsWith("select supplier_key, supplier_name, logo_data_url")) {
        const rows = [...state.supplierLogos.values()].sort((a, b) =>
          a.supplier_name.localeCompare(b.supplier_name),
        );
        return { rowCount: rows.length, rows };
      }

      if (normalized.startsWith("insert into public.supplier_logos")) {
        const existing = state.supplierLogos.get(params[0]);
        const now = new Date().toISOString();
        const row = {
          supplier_key: params[0],
          supplier_name: params[1],
          logo_data_url: params[2],
          created_at: existing?.created_at || now,
          updated_at: now,
        };
        state.supplierLogos.set(params[0], row);
        return { rowCount: 1, rows: [row] };
      }

      throw new Error(`Unhandled mock query: ${normalized}`);
    },
    async end() {},
  };

  return db;
}

function createTestApp() {
  const db = createSupplierLogoMockDb();
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
  assert.equal(response.body.ok, true);
  assert.ok(response.body.csrf_token);
  return response.body.csrf_token;
}

function svgDataUrl(svgText) {
  return `data:image/svg+xml;base64,${Buffer.from(svgText, "utf8").toString("base64")}`;
}

test("PUT /api/admin/supplier-logos saves a valid SVG data URL", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsAdmin(agent);
  const logoDataUrl = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');

  const response = await agent
    .put("/api/admin/supplier-logos")
    .set("x-csrf-token", csrfToken)
    .send({
      supplierKey: "supplierone",
      supplierName: "Supplier One",
      logoDataUrl,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.logo.supplierKey, "supplierone");
  assert.equal(response.body.logo.logoDataUrl, logoDataUrl);
  assert.equal(db.state.supplierLogos.size, 1);
});

test("GET /api/admin/supplier-logos returns saved logos", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsAdmin(agent);
  const logoDataUrl = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>');

  await agent
    .put("/api/admin/supplier-logos")
    .set("x-csrf-token", csrfToken)
    .send({ supplierKey: "suppliertwo", supplierName: "Supplier Two", logoDataUrl });

  const response = await agent.get("/api/admin/supplier-logos");

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.logos.length, 1);
  assert.equal(response.body.logos[0].supplierName, "Supplier Two");
  assert.equal(response.body.logos[0].logoDataUrl, logoDataUrl);
});

test("PUT /api/admin/supplier-logos rejects unsafe SVG script markup", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsAdmin(agent);

  const response = await agent
    .put("/api/admin/supplier-logos")
    .set("x-csrf-token", csrfToken)
    .send({
      supplierKey: "unsafe",
      supplierName: "Unsafe Supplier",
      logoDataUrl: svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /unsafe markup/i);
  assert.equal(db.state.supplierLogos.size, 0);
});

test("supplier logo alias route saves and loads logos", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsAdmin(agent);
  const logoDataUrl = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>');

  const saveResponse = await agent
    .put("/supplier-logos")
    .set("x-csrf-token", csrfToken)
    .send({
      supplierKey: "alias",
      supplierName: "Alias Supplier",
      logoDataUrl,
    });
  assert.equal(saveResponse.status, 200);

  const listResponse = await agent.get("/supplier-logos");
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.body.ok, true);
  assert.equal(listResponse.body.logos[0].supplierKey, "alias");
});
