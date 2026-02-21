"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");
const { createApp } = require("../apps/admin-api/src/server");
const { parseSyncJobRequestBody } = require("../apps/admin-api/src/services/embedding-sync-jobs");

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

function createMockDb(options = {}) {
  const activeJob = options.activeJob || null;
  const insertedJobs = [];
  return {
    insertedJobs,
    async query(sql, params) {
      const normalized = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

      if (normalized.startsWith("insert into public.audit_logs")) {
        return {
          rowCount: 1,
          rows: [{ audit_id: 1, event_time: new Date().toISOString() }],
        };
      }

      if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes("pg_try_advisory_xact_lock")) {
        return { rowCount: 1, rows: [{ acquired: true }] };
      }

      if (normalized.includes("from public.embedding_sync_jobs") && normalized.includes("status in ('queued', 'running')")) {
        if (activeJob) {
          return {
            rowCount: 1,
            rows: [{ job_id: activeJob.job_id, status: activeJob.status }],
          };
        }
        return { rowCount: 0, rows: [] };
      }

      if (normalized.startsWith("insert into public.embedding_sync_jobs")) {
        const row = {
          job_id: 123,
          mode: params[0],
          status: "queued",
          requested_by: params[1],
          request_ip: params[2],
          params: JSON.parse(params[3]),
          started_at: null,
          finished_at: null,
          processed_count: 0,
          inserted_count: 0,
          updated_count: 0,
          skipped_count: 0,
          error_count: 0,
          error_summary: null,
          cancel_requested: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        insertedJobs.push(row);
        return { rowCount: 1, rows: [row] };
      }

      throw new Error(`Unhandled query in embedding sync test mock: ${normalized}`);
    },
    async end() {},
  };
}

function createNoopRunner() {
  const enqueued = [];
  return {
    enqueued,
    enqueue(jobId) {
      enqueued.push(jobId);
    },
  };
}

async function loginAsAdmin(agent) {
  const response = await agent
    .post("/admin/auth/login")
    .send({ username: "admin@example.com", password: "admin-pass-123" });
  assert.equal(response.status, 200);
  return response.body.csrf_token;
}

test("parseSyncJobRequestBody validates mode and builds normalized payload", () => {
  assert.throws(
    () =>
      parseSyncJobRequestBody({
        mode: "invalid-mode",
      }),
    /mode must be dry_run or execute/i,
  );

  const parsed = parseSyncJobRequestBody({
    mode: "execute",
    limit: 25,
    batch_size: 20,
    filters: {
      company_code: "630010001",
    },
  });
  assert.equal(parsed.mode, "execute");
  assert.equal(parsed.execute, true);
  assert.equal(parsed.limit, 25);
  assert.equal(parsed.batchSize, 20);
  assert.equal(parsed.filters.companyCode, "630010001");
});

test("sync trigger returns 409 when another job is active", async () => {
  const db = createMockDb({
    activeJob: {
      job_id: 99,
      status: "running",
    },
  });
  const runner = createNoopRunner();

  const { app } = createApp({
    config: buildConfig(),
    db,
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
    searchEmbeddingSyncJobRunner: runner,
  });

  const agent = request.agent(app);
  const csrfToken = await loginAsAdmin(agent);
  const response = await agent
    .post("/api/search/skus/sync")
    .set("x-csrf-token", csrfToken)
    .send({ mode: "dry_run", limit: 10 });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "JOB_ALREADY_RUNNING");
  assert.equal(runner.enqueued.length, 0);
});

test("sync trigger queues job and returns job_id", async () => {
  const db = createMockDb();
  const runner = createNoopRunner();

  const { app } = createApp({
    config: buildConfig(),
    db,
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
    searchEmbeddingSyncJobRunner: runner,
  });

  const agent = request.agent(app);
  const csrfToken = await loginAsAdmin(agent);
  const response = await agent
    .post("/api/search/skus/sync")
    .set("x-csrf-token", csrfToken)
    .send({ mode: "dry_run", limit: 10, filters: { product_kind: "medicine" } });

  assert.equal(response.status, 202);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.job_id, 123);
  assert.equal(runner.enqueued[0], 123);
  assert.equal(db.insertedJobs.length, 1);
  assert.equal(db.insertedJobs[0].mode, "dry_run");
});
