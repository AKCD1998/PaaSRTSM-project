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

function createIngredientKnowledgeMockDb() {
  const state = {
    auditActions: [],
    products: new Map([
      [
        "IC-005863",
        {
          product_code: "IC-005863",
          product_name_thai: "เภสัช โลดอส 2.5 มก./6.25 มก. 30 เม็ด",
          product_name_eng: "MERCK LODOS BISOPROLOL FUMARATE 2.5 MG. HYDROCHLOROTHIAZIDE 6.25 MG. 30 S",
          barcode: "4065266690606",
        },
      ],
    ]),
    ingredients: [
      {
        ingredient_id: 1,
        canonical_name: "bisoprolol",
        display_name: "Bisoprolol",
        status: "active",
        synonyms: [
          { synonymId: 1, synonymText: "bisoprolol fumarate", language: "en", source: "manual", status: "active" },
        ],
      },
      {
        ingredient_id: 2,
        canonical_name: "hydrochlorothiazide",
        display_name: "Hydrochlorothiazide",
        status: "active",
        synonyms: [
          { synonymId: 2, synonymText: "hydrochlorothaiazide", language: "en", source: "typo", status: "active" },
        ],
      },
    ],
    productIngredients: new Map([
      [
        "IC-005863",
        [
          {
            ingredient_id: 1,
            canonical_name: "bisoprolol",
            display_name: "Bisoprolol",
            strength_value: "2.5000",
            strength_unit: "mg",
            raw_text: "BISOPROLOL FUMARATE 2.5 MG",
            source: "dictionary_match",
            status: "proposed",
            confidence: "0.9200",
            drug_classes: [
              { drugClassId: 10, name: "Beta blocker", status: "confirmed", confidence: 1, source: "pharmacist" },
            ],
            indications: [
              { indicationId: 20, name: "Hypertension", status: "confirmed", source: "pharmacist" },
            ],
          },
          {
            ingredient_id: 2,
            canonical_name: "hydrochlorothiazide",
            display_name: "Hydrochlorothiazide",
            strength_value: "6.2500",
            strength_unit: "mg",
            raw_text: "HYDROCHLOROTHAIAZIDE 6.25 MG",
            source: "dictionary_match",
            status: "confirmed",
            confidence: "0.8800",
            drug_classes: [
              { drugClassId: 11, name: "Thiazide diuretic", status: "confirmed", confidence: 1, source: "pharmacist" },
            ],
            indications: [
              { indicationId: 20, name: "Hypertension", status: "confirmed", source: "pharmacist" },
            ],
          },
        ],
      ],
    ]),
    categorySuggestions: new Map([
      [
        "IC-005863",
        [
          {
            category_name: "ยาความดัน/หัวใจ",
            reason: "Bisoprolol -> Beta blocker -> Hypertension -> ยาความดัน/หัวใจ",
            source: "ingredient_rule",
            priority: 10,
          },
          {
            category_name: "ยาขับปัสสาวะ",
            reason: "Hydrochlorothiazide -> Thiazide diuretic -> ยาขับปัสสาวะ",
            source: "drug_class_rule",
            priority: 30,
          },
        ],
      ],
    ]),
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

      if (normalized.includes("from (select $1::text as product_code) input")) {
        const product = state.products.get(params[0]);
        return {
          rowCount: 1,
          rows: [
            product || {
              product_code: params[0],
              product_name_thai: params[0],
              product_name_eng: "",
              barcode: "",
            },
          ],
        };
      }

      if (normalized.includes("from knowledge.product_ingredients pi") && normalized.includes("group by")) {
        const rows = state.productIngredients.get(params[0]) || [];
        return { rowCount: rows.length, rows };
      }

      if (normalized.includes("with product_ingredient_context as")) {
        const rows = state.categorySuggestions.get(params[0]) || [];
        return { rowCount: rows.length, rows };
      }

      if (normalized.includes("from knowledge.ingredients i")) {
        const search = String(params[0] || "").replace(/%/g, "").toLowerCase();
        const rows = state.ingredients
          .filter((ingredient) => {
            if (!search) return true;
            return (
              ingredient.canonical_name.toLowerCase().includes(search) ||
              ingredient.display_name.toLowerCase().includes(search) ||
              ingredient.synonyms.some((synonym) => synonym.synonymText.toLowerCase().includes(search))
            );
          })
          .map((ingredient) => ({
            ingredient_id: ingredient.ingredient_id,
            canonical_name: ingredient.canonical_name,
            display_name: ingredient.display_name,
            status: ingredient.status,
            synonyms: ingredient.synonyms,
          }));
        return { rowCount: rows.length, rows };
      }

      throw new Error(`Unhandled mock query: ${normalized}`);
    },
    async end() {},
  };

  return db;
}

function createTestApp() {
  const db = createIngredientKnowledgeMockDb();
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

test("ingredient supervision returns product ingredients and category suggestions", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAs(agent);

  const response = await agent.get("/api/admin/products/IC-005863/ingredient-supervision");

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.product.productCode, "IC-005863");
  assert.equal(response.body.product.barcode, "4065266690606");
  assert.equal(response.body.ingredients.length, 2);
  assert.equal(response.body.ingredients[0].canonicalName, "bisoprolol");
  assert.equal(response.body.ingredients[0].strengthValue, 2.5);
  assert.equal(response.body.ingredients[0].drugClasses[0].name, "Beta blocker");
  assert.equal(response.body.ingredients[1].canonicalName, "hydrochlorothiazide");
  assert.equal(response.body.categorySuggestions.length, 2);
  assert.equal(response.body.categorySuggestions[0].categoryName, "ยาความดัน/หัวใจ");
});

test("ingredient supervision returns empty arrays for products without ingredient records", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAs(agent);

  const response = await agent.get("/api/admin/products/UNKNOWN-001/ingredient-supervision");

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.product.productCode, "UNKNOWN-001");
  assert.deepEqual(response.body.ingredients, []);
  assert.deepEqual(response.body.categorySuggestions, []);
});

test("ingredient dictionary search returns synonyms", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAs(agent);

  const response = await agent.get("/api/admin/ingredients?search=fumarate");

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.records.length, 1);
  assert.equal(response.body.records[0].canonicalName, "bisoprolol");
  assert.equal(response.body.records[0].synonyms[0].synonymText, "bisoprolol fumarate");
});

test("ingredient knowledge read APIs require admin auth", async () => {
  const { app } = createTestApp();

  const unauthorized = await request(app).get("/api/admin/ingredients");
  assert.equal(unauthorized.status, 401);

  const staff = request.agent(app);
  await loginAs(staff, "staff@example.com", "staff-pass-123");
  const forbidden = await staff.get("/api/admin/ingredients");
  assert.equal(forbidden.status, 403);
});
