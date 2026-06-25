"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");
const { createApp } = require("../apps/admin-api/src/server");

function buildConfig(overrides = {}) {
  return {
    nodeEnv: "test",
    port: 0,
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    cipdataSupabaseUrl: "https://example.supabase.co",
    cipdataSupabaseServiceRoleKey: "test-cipdata-service-role",
    authJwtSecret: "test-jwt-secret",
    cookieName: "admin_session",
    cookieSecure: false,
    cookieSameSite: "lax",
    sessionTtlHours: 12,
    trustProxy: false,
    corsAllowedOrigins: new Set(),
    corsAllowAllOrigins: false,
    loginRateLimitMax: 20,
    loginRateLimitWindowMs: 60_000,
    maxUploadBytes: 5 * 1024 * 1024,
    defaultPeriodDays: 30,
    featureStockRequests: false,
    featureMobilePda: false,
    mobileEnrollCodeTtlSeconds: 60,
    mobileTokenTtlHours: 24,
    embeddingProvider: "mock",
    embeddingModel: "mock-embedding-model",
    embeddingDimension: 1536,
    embeddingTimeoutMs: 30_000,
    embeddingOpenAiBaseUrl: "https://api.openai.com/v1",
    adminUsers: new Set(["admin@example.com"]),
    staffUsers: new Set(["staff@example.com"]),
    branchUsers: new Set(),
    adminPasswordHash: bcrypt.hashSync("admin-pass-123", 10),
    staffPasswordHash: bcrypt.hashSync("staff-pass-123", 10),
    branchUserBranches: new Map(),
    branchUserPasswordHashes: new Map(),
    posApiKeys: new Set(["test-pos-key"]),
    crmMirrorBaseUrl: "",
    crmMirrorInternalToken: "",
    staffBranchAllowlists: new Map(),
    ...overrides,
  };
}

function createMockDb() {
  return {
    connect() {
      return {
        query: this.query.bind(this),
        async release() {},
      };
    },
    async query() {
      throw new Error("Unexpected database query in CiPData route test.");
    },
  };
}

