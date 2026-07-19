"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "060_add_async_ingestion_queue.sql"), "utf8");

test("CP4 migration keeps v1 out of pending states and defines corrected state machines", () => {
  assert.match(sql, /ingestion_mode text NOT NULL DEFAULT 'v1'/);
  assert.match(sql, /handoff_status text NOT NULL DEFAULT 'not_applicable'/);
  assert.match(sql, /apply_status text NOT NULL DEFAULT 'not_applicable'/);
  assert.match(sql, /'not_applicable', 'waiting', 'pending', 'partial', 'applied', 'failed'/);
  assert.match(sql, /UPDATE ingest\.sync_runs[\s\S]*apply_status = 'not_applicable'[\s\S]*WHERE ingestion_mode = 'v1'/);
});

test("CP4 migration stages batches uniquely and adds per-branch freshness", () => {
  assert.match(sql, /DEFAULT 'staged'/);
  assert.match(sql, /'staged', 'queued', 'processing', 'retry_wait', 'applied', 'dead_letter'/);
  assert.match(sql, /UNIQUE \(sync_run_id, dataset, batch_seq\)/);
  assert.match(sql, /payload_hash\s+text NOT NULL/);
  for (const branch of ["000", "001", "002", "003", "004", "005"]) assert.match(sql, new RegExp(`synced_at_branch_${branch}`));
});
