"use strict";

// WP-13 contract test for migration 034_add_stock_request_fulfillment.sql.
// Validated statically (this repo's tests run against a fake DB), matching the
// approach of stock_request_migration.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "034_add_stock_request_fulfillment.sql"),
  "utf8",
);
const normalized = sql.replace(/\s+/g, " ");
const code = sql.replace(/--[^\n]*/g, "");

test("migration is a single transaction", () => {
  assert.match(sql, /^\s*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
});

test("creates the four fulfillment tables additively", () => {
  for (const table of [
    "ordering.stock_request_shipments",
    "ordering.stock_request_shipment_lines",
    "ordering.stock_request_receipts",
    "ordering.stock_request_receipt_lines",
  ]) {
    const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${table.replace(/\./g, "\\.")}\\b`);
    assert.match(sql, re, `expected additive CREATE TABLE for ${table}`);
  }
});

test("shipment and receipt lines cascade from their parents and the request lines", () => {
  assert.match(
    normalized,
    /REFERENCES ordering\.stock_request_shipments\(shipment_id\) ON DELETE CASCADE/,
  );
  assert.match(
    normalized,
    /REFERENCES ordering\.stock_request_receipts\(receipt_id\) ON DELETE CASCADE/,
  );
  assert.match(
    normalized,
    /REFERENCES ordering\.stock_request_lines\(line_id\) ON DELETE CASCADE/,
  );
});

test("dispatched and received quantities are non-negative", () => {
  assert.match(normalized, /dispatched_qty numeric\(14,4\) NOT NULL DEFAULT 0 CHECK \(dispatched_qty >= 0\)/);
  assert.match(normalized, /received_qty numeric\(14,4\) NOT NULL DEFAULT 0 CHECK \(received_qty >= 0\)/);
});

test("a line appears at most once per shipment and per receipt", () => {
  assert.match(normalized, /UNIQUE \(shipment_id, line_id\)/);
  assert.match(normalized, /UNIQUE \(receipt_id, line_id\)/);
});

test("does not modify the migration 033 request tables in place", () => {
  assert.doesNotMatch(code, /ALTER TABLE/i);
});
