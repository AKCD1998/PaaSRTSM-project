"use strict";

// Static contract test for migration 045_add_focus_products.sql.
// This repo's tests run against an injected/fake DB (no live Postgres), so we
// validate the migration's structural contract statically.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATION_PATH = path.join(
  __dirname,
  "..",
  "migrations",
  "045_add_focus_products.sql"
);

const sql = fs.readFileSync(MIGRATION_PATH, "utf8");

test("migration is wrapped in a single transaction", () => {
  assert.match(sql, /^\s*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
});

test("creates the focus schema and focus_products table, additively", () => {
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS focus;/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS focus\.focus_products\b/);
});

test("focus_type is constrained to the four defined targeting rules", () => {
  assert.match(
    sql,
    /focus_type\s+text\s+NOT NULL\s+CHECK \(focus_type IN \('salesperson', 'pharmacist', 'store_manager', 'group_manager'\)\)/
  );
});

test("target_qty must be positive", () => {
  assert.match(sql, /target_qty\s+numeric\(14,4\)\s+NOT NULL\s+CHECK \(target_qty > 0\)/);
});

test("date_to cannot precede date_from", () => {
  assert.match(sql, /CONSTRAINT focus_products_date_range CHECK \(date_to >= date_from\)/);
});

test("branch_codes is nullable (NULL = all active branches)", () => {
  assert.match(sql, /branch_codes\s+text\[\]\s+NULL/);
});

test("creates indexes for common lookups", () => {
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_focus_products_active_range/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_focus_products_type/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_focus_products_product/);
});
