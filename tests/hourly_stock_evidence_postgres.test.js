"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const { Pool } = require("pg");
const request = require("supertest");

const { parseCapturePayload, payloadIdentity } = require("../apps/admin-api/src/services/hourlyStockEvidence");
const {
  createHourlyStockEvidenceRouter,
  persistCapture,
} = require("../apps/admin-api/src/routes/hourly-stock-evidence");

const databaseUrl = process.env.HOURLY_EVIDENCE_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 2 }) : null;
const migrationSql = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "072_add_hourly_dual_stock_evidence.sql"),
  "utf8",
);

function capture(overrides = {}) {
  const body = {
    contractVersion: "hourly-dual-stock-evidence-v1",
    datasetTag: "hourly_dual_stock_evidence",
    branchCode: "005",
    observationKind: "intraday",
    plannedSlot: "19:00",
    capturedAt: "2026-09-18T12:00:01.000Z",
    sourceEventAt: null,
    records: [
      { productCode: "IC-003550", retailOnHand: 222, latestEstimatedOnHand: null },
      { productCode: "IC-005003", retailOnHand: 100, latestEstimatedOnHand: 99 },
    ],
    clientMeta: { queryDurationMs: 12 },
    ...overrides,
  };
  body.idempotencyKey = payloadIdentity(body);
  return parseCapturePayload(body);
}

function createSummaryApp() {
  const app = express();
  app.use("/api/hourly-stock-evidence", createHourlyStockEvidenceRouter({
    config: { hourlyStockEvidenceBranchTokens: new Map() },
    db: pool,
    requireAuthMiddleware: (_req, _res, next) => next(),
    requireRoleMiddleware: () => (_req, _res, next) => next(),
  }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
  return app;
}

async function expectRunConstraintViolation({ keyCharacter, branchCode = "005", recordCount = 1, sourceEventAt = null }) {
  const capturedAt = "2026-09-18T12:00:01.000Z";
  await assert.rejects(
    pool.query(
      `INSERT INTO evidence.hourly_stock_capture_runs (
         idempotency_key, contract_version, branch_code, observation_kind,
         planned_slot, planned_for, captured_at, source_event_at, record_count,
         payload_sha256, client_meta
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{}'::jsonb)`,
      [
        keyCharacter.repeat(64),
        "hourly-dual-stock-evidence-v1",
        branchCode,
        "intraday",
        "19:00",
        "2026-09-18T12:00:00.000Z",
        capturedAt,
        sourceEventAt,
        recordCount,
        keyCharacter.repeat(64),
      ],
    ),
    (error) => error.code === "23514",
  );
}

integration("REAL POSTGRES: migration, constraints, null UNNEST, idempotency, rollback, and summary", async (t) => {
  const identity = await pool.query("SELECT current_database() AS name");
  const databaseName = identity.rows[0].name;
  assert.match(
    databaseName,
    /^sc_hourly_evidence_test_[a-z0-9_]+$/,
    "isolation guard refuses DDL unless database name is disposable",
  );
  t.after(async () => {
    await pool.query("DROP SCHEMA IF EXISTS evidence CASCADE");
    await pool.end();
  });
  await pool.query("DROP SCHEMA IF EXISTS evidence CASCADE");
  await pool.query(migrationSql);
  await pool.query(migrationSql);

  const constraints = await pool.query(
    `SELECT conname
       FROM pg_constraint
      WHERE connamespace = 'evidence'::regnamespace`,
  );
  assert.ok(constraints.rows.length >= 10, "migration must install the evidence constraints");
  await expectRunConstraintViolation({ keyCharacter: "a", recordCount: 0 });
  await expectRunConstraintViolation({
    keyCharacter: "b",
    sourceEventAt: "2026-09-18T12:00:02.000Z",
  });
  await expectRunConstraintViolation({ keyCharacter: "c", branchCode: "002" });

  const firstClient = await pool.connect();
  const duplicateClient = await pool.connect();
  try {
    const first = await persistCapture(firstClient, capture());
    const duplicate = await persistCapture(duplicateClient, capture());
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.captureId, first.captureId);
  } finally {
    firstClient.release();
    duplicateClient.release();
  }
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM evidence.hourly_stock_capture_runs")).rows[0].count, 1);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM evidence.hourly_stock_capture_rows")).rows[0].count, 2);
  assert.equal(
    (await pool.query("SELECT COUNT(*)::int AS count FROM evidence.hourly_stock_capture_rows WHERE latest_estimated_on_hand IS NULL")).rows[0].count,
    1,
  );

  const rollbackCapture = {
    ...capture(),
    idempotencyKey: "d".repeat(64),
    payloadSha256: "d".repeat(64),
    records: [
      { productCode: "ROLLBACK-PROBE", retailOnHand: 1, latestEstimatedOnHand: 1 },
      { productCode: "ROLLBACK-PROBE", retailOnHand: 2, latestEstimatedOnHand: null },
    ],
  };
  const rollbackClient = await pool.connect();
  try {
    await assert.rejects(
      persistCapture(rollbackClient, rollbackCapture),
      (error) => error.code === "23505",
    );
  } finally {
    rollbackClient.release();
  }
  assert.equal(
    (await pool.query("SELECT COUNT(*)::int AS count FROM evidence.hourly_stock_capture_runs WHERE idempotency_key = $1", [rollbackCapture.idempotencyKey])).rows[0].count,
    0,
    "failed row insert must roll back its run",
  );
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM evidence.hourly_stock_capture_rows")).rows[0].count, 2);

  for (const additionalCapture of [
    capture({
      observationKind: "morning_anchor",
      plannedSlot: "08:20",
      capturedAt: "2026-09-18T01:20:05.000Z",
      records: [
        { productCode: "IC-003550", retailOnHand: 222, latestEstimatedOnHand: 222 },
        { productCode: "IC-005003", retailOnHand: 100, latestEstimatedOnHand: 100 },
      ],
    }),
    capture({
      observationKind: "morning_anchor",
      plannedSlot: "08:20",
      capturedAt: "2026-09-19T01:20:05.000Z",
      records: [
        { productCode: "IC-003550", retailOnHand: 221, latestEstimatedOnHand: 221 },
        { productCode: "IC-005003", retailOnHand: 99, latestEstimatedOnHand: 99 },
      ],
    }),
  ]) {
    const client = await pool.connect();
    try {
      await persistCapture(client, additionalCapture);
    } finally {
      client.release();
    }
  }

  const summary = await request(createSummaryApp())
    .get("/api/hourly-stock-evidence/summary?branchCode=005&date=2026-09-18");
  assert.equal(summary.status, 200);
  assert.equal(summary.body.comparisonStatus, "compared");
  assert.equal(summary.body.dailyCompletenessStatus, "incomplete");
  assert.deepEqual(summary.body.capturedPlannedSlots, ["19:00"]);
  assert.equal(summary.body.missingPlannedSlots.length, 10);
  assert.equal(summary.body.metrics.eligibleProducts, 1);
  assert.equal(summary.body.metrics.missingEstimatedValue, 1);
});
