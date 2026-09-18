"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Pool } = require("pg");

const { parseCapturePayload, payloadIdentity } = require("../apps/admin-api/src/services/hourlyStockEvidence");
const { persistCapture } = require("../apps/admin-api/src/routes/hourly-stock-evidence");

const databaseUrl = process.env.HOURLY_EVIDENCE_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 2 }) : null;
const migrationSql = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "072_add_hourly_dual_stock_evidence.sql"),
  "utf8",
);

function capture() {
  const body = {
    contractVersion: "hourly-dual-stock-evidence-v1",
    datasetTag: "hourly_dual_stock_evidence",
    branchCode: "005",
    observationKind: "intraday",
    plannedSlot: "19:00",
    capturedAt: "2026-09-18T12:00:01.000Z",
    sourceEventAt: null,
    records: [{ productCode: "IC-003550", retailOnHand: 222, latestEstimatedOnHand: 221 }],
    clientMeta: { queryDurationMs: 12 },
  };
  body.idempotencyKey = payloadIdentity(body);
  return parseCapturePayload(body);
}

integration("REAL POSTGRES: migration reruns and duplicate capture remains one run/row", async (t) => {
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
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM evidence.hourly_stock_capture_rows")).rows[0].count, 1);
});
