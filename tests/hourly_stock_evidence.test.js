"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const request = require("supertest");
const fs = require("node:fs");
const path = require("node:path");

const {
  computeNextMorningMetrics,
  classifyCollectionQuality,
  parseCapturePayload,
  payloadIdentity,
} = require("../apps/admin-api/src/services/hourlyStockEvidence");
const {
  createHourlyStockEvidenceRouter,
} = require("../apps/admin-api/src/routes/hourly-stock-evidence");
const { loadConfig } = require("../apps/admin-api/src/config");
const TOKEN = "branch-005-secret".repeat(3);

function payload(overrides = {}) {
  const value = {
    contractVersion: "hourly-dual-stock-evidence-v1",
    datasetTag: "hourly_dual_stock_evidence",
    branchCode: "005",
    observationKind: "intraday",
    plannedSlot: "19:00",
    capturedAt: "2026-09-18T12:01:02.000Z",
    sourceEventAt: null,
    records: [
      { productCode: "P2", retailOnHand: 10, latestEstimatedOnHand: 8 },
      { productCode: "P1", retailOnHand: 20, latestEstimatedOnHand: 18 },
    ],
    clientMeta: { agentVersion: "1.0.0", queryDurationMs: 12, sqlConnectionAttempts: 1, sqlConnectionRetryCount: 0 },
    ...overrides,
  };
  const identityInput = { ...value, records: [...value.records].sort((a, b) => a.productCode.localeCompare(b.productCode)) };
  value.idempotencyKey = payloadIdentity(identityInput);
  return value;
}

