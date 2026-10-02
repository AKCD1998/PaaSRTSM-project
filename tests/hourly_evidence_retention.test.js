"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { pruneHourlyEvidence } = require("../apps/admin-api/src/services/hourlyEvidenceRetention");

test("retention is OFF before any DB query; invalid policy refuses SQL", async () => {
  const client = { query: async () => assert.fail("must not query") };
  assert.equal((await pruneHourlyEvidence(client)).status, "disabled");
  for (const retentionDays of [0, 2, 366, NaN]) {
    await assert.rejects(pruneHourlyEvidence(client, { enabled: true, retentionDays }), /Invalid/);
  }
});
test("retention dry-run is SELECT-only and execution is transactional/bounded", async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT COUNT")) return { rows: [{ count: 4 }] };
    if (sql.startsWith("SELECT capture_id")) return { rows: [{ capture_id: "7" }] };
    return { rowCount: sql.includes("capture_rows") ? 2 : 1 };
  }};
  const options = { enabled: true, now: "2026-10-02T13:00:00.000Z", retentionDays: 30 };
  assert.equal((await pruneHourlyEvidence(client, options)).status, "dry-run");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].sql.startsWith("SELECT"));
  calls.length = 0;
  const result = await pruneHourlyEvidence(client, { ...options, execute: true });
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-1).sql, "COMMIT");
  assert.ok(calls[1].sql.includes("FOR UPDATE SKIP LOCKED"));
  assert.deepEqual(calls[2].params, [["7"]]);
  assert.equal(result.deletedRuns, 1);
  assert.equal(result.deletedRows, 2);
});
test("cleanup CLI defaults OFF without needing a database credential", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "../scripts/prune_hourly_stock_evidence.js")], {
    env: { ...process.env, FEATURE_HOURLY_STOCK_EVIDENCE_RETENTION: "false", DATABASE_URL: "" }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "disabled");
});
