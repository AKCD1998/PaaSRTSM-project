"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

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
    featureStockRequests: false,
    adminUsers: new Set(["admin@example.com"]),
    staffUsers: new Set(["staff@example.com", "staff2@example.com"]),
    branchUsers: new Set(["branch001@example.com"]),
    adminPasswordHash: bcrypt.hashSync("admin-pass-123", 10),
    staffPasswordHash: bcrypt.hashSync("staff-pass-123", 10),
    branchUserBranches: new Map([["branch001@example.com", "001"]]),
    branchUserPasswordHashes: new Map([["branch001@example.com", bcrypt.hashSync("branch-pass-001", 10)]]),
    posApiKeys: new Set(),
    staffBranchAllowlists: new Map(),

    featureVideoStudio: true,
    videoProviderDefault: "mock",
    videoProviderEnabled: new Set(["mock"]),
    videoProviderApiKey: "",
    videoProviderModel: "sora-2",
    videoProviderWebhookSecret: "",
    videoStorageProvider: "local",
    videoStorageLocalDir: path.join(os.tmpdir(), `video-studio-test-${crypto.randomUUID()}`),
    videoStorageBucket: "",
    videoStoragePublicBaseUrl: "",
    videoSignedUrlSecret: "test-signed-url-secret",
    videoMaxPromptLength: 200,
    videoMaxUploadBytes: 5 * 1024 * 1024,
    videoMaxJobsPerUserPerDay: 20,
    videoMaxConcurrentJobsPerUser: 3,
    videoMaxRetries: 2,
    videoPollIntervalMs: 10_000,
    videoMaxPollMinutes: 30,
    usdToThbRate: 36.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock DB — content.video_jobs / content.video_job_events / content.video_assets