function createMockDb() {
  const state = { runs: new Map(), rows: new Map(), nextId: 1, rowInsertCalls: 0 };
  const client = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
      if (["begin", "commit", "rollback"].includes(normalized)) return { rowCount: 0, rows: [] };
      if (normalized.startsWith("insert into evidence.hourly_stock_capture_runs")) {
        if (state.runs.has(params[0])) return { rowCount: 0, rows: [] };
        const row = {
          capture_id: state.nextId++, branch_code: params[2], payload_sha256: params[9],
          record_count: params[8], received_at: "2026-09-18T12:01:03.000Z",
        };
        state.runs.set(params[0], row);
        return { rowCount: 1, rows: [row] };
      }
      if (normalized.startsWith("select capture_id, branch_code")) {
        const row = state.runs.get(params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (normalized.startsWith("insert into evidence.hourly_stock_capture_rows")) {
        state.rowInsertCalls++;
        state.rows.set(params[0], params[1].map((productCode, index) => ({
          productCode, retailOnHand: params[2][index], latestEstimatedOnHand: params[3][index],
        })));
        return { rowCount: params[1].length, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
    release() {},
  };
  return { state, async connect() { return client; }, async query() { return { rows: [] }; } };
}

function createTestApp({ tokens = new Map([["005", TOKEN]]), db = createMockDb(), config = {} } = {}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/hourly-stock-evidence", createHourlyStockEvidenceRouter({
    config: { featureHourlyStockEvidence: true, hourlyStockEvidenceBranchTokens: tokens, ...config },
    db,
    requireAuthMiddleware: (_req, _res, next) => next(),
    requireRoleMiddleware: () => (_req, _res, next) => next(),
  }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
  return { app, db };
}

test("payload identity is deterministic and parser sorts selected cohort records", () => {
  const first = parseCapturePayload(payload());
  const second = parseCapturePayload(payload({ records: [...payload().records].reverse() }));
  assert.equal(first.payloadSha256, second.payloadSha256);
  assert.deepEqual(first.records.map((record) => record.productCode), ["P1", "P2"]);
  assert.equal(first.plannedFor, "2026-09-18T12:00:00.000Z");
  assert.equal(first.slotDelaySeconds, 62);
});

test("payload rejects inactive branch, wrong slot, duplicate products, and metadata outside the no-PII allowlist", () => {
  assert.throws(() => parseCapturePayload(payload({ branchCode: "002" })), /active fleet/);
  assert.throws(() => parseCapturePayload(payload({ plannedSlot: "14:30" })), /plannedSlot/);
  assert.throws(() => parseCapturePayload(payload({ records: [payload().records[0], payload().records[0]] })), /duplicated/);
  assert.throws(() => parseCapturePayload(payload({ clientMeta: { customerName: "forbidden" } })), /not allowed/);
});

test("capture endpoint fails closed without branch tokens and rejects mismatched branch identity", async () => {
  const disabled = createTestApp({ tokens: new Map() });
  assert.equal((await request(disabled.app).post("/api/hourly-stock-evidence/captures").send(payload())).status, 503);

  const enabled = createTestApp();
  const response = await request(enabled.app)
    .post("/api/hourly-stock-evidence/captures")
    .set("x-branch-code", "004")
    .set("x-hourly-evidence-token", TOKEN)
    .send(payload());
  assert.equal(response.status, 401);
});

test("duplicate retry is idempotent and never inserts product rows twice", async () => {
  const candidate = createTestApp();
  const send = () => request(candidate.app)
    .post("/api/hourly-stock-evidence/captures")
    .set("x-branch-code", "005")
    .set("x-hourly-evidence-token", TOKEN)
    .send(payload());
  const first = await send();
  const duplicate = await send();
  assert.equal(first.status, 201);
  assert.equal(first.body.duplicate, false);
  assert.equal(first.body.slotDelaySeconds, 62);
  assert.equal(first.body.ingestionDelaySeconds, 1);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(candidate.db.state.runs.size, 1);
  assert.equal(candidate.db.state.rowInsertCalls, 1);
  assert.equal(candidate.db.state.rows.get(1).length, 2);
});

test("next-morning metrics report exact match, direction and drift without a pass threshold", () => {
  const metrics = computeNextMorningMetrics({
    morningAnchorRows: [
      { productCode: "P1", retailOnHand: 20, latestEstimatedOnHand: 20 },
      { productCode: "P2", retailOnHand: 10, latestEstimatedOnHand: 10 },
    ],
    closingRows: [
      { productCode: "P1", retailOnHand: 20, latestEstimatedOnHand: 18 },
      { productCode: "P2", retailOnHand: 10, latestEstimatedOnHand: 12 },
    ],
    nextMorningRows: [
      { productCode: "P1", retailOnHand: 18, latestEstimatedOnHand: 18 },
      { productCode: "P2", retailOnHand: 9, latestEstimatedOnHand: 9 },
    ],
  });
  assert.deepEqual({
    eligible: metrics.eligibleProducts,
    exact: metrics.exactMatchCount,
    agreement: metrics.directionAgreementCount,
    mismatch: metrics.directionMismatchCount,
    drift: metrics.absoluteDriftSum,
    mean: metrics.absoluteDriftMean,
    max: metrics.absoluteDriftMax,
  }, { eligible: 2, exact: 1, agreement: 1, mismatch: 1, drift: 3, mean: 1.5, max: 3 });
  assert.equal("passed" in metrics, false);
});

test("summary stays incomplete when the 19:00 or next-morning slot is absent", async () => {
  const candidate = createTestApp();
  const response = await request(candidate.app)
    .get("/api/hourly-stock-evidence/summary?branchCode=005&date=2026-09-18");
  assert.equal(response.status, 200);
  assert.equal(response.body.comparisonStatus, "incomplete");
  assert.equal(response.body.dailyCompletenessStatus, "incomplete");
  assert.deepEqual(response.body.missingSlots, ["morning", "closing", "next_morning"]);
  assert.equal(response.body.missingPlannedSlots.length, 11);
  assert.equal(response.body.metrics, null);
});

test("19:00 makes comparison computable but daily completeness remains incomplete when 09:00-18:00 are missing", async () => {
  const timestamps = {
    morning: ["2026-09-18T01:20:00.000Z", "2026-09-18T01:20:05.000Z"],
    closing: ["2026-09-18T12:00:00.000Z", "2026-09-18T12:00:07.000Z"],
    next: ["2026-09-19T01:20:00.000Z", "2026-09-19T01:20:04.000Z"],
  };
  const rows = [
    { capture_role: "morning", planned_slot: "08:20", captured_at: timestamps.morning[0], planned_for: timestamps.morning[0], received_at: timestamps.morning[1], capture_count: 1, product_code: "P1", retail_on_hand: 20, latest_estimated_on_hand: 20 },
    { capture_role: "intraday", planned_slot: "19:00", captured_at: timestamps.closing[0], planned_for: timestamps.closing[0], received_at: timestamps.closing[1], capture_count: 2, product_code: "P1", retail_on_hand: 20, latest_estimated_on_hand: 18 },
    { capture_role: "next_morning", planned_slot: "08:20", captured_at: timestamps.next[0], planned_for: timestamps.next[0], received_at: timestamps.next[1], capture_count: 1, product_code: "P1", retail_on_hand: 18, latest_estimated_on_hand: 18 },
  ];
  const db = createMockDb();
  db.query = async () => ({ rows });
  const candidate = createTestApp({ db });
  const response = await request(candidate.app)
    .get("/api/hourly-stock-evidence/summary?branchCode=005&date=2026-09-18");
  assert.equal(response.status, 200);
  assert.equal(response.body.comparisonStatus, "compared");
  assert.equal(response.body.metrics.exactMatchCount, 1);
  assert.equal(response.body.dailyCompletenessStatus, "incomplete");
  assert.deepEqual(response.body.capturedPlannedSlots, ["19:00"]);
  assert.equal(response.body.missingPlannedSlots.length, 10);
  assert.equal(response.body.slotEvidence.intraday[0].captureCount, 2);
  assert.equal(response.body.slotEvidence.intraday[0].duplicateCaptureCount, 1);
  assert.equal(response.body.slotEvidence.intraday[0].slotDelaySeconds, 0);
});

test("configuration is fail-closed and accepts only active per-branch token entries", () => {
  assert.equal(loadConfig({}).hourlyStockEvidenceBranchTokens.size, 0);
  const config = loadConfig({
    HOURLY_STOCK_EVIDENCE_BRANCH_TOKENS: "005=" + "token:with:colons".repeat(3) + ";001=" + "second".repeat(8),
  });
  assert.deepEqual([...config.hourlyStockEvidenceBranchTokens.keys()], ["005", "001"]);
  assert.equal(config.hourlyStockEvidenceBranchTokens.get("005"), "token:with:colons".repeat(3));
});

test("token policy rejects duplicate branches/shared/short/malformed credentials and flag remains OFF", async () => {
  assert.equal(loadConfig({}).featureHourlyStockEvidence, false);
  assert.equal(loadConfig({}).featureHourlyStockEvidenceRetention, false);
  assert.equal(loadConfig({}).hourlyStockEvidenceMaxSlotDelaySeconds, null);
  for (const entries of ["005=short", "005=" + TOKEN + ";004=" + TOKEN, "005=" + TOKEN + ";005=" + TOKEN, "002=" + TOKEN, "005=" + TOKEN + ";bad"]) {
    assert.equal(loadConfig({ HOURLY_STOCK_EVIDENCE_BRANCH_TOKENS: entries }).hourlyStockEvidenceBranchTokens.size, 0);
  }
  const disabled = createTestApp({ config: { featureHourlyStockEvidence: false } });
  assert.equal((await request(disabled.app).post("/api/hourly-stock-evidence/captures")
    .set("x-branch-code", "005").set("x-hourly-evidence-token", TOKEN).send(payload())).status, 503);
});

test("early capture, evening recovery mislabeled morning, and receipt-less morning are rejected", () => {
  assert.throws(() => parseCapturePayload(payload({ capturedAt: "2026-09-18T11:59:59.000Z" })), /precede/);
  assert.throws(() => parseCapturePayload(payload({ observationKind: "morning_anchor", plannedSlot: "08:20",
    clientMeta: { authoritativeSyncRunId: "9" } })), /before 09:00/);
  assert.throws(() => parseCapturePayload(payload({ observationKind: "morning_anchor", plannedSlot: "08:20",
    capturedAt: "2026-09-18T01:20:05.000Z" })), /receipt/);
});

test("morning persistence checks central branch/full/terminal receipt and rolls back invalid proof", async () => {
  const { persistCapture } = require("../apps/admin-api/src/routes/hourly-stock-evidence");
  const capture = parseCapturePayload(payload({ observationKind: "morning_anchor", plannedSlot: "08:20",
    capturedAt: "2026-09-18T01:20:05.000Z", clientMeta: { authoritativeSyncRunId: "9" } }));
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push(sql);
    if (sql.includes("FROM ingest.sync_runs")) {
      assert.deepEqual(params, ["9", "005", capture.capturedAt]);
      assert.match(sql, /snapshot_mode = 'full'/);
      assert.match(sql, /status = 'success'/);
      assert.match(sql, /apply_status = 'applied'/);
      return { rows: [] };
    }
    return { rows: [] };
  }};
  await assert.rejects(persistCapture(client, capture), (e) => e.status === 409);
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.equal(calls.some((sql) => sql.startsWith("INSERT")), false);
});

