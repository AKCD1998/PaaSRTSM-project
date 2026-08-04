"use strict";

// REAL-POSTGRES characterization of CLAIM-X-039 (_ledger/claude.md, PARTIAL
// verdict on C-043, conceded): the legacy v1 wide-table upsert
// (upsertBranchStockSnapshot) has NO freshness guard at all — its
// `ON CONFLICT (product_code) DO UPDATE SET ... synced_at = EXCLUDED.synced_at`
// is unconditional, so a late-arriving/out-of-order payload silently
// overwrites a newer value. The new normalized table's upsert
// (upsertBranchStockCurrent, added in WP3 Phase 1) DOES guard on freshness
// (`WHERE synced_at IS NULL OR synced_at <= EXCLUDED.synced_at`), matching
// the pattern worker.js's v2 path already used. Dual-writing the SAME
// out-of-order sequence to both tables therefore does not keep them in sync
// — the wide table accepts the stale write, the normalized table rejects it.
//
// This is deliberately NOT "fixed" in this file — whether to (a) leave the
// new table as strictly more correct and accept the two tables can diverge
// under this specific condition during the dual-write period, or (b) also
// add a freshness guard to the legacy wide-table write path (a behavior
// change to the CURRENT live production write path, not merely additive) is
// a product decision, not a technical one — see QUESTION-004 in
// _ledger/claude.md. This test exists so that decision is made with a proven
// fact in hand, not a guess, and so whichever way it's decided, a test
// already exists to encode the chosen behavior.

const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { upsertBranchStockSnapshot, upsertBranchStockCurrent } = require("../apps/admin-api/src/routes/branch-stock");

const databaseUrl = process.env.CP4_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : null;

async function resetSchema() {
  await pool.query(`
    DROP SCHEMA IF EXISTS ada CASCADE;
    CREATE SCHEMA ada;

    CREATE TABLE ada.branch_stock_snapshots (
      product_code text PRIMARY KEY, product_name_thai text, product_name_eng text, barcode text, unit text,
      qty_branch_000 numeric(14,4) NOT NULL DEFAULT 0, qty_branch_001 numeric(14,4) NOT NULL DEFAULT 0,
      qty_branch_002 numeric(14,4) NOT NULL DEFAULT 0, qty_branch_003 numeric(14,4) NOT NULL DEFAULT 0,
      qty_branch_004 numeric(14,4) NOT NULL DEFAULT 0, qty_branch_005 numeric(14,4) NOT NULL DEFAULT 0,
      qty_total_all_branches numeric(14,4) NOT NULL DEFAULT 0,
      cost_avg_branch_000 numeric(18,4), cost_avg_branch_001 numeric(18,4), cost_avg_branch_002 numeric(18,4),
      cost_avg_branch_003 numeric(18,4), cost_avg_branch_004 numeric(18,4), cost_avg_branch_005 numeric(18,4),
      synced_at timestamptz NOT NULL, source_system text NOT NULL DEFAULT 'AdaAcc',
      source_table text NOT NULL DEFAULT 'TCNTPdtInWha', source_synced_at timestamptz NOT NULL,
      raw_payload jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- last_full_sync_run_id/retired_at/retired_by_sync_run_id mirror
    -- migrations/068_add_branch_stock_generation_tracking.sql (branch-stock
    -- generation round) — upsertBranchStockCurrent always names them now.
    CREATE TABLE ada.branch_stock_current (
      product_code text NOT NULL, branch_code text NOT NULL,
      qty numeric(14,4) NOT NULL DEFAULT 0, cost_avg numeric(18,4), synced_at timestamptz,
      source_system text NOT NULL DEFAULT 'AdaAcc', source_table text NOT NULL DEFAULT 'TCNTPdtInWha',
      source_synced_at timestamptz, raw_payload jsonb,
      last_full_sync_run_id bigint, retired_at timestamptz, retired_by_sync_run_id bigint,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (product_code, branch_code)
    );
  `);
}

