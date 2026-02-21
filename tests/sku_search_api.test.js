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
    embeddingProvider: "mock",
    embeddingModel: "text-embedding-3-small",
    embeddingDimension: 1536,
    embeddingTimeoutMs: 1000,
    embeddingOpenAiBaseUrl: "https://api.openai.com/v1",
    adminUsers: new Set(["admin@example.com"]),
    staffUsers: new Set(["staff@example.com"]),
    adminPasswordHash: bcrypt.hashSync("admin-pass-123", 10),
    staffPasswordHash: bcrypt.hashSync("staff-pass-123", 10),
  };
}

function createMockDb() {
  return {
    async query(sql, params) {
      const normalized = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

      if (normalized.startsWith("insert into public.audit_logs")) {
        return {
          rowCount: 1,
          rows: [{ audit_id: 1, event_time: new Date().toISOString() }],
        };
      }

      if (normalized.includes("from pg_extension where extname = 'vector'")) {
        return {
          rowCount: 1,
          rows: [{ extname: "vector", extversion: "0.6.0" }],
        };
      }

      if (normalized.includes("to_regclass('public.sku_embeddings')")) {
        return {
          rowCount: 1,
          rows: [{ table_name: "public.sku_embeddings" }],
        };
      }

      if (normalized.includes("from public.sku_embeddings e join public.skus s")) {
        assert.equal(params[params.length - 1], 2);
        return {
          rowCount: 2,
          rows: [
            {
              sku_id: 10,
              company_code: "630010010",
              display_name: "Amoxicillin 500 mg",
              generic_name: "Amoxicillin",
              similarity_score: 0.92,
              keyword_boost: 0.05,
              metadata: { product_type: "medicine" },
              retail_price: "55.00",
              retail_currency: "THB",
            },
            {
              sku_id: 11,
              company_code: "630010011",
              display_name: "Ampicillin 500 mg",
              generic_name: "Ampicillin",
              similarity_score: 0.88,
              keyword_boost: 0,
              metadata: { product_type: "medicine" },
              retail_price: "49.00",
              retail_currency: "THB",
            },
          ],
        };
      }

      throw new Error(`Unhandled query in test mock: ${normalized}`);
    },
    async end() {},
  };
}

function createMockEmbeddingProvider() {
  return {
    name: "mock",
    model: "text-embedding-3-small",
    dimension: 1536,
    async embed(inputText) {
      const seed = inputText.length > 0 ? 0.001 : 0;
      return new Array(1536).fill(seed);
    },
  };
}

async function loginAsAdmin(agent) {
  const response = await agent
    .post("/admin/auth/login")
    .send({ username: "admin@example.com", password: "admin-pass-123" });
  assert.equal(response.status, 200);
}

test("search API health and hybrid SKU search endpoint", async () => {
  const { app } = createApp({
    config: buildConfig(),
    db: createMockDb(),
    searchEmbeddingProvider: createMockEmbeddingProvider(),
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
  });

  const health = await request(app).get("/api/search/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.pgvector_enabled, true);

  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const response = await agent.get("/api/search/skus?q=amoxicillin&k=2&product_kind=medicine");
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.mode, "hybrid");
  assert.equal(response.body.rows.length, 2);
  assert.equal(response.body.rows[0].sku_id, 10);
});
