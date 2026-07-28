"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

const { listStockRecommendationsByProduct } = require("../apps/admin-api/src/services/stockRecommendations");

// The by-product pivot's GROUP BY + jsonb_agg + HAVING bool_or SQL is easy to
// get subtly wrong (aggregate column names, HAVING vs WHERE, jsonb shape) in
// ways a JS-side mock can't catch — worth verifying against a real Postgres
// instead of just mocking db.query. Gated behind CP4_TEST_DATABASE_URL, same
// as the other real-Postgres test in this suite; CI provisions this via a
// Postgres service container, so it runs there even though it's skipped
// locally without that env var set.
const databaseUrl = process.env.CP4_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : null;

async function resetSchema() {
  await pool.query(`
    DROP SCHEMA IF EXISTS ordering CASCADE;
    DROP SCHEMA IF EXISTS core CASCADE;
    CREATE SCHEMA core;
    CREATE SCHEMA ordering;

    CREATE TABLE core.branches (
      branch_code text PRIMARY KEY,
      branch_name text NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      is_hq boolean NOT NULL DEFAULT false
    );

    CREATE TABLE ordering.stock_recommendation_snapshots (
      snapshot_id bigserial PRIMARY KEY,
      anchor_date date NOT NULL,
      target_days integer NOT NULL,
      branch_code text NOT NULL REFERENCES core.branches(branch_code),
      branch_label text NULL,
      product_code text NOT NULL,
      product_name_thai text NULL,
      product_name_eng text NULL,
      barcode text NULL,
      unit text NULL,
      current_stock numeric(14,4) NOT NULL DEFAULT 0,
      unit_cost_avg numeric(14,4) NULL,
      inventory_value numeric(16,2) NOT NULL DEFAULT 0,
      sold_qty_30d numeric(14,4) NOT NULL DEFAULT 0,
      sold_qty_90d numeric(14,4) NOT NULL DEFAULT 0,
      sold_qty_same_period_last_year numeric(14,4) NULL,
      adu_30 numeric(14,6) NOT NULL DEFAULT 0,
      adu_90 numeric(14,6) NOT NULL DEFAULT 0,
      trend_ratio_30_vs_90 numeric(14,4) NULL,
      adjusted_adu numeric(14,6) NOT NULL DEFAULT 0,
      incoming_po_qty_total numeric(14,4) NOT NULL DEFAULT 0,
      incoming_po_allocation_qty numeric(14,4) NOT NULL DEFAULT 0,
      effective_stock numeric(14,4) NOT NULL DEFAULT 0,
      current_days_cover numeric(14,2) NULL,
      effective_days_cover numeric(14,2) NULL,
      target_qty numeric(14,4) NOT NULL DEFAULT 0,
      surplus_qty numeric(14,4) NOT NULL DEFAULT 0,
      shortage_qty numeric(14,4) NOT NULL DEFAULT 0,
      transfer_plan_qty numeric(14,4) NOT NULL DEFAULT 0,
      purchase_qty numeric(14,4) NOT NULL DEFAULT 0,
      priority_score numeric(16,2) NOT NULL DEFAULT 0,
      action text NOT NULL,
      recommendation_reason text NULL,
      recommendation_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
      donors_json jsonb NOT NULL DEFAULT '[]'::jsonb,
      primary_suggested_donor_branch_code text NULL,
      synced_at timestamptz NULL,
      generated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    INSERT INTO core.branches (branch_code, branch_name, is_active, is_hq) VALUES
      ('001', 'Branch 001', true, false),
      ('003', 'Branch 003', true, false);
  `);
}

