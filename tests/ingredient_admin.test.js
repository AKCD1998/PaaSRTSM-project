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
    auditActions: [],
    ingredient: {
      ingredient_id: 1,
      canonical_name: "paracetamol",
      display_name: "Paracetamol",
      status: "active",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
    synonyms: [
      { synonym_id: 10, synonym_text: "paracetamol", language: "en", source: "seed", status: "active", updated_at: "2026-06-01T00:00:00.000Z" },
    ],
    insertedSynonyms: [],
    productIngredients: new Map([
      ["IC-001624|1", { product_code: "IC-001624", ingredient_id: 1, status: "proposed", source: "dictionary_backfill", confirmed_by: null }],
    ]),
    resolvedAudits: [],
  };

  const db = {
    state,
    connect() {
      return { query: db.query.bind(db), async release() {} };
    },
    async query(sql, params = []) {
      const q = normalizeSql(sql);

      if (q.startsWith("insert into public.audit_logs")) {
        state.auditActions.push(params[2]);
        return { rowCount: 1, rows: [{ audit_id: state.auditActions.length, event_time: new Date().toISOString() }] };
      }

      // ingredients list count
      if (q.startsWith("select count(*)::int as total from knowledge.ingredients i")) {
        return { rowCount: 1, rows: [{ total: 1 }] };
      }

      // ingredients list
      if (q.includes("from knowledge.ingredients i") && q.includes("order by i.display_name")) {
        return {
          rowCount: 1,
          rows: [{
            ingredient_id: 1, canonical_name: "paracetamol", display_name: "Paracetamol", status: "active",
            updated_at: state.ingredient.updated_at, synonym_count: state.synonyms.length, drug_class_count: 1,
            indication_count: 1, category_rule_count: 1, drug_class_names: "Analgesic/Antipyretic", indication_names: "Pain, Fever",
          }],
        };
      }

      // fetchIngredientRow
      if (q.startsWith("select ingredient_id, canonical_name, display_name, status, created_at, updated_at")) {
        return Number(params[0]) === 1 ? { rowCount: 1, rows: [state.ingredient] } : { rowCount: 0, rows: [] };
      }

      // synonym global-dup check
      if (q.includes("from knowledge.ingredient_synonyms") && q.includes("lower(btrim(synonym_text)) = lower(btrim($1))")) {
        const txt = String(params[0] || "").trim().toLowerCase();
        const found = [...state.synonyms, ...state.insertedSynonyms].find((s) => s.synonym_text.toLowerCase() === txt);
        return found ? { rowCount: 1, rows: [{ synonym_id: found.synonym_id, ingredient_id: 1, status: found.status }] } : { rowCount: 0, rows: [] };
      }

      // synonym insert
      if (q.startsWith("insert into knowledge.ingredient_synonyms")) {
        const id = 100 + state.insertedSynonyms.length;
        state.insertedSynonyms.push({ synonym_id: id, synonym_text: params[1], language: params[2], source: params[3], status: "active", updated_at: new Date().toISOString() });
        return { rowCount: 1, rows: [{ synonym_id: id }] };
      }

      // detail: synonyms
      if (q.includes("from knowledge.ingredient_synonyms where ingredient_id = $1")) {
        return { rowCount: state.synonyms.length, rows: [...state.synonyms, ...state.insertedSynonyms] };
      }
      // detail: drug classes
      if (q.includes("from knowledge.ingredient_drug_classes idc")) {
        return { rowCount: 1, rows: [{ drug_class_id: 5, name: "Analgesic/Antipyretic", confidence: 1, source: "seed", status: "confirmed", updated_at: state.ingredient.updated_at }] };
      }
      // detail: indications
      if (q.includes("from knowledge.ingredient_indications ii")) {
        return { rowCount: 1, rows: [{ indication_id: 7, name: "Pain", source: "seed", status: "confirmed", updated_at: state.ingredient.updated_at }] };
      }
      // detail: category rules
      if (q.includes("from knowledge.ingredient_category_rules r")) {
        return { rowCount: 1, rows: [{ rule_id: 3, category_name: "3ยาแก้ปวด", drug_class_id: null, drug_class_name: null, indication_id: null, indication_name: null, priority: 20, rule_status: "active", note: null, updated_at: state.ingredient.updated_at }] };
      }

      // product-ingredient: fetch before update
      if (q.startsWith("select status, source, confirmed_by from knowledge.product_ingredients")) {
        const row = state.productIngredients.get(`${params[0]}|${params[1]}`);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }
      // product-ingredient: update status
      if (q.startsWith("update knowledge.product_ingredients")) {
        const key = `${params[0]}|${params[1]}`;
        const row = state.productIngredients.get(key);
        if (row) row.status = params[2];
        return { rowCount: row ? 1 : 0, rows: [] };
      }
      // suggestion-audit resolution update
      if (q.startsWith("update knowledge.ingredient_suggestion_audit")) {
        state.resolvedAudits.push({ productCode: params[0], ingredientId: params[1], status: params[2] });
        return { rowCount: 1, rows: [] };
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

test("ingredient-dictionary list requires admin auth/role", async () => {
  const { app } = createTestApp();

  const unauth = await request(app).get("/api/admin/ingredient-dictionary/ingredients");
  assert.equal(unauth.status, 401);

  const staff = request.agent(app);
  await loginAs(staff, "staff@example.com", "staff-pass-123");
  const forbidden = await staff.get("/api/admin/ingredient-dictionary/ingredients");
  assert.equal(forbidden.status, 403);
});

test("ingredient-dictionary list returns mapped records with counts", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAs(agent);

  const res = await agent.get("/api/admin/ingredient-dictionary/ingredients?search=para");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.records[0].canonicalName, "paracetamol");
  assert.equal(res.body.records[0].synonymCount, 1);
  assert.equal(res.body.records[0].drugClassNames, "Analgesic/Antipyretic");
});

test("adding a synonym requires CSRF and writes an audit row", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrf = await loginAs(agent);

  // Missing CSRF → rejected
  const noCsrf = await agent
    .post("/api/admin/ingredient-dictionary/ingredients/1/synonyms")
    .send({ synonymText: "acetaminophen" });
  assert.equal(noCsrf.status, 403);

  // With CSRF → created + audited
  const ok = await agent
    .post("/api/admin/ingredient-dictionary/ingredients/1/synonyms")
    .set("x-csrf-token", csrf)
    .send({ synonymText: "acetaminophen" });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.ok, true);
  assert.ok(ok.body.ingredient.synonyms.some((s) => s.synonymText === "acetaminophen"));
  assert.ok(db.state.auditActions.includes("ingredient_dictionary.synonym.add"));
});