test("qualification requires complete unique timely cohort and explicit lateness policy, not a stock pass threshold", () => {
  const slot = { captureCount: 1, slotDelaySeconds: 5 };
  const evidence = { morning: slot, intraday: Array.from({ length: 11 }, () => slot), nextMorning: slot };
  const args = { slotEvidence: evidence, missingPlannedSlots: [], metrics: { eligibleProducts: 2 }, maxSlotDelaySeconds: 10 };
  assert.equal(classifyCollectionQuality(args).qualifying, true);
  assert.deepEqual(classifyCollectionQuality({ ...args, maxSlotDelaySeconds: null }).reasons, ["lateness-policy-pending"]);
  assert.equal(classifyCollectionQuality({ ...args, missingPlannedSlots: ["10:00"] }).qualifying, false);
  assert.equal(classifyCollectionQuality({ ...args, maxSlotDelaySeconds: 1 }).qualifying, false);
  assert.equal(classifyCollectionQuality({ ...args, metrics: { eligibleProducts: 1, missingEstimatedValue: 1 } }).qualifying, false);
  assert.equal(classifyCollectionQuality({ ...args, slotEvidence: { ...evidence, morning: { ...slot, captureCount: 2 } } }).qualifying, false);
});

test("retention rejects expired replay instead of resurrecting pruned evidence", async () => {
  const candidate = createTestApp({ config: { featureHourlyStockEvidenceRetention: true, hourlyStockEvidenceRetentionDays: 3 } });
  const response = await request(candidate.app).post("/api/hourly-stock-evidence/captures")
    .set("x-branch-code", "005").set("x-hourly-evidence-token", TOKEN).send(payload({ capturedAt: "2020-09-18T12:01:02.000Z" }));
  assert.equal(response.status, 410);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(candidate.db.state.runs.size, 0);
});