function createJsonResponse(status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(payload, {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function buildEncounterRow(overrides = {}) {
  return {
    encounter_id: "enc-001",
    branch_no: "001",
    encounter_at: "2026-06-25T09:15:00+07:00",
    followup_call: "2026-06-27T10:00:00+07:00",
    patient_pid: "1101700000001",
    patient_name: "Patient Example",
    patient_phone: "0812345678",
    symptom_no: 205,
    symptom_name: "ไอ เจ็บคอ",
    th_answers: "<p>เจ็บคอ 2 วัน</p>",
    meds_json: '[{"name":"Paracetamol","qty":10,"uom":"เม็ด"}]',
    meds_amed_th: "Paracetamol",
    pharm_warning: "โทรติดตาม",
    ...overrides,
  };
}

function createFetchMock() {
  const calls = [];

  async function fetchMock(url, options = {}) {
    const parsed = new URL(url);
    calls.push({
      url: parsed,
      options,
    });

    if (parsed.pathname.endsWith("/rest/v1/v_encounters_lookup_ui")) {
      const select = parsed.searchParams.get("select");
      const rangeHeader = options.headers && options.headers.Range;
      const prefer = options.headers && options.headers.Prefer;

      if (select === "branch_no") {
        return createJsonResponse(200, [{ branch_no: "001" }, { branch_no: "002" }, { branch_no: "001" }]);
      }

      if (parsed.searchParams.get("encounter_id") === "eq.enc-001") {
        return createJsonResponse(200, [buildEncounterRow()]);
      }

      if (parsed.searchParams.get("followup_call")) {
        return createJsonResponse(200, [buildEncounterRow()], {
          "content-range": "0-0/1",
        });
      }

      if (prefer === "count=exact" && rangeHeader === "0-0") {
        const encounterFilterValues = parsed.searchParams.getAll("encounter_at");
        if (encounterFilterValues.some((value) => String(value).includes("2026-06-25"))) {
          return createJsonResponse(200, [], { "content-range": "0-0/5" });
        }
        return createJsonResponse(200, [], { "content-range": "0-0/18" });
      }

      return createJsonResponse(200, [buildEncounterRow()], {
        "content-range": "0-0/1",
      });
    }

    if (parsed.pathname.endsWith("/rest/v1/v_encounter_meds_min")) {
      return createJsonResponse(200, [
        {
          barcode: "885000001",
          sku_id: 1001,
          item_id: 1001,
          qty: 10,
          unit_price: 12.5,
          line_total: 125,
          use_text: "หลังอาหาร",
          directions_text: "ครั้งละ 1 เม็ด",
          use_text_agg: "หลังอาหาร เช้า-เย็น",
          amed_full_name: "Paracetamol 500mg",
          amed_short_name: "Para",
          verified_by: "pharm001",
        },
      ]);
    }

    if (parsed.pathname.endsWith("/rest/v1/rpc/sku_qty_summary")) {
      return createJsonResponse(200, [
        {
          sku_id: "SKU-001",
          company_code: "CMP-01",
          sku_name: "Paracetamol 500mg",
          uom: "เม็ด",
          qty_in_base: 1,
          total_qty: 10,
          orders: 2,
          last_sold: "2026-06-25T09:15:00+07:00",
        },
      ]);
    }

    return createJsonResponse(404, { error: `Unhandled URL: ${parsed.toString()}` });
  }

  return {
    calls,
    fetchMock,
  };
}

function createTestApp(options = {}) {
  const config = buildConfig(options.configOverrides || {});
  const db = createMockDb();
  const { fetchMock, calls } = createFetchMock();
  const { app } = createApp({
    config,
    db,
    fetchImpl: options.fetchImpl || fetchMock,
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
  });

  return {
    app,
    calls,
  };
}

test("cipdata branches and encounters endpoints normalize list responses", async () => {
  const { app } = createTestApp();

  const branchesResponse = await request(app).get("/api/cipdata/branches");
  assert.equal(branchesResponse.status, 200);
  assert.deepEqual(branchesResponse.body.branches, [
    { branchCode: "001", branchName: "" },
    { branchCode: "002", branchName: "" },
  ]);

  const encountersResponse = await request(app).get("/api/cipdata/encounters?page=1&pageSize=25&branchCode=001");
  assert.equal(encountersResponse.status, 200);
  assert.equal(encountersResponse.body.total, 1);
  assert.equal(encountersResponse.body.records[0].encounterId, "enc-001");
  assert.equal(encountersResponse.body.records[0].branchNo, "001");
  assert.equal(encountersResponse.body.records[0].symptomName, "ไอ เจ็บคอ");
});

test("cipdata detail and medication endpoints normalize record payloads", async () => {
  const { app } = createTestApp();

  const detailResponse = await request(app).get("/api/cipdata/encounters/enc-001");
  assert.equal(detailResponse.status, 200);
  assert.equal(detailResponse.body.patientName, "Patient Example");

  const medicationsResponse = await request(app).get("/api/cipdata/encounters/enc-001/medications");
  assert.equal(medicationsResponse.status, 200);
  assert.equal(medicationsResponse.body.records[0].amedFullName, "Paracetamol 500mg");
  assert.equal(medicationsResponse.body.records[0].lineTotal, 125);
});

test("cipdata kpis endpoint computes counts from Supabase content-range totals", async () => {
  const { app } = createTestApp();

  const response = await request(app).get("/api/cipdata/kpis?branchCode=001&monthlyTarget=30");
  assert.equal(response.status, 200);
  assert.equal(response.body.todayCount, 5);
  assert.equal(response.body.accumCount, 5);
  assert.equal(response.body.target, 30);
  assert.ok(response.body.remaining >= 0);
});

test("cipdata summary, followups, and report preview endpoints return public lookup payloads", async () => {
  const { app } = createTestApp();

  const summaryResponse = await request(app).get("/api/cipdata/summary?dateFrom=2026-06-01&dateTo=2026-06-25");
  assert.equal(summaryResponse.status, 200);
  assert.equal(summaryResponse.body.records[0].skuName, "Paracetamol 500mg");
  assert.equal(summaryResponse.body.totals.totalOrders, 2);

  const followupsResponse = await request(app).get("/api/cipdata/followups?date=2026-06-27");
  assert.equal(followupsResponse.status, 200);
  assert.equal(followupsResponse.body.records[0].followupCall, "2026-06-27T10:00:00+07:00");

  const reportResponse = await request(app).get("/api/cipdata/report-preview?reportType=range&dateFrom=2026-06-01&dateTo=2026-06-25");
  assert.equal(reportResponse.status, 200);
  assert.equal(reportResponse.body.records[0].encounterId, "enc-001");
  assert.equal(reportResponse.body.meta.reportType, "range");
});

test("cipdata endpoints fail closed when backend Supabase env is missing", async () => {
  const { app } = createTestApp({
    configOverrides: {
      cipdataSupabaseUrl: "",
      cipdataSupabaseServiceRoleKey: "",
    },
  });

  const response = await request(app).get("/api/cipdata/branches");
  assert.equal(response.status, 503);
  assert.match(response.body.error, /CiPData is not configured/i);
});
