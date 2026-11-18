"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { createAdaSyncRouter } = require("./sync-ada");

const path = "/api/sync/ada/stock-snapshot-recovery/complete";
const stockHash = "0123456789abcdef0123456789abcdef";

const payload = {
  branchCode: "004",
  coverageDate: "2026-11-13",
  snapshots: [
    { snapshotAt: "2026-11-13T08:20:16.786+07:00", recordCount: 2, stockHash },
    { snapshotAt: "2026-11-13T19:20:13.212+07:00", recordCount: 2, stockHash },
  ],
  recoveredDatasets: ["branch stock snapshots (reconstructed)"],
  evidence: { method: "stock-card-reconstruction" },
  note: "Stock snapshots reconstructed and verified.",
};

function makeApp(db) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/sync/ada",
    createAdaSyncRouter({ config: { posApiKeys: new Set(["test-key"]) }, db, crmMirrorClient: null }),
  );
  app.use((error, req, res, _next) => res.status(500).json({ message: error.message }));
  return app;
}

function makeDb({ mismatchedSnapshotAt = null, noteExists = true } = {}) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      queries.push({ sql: normalized, params });
      if (normalized.startsWith("SELECT recovery_status")) {
        return { rows: noteExists ? [{ recovery_status: "partial" }] : [], rowCount: noteExists ? 1 : 0 };
      }
      if (normalized.includes("COUNT(*)::int AS record_count")) {
        const snapshotAt = params[1];
        const mismatch = snapshotAt === mismatchedSnapshotAt;
        return {
          rows: [{ record_count: mismatch ? 1 : 2, stock_hash: stockHash, date_matches: true }],
          rowCount: 1,
        };
      }
      if (normalized.startsWith("UPDATE ingest.sync_run_recovery_notes")) {
        return {
          rows: [{ branch_code: "004", coverage_date: "2026-11-13", recovery_status: "complete" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release() { client.released = true; },
    released: false,
  };
  return { client, queries, connectCount: 0, async connect() { this.connectCount += 1; return client; } };
}

test("recovery completion rejects an invalid snapshot certificate before DB access", async () => {
  const db = makeDb();
  const invalid = { ...payload, snapshots: [{ ...payload.snapshots[0], stockHash: "bad" }] };
  const response = await request(makeApp(db)).post(path).set("x-api-key", "test-key").send(invalid);

  assert.equal(response.status, 400);
  assert.equal(db.connectCount, 0);
});

test("recovery completion requires the configured API key", async () => {
  const db = makeDb();
  const response = await request(makeApp(db)).post(path).send(payload);

  assert.equal(response.status, 401);
  assert.equal(db.connectCount, 0);
});

test("recovery completion verifies every snapshot before marking the note complete", async () => {
  const db = makeDb();
  const response = await request(makeApp(db)).post(path).set("x-api-key", "test-key").send(payload);

  assert.equal(response.status, 200);
  assert.equal(response.body.verifiedSnapshots, 2);
  assert.equal(response.body.recovery.recovery_status, "complete");
  assert.equal(db.queries.filter((q) => q.sql.includes("COUNT(*)::int AS record_count")).length, 2);
  assert.ok(db.queries.some((q) => q.sql.startsWith("UPDATE ingest.sync_run_recovery_notes")));
  assert.ok(db.queries.some((q) => q.sql === "COMMIT"));
  assert.equal(db.client.released, true);
});

test("recovery completion leaves the note unchanged when a stock hash/count fails", async () => {
  const db = makeDb({ mismatchedSnapshotAt: payload.snapshots[1].snapshotAt });
  const response = await request(makeApp(db)).post(path).set("x-api-key", "test-key").send(payload);

  assert.equal(response.status, 409);
  assert.ok(db.queries.some((q) => q.sql === "ROLLBACK"));
  assert.ok(!db.queries.some((q) => q.sql.startsWith("UPDATE ingest.sync_run_recovery_notes")));
  assert.equal(db.client.released, true);
});

test("recovery completion reports a missing recovery note", async () => {
  const db = makeDb({ noteExists: false });
  const response = await request(makeApp(db)).post(path).set("x-api-key", "test-key").send(payload);

  assert.equal(response.status, 404);
  assert.ok(db.queries.some((q) => q.sql === "ROLLBACK"));
  assert.ok(!db.queries.some((q) => q.sql.includes("COUNT(*)::int AS record_count")));
});
