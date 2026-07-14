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
    posApiKeys: new Set(["test-pos-key"]),
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
    connect() {
      return {
        query: this.query.bind(this),
        async release() {},
      };
    },
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

      if (
        normalizedSql.includes("left join lateral") &&
        normalizedSql.includes("from public.skus s") &&
        normalizedSql.includes("retail_price")
      ) {
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

      if (normalizedSql.includes("from public.barcodes b") && normalizedSql.includes("inner join public.skus s")) {
        return {
          rowCount: 1,
          rows: [
            {
              ...state.product,
              barcode: params[0],
            },
          ],
        };
      }

      if (
        normalizedSql.includes("from public.skus s") &&
        normalizedSql.includes("where s.company_code = $1")
      ) {
        return {
          rowCount: 1,
          rows: [
            {
              ...state.product,
              barcode: null,
            },
          ],
        };
      }

      if (normalizedSql.includes("from core.branches") && normalizedSql.includes("order by branch_code asc")) {
        return {
          rowCount: 1,
          rows: [{ branch_code: "B001", branch_name: "Main Branch", is_hq: true }],
        };
      }

      if (
        normalizedSql.includes("from public.skus s") &&
        normalizedSql.includes("where s.company_code is not null") &&
        normalizedSql.includes("limit 20")
      ) {
        return {
          rowCount: 1,
          rows: [
            {
              product_code: state.product.company_code,
              product_name: state.product.display_name,
              barcode: "8853935031319",
              supplier: state.product.supplier_code,
              unit: "ขวด",
              unit_code: "004",
              unit_name: "ขวด",
              min_stock: "3",
              max_stock: "20",
              lead_time_days: "5",
              stock_current: "10",
              stock_retail: "6",
              stock_warehouse: "4",
            },
          ],
        };
      }

      if (normalizedSql.includes("with latest_stock as")) {
        return {
          rowCount: 1,
          rows: [
            {
              product_code: state.product.company_code,
              product_name: state.product.display_name,
              barcode: "8853935031319",
              unit: "BOX",
              stock_current: "10",
              sold_qty_period: "5",
              purchased_qty_period: "8",
              min_stock: "3",
              max_stock: "20",
              lead_time_days: "5",
              supplier: state.product.supplier_code,
            },
          ],
        };
      }

      if (normalizedSql.startsWith("insert into ingest.sync_runs")) {
        state.lastSyncRun = {
          sync_run_id: 77,
          sync_type: params[0],
          source_name: params[1],
          started_at: params[2],
          finished_at: params[3],
          status: params[4],
          records_read: params[5],
          records_sent: params[6],
          message: params[7],
        };
        return {
          rowCount: 1,
          rows: [{ sync_run_id: 77 }],
        };
      }

      if (normalizedSql.startsWith("insert into ada.sync_runs")) {
        state.lastAdaSyncRun = {
          sync_run_id: 88,
          source_system: params[0],
          source_location: params[1],
          agent_name: params[2],
          agent_version: params[3],
          sync_type: params[4],
          started_at: params[5],
          finished_at: params[6],
          status: params[7],
          records_read: params[8],
          records_sent: params[9],
          watermark_from: params[10],
          watermark_to: params[11],
          message: params[12],
          meta: JSON.parse(params[13]),
        };
        return {
          rowCount: 1,
          rows: [{ sync_run_id: 88 }],
        };
      }

      if (normalizedSql.includes("from ingest.sync_runs")) {
        return {
          rowCount: state.lastSyncRun ? 1 : 0,
          rows: state.lastSyncRun ? [state.lastSyncRun] : [],
        };
      }

      if (normalizedSql.includes("from ingest.sync_errors")) {
        return {
          rowCount: 0,
          rows: [],
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

test("pos loyalty eligibility endpoint blocks medicine items by barcode", async () => {
  const { app } = createTestApp();

  const response = await request(app)
    .get("/api/loyalty/products/eligibility?barcode=8853935031319")
    .set("x-pos-api-key", "test-pos-key");

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.matched_by, "barcode");
  assert.equal(response.body.product.company_code, "630010001");
  assert.equal(response.body.loyalty.eligible, false);
  assert.equal(response.body.loyalty.reason, "medicine_blocked");
});

test("pos loyalty eligibility endpoint requires api key", async () => {
  const { app } = createTestApp();

  const response = await request(app).get("/api/loyalty/products/eligibility?company_code=630010001");

  assert.equal(response.status, 401);
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

test("ordering and sync routes are available on the unified backend", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);

  const branchesResponse = await agent.get("/api/branches");
  assert.equal(branchesResponse.status, 200);
  assert.equal(branchesResponse.body[0].branchCode, "B001");

  const searchResponse = await agent.get("/api/products/search?q=630010001");
  assert.equal(searchResponse.status, 200);
  assert.equal(searchResponse.body[0].productCode, "630010001");
  assert.equal(searchResponse.body[0].barcode, "8853935031319");
  assert.equal(searchResponse.body[0].unit, "ขวด");
  assert.equal(searchResponse.body[0].unitCode, "004");
  assert.equal(searchResponse.body[0].unitName, "ขวด");

  const csrfToken = await loginAs(agent, "admin@example.com", "admin-pass-123");
  assert.ok(csrfToken);

  const stockDayResponse = await agent.get("/api/admin/stock-day?periodDays=30");
  assert.equal(stockDayResponse.status, 200);
  assert.equal(stockDayResponse.body[0].productCode, "630010001");
  assert.equal(stockDayResponse.body[0].turnoverRate, 0.59);

  const syncRunLogResponse = await request(app)
    .post("/api/sync/run-log")
    .set("x-api-key", "test-pos-key")
    .send({
      syncType: "scheduled-sync",
      sourceName: "adapos_sync",
      status: "success",
      recordsRead: 10,
      recordsSent: 10,
      message: "Sync completed.",
    });
  assert.equal(syncRunLogResponse.status, 200);
  assert.equal(syncRunLogResponse.body.accepted, 1);
  assert.equal(syncRunLogResponse.body.adaSyncRunId, "88");
  assert.equal(db.state.lastAdaSyncRun.sync_type, "scheduled-sync");
  assert.equal(db.state.lastAdaSyncRun.source_system, "AdaAcc");
  assert.equal(db.state.lastAdaSyncRun.meta.legacyRoute, true);
  assert.equal(db.state.lastAdaSyncRun.meta.sourceName, "adapos_sync");

  const syncStatusResponse = await agent.get("/api/admin/sync-status");
  assert.equal(syncStatusResponse.status, 200);
  assert.equal(syncStatusResponse.body.latestRun.syncType, "scheduled-sync");
});
