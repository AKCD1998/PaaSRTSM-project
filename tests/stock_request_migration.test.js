"use strict";

// WP-01 contract test for migration 033_add_stock_request_workflow.sql.
// This repo's tests run against an injected/fake DB (no live Postgres), so we
// validate the migration's structural contract statically: the tables, the
// critical CHECK/UNIQUE/FK rules, and additive/transactional safety. Anything
// the downstream services (WP-02+) rely on must be asserted here.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATION_PATH = path.join(
  __dirname,
  "..",
  "migrations",
  "033_add_stock_request_workflow.sql"
);

const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalized = sql.replace(/\s+/g, " ");
// SQL with `-- line comments` stripped, for assertions about executed DDL only.
const code = sql.replace(/--[^\n]*/g, "");

test("migration is wrapped in a single transaction", () => {
  assert.match(sql, /^\s*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
});

test("creates the ordering schema additively (IF NOT EXISTS)", () => {
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS ordering;/);
});

test("creates all seven stock-request tables, all additive", () => {
  const tables = [
    "ordering.stock_request_batches",
    "ordering.stock_requests",
    "ordering.stock_request_lines",
    "ordering.stock_request_line_responses",
    "ordering.stock_request_events",
    "ordering.stock_request_notifications",
    "ordering.stock_request_documents",
  ];
  for (const table of tables) {
    const re = new RegExp(
      `CREATE TABLE IF NOT EXISTS ${table.replace(/\./g, "\\.")}\\b`
    );
    assert.match(sql, re, `expected additive CREATE TABLE for ${table}`);
  }
});

test("does not touch the legacy single-branch ordering tables", () => {
  assert.doesNotMatch(code, /branch_order_requests\b/);
  assert.doesNotMatch(code, /branch_order_request_items\b/);
});

test("branch references point at core.branches(branch_code)", () => {
  // requesting + source on stock_requests, plus batch requesting and notif recipient.
  const branchFks = normalized.match(/REFERENCES core\.branches\(branch_code\)/g) || [];
  assert.ok(
    branchFks.length >= 4,
    `expected >=4 core.branches FKs, found ${branchFks.length}`
  );
});

test("product lines reference public.skus(company_code)", () => {
  assert.match(normalized, /product_code text NOT NULL REFERENCES public\.skus\(company_code\)/);
});

test("a child request cannot be addressed to its own branch", () => {
  assert.match(
    normalized,
    /CHECK \(source_branch_code <> requesting_branch_code\)/
  );
});

test("requested_qty must be positive and approved_qty non-negative", () => {
  assert.match(normalized, /requested_qty numeric\(14,4\) NOT NULL CHECK \(requested_qty > 0\)/);
  assert.match(normalized, /approved_qty numeric\(14,4\) NOT NULL DEFAULT 0 CHECK \(approved_qty >= 0\)/);
});

test("idempotency and dedup keys are unique", () => {
  assert.match(normalized, /idempotency_key text UNIQUE/);
  assert.match(normalized, /dedup_key text UNIQUE/);
  assert.match(normalized, /public_id text NOT NULL UNIQUE/);
});

test("line key prevents duplicate product+unit per request", () => {
  assert.match(normalized, /UNIQUE \(request_id, product_code, unit\)/);
});

test("documents are versioned per request and never overwritten", () => {
  assert.match(normalized, /UNIQUE \(request_id, version\)/);
});

test("batch status CHECK covers the full state machine", () => {
  for (const status of [
    "DRAFT",
    "SUBMITTED",
    "PARTIALLY_RESPONDED",
    "RESPONDED",
    "ACKNOWLEDGED",
    "COMPLETED",
    "CANCELLED",
  ]) {
    assert.match(normalized, new RegExp(`'${status}'`));
  }
});

test("child request and line status CHECKs are present", () => {
  for (const status of ["READY_TO_DISPATCH", "DISPATCHED", "RECEIVED"]) {
    assert.match(normalized, new RegExp(`'${status}'`));
  }
  for (const status of ["PENDING", "APPROVED_FULL", "APPROVED_PARTIAL", "REJECTED"]) {
    assert.match(normalized, new RegExp(`'${status}'`));
  }
});

test("child requests and lines cascade-delete with their parents", () => {
  assert.match(
    normalized,
    /REFERENCES ordering\.stock_request_batches\(batch_id\) ON DELETE CASCADE/
  );
  assert.match(
    normalized,
    /REFERENCES ordering\.stock_requests\(request_id\) ON DELETE CASCADE/
  );
  assert.match(
    normalized,
    /REFERENCES ordering\.stock_request_lines\(line_id\) ON DELETE CASCADE/
  );
});