function wideRecord(overrides) {
  return {
    productCode: "X1", productNameThai: "p", productNameEng: "p", barcode: null, unit: null,
    qtyBranch000: 0, qtyBranch001: 0, qtyBranch002: 0, qtyBranch003: 0, qtyBranch004: 0, qtyBranch005: 0,
    qtyTotalAllBranches: 0,
    costAvgBranch000: null, costAvgBranch001: null, costAvgBranch002: null,
    costAvgBranch003: null, costAvgBranch004: null, costAvgBranch005: null,
    syncedAt: "2026-07-29T10:00:00Z", rawPayload: {},
    ...overrides,
  };
}

integration(
  "REAL POSTGRES (CLAIM-X-039): a stale, out-of-order write is silently accepted by the wide table but rejected by the normalized table — the two tables diverge",
  async () => {
    await resetSchema();
    const client = await pool.connect();

    // Newer write lands first: qty=100 at 10:00.
    await upsertBranchStockSnapshot(client, wideRecord({ qtyBranch001: 100, qtyTotalAllBranches: 100, syncedAt: "2026-07-29T10:00:00Z" }));
    await upsertBranchStockCurrent(client, { productCode: "X1", branchCode: "001", qty: 100, costAvg: null, syncedAt: "2026-07-29T10:00:00Z", rawPayload: {} });

    // Stale write arrives late: qty=50 at 09:00 (an hour EARLIER than what's already applied).
    await upsertBranchStockSnapshot(client, wideRecord({ qtyBranch001: 50, qtyTotalAllBranches: 50, syncedAt: "2026-07-29T09:00:00Z" }));
    await upsertBranchStockCurrent(client, { productCode: "X1", branchCode: "001", qty: 50, costAvg: null, syncedAt: "2026-07-29T09:00:00Z", rawPayload: {} });

    client.release();

    const wide = (await pool.query("SELECT qty_branch_001 FROM ada.branch_stock_snapshots WHERE product_code='X1'")).rows[0];
    const normalized = (await pool.query("SELECT qty FROM ada.branch_stock_current WHERE product_code='X1' AND branch_code='001'")).rows[0];

    assert.equal(Number(wide.qty_branch_001), 50, "the wide table has NO freshness guard — the stale write wins unconditionally");
    assert.equal(Number(normalized.qty), 100, "the normalized table's freshness guard correctly rejects the stale write");

    assert.notEqual(
      Number(wide.qty_branch_001),
      Number(normalized.qty),
      "THE DIVERGENCE: identical write sequence to both tables produces different final values — this is real and must be a deliberate, understood decision (see QUESTION-004) before any reader migrates from the wide table to this one",
    );
  },
);

integration(
  "REAL POSTGRES: in-order writes (no staleness involved) produce IDENTICAL results in both tables",
  async () => {
    await resetSchema();
    const client = await pool.connect();

    await upsertBranchStockSnapshot(client, wideRecord({ qtyBranch001: 50, qtyTotalAllBranches: 50, syncedAt: "2026-07-29T09:00:00Z" }));
    await upsertBranchStockCurrent(client, { productCode: "X1", branchCode: "001", qty: 50, costAvg: null, syncedAt: "2026-07-29T09:00:00Z", rawPayload: {} });

    await upsertBranchStockSnapshot(client, wideRecord({ qtyBranch001: 100, qtyTotalAllBranches: 100, syncedAt: "2026-07-29T10:00:00Z" }));
    await upsertBranchStockCurrent(client, { productCode: "X1", branchCode: "001", qty: 100, costAvg: null, syncedAt: "2026-07-29T10:00:00Z", rawPayload: {} });

    client.release();

    const wide = (await pool.query("SELECT qty_branch_001 FROM ada.branch_stock_snapshots WHERE product_code='X1'")).rows[0];
    const normalized = (await pool.query("SELECT qty FROM ada.branch_stock_current WHERE product_code='X1' AND branch_code='001'")).rows[0];
    assert.equal(Number(wide.qty_branch_001), 100);
    assert.equal(Number(normalized.qty), 100);
    assert.equal(Number(wide.qty_branch_001), Number(normalized.qty), "when delivery order matches synced_at order (the common case), both tables agree — the divergence is specific to out-of-order delivery");
  },
);
