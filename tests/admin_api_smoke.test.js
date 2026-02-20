"use strict";

const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");
const { createApp } = require("../apps/admin-api/src/server");

const FIXTURE_CSV = path.join(__dirname, "fixtures", "adapos_sample.csv");

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
  };
}

function createMockDb() {
  const state = {
    auditActions: [],
    product: {
      sku_id: 1,
      company_code: "630010001",
      display_name: "Original Name",
      category_name: "ยาแก้แพ้",
      supplier_code: "TT00001",
      product_kind: "medicine",
      enrichment_status: "missing",
      enrichment_notes: null,
      generic_name: null,
      strength_text: null,
      form: null,
      route: null,
      updated_at: new Date().toISOString(),
    },
  };

  return {
    state,
    async query(sql, params) {
      const normalizedSql = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

      if (normalizedSql.startsWith("insert into public.audit_logs")) {
        state.auditActions.push(params[2]);
        return {
          rowCount: 1,
          rows: [{ audit_id: state.auditActions.length, event_time: new Date().toISOString() }],
        };
      }

      if (
        normalizedSql.includes("select count(*)::integer as total") &&
        normalizedSql.includes("from public.skus s")
      ) {
        return {
          rowCount: 1,
          rows: [{ total: 1 }],
        };
      }

      if (normalizedSql.includes("left join lateral") && normalizedSql.includes("from public.skus s")) {
        return {
          rowCount: 1,
          rows: [
            {
              sku_id: state.product.sku_id,
              company_code: state.product.company_code,
              display_name: state.product.display_name,
              category_name: state.product.category_name,
              supplier_code: state.product.supplier_code,
              product_kind: state.product.product_kind,
              enrichment_status: state.product.enrichment_status,
              avg_cost: "12.50",
              updated_at: state.product.updated_at,
              retail_price: "18.00",
              retail_currency: "THB",
              retail_effective_start: null,
              retail_updated_at: state.product.updated_at,
            },
          ],
        };
      }

      if (
        normalizedSql.startsWith("select sku_id, company_code, display_name") &&
        normalizedSql.includes("from public.skus")
      ) {
        return {
          rowCount: 1,
          rows: [state.product],
        };
      }

      if (normalizedSql.startsWith("update public.skus set")) {
        state.product = {
          ...state.product,
          display_name: params[0],
          updated_at: new Date().toISOString(),
        };
        return {
          rowCount: 1,
          rows: [state.product],
        };
      }

      if (normalizedSql.includes("with sales as")) {
        return {
          rowCount: 1,
          rows: [
            {
              sku_id: state.product.sku_id,
              company_code: state.product.company_code,
              display_name: state.product.display_name,
              category_name: state.product.category_name,
              supplier_code: state.product.supplier_code,
              enrichment_status: state.product.enrichment_status,
              generic_name: state.product.generic_name,
              strength_text: state.product.strength_text,
              form: state.product.form,
              route: state.product.route,
              total_qty: "100.000",
              total_amount: "999.99",
            },
          ],
        };
      }

      throw new Error(`Unhandled mock query: ${normalizedSql}`);
    },
    async end() {},
  };
}

function createTestApp(overrides = {}) {
  const db = createMockDb();
  const config = buildConfig();
  const runImporter = overrides.runImporter || (async (options) => {
    if (options.dryRun) {
      return {
        mode: "dry-run",
        decodeResult: { encoding: "cp874", markerHits: 5, replacements: 0 },
        plan: {
          rows_read: 5,
          products_parsed: 5,
          skipped_rows: 0,
          parse_errors: 0,
          planned_actions: {
            items_upsert: 5,
            skus_upsert: 5,
            barcodes_upsert: 5,
            prices_update_or_insert: 5,
            sku_price_tiers_upsert: 5,
          },
          product_kind_breakdown: { medicine: 5 },
          skipped_by_reason: {},
          top_parse_errors: [],
        },
      };
    }
    return {
      mode: "commit",
      decodeResult: { encoding: "cp874", markerHits: 5, replacements: 0 },
      parsed: {
        rowsRead: 5,
        products: new Array(5).fill({}),
        skippedRows: [],
      },
      summary: {
        tables: {
          items: { inserted: 1, updated: 4, skipped: 0 },
          skus: { inserted: 1, updated: 4, skipped: 0 },
          barcodes: { inserted: 5, updated: 0, skipped: 0, conflicts: 0 },
          prices: { inserted: 1, updated: 4, skipped: 0, unchanged: 0, history_closed: 0 },
          sku_price_tiers: { inserted: 5, updated: 0, skipped: 0 },
        },
        skipped_rows: {},
        parse_errors: [],
      },
      ruleSummary: null,
    };
  });
  const runExcelPriceImporter =
    overrides.runExcelPriceImporter ||
    (async (_options) => ({
      mode: "dry-run",
      parser_summary: {
        rows_read: 10,
        products_parsed: 2,
        row_type_counts: { header_rows: 2, detail_rows: 4, meta_rows: 2, ignored_rows: 2 },
      },
      summary: {
        products_processed: 2,
        sku_found: 2,
        missing_sku: 0,
        units_processed: 3,
        price_rows_planned_updates: 3,
        barcodes_new: 2,
        barcodes_existing: 1,
        skipped_no_price: 0,
        skipped_ambiguous_unit_prices: 0,
        errors: 0,
      },
      plan: {
        changes: [],
      },
    }));
  const runRuleApplication = async () => ({
    mode: "dry-run",
    rules_loaded: 1,
    ruleSummaries: [{ rule_id: 1, priority: 10, matched: 1, updated: 1, skipped: {}, error: "" }],
    totals: { candidates: 1, matched: 1, updated: 1, skipped: 0 },
    actions: [{ rule_id: 1, sku_id: 1, company_code: "630010001" }],
    limitReached: false,
  });

  const { app } = createApp({
    config,
    db,
    runImporter,
    runExcelPriceImporter,
    runRuleApplication,
  });

  return { app, db };
}

