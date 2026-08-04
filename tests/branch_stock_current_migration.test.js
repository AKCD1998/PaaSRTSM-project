"use strict";

// REAL-POSTGRES proof of migrations/066_add_ada_branch_stock_current.sql —
// both the schema (CREATE TABLE/indexes) and the one-time backfill's
// conditional logic (qty<>0 OR per-branch synced_at, falling back to the
// shared synced_at column) documented in that migration's own comments.
//
// Runs the REAL migration SQL file (fs.readFileSync + execute), not a
// reimplementation, against a wide-table fixture built to match migrations
// 022+032+060 exactly. Gated behind CP4_TEST_DATABASE_URL, same convention
// as the other real-Postgres tests in this suite.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const databaseUrl = process.env.CP4_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : null;

const migrationSql = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "066_add_ada_branch_stock_current.sql"),
  "utf8",
);

async function resetWideTableSchema() {
  await pool.query(`
    DROP SCHEMA IF EXISTS ada CASCADE;
    CREATE SCHEMA ada;

    CREATE TABLE ada.branch_stock_snapshots (
      product_code text PRIMARY KEY,
      product_name_thai text,
      product_name_eng text,
      barcode text,
      unit text,
      qty_branch_000 numeric(14,4) NOT NULL DEFAULT 0,
      qty_branch_001 numeric(14,4) NOT NULL DEFAULT 0,
      qty_branch_002 numeric(14,4) NOT NULL DEFAULT 0,
      qty_branch_003 numeric(14,4) NOT NULL DEFAULT 0,
      qty_branch_004 numeric(14,4) NOT NULL DEFAULT 0,
      qty_branch_005 numeric(14,4) NOT NULL DEFAULT 0,
      qty_total_all_branches numeric(14,4) NOT NULL DEFAULT 0,
      synced_at timestamptz NOT NULL,
      source_system text NOT NULL DEFAULT 'AdaAcc',
      source_table text NOT NULL DEFAULT 'TCNTPdtInWha',
      source_synced_at timestamptz NOT NULL,
      raw_payload jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      cost_avg_branch_000 numeric(18,4),
      cost_avg_branch_001 numeric(18,4),
      cost_avg_branch_002 numeric(18,4),
      cost_avg_branch_003 numeric(18,4),
      cost_avg_branch_004 numeric(18,4),
      cost_avg_branch_005 numeric(18,4),
      synced_at_branch_000 timestamptz,
      synced_at_branch_001 timestamptz,
      synced_at_branch_002 timestamptz,
      synced_at_branch_003 timestamptz,
      synced_at_branch_004 timestamptz,
      synced_at_branch_005 timestamptz
    );
  `);
}

integration("REAL POSTGRES: migration 066 creates ada.branch_stock_current with the expected shape", async () => {
  await resetWideTableSchema();
  await pool.query(migrationSql);

  const columns = await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'ada' AND table_name = 'branch_stock_current'
    ORDER BY ordinal_position
  `);
  const columnNames = columns.rows.map((row) => row.column_name);
  assert.deepEqual(columnNames, [
    "product_code", "branch_code", "qty", "cost_avg", "synced_at",
    "source_system", "source_table", "source_synced_at", "raw_payload",
    "created_at", "updated_at",
  ]);
  // deliberately absent, per the migration's own documented design choices:
  assert.ok(!columnNames.includes("product_name_thai"));
  assert.ok(!columnNames.includes("qty_total_all_branches"));

  const pk = await pool.query(`
    SELECT a.attname
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'ada.branch_stock_current'::regclass AND i.indisprimary
    ORDER BY a.attname
  `);
  assert.deepEqual(pk.rows.map((r) => r.attname), ["branch_code", "product_code"]);
});

integration(
  "REAL POSTGRES: backfill includes nonzero-qty branches (v1-style, no per-branch synced_at) using the shared synced_at as fallback",
  async () => {
    await resetWideTableSchema();
    const sharedSyncedAt = "2026-07-01T08:00:00.000Z";
    await pool.query(
      `INSERT INTO ada.branch_stock_snapshots
        (product_code, qty_branch_001, qty_branch_003, synced_at, source_synced_at)
       VALUES ('V1PROD', 10, 5, $1, $1)`,
      [sharedSyncedAt],
    );

    await pool.query(migrationSql);

    const rows = (await pool.query(
      `SELECT branch_code, qty, synced_at FROM ada.branch_stock_current WHERE product_code = 'V1PROD' ORDER BY branch_code`,
    )).rows;
    assert.equal(rows.length, 2, "only the two branches with nonzero qty are backfilled — the other 4 (qty=0, no per-branch sync) are not");
    assert.equal(rows[0].branch_code, "001");
    assert.equal(Number(rows[0].qty), 10);
    assert.equal(rows[0].synced_at.toISOString(), new Date(sharedSyncedAt).toISOString(), "falls back to the shared synced_at since no per-branch value exists");
    assert.equal(rows[1].branch_code, "003");
    assert.equal(Number(rows[1].qty), 5);
  },
);

integration(
  "REAL POSTGRES: backfill includes a per-branch-synced (v2-style) branch even at zero quantity",
  async () => {
    await resetWideTableSchema();
    const sharedSyncedAt = "2026-07-01T08:00:00.000Z";
    const branch004SyncedAt = "2026-07-02T09:30:00.000Z";
    await pool.query(
      `INSERT INTO ada.branch_stock_snapshots
        (product_code, qty_branch_004, synced_at_branch_004, synced_at, source_synced_at)
       VALUES ('V2PROD', 0, $2, $1, $1)`,
      [sharedSyncedAt, branch004SyncedAt],
    );

    await pool.query(migrationSql);

    const rows = (await pool.query(
      `SELECT branch_code, qty, synced_at FROM ada.branch_stock_current WHERE product_code = 'V2PROD'`,
    )).rows;
    assert.equal(rows.length, 1, "backfilled because it has a real per-branch synced_at, even though qty is 0");
    assert.equal(rows[0].branch_code, "004");
    assert.equal(Number(rows[0].qty), 0);
    assert.equal(rows[0].synced_at.toISOString(), new Date(branch004SyncedAt).toISOString(), "uses the MORE PRECISE per-branch value, not the shared fallback");
  },
);

integration(
  "REAL POSTGRES: a branch with zero qty AND no per-branch synced_at is NOT backfilled (documented limitation)",
  async () => {
    await resetWideTableSchema();
    await pool.query(
      `INSERT INTO ada.branch_stock_snapshots (product_code, synced_at, source_synced_at) VALUES ('EMPTY1', now(), now())`,
    );

    await pool.query(migrationSql);

    const rows = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM ada.branch_stock_current WHERE product_code = 'EMPTY1'`,
    )).rows;
    assert.equal(rows[0].n, 0);
  },
);

integration("REAL POSTGRES: applying the migration a second time does not duplicate or error", async () => {
  await resetWideTableSchema();
  await pool.query(
    `INSERT INTO ada.branch_stock_snapshots (product_code, qty_branch_001, synced_at, source_synced_at) VALUES ('IDEMPOTENT1', 7, now(), now())`,
  );

  await pool.query(migrationSql);
  await pool.query(migrationSql); // re-apply

  const rows = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM ada.branch_stock_current WHERE product_code = 'IDEMPOTENT1'`,
  )).rows;
  assert.equal(rows[0].n, 1, "ON CONFLICT DO NOTHING keeps this idempotent across re-application");
});