test("complete hourly slots do not qualify with a missing/null cohort or duplicate anchor", async () => {
  const slotRow = (role, slot, date, retail, estimated) => {
    const planned = new Date(date + "T" + slot + ":00+07:00").toISOString();
    return { capture_role: role, planned_slot: slot, planned_for: planned,
      captured_at: new Date(new Date(planned).getTime() + 5000).toISOString(),
      received_at: new Date(new Date(planned).getTime() + 6000).toISOString(),
      capture_count: 1, product_code: "P1", retail_on_hand: retail, latest_estimated_on_hand: estimated };
  };
  const rows = [slotRow("morning", "08:20", "2026-09-18", 20, 20),
    slotRow("next_morning", "08:20", "2026-09-19", 18, 18),
    ...Array.from({ length: 11 }, (_, i) => slotRow("intraday", String(i + 9).padStart(2, "0") + ":00", "2026-09-18", 20, i === 10 ? 18 : 20))];
  rows[4].product_code = "P2";
  rows[5].latest_estimated_on_hand = null;
  const db = createMockDb();
  db.query = async () => ({ rows });
  const candidate = createTestApp({ db, config: { hourlyStockEvidenceMaxSlotDelaySeconds: 10 } });
  const get = () => request(candidate.app).get("/api/hourly-stock-evidence/summary?branchCode=005&date=2026-09-18");
  const incomplete = await get();
  assert.equal(incomplete.body.dailyCompletenessStatus, "complete");
  assert.equal(incomplete.body.metrics.exactMatchCount, 1);
  assert.equal(incomplete.body.collectionQuality.qualifying, false);
  assert.deepEqual(incomplete.body.collectionQuality.reasons, ["incomplete-cohort"]);
  rows[4].product_code = "P1";
  rows[5].latest_estimated_on_hand = 20;
  assert.equal((await get()).body.collectionQuality.qualifying, true);
  rows[0].capture_count = 2;
  const duplicate = await get();
  assert.equal(duplicate.body.collectionQuality.qualifying, false);
  assert.deepEqual(duplicate.body.collectionQuality.reasons, ["duplicate-captures"]);
  assert.equal("passed" in duplicate.body.metrics, false);
});

test("migration 074 is additive, transactional and excludes inactive branch 002", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "migrations", "074_add_hourly_dual_stock_evidence.sql"),
    "utf8",
  );
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS evidence/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS evidence\.hourly_stock_capture_runs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS evidence\.hourly_stock_capture_rows/);
  assert.match(sql, /CHECK \(branch_code IN \('000', '001', '003', '004', '005'\)\)/);
  assert.doesNotMatch(sql, /branch_code IN \([^)]*'002'/);
  assert.match(sql, /idempotency_key CHAR\(64\) NOT NULL UNIQUE/);
});