// ---------------------------------------------------------------------------

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function createVideoStudioMockDb() {
  const state = {
    videoJobs: [],
    videoJobEvents: [],
    videoAssets: [],
    nextJobId: 1,
    nextEventId: 1,
    nextAssetId: 1,
    branches: new Map([
      ["001", { branch_code: "001", branch_name: "Branch 001", is_active: true, is_hq: false }],
    ]),
  };

  // Generic WHERE-clause interpreter shared by single-row lookups, CAS updates,
  // and the filtered list query — extracts `(column) (op) $(n)` triples from the
  // raw SQL and resolves each against the params array, regardless of clause
  // order or which optional filters are present.
  function extractConditions(sql, params) {
    const conditions = [];
    const regex = /(\w[\w.]*)\s*(=|ilike|>=|<=)\s*\$(\d+)/gi;
    let match;
    while ((match = regex.exec(sql)) !== null) {
      conditions.push({ column: match[1].toLowerCase(), op: match[2].toLowerCase(), value: params[Number(match[3]) - 1] });
    }
    return conditions;
  }

  function rowMatchesConditions(row, conditions) {
    return conditions.every(({ column, op, value }) => {
      const rowValue = row[column];
      if (op === "=") return String(rowValue) === String(value);
      if (op === "ilike") {
        const needle = String(value).replace(/%/g, "").toLowerCase();
        return String(rowValue || "").toLowerCase().includes(needle);
      }
      if (op === ">=") return new Date(rowValue) >= new Date(value);
      if (op === "<=") return new Date(rowValue) <= new Date(value);
      return true;
    });
  }

  function matchesInClause(sql, columnStatusValue, allowedList) {
    return allowedList.includes(columnStatusValue);
  }

  async function query(sql, params = []) {
    const normalized = normalizeSql(sql);

    if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
      return { rowCount: 0, rows: [] };
    }

    if (normalized.includes("from core.branches") && normalized.includes("where branch_code = $1")) {
      const branch = state.branches.get(String(params[0] || "")) || null;
      return { rowCount: branch ? 1 : 0, rows: branch ? [branch] : [] };
    }

    // --- video_jobs: insert -------------------------------------------------
    if (normalized.startsWith("insert into content.video_jobs")) {
      const row = {
        job_id: state.nextJobId++,
        job_public_id: params[0],
        created_at: nowIso(),
        updated_at: nowIso(),
        created_by: params[1],
        status: "draft",
        provider: params[2],
        model: params[3],
        provider_job_id: null,
        prompt: params[4],
        negative_prompt: params[5] ?? null,
        aspect_ratio: params[6],
        duration_seconds: params[7],
        input_asset_id: params[8] ?? null,
        product_id_or_sku_reference: params[9] ?? null,
        output_asset_id: null,
        estimated_cost: null,
        actual_cost: null,
        error_code: null,
        error_message: null,
        retry_count: 0,
        submitted_at: null,
        started_at: null,
        completed_at: null,
        approved_at: null,
        approved_by: null,
        rejected_at: null,
        rejected_by: null,
        rejection_reason: null,
        metadata_json: {},
      };
      state.videoJobs.push(row);
      return { rowCount: 1, rows: [row] };
    }

    // --- video_job_events: insert -------------------------------------------
    if (normalized.startsWith("insert into content.video_job_events")) {
      const row = {
        event_id: state.nextEventId++,
        video_job_id: Number(params[0]),
        event_type: params[1],
        message: params[2] ?? null,
        payload_json: params[3] ? JSON.parse(params[3]) : {},
        created_at: nowIso(),
        created_by: params[4] ?? null,
      };
      state.videoJobEvents.push(row);
      return { rowCount: 1, rows: [] };
    }

    // --- video_jobs: single select by job_id (with or without FOR UPDATE) ---
    if (
      normalized.startsWith("select * from content.video_jobs") &&
      normalized.includes("where job_id = $1") &&
      !normalized.includes("order by")
    ) {
      const row = state.videoJobs.find((item) => item.job_id === Number(params[0])) || null;
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }

    // --- video_jobs: filtered list -------------------------------------------
    if (normalized.startsWith("select * from content.video_jobs") && normalized.includes("order by job_id desc")) {
      if (normalized.includes("1=0")) {
        return { rowCount: 0, rows: [] };
      }
      const limit = Number(params[params.length - 2]);
      const offset = Number(params[params.length - 1]);
      const conditions = extractConditions(sql, params);
      const filtered = state.videoJobs
        .filter((row) => rowMatchesConditions(row, conditions))
        .sort((a, b) => b.job_id - a.job_id)
        .slice(offset, offset + limit);
      return { rowCount: filtered.length, rows: filtered };
    }

    // --- video_jobs: daily submitted count -----------------------------------
    if (normalized.includes("count(*)::int as count from content.video_jobs") && normalized.includes("submitted_at >=")) {
      const count = state.videoJobs.filter(
        (row) => row.created_by === params[0] && row.submitted_at != null,
      ).length;
      return { rowCount: 1, rows: [{ count }] };
    }

    // --- video_jobs: concurrent count -----------------------------------------
    if (normalized.includes("count(*)::int as count from content.video_jobs") && normalized.includes("status in ('queued', 'processing')")) {
      const count = state.videoJobs.filter(
        (row) => row.created_by === params[0] && ["queued", "processing"].includes(row.status),
      ).length;
      return { rowCount: 1, rows: [{ count }] };
    }

    // --- video_jobs: CAS updates ----------------------------------------------
    if (normalized.startsWith("update content.video_jobs")) {
      const jobId = Number(params[0]);
      const row = state.videoJobs.find((item) => item.job_id === jobId);

      if (normalized.includes("set status = 'queued', submitted_at = now()")) {
        if (!row || !matchesInClause(sql, row.status, ["draft", "failed"])) {
          return { rowCount: 0, rows: [] };
        }
        row.status = "queued";
        row.submitted_at = nowIso();
        row.updated_at = nowIso();
        return { rowCount: 1, rows: [row] };
      }

      if (normalized.includes("set provider_job_id = $2")) {
        if (!row) return { rowCount: 0, rows: [] };
        row.provider_job_id = params[1];
        row.status = params[2];
        row.estimated_cost = params[3] ?? null;
        row.updated_at = nowIso();
        return { rowCount: 1, rows: [row] };
      }

      if (normalized.includes("set status = 'draft', retry_count = retry_count + 1")) {
        if (!row || row.status !== "failed") {
          return { rowCount: 0, rows: [] };
        }
        row.status = "draft";
        row.retry_count += 1;
        row.updated_at = nowIso();
        return { rowCount: 1, rows: [row] };
      }

      if (normalized.includes("set status = 'cancelled'")) {
        if (!row || !matchesInClause(sql, row.status, ["draft", "queued", "processing"])) {
          return { rowCount: 0, rows: [] };
        }
        row.status = "cancelled";
        row.updated_at = nowIso();
        return { rowCount: 1, rows: [row] };
      }

      if (normalized.includes("set status = 'approved'")) {
        if (!row || row.status !== "completed") {
          return { rowCount: 0, rows: [] };
        }
        row.status = "approved";
        row.approved_at = nowIso();
        row.approved_by = params[1];
        row.updated_at = nowIso();
        return { rowCount: 1, rows: [row] };
      }

      if (normalized.includes("set status = 'rejected'")) {
        if (!row || row.status !== "completed") {
          return { rowCount: 0, rows: [] };
        }
        row.status = "rejected";
        row.rejected_at = nowIso();
        row.rejected_by = params[1];
        row.rejection_reason = params[2];
        row.updated_at = nowIso();
        return { rowCount: 1, rows: [row] };
      }

      // Runner updates (processing/completed/failed) — used only by direct test
      // manipulation helpers below, not exercised via the runner in this file.
      return { rowCount: 0, rows: [] };
    }

    // --- video_jobs: output_asset_id lookup (asset visibility) ---------------
    if (normalized.startsWith("select status from content.video_jobs where output_asset_id")) {
      const row = state.videoJobs.find((item) => item.output_asset_id === Number(params[0])) || null;
      return { rowCount: row ? 1 : 0, rows: row ? [{ status: row.status }] : [] };
    }

    // --- video_job_events: list ------------------------------------------------
    if (normalized.startsWith("select * from content.video_job_events")) {
      const rows = state.videoJobEvents
        .filter((row) => row.video_job_id === Number(params[0]))
        .sort((a, b) => a.event_id - b.event_id);
      return { rowCount: rows.length, rows };
    }

    // --- video_assets: insert (upload-init) -------------------------------------
    if (normalized.startsWith("insert into content.video_assets")) {
      const row = {
        asset_id: state.nextAssetId++,
        asset_public_id: params[0],
        created_at: nowIso(),
        created_by: params[1],
        storage_provider: params[2],
        storage_key: "",
        original_filename: params[4] ?? null,
        mime_type: params[5] ?? null,
        file_size_bytes: null,
        asset_type: params[3],
        checksum: null,
        width: null,
        height: null,
        duration_seconds: null,
        metadata_json: {},
      };
      state.videoAssets.push(row);
      return { rowCount: 1, rows: [row] };
    }

    // --- video_assets: single select --------------------------------------------
    if (normalized.startsWith("select * from content.video_assets where asset_id = $1")) {
      const row = state.videoAssets.find((item) => item.asset_id === Number(params[0])) || null;
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }

    // --- video_assets: finalize update -------------------------------------------
    if (normalized.startsWith("update content.video_assets")) {
      const row = state.videoAssets.find((item) => item.asset_id === Number(params[0]));
      if (!row) return { rowCount: 0, rows: [] };
      row.storage_key = params[1];
      row.file_size_bytes = params[2];
      row.checksum = params[3];
      row.mime_type = params[4];
      row.original_filename = params[5];
      return { rowCount: 1, rows: [row] };
    }

    if (normalized.startsWith("insert into public.audit_logs")) {
      return { rowCount: 1, rows: [{ audit_id: 1, event_time: nowIso() }] };
    }

    // --- usage summary aggregates ---------------------------------------------
    if (normalized.includes("job_count") && normalized.includes("from content.video_jobs")) {
      function aggregate(rows) {
        return {
          job_count: rows.length,
          total_estimated_cost_usd: rows.reduce((sum, row) => sum + Number(row.estimated_cost || 0), 0),
          total_actual_cost_usd: rows.reduce((sum, row) => sum + Number(row.actual_cost || 0), 0),
        };
      }

      if (normalized.includes("group by provider, model")) {
        const groups = new Map();
        for (const row of state.videoJobs) {
          const key = `${row.provider}::${row.model}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(row);
        }
        const rows = [...groups.entries()].map(([key, groupRows]) => {
          const [provider, model] = key.split("::");
          return { provider, model, ...aggregate(groupRows) };
        });
        return { rowCount: rows.length, rows };
      }

      if (normalized.includes("group by created_by")) {
        const groups = new Map();
        for (const row of state.videoJobs) {
          if (!groups.has(row.created_by)) groups.set(row.created_by, []);
          groups.get(row.created_by).push(row);
        }
        const rows = [...groups.entries()].map(([createdBy, groupRows]) => ({
          created_by: createdBy,
          ...aggregate(groupRows),
        }));
        return { rowCount: rows.length, rows };
      }

      if (normalized.includes("date_trunc('month', now())")) {
        const startOfMonth = new Date();
        startOfMonth.setUTCDate(1);
        startOfMonth.setUTCHours(0, 0, 0, 0);
        const rows = state.videoJobs.filter((row) => new Date(row.created_at) >= startOfMonth);
        return { rowCount: 1, rows: [aggregate(rows)] };
      }

      return { rowCount: 1, rows: [aggregate(state.videoJobs)] };
    }

    throw new Error(`Unhandled mock query: ${normalized}`);
  }

  return {
    state,
    connect() {
      return {
        query,
        async release() {},
      };
    },
    query,
    async end() {},
  };
}

function createNoopVideoJobRunner() {
  return {
    schedulePoll() {},
    stop() {},
  };
}

function createTestApp(configOverrides = {}) {
  const db = createVideoStudioMockDb();
  const { app } = createApp({
    config: buildConfig(configOverrides),
    db,
    videoJobRunner: createNoopVideoJobRunner(),
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
  });
  return { app, db };
}

async function login(agent, credentials) {
  const response = await agent.post("/admin/auth/login").send(credentials);
  assert.equal(response.status, 200);
  return response.body.csrf_token;
}

async function createDraftJob(agent, csrfToken, overrides = {}) {
  const payload = {
    prompt: "a bottle of vitamin C rotating on a white background",
    aspectRatio: "16:9",
    durationSeconds: 4,
    provider: "mock",
    model: "mock-v1",
    ...overrides,
  };
  return agent.post("/api/content/video-jobs").set("x-csrf-token", csrfToken).send(payload);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("job creation validation rejects a blank prompt", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await login(agent, { username: "staff@example.com", password: "staff-pass-123" });
  const response = await createDraftJob(agent, csrfToken, { prompt: "   " });
  assert.equal(response.status, 400);
});

test("job creation validation rejects an unsupported aspect ratio", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await login(agent, { username: "staff@example.com", password: "staff-pass-123" });
  const response = await createDraftJob(agent, csrfToken, { aspectRatio: "4:3" });
  assert.equal(response.status, 400);
});

test("job creation validation rejects a duration not on the provider's allow-list", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await login(agent, { username: "staff@example.com", password: "staff-pass-123" });
  const response = await createDraftJob(agent, csrfToken, { durationSeconds: 7 });
  assert.equal(response.status, 400);
});

test("job creation validation rejects a provider not enabled server-side", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await login(agent, { username: "staff@example.com", password: "staff-pass-123" });
  const response = await createDraftJob(agent, csrfToken, { provider: "openai", model: "sora-2" });
  assert.equal(response.status, 400);
});

test("job creation validation rejects a model not allow-listed for the provider", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await login(agent, { username: "staff@example.com", password: "staff-pass-123" });
  const response = await createDraftJob(agent, csrfToken, { model: "some-other-model" });
  assert.equal(response.status, 400);
});

// ---------------------------------------------------------------------------
// AuthN/AuthZ
// ---------------------------------------------------------------------------

test("unauthenticated requests cannot create a video job", async () => {
  const { app } = createTestApp();
  const response = await request(app).post("/api/content/video-jobs").send({});
  assert.equal(response.status, 401);
});

test("branch role cannot create a video job", async () => {
  const { app } = createTestApp({ featureStockRequests: true });
  const agent = request.agent(app);
  const csrfToken = await login(agent, { username: "branch001@example.com", password: "branch-pass-001" });
  const response = await createDraftJob(agent, csrfToken);
  assert.equal(response.status, 403);
});

test("staff role cannot approve a video job", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await login(agent, { username: "staff@example.com", password: "staff-pass-123" });
  const createResponse = await createDraftJob(agent, csrfToken);
  assert.equal(createResponse.status, 201);
  const jobId = createResponse.body.job.jobId;

  const approveResponse = await agent
    .post(`/api/content/video-jobs/${jobId}/approve`)
    .set("x-csrf-token", csrfToken)
    .send({});
  assert.equal(approveResponse.status, 403);
});

// ---------------------------------------------------------------------------
// Submit / retry state machine
// ---------------------------------------------------------------------------

test("submitting the same job twice returns 409 on the second attempt", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await login(agent, { username: "staff@example.com", password: "staff-pass-123" });
  const createResponse = await createDraftJob(agent, csrfToken);
  const jobId = createResponse.body.job.jobId;

  const firstSubmit = await agent.post(`/api/content/video-jobs/${jobId}/submit`).set("x-csrf-token", csrfToken).send({});
  assert.equal(firstSubmit.status, 200);
  assert.equal(firstSubmit.body.job.status, "queued");

  const secondSubmit = await agent.post(`/api/content/video-jobs/${jobId}/submit`).set("x-csrf-token", csrfToken).send({});
  assert.equal(secondSubmit.status, 409);
});

test("retry is capped at VIDEO_MAX_RETRIES and then returns 400", async () => {
  const { app, db } = createTestApp({ videoMaxRetries: 1 });
  const agent = request.agent(app);
  const csrfToken = await login(agent, { username: "staff@example.com", password: "staff-pass-123" });
  const createResponse = await createDraftJob(agent, csrfToken);
  const jobId = createResponse.body.job.jobId;

  // Force the job into a failed state to exercise the retry path directly,
  // simulating what the runner would do after a provider failure.
  const row = db.state.videoJobs.find((item) => item.job_id === jobId);
  row.status = "failed";

  const firstRetry = await agent.post(`/api/content/video-jobs/${jobId}/retry`).set("x-csrf-token", csrfToken).send({});
  assert.equal(firstRetry.status, 200);
  assert.equal(firstRetry.body.job.retryCount, 1);
  assert.equal(firstRetry.body.job.status, "queued");

  row.status = "failed";
  const secondRetry = await agent.post(`/api/content/video-jobs/${jobId}/retry`).set("x-csrf-token", csrfToken).send({});
  assert.equal(secondRetry.status, 400);
});

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

test("a staff member cannot see another staff member's non-approved job (404, not 403)", async () => {
  const { app } = createTestApp();
  const ownerAgent = request.agent(app);
  const ownerCsrf = await login(ownerAgent, { username: "staff@example.com", password: "staff-pass-123" });
  const createResponse = await createDraftJob(ownerAgent, ownerCsrf);
  const jobId = createResponse.body.job.jobId;

  const otherAgent = request.agent(app);
  const otherCsrf = await login(otherAgent, { username: "staff2@example.com", password: "staff-pass-123" });
  const response = await otherAgent.get(`/api/content/video-jobs/${jobId}`).set("x-csrf-token", otherCsrf);
  assert.equal(response.status, 404);
});

// ---------------------------------------------------------------------------
// Download token verification
// ---------------------------------------------------------------------------

test("GET /assets/binary rejects a tampered token with 403", async () => {
  const { app } = createTestApp();
  const response = await request(app)
    .get("/api/content/assets/binary")
    .query({ key: "content/x.mp4", exp: String(Math.floor(Date.now() / 1000) + 300), token: "0".repeat(64) });
  assert.equal(response.status, 403);
});

// ---------------------------------------------------------------------------
// Duration allow-list is per model, not just per provider
// ---------------------------------------------------------------------------

test("a duration valid for sora-2-pro is rejected for sora-2 (model-specific allow-list)", async () => {
  const { app } = createTestApp({ videoProviderEnabled: new Set(["mock", "openai"]) });
  const agent = request.agent(app);
  const csrfToken = await login(agent, { username: "staff@example.com", password: "staff-pass-123" });
  // 15s is valid for sora-2-pro but not sora-2.
  const response = await createDraftJob(agent, csrfToken, { provider: "openai", model: "sora-2", durationSeconds: 15 });
  assert.equal(response.status, 400);
});

// ---------------------------------------------------------------------------
// Usage summary
// ---------------------------------------------------------------------------

test("usage summary requires admin role", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await login(agent, { username: "staff@example.com", password: "staff-pass-123" });
  const response = await agent.get("/api/content/usage-summary").set("x-csrf-token", csrfToken);
  assert.equal(response.status, 403);
});

test("usage summary aggregates estimated cost across jobs and converts to THB", async () => {
  const { app, db } = createTestApp({ usdToThbRate: 35 });
  const agent = request.agent(app);
  const csrfToken = await login(agent, { username: "admin@example.com", password: "admin-pass-123" });

  const createResponse = await createDraftJob(agent, csrfToken);
  const jobId = createResponse.body.job.jobId;
  const row = db.state.videoJobs.find((item) => item.job_id === jobId);
  row.estimated_cost = 2;
  row.actual_cost = null;

  const response = await agent.get("/api/content/usage-summary").set("x-csrf-token", csrfToken);
  assert.equal(response.status, 200);
  assert.equal(response.body.usdToThbRate, 35);
  assert.equal(response.body.allTime.totalEstimatedCostUsd, 2);
  assert.equal(response.body.allTime.totalEstimatedCostThb, 70);
  assert.ok(Array.isArray(response.body.byProviderModel));
  assert.ok(Array.isArray(response.body.byUser));
});

test("GET /assets/binary rejects an expired token with 403", async () => {
  const { app } = createTestApp();
  const config = buildConfig();
  const key = "content/x.mp4";
  const expiredExp = Math.floor(Date.now() / 1000) - 60;
  const token = crypto.createHmac("sha256", config.videoSignedUrlSecret).update(`${key}:${expiredExp}`).digest("hex");

  const response = await request(app)
    .get("/api/content/assets/binary")
    .query({ key, exp: String(expiredExp), token });
  assert.equal(response.status, 403);
});