async function loginAs(agent, username, password) {
  const response = await agent.post("/admin/auth/login").send({ username, password });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.ok(response.body.csrf_token);
  return response.body.csrf_token;
}

test("admin health endpoint returns ok", async () => {
  const { app } = createTestApp();
  const response = await request(app).get("/admin/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.service, "admin-api");
});

test("login and me endpoint work with session cookie", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);

  const csrfToken = await loginAs(agent, "admin@example.com", "admin-pass-123");
  const meResponse = await agent.get("/admin/me");

  assert.equal(meResponse.status, 200);
  assert.equal(meResponse.body.user.role, "admin");
  assert.equal(meResponse.body.csrf_token, csrfToken);
  assert.ok(db.state.auditActions.includes("auth.login_success"));
});

test("staff is blocked from product edit and imports", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAs(agent, "staff@example.com", "staff-pass-123");

  const updateResponse = await agent
    .put("/admin/products/1")
    .set("x-csrf-token", csrfToken)
    .send({ display_name: "Blocked Update" });
  assert.equal(updateResponse.status, 403);

  const importResponse = await agent
    .post("/admin/import/products")
    .set("x-csrf-token", csrfToken)
    .send({ commit: false });
  assert.equal(importResponse.status, 403);
});

test("admin can read products, edit product, run import dry-run, and apply rules dry-run", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAs(agent, "admin@example.com", "admin-pass-123");

  const listResponse = await agent.get("/admin/products?limit=20&offset=0");
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.body.total, 1);
  assert.equal(listResponse.body.rows[0].company_code, "630010001");

  const updateResponse = await agent
    .put("/admin/products/1")
    .set("x-csrf-token", csrfToken)
    .send({ display_name: "Updated Product Name" });
  assert.equal(updateResponse.status, 200);
  assert.ok(updateResponse.body.changed_fields.includes("display_name"));
  assert.ok(db.state.auditActions.includes("product.update"));

  const importResponse = await agent
    .post("/admin/import/products")
    .set("x-csrf-token", csrfToken)
    .attach("file", FIXTURE_CSV)
    .field("commit", "false")
    .field("mode", "full");
  assert.equal(importResponse.status, 200);
  assert.equal(importResponse.body.summary.mode, "dry-run");
  assert.ok(db.state.auditActions.includes("import.products.dry_run"));

  const applyRulesResponse = await agent
    .post("/admin/enrichment/apply-rules")
    .set("x-csrf-token", csrfToken)
    .send({ commit: false, only_status: "missing" });
  assert.equal(applyRulesResponse.status, 200);
  assert.equal(applyRulesResponse.body.summary.mode, "dry-run");
  assert.ok(db.state.auditActions.includes("enrichment.apply_rules.dry_run"));
});

test("admin import prices route accepts .xls and uses excel-dataonly importer", async () => {
  let excelImporterCalled = false;
  const { app, db } = createTestApp({
    runExcelPriceImporter: async (_options) => {
      excelImporterCalled = true;
      return {
        mode: "dry-run",
        parser_summary: {
          rows_read: 12,
          products_parsed: 3,
          row_type_counts: { header_rows: 3, detail_rows: 6, meta_rows: 3, ignored_rows: 0 },
        },
        summary: {
          products_processed: 3,
          sku_found: 2,
          missing_sku: 1,
          units_processed: 5,
          price_rows_planned_updates: 4,
          barcodes_new: 2,
          barcodes_existing: 2,
          skipped_no_price: 1,
          skipped_ambiguous_unit_prices: 0,
          errors: 0,
        },
        plan: {
          changes: [],
        },
      };
    },
  });

  const agent = request.agent(app);
  const csrfToken = await loginAs(agent, "admin@example.com", "admin-pass-123");

  const importResponse = await agent
    .post("/admin/import/prices")
    .set("x-csrf-token", csrfToken)
    .attach("file", FIXTURE_CSV, "rpt_sql_allmpdtentryexceldataonly.xls")
    .field("commit", "false")
    .field("mode", "price-only")
    .field("source_format", "auto")
    .field("price_history", "off");

  assert.equal(importResponse.status, 200);
  assert.equal(importResponse.body.summary.mode, "dry-run");
  assert.equal(importResponse.body.summary.source_format, "excel-dataonly");
  assert.equal(excelImporterCalled, true);
  assert.ok(db.state.auditActions.includes("import.prices.dry_run"));
});
