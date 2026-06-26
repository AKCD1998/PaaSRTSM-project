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

function applySkuFilters(rows, normalizedSql, params) {
  let index = 0;
  let filtered = [...rows];

  if (normalizedSql.includes("where s.product_type = $")) {
    const productType = params[index];
    index += 1;
    filtered = filtered.filter((row) => row.product_type === productType);
  } else if (normalizedSql.includes("where s.product_type is null")) {
    filtered = filtered.filter((row) => row.product_type == null);
  }

  if (normalizedSql.includes("coalesce(s.enrichment_status, 'missing') = $")) {
    const enrichmentStatus = params[index];
    index += 1;
    filtered = filtered.filter(
      (row) => (row.enrichment_status || "missing") === enrichmentStatus,
    );
  }

  if (normalizedSql.includes("s.company_code ilike $") || normalizedSql.includes("s.display_name ilike $")) {
    const query = String(params[index] || "").replace(/%/g, "").toLowerCase();
    index += 1;
    filtered = filtered.filter((row) => {
      const code = String(row.company_code || "").toLowerCase();
      const name = String(row.display_name || "").toLowerCase();
      return code.includes(query) || name.includes(query);
    });
  }

  return { rows: filtered, nextIndex: index };
}

function createMockDb() {
  const state = {
    auditActions: [],
    skus: [
      {
        sku_id: 1,
        company_code: "DRUG-001",
        display_name: "Pain Relief",
        product_kind: "medicine",
        product_type: "drug",
        enrichment_status: "verified",
        category_name: "ยาแก้ปวด",
        ingredient_categories: [],
      },
      {
        sku_id: 2,
        company_code: "SUP-001",
        display_name: "Vitamin C Plus",
        product_kind: "supplement",
        product_type: null,
        enrichment_status: "missing",
        category_name: "อาหารเสริม",
        ingredient_categories: ["อาหารเสริม"],
      },
      {
        sku_id: 3,
        company_code: "IS-0001",
        display_name: "Delivery Fee",
        product_kind: "service_fee",
        product_type: null,
        enrichment_status: "missing",
        category_name: "ค่าบริการ",
        ingredient_categories: [],
      },
      {
        sku_id: 4,
        company_code: "DEV-001",
        display_name: "BP Monitor",
        product_kind: "device_or_general_goods",
        product_type: null,
        enrichment_status: "missing",
        category_name: "เครื่องมือแพทย์",
        ingredient_categories: [],
      },
    ],
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
        return { rowCount: 0, rows: [] };
      }

      if (normalized.startsWith("insert into public.audit_logs")) {
        state.auditActions.push(params[2]);
        return {
          rowCount: 1,
          rows: [{ audit_id: state.auditActions.length, event_time: new Date().toISOString() }],
        };
      }

      if (normalized.includes("count(*)::integer as total") && normalized.includes("count(*) filter")) {
        const total = state.skus.length;
        const classified = state.skus.filter((row) => row.product_type != null).length;
        return {
          rowCount: 1,
          rows: [{ total, classified, unclassified: total - classified }],
        };
      }

      if (normalized.startsWith("select product_type, count(*)::integer as count from public.skus")) {
        const groups = new Map();
        for (const row of state.skus) {
          const key = row.product_type;
          groups.set(key, (groups.get(key) || 0) + 1);
        }
        return {
          rowCount: groups.size,
          rows: [...groups.entries()].map(([product_type, count]) => ({ product_type, count })),
        };
      }

      if (normalized.startsWith("select coalesce(enrichment_status, 'missing') as enrichment_status")) {
        const groups = new Map();
        for (const row of state.skus) {
          const key = row.enrichment_status || "missing";
          groups.set(key, (groups.get(key) || 0) + 1);
        }
        return {
          rowCount: groups.size,
          rows: [...groups.entries()].map(([enrichment_status, count]) => ({ enrichment_status, count })),
        };
      }

      if (normalized.startsWith("select count(*)::integer as total from public.skus s")) {
        const filtered = applySkuFilters(state.skus, normalized, params).rows;
        return {
          rowCount: 1,
          rows: [{ total: filtered.length }],
        };
      }

      if (normalized.startsWith("select s.company_code as sku_code, s.display_name as name")) {
        const filteredState = applySkuFilters(state.skus, normalized, params);
        const limit = params[filteredState.nextIndex];
        const offset = params[filteredState.nextIndex + 1];
        const rows = filteredState.rows.slice(offset, offset + limit).map((row) => ({
          sku_code: row.company_code,
          name: row.display_name,
          product_kind: row.product_kind,
          product_type: row.product_type,
          enrichment_status: row.enrichment_status || "missing",
          category_name: row.category_name,
        }));
        return { rowCount: rows.length, rows };
      }

      if (
        normalized.startsWith("select company_code as sku_code, display_name as name") &&
        normalized.includes("from public.skus") &&
        normalized.includes("where company_code = $1")
      ) {
        const row = state.skus.find((entry) => entry.company_code === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [{
          sku_code: row.company_code,
          name: row.display_name,
          product_type: row.product_type,
          enrichment_status: row.enrichment_status || "missing",
          category_name: row.category_name,
          product_kind: row.product_kind,
        }] : [] };
      }

      if (normalized.startsWith("update public.skus set") && normalized.includes("where company_code = $1")) {
        const row = state.skus.find((entry) => entry.company_code === params[0]);
        if (!row) {
          return { rowCount: 0, rows: [] };
        }
        row.product_type = params[1];
        row.enrichment_status = params[2] || row.enrichment_status;
        return {
          rowCount: 1,
          rows: [{
            sku_code: row.company_code,
            name: row.display_name,
            product_type: row.product_type,
            enrichment_status: row.enrichment_status || "missing",
            category_name: row.category_name,
            product_kind: row.product_kind,
          }],
        };
      }

      if (normalized.includes("with ingredient_category_matches as")) {
        const limit = params[0] || null;
        const rows = state.skus
          .filter((row) => row.product_type == null)
          .slice(0, limit || state.skus.length)
          .map((row) => ({
            sku_id: row.sku_id,
            sku_code: row.company_code,
            name: row.display_name,
            product_kind: row.product_kind,
            enrichment_status: row.enrichment_status || "missing",
            category_name: row.category_name,
            ingredient_categories: row.ingredient_categories,
          }));
        return { rowCount: rows.length, rows };
      }

      if (normalized.startsWith("update public.skus as s set") && normalized.includes("from ( values")) {
        let updated = 0;
        for (let i = 0; i < params.length; i += 3) {
          const skuCode = params[i];
          const productType = params[i + 1];
          const enrichmentStatus = params[i + 2];
          const row = state.skus.find((entry) => entry.company_code === skuCode);
          if (row && row.product_type == null) {
            row.product_type = productType;
            row.enrichment_status = enrichmentStatus || row.enrichment_status;
            updated += 1;
          }
        }
        return { rowCount: updated, rows: [] };
      }

      throw new Error(`Unhandled mock query: ${normalized}`);
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

test("GET /api/products/taxonomy/stats returns the expected shape", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAs(agent);

  const response = await agent.get("/api/products/taxonomy/stats");

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.total, 4);
  assert.equal(response.body.classified, 1);
  assert.equal(response.body.unclassified, 3);
  assert.equal(response.body.by_product_type.drug, 1);
  assert.equal(response.body.by_product_type.service, 0);
  assert.equal(response.body.enrichment_status.verified, 1);
  assert.equal(response.body.enrichment_status.missing, 3);
});