test("duplicate synonym is rejected with 409", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrf = await loginAs(agent);

  const dup = await agent
    .post("/api/admin/ingredient-dictionary/ingredients/1/synonyms")
    .set("x-csrf-token", csrf)
    .send({ synonymText: "Paracetamol" });
  assert.equal(dup.status, 409);
});

test("ingredient detail 404s for unknown id", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAs(agent);

  const res = await agent.get("/api/admin/ingredient-dictionary/ingredients/999");
  assert.equal(res.status, 404);
});

test("confirming a product-ingredient requires CSRF, updates status, resolves audit", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrf = await loginAs(agent);

  // missing CSRF
  const noCsrf = await agent
    .patch("/api/admin/ingredient-dictionary/product-ingredients/IC-001624/1")
    .send({ status: "confirmed" });
  assert.equal(noCsrf.status, 403);

  // confirm
  const ok = await agent
    .patch("/api/admin/ingredient-dictionary/product-ingredients/IC-001624/1")
    .set("x-csrf-token", csrf)
    .send({ status: "confirmed" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, "confirmed");
  assert.equal(db.state.productIngredients.get("IC-001624|1").status, "confirmed");
  assert.ok(db.state.auditActions.includes("ingredient_dictionary.product_ingredient.status"));
  assert.equal(db.state.resolvedAudits[0].status, "accepted");
});

test("invalid status and unknown product-ingredient are handled", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrf = await loginAs(agent);

  const bad = await agent
    .patch("/api/admin/ingredient-dictionary/product-ingredients/IC-001624/1")
    .set("x-csrf-token", csrf)
    .send({ status: "banana" });
  assert.equal(bad.status, 400);

  const missing = await agent
    .patch("/api/admin/ingredient-dictionary/product-ingredients/NOPE/1")
    .set("x-csrf-token", csrf)
    .send({ status: "confirmed" });
  assert.equal(missing.status, 404);
});

test("confirm-batch processes multiple decisions", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrf = await loginAs(agent);

  const res = await agent
    .post("/api/admin/ingredient-dictionary/product-ingredients/confirm-batch")
    .set("x-csrf-token", csrf)
    .send({ decisions: [
      { productCode: "IC-001624", ingredientId: 1, status: "rejected" },
      { productCode: "NOPE", ingredientId: 9, status: "confirmed" },
    ] });
  assert.equal(res.status, 200);
  assert.equal(res.body.updated, 1);
  assert.equal(res.body.notFound, 1);
  assert.equal(db.state.productIngredients.get("IC-001624|1").status, "rejected");
});
