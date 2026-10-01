"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

const { loadConfig } = require("../config");
const { createTransferDeltaEvidenceRouter } = require("./transfer-delta-evidence");

const TEST_TOKEN = "evidence-test-token-32-bytes-long";

const schemaRow = {
  migration_073_recorded: true,
  checkpoints_table_exists: true,
  requests_table_exists: true,
  tombstone_audit_table_exists: true,
};

const evidenceRow = {
  checkpoint_row_count: 1,
  checkpoint_sequence: 1,
  checkpoint_has_token: true,
  checkpoint_has_state_hash: true,
  checkpoint_updated_at: new Date("2026-10-02T01:22:00.000Z"),
  request_row_count: 1,
  latest_operation: "rebaseline",
  latest_status: "applied",
  latest_checkpoint_sequence: 1,
  latest_header_count: 0,
  latest_line_count: 0,
  latest_tombstone_count: 0,
  latest_applied_at: new Date("2026-10-02T01:22:00.000Z"),
  tombstone_audit_rows: 0,
};

function createTestApp({
  enabled = true,
  token = TEST_TOKEN,
  branches = new Set(["004"]),
  rows = [schemaRow, evidenceRow],
  queryError = null,
} = {}) {
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (queryError) throw queryError;
      return { rows: [rows[queries.length - 1] || {}] };
    },
  };
  const app = express();
  app.use(
    "/internal/transfer-delta-evidence",
    createTransferDeltaEvidenceRouter({
      config: {
        featureTransferDeltaEvidenceApi: enabled,
        transferDeltaEvidenceToken: token,
        transferDeltaBranches: branches,
      },
      db,
    }),
  );
  app.use((error, req, res, _next) => res.status(error.status || 500).json({
    error: (error.status || 500) >= 500 ? "Internal server error" : error.message,
    request_id: req.requestId || null,
  }));
  return { app, queries };
}

test("Transfer Delta evidence API defaults OFF with no token", () => {
  const config = loadConfig({});
  assert.equal(config.featureTransferDeltaEvidenceApi, false);
  assert.equal(config.transferDeltaEvidenceToken, "");
});

test("fails closed before querying when disabled or unauthenticated", async () => {
  const disabled = createTestApp({ enabled: false });
  await request(disabled.app)
    .get("/internal/transfer-delta-evidence/004")
    .set("x-internal-token", TEST_TOKEN)
    .expect(404);
  assert.equal(disabled.queries.length, 0);

  const unconfigured = createTestApp({ token: "" });
  await request(unconfigured.app).get("/internal/transfer-delta-evidence/004").expect(503);
  assert.equal(unconfigured.queries.length, 0);

  const weakToken = createTestApp({ token: "too-short" });
  await request(weakToken.app)
    .get("/internal/transfer-delta-evidence/004")
    .set("x-internal-token", "too-short")
    .expect(503);
  assert.equal(weakToken.queries.length, 0);

  const unauthorized = createTestApp();
  await request(unauthorized.app)
    .get("/internal/transfer-delta-evidence/004")
    .set("x-internal-token", "wrong-token")
    .expect(401);
  assert.equal(unauthorized.queries.length, 0);
});

test("rejects inactive, malformed, and non-canary branches before querying", async () => {
  const { app, queries } = createTestApp({ branches: new Set(["002", "004"]) });
  for (const branchCode of ["002", "005", "bad"]) {
    // eslint-disable-next-line no-await-in-loop
    await request(app)
      .get(`/internal/transfer-delta-evidence/${branchCode}`)
      .set("x-internal-token", TEST_TOKEN)
      .expect(404);
  }
  assert.equal(queries.length, 0);
});

test("returns only bounded sanitized evidence using SELECT-only queries", async () => {
  const { app, queries } = createTestApp();
  const response = await request(app)
    .get("/internal/transfer-delta-evidence/004")
    .set("x-internal-token", TEST_TOKEN)
    .expect(200);

  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.branchCode, "004");
  assert.equal(response.body.migration073Recorded, true);
  assert.deepEqual(response.body.tables, {
    checkpoints: true,
    requests: true,
    tombstoneAudit: true,
  });
  assert.deepEqual(response.body.checkpoint, {
    rowCount: 1,
    sequence: 1,
    hasToken: true,
    hasStateHash: true,
    updatedAt: "2026-10-02T01:22:00.000Z",
  });
  assert.deepEqual(response.body.requests, {
    rowCount: 1,
    latest: {
      operation: "rebaseline",
      status: "applied",
      sequence: 1,
      headerCount: 0,
      lineCount: 0,
      tombstoneCount: 0,
      appliedAt: "2026-10-02T01:22:00.000Z",
    },
  });
  assert.equal(response.body.tombstoneAuditRows, 0);
  assert.equal(JSON.stringify(response.body).includes("checkpointToken"), false);
  assert.equal(JSON.stringify(response.body).includes("stateHash"), false);
  assert.equal(queries.length, 2);
  for (const { sql } of queries) {
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
  }
  assert.deepEqual(queries[1].params, ["004", "transfers", "transfer-delta-v1"]);
});

test("reports missing schema without querying absent tables", async () => {
  const missingSchema = {
    migration_073_recorded: false,
    checkpoints_table_exists: false,
    requests_table_exists: false,
    tombstone_audit_table_exists: false,
  };
  const { app, queries } = createTestApp({ rows: [missingSchema] });
  const response = await request(app)
    .get("/internal/transfer-delta-evidence/004")
    .set("x-internal-token", TEST_TOKEN)
    .expect(200);

  assert.equal(queries.length, 1);
  assert.equal(response.body.migration073Recorded, false);
  assert.equal(response.body.checkpoint.rowCount, null);
  assert.equal(response.body.requests.rowCount, null);
  assert.equal(response.body.tombstoneAuditRows, null);
});

test("sanitizes database failures", async () => {
  const { app } = createTestApp({ queryError: new Error("postgres detail must not escape") });
  const response = await request(app)
    .get("/internal/transfer-delta-evidence/004")
    .set("x-internal-token", TEST_TOKEN)
    .expect(503);
  assert.equal(response.body.error, "Internal server error");
  assert.equal(JSON.stringify(response.body).includes("postgres detail"), false);
});