test("PATCH /api/products/:sku_code/taxonomy with valid value returns 200", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrf = await loginAs(agent);

  const response = await agent
    .patch("/api/products/SUP-001/taxonomy")
    .set("x-csrf-token", csrf)
    .send({ product_type: "supplement" });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.product.product_type, "supplement");
  assert.ok(response.body.changed_fields.includes("product_type"));
  assert.ok(db.state.auditActions.includes("product.taxonomy.update"));
});

test("PATCH /api/products/:sku_code/taxonomy with invalid value returns 400", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrf = await loginAs(agent);

  const response = await agent
    .patch("/api/products/SUP-001/taxonomy")
    .set("x-csrf-token", csrf)
    .send({ product_type: "banana" });

  assert.equal(response.status, 400);
});

test("POST /api/products/taxonomy/bulk-classify with commit=false returns preview only", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrf = await loginAs(agent);

  const response = await agent
    .post("/api/products/taxonomy/bulk-classify")
    .set("x-csrf-token", csrf)
    .send({ commit: false });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.summary.mode, "dry_run");
  assert.equal(response.body.summary.classified, 3);
  assert.equal(response.body.summary.unclassified, 0);
  assert.equal(db.state.skus.find((row) => row.company_code === "SUP-001").product_type, null);
});

test("PATCH taxonomy requires CSRF", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAs(agent);

  const response = await agent
    .patch("/api/products/SUP-001/taxonomy")
    .send({ product_type: "supplement" });

  assert.equal(response.status, 403);
});

test("bulk-classify requires CSRF", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAs(agent);

  const response = await agent
    .post("/api/products/taxonomy/bulk-classify")
    .send({ commit: false });

  assert.equal(response.status, 403);
});
