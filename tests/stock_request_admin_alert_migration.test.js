"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATION_PATH = path.join(
  __dirname,
  "..",
  "migrations",
  "037_add_stock_request_mode.sql",
);

const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalized = sql.replace(/\s+/g, " ");

test("migration 037 is wrapped in a single transaction", () => {
  assert.match(sql, /^\s*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
});

test("migration 037 adds request_mode additively", () => {
  assert.match(normalized, /ALTER TABLE ordering\.stock_requests ADD COLUMN IF NOT EXISTS request_mode text;/);
  assert.match(normalized, /ALTER TABLE ordering\.stock_requests ALTER COLUMN request_mode SET DEFAULT 'STANDARD';/);
  assert.match(normalized, /ALTER TABLE ordering\.stock_requests ALTER COLUMN request_mode SET NOT NULL;/);
});

test("migration 037 backfills and constrains request_mode", () => {
  assert.match(normalized, /UPDATE ordering\.stock_requests SET request_mode = COALESCE\(request_mode, 'STANDARD'\);/);
  assert.match(normalized, /CHECK \(request_mode IN \('STANDARD', 'ADMIN_ALERT'\)\)/);
});