async function insertSnapshotRow(overrides = {}) {
  const row = {
    anchor_date: "2026-07-27",
    target_days: 90,
    branch_code: "001",
    branch_label: "Branch 001",
    product_code: "P1",
    product_name_thai: "สินค้าหนึ่ง",
    product_name_eng: "Product One",
    barcode: "111",
    unit: "ชิ้น",
    current_stock: 10,
    priority_score: 100,
    effective_days_cover: 5,
    inventory_value: 1000,
    action: "PURCHASE",
    recommendation_reason: "ต้องสั่งซื้อเพิ่ม",
    ...overrides,
  };
  await pool.query(
    `INSERT INTO ordering.stock_recommendation_snapshots
       (anchor_date, target_days, branch_code, branch_label, product_code, product_name_thai,
        product_name_eng, barcode, unit, current_stock, priority_score, effective_days_cover,
        inventory_value, action, recommendation_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      row.anchor_date, row.target_days, row.branch_code, row.branch_label, row.product_code,
      row.product_name_thai, row.product_name_eng, row.barcode, row.unit, row.current_stock,
      row.priority_score, row.effective_days_cover, row.inventory_value, row.action, row.recommendation_reason,
    ],
  );
}

integration("REAL POSTGRES: by-product pivot groups one row per product with nested branches", async () => {
  await resetSchema();
  // P1: branch 001 needs to purchase (priority 100), branch 003 is fine (NO_ACTION, priority 0).
  await insertSnapshotRow({ product_code: "P1", branch_code: "001", action: "PURCHASE", priority_score: 100, current_stock: 10, inventory_value: 500 });
  await insertSnapshotRow({ product_code: "P1", branch_code: "003", action: "NO_ACTION", priority_score: 0, current_stock: 40, inventory_value: 400, recommendation_reason: null });
  // P2: both branches fine.
  await insertSnapshotRow({ product_code: "P2", branch_code: "001", action: "NO_ACTION", priority_score: 0, current_stock: 20, inventory_value: 200, recommendation_reason: null });
  await insertSnapshotRow({ product_code: "P2", branch_code: "003", action: "NO_ACTION", priority_score: 0, current_stock: 20, inventory_value: 200, recommendation_reason: null });

  const result = await listStockRecommendationsByProduct({
    db: pool,
    auth: { role: "admin" },
    filters: { branchCode: "all", targetDays: 90, dateTo: "2026-07-27" },
  });

  assert.equal(result.meta.source, "precomputed");
  assert.equal(result.rows.length, 2);

  const p1 = result.rows.find((row) => row.productCode === "P1");
  assert.equal(p1.branches.length, 2);
  assert.equal(p1.totalCurrentStock, 50);
  assert.equal(p1.aggPriorityScore, 100);
  assert.equal(p1.aggInventoryValue, 900);
  const p1Branch001 = p1.branches.find((b) => b.branchCode === "001");
  assert.equal(p1Branch001.action, "PURCHASE");
  const p1Branch003 = p1.branches.find((b) => b.branchCode === "003");
  assert.equal(p1Branch003.action, "NO_ACTION");
});

integration("REAL POSTGRES: by-product default sort ranks by highest priority score across branches", async () => {
  await resetSchema();
  await insertSnapshotRow({ product_code: "LOW", branch_code: "001", priority_score: 5, action: "PURCHASE" });
  await insertSnapshotRow({ product_code: "LOW", branch_code: "003", priority_score: 5, action: "PURCHASE" });
  await insertSnapshotRow({ product_code: "HIGH", branch_code: "001", priority_score: 999, action: "PURCHASE" });
  await insertSnapshotRow({ product_code: "HIGH", branch_code: "003", priority_score: 1, action: "NO_ACTION", recommendation_reason: null });

  const result = await listStockRecommendationsByProduct({
    db: pool,
    auth: { role: "admin" },
    filters: { branchCode: "all", targetDays: 90, dateTo: "2026-07-27", sort: "priority_desc" },
  });

  assert.deepEqual(result.rows.map((row) => row.productCode), ["HIGH", "LOW"]);
});

integration("REAL POSTGRES: by-product action filter only returns products where some branch matches", async () => {
  await resetSchema();
  await insertSnapshotRow({ product_code: "TRANSFER_PRODUCT", branch_code: "001", action: "TRANSFER_IN", priority_score: 10 });
  await insertSnapshotRow({ product_code: "TRANSFER_PRODUCT", branch_code: "003", action: "NO_ACTION", priority_score: 0, recommendation_reason: null });
  await insertSnapshotRow({ product_code: "PURCHASE_ONLY_PRODUCT", branch_code: "001", action: "PURCHASE", priority_score: 20 });
  await insertSnapshotRow({ product_code: "PURCHASE_ONLY_PRODUCT", branch_code: "003", action: "NO_ACTION", priority_score: 0, recommendation_reason: null });

  const result = await listStockRecommendationsByProduct({
    db: pool,
    auth: { role: "admin" },
    filters: { branchCode: "all", targetDays: 90, dateTo: "2026-07-27", action: "TRANSFER_IN" },
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].productCode, "TRANSFER_PRODUCT");
});

integration("REAL POSTGRES: by-product pagination total reflects distinct product count, not row count", async () => {
  await resetSchema();
  for (let i = 0; i < 5; i += 1) {
    await insertSnapshotRow({ product_code: `P${i}`, branch_code: "001", priority_score: i });
    await insertSnapshotRow({ product_code: `P${i}`, branch_code: "003", priority_score: i, action: "NO_ACTION", recommendation_reason: null });
  }

  const result = await listStockRecommendationsByProduct({
    db: pool,
    auth: { role: "admin" },
    filters: { branchCode: "all", targetDays: 90, dateTo: "2026-07-27", pageSize: 2, page: 1 },
  });

  assert.equal(result.pagination.total, 5);
  assert.equal(result.rows.length, 2);
});
