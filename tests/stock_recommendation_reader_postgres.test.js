"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

const {
  loadNormalizedActiveBranches,
  loadNormalizedGenerationEvidence,
  loadNormalizedCandidateProductCodes,
  loadNormalizedCurrentStockByProduct,
  persistReaderComparison,
  linkReaderComparisonToServedSnapshot,
  pruneExpiredReaderComparisons,
  withRepeatableReadSnapshot,
} = require("../apps/admin-api/src/services/stockRecommendationReaders");

const databaseUrl = process.env.CP4_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
let maintenancePool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 2 }) : null;
let pool = null;
let sharedDatabaseName = null;
let disposableDatabaseName = null;
const migrationSql = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "070_add_stock_recommendation_reader_comparisons.sql"),
  "utf8",
);

function quoteDatabaseIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error("Invalid disposable PostgreSQL database name.");
  }
  return `"${value}"`;
}

function connectionStringForDatabase(databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function currentDatabase(targetPool) {
  return String((await targetPool.query(
    "SELECT current_database() AS database_name",
  )).rows[0]?.database_name || "");
}

async function createDisposableDatabase() {
  sharedDatabaseName = await currentDatabase(maintenancePool);
  disposableDatabaseName = `wp3_reader_${process.pid}_${crypto.randomBytes(8).toString("hex")}`;
  assert.notEqual(disposableDatabaseName, sharedDatabaseName);
  await maintenancePool.query(`CREATE DATABASE ${quoteDatabaseIdentifier(disposableDatabaseName)}`);
  pool = new Pool({
    connectionString: connectionStringForDatabase(disposableDatabaseName),
    max: 4,
  });
  assert.equal(await currentDatabase(pool), disposableDatabaseName);
}

async function resetSchema(targetPool = pool) {
  const connectedDatabase = await currentDatabase(targetPool);
  if (
    !disposableDatabaseName
    || connectedDatabase !== disposableDatabaseName
    || connectedDatabase === sharedDatabaseName
  ) {
    throw new Error("Refusing destructive WP3 test setup outside its disposable database.");
  }

  await targetPool.query(`
    DROP TABLE IF EXISTS public.wp3_snapshot_probe;
    DROP SCHEMA IF EXISTS ordering CASCADE;
    DROP SCHEMA IF EXISTS ingest CASCADE;
    DROP SCHEMA IF EXISTS ada CASCADE;
    DROP SCHEMA IF EXISTS core CASCADE;
    CREATE SCHEMA ordering;
    CREATE SCHEMA ingest;
    CREATE SCHEMA ada;
    CREATE SCHEMA core;

    CREATE TABLE core.branches (
      branch_code text PRIMARY KEY,
      branch_name text NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      is_hq boolean NOT NULL DEFAULT false
    );
    CREATE TABLE ada.products (
      product_code text PRIMARY KEY,
      product_name_th text,
      product_name text,
      unit_small text,
      unit_medium text,
      unit_large text,
      is_active text
    );
    CREATE TABLE ada.product_barcodes (
      product_code text NOT NULL,
      barcode text NOT NULL,
      barcode_role text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE ada.branch_stock_current (
      product_code text NOT NULL,
      branch_code text NOT NULL,
      qty numeric NOT NULL,
      cost_avg numeric,
      synced_at timestamptz,
      last_full_sync_run_id bigint,
      PRIMARY KEY (product_code, branch_code)
    );
    CREATE TABLE ingest.sync_runs (
      sync_run_id bigint PRIMARY KEY,
      branch_code text,
      status text NOT NULL,
      ingestion_mode text NOT NULL,
      snapshot_mode text NOT NULL,
      handoff_status text NOT NULL,
      apply_status text NOT NULL,
      finalized_at timestamptz,
      finished_at timestamptz
    );
    CREATE TABLE ingest.branch_stock_retirements (
      sync_run_id bigint PRIMARY KEY,
      status text NOT NULL,
      expected_membership_count integer,
      actual_membership_count integer
    );
    CREATE TABLE ingest.branch_stock_reconciliations (
      sync_run_id bigint PRIMARY KEY,
      status text NOT NULL,
      mismatch_summary jsonb
    );
    CREATE TABLE public.wp3_snapshot_probe (
      id integer PRIMARY KEY,
      qty integer NOT NULL
    );
  `);
  await targetPool.query(migrationSql);
}

async function cleanupDisposableDatabase() {
  const cleanupErrors = [];
  const databaseNameToDrop = disposableDatabaseName;
  const adminPool = maintenancePool;
  if (pool) {
    try {
      await pool.end();
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      pool = null;
    }
  }

  if (adminPool && databaseNameToDrop) {
    try {
      await adminPool.query(
        `
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = $1
            AND pid <> pg_backend_pid()
        `,
        [databaseNameToDrop],
      );
      const remainingConnections = Number((await adminPool.query(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1",
        [databaseNameToDrop],
      )).rows[0]?.count || 0);
      if (remainingConnections !== 0) {
        throw new Error("Disposable WP3 database still has open connections after pool shutdown.");
      }
      await adminPool.query(
        `DROP DATABASE IF EXISTS ${quoteDatabaseIdentifier(databaseNameToDrop)}`,
      );
      const remainingDatabases = Number((await adminPool.query(
        "SELECT count(*)::int AS count FROM pg_database WHERE datname = $1",
        [databaseNameToDrop],
      )).rows[0]?.count || 0);
      if (remainingDatabases !== 0) {
        throw new Error("Disposable WP3 database was not removed.");
      }
      console.log(
        `[wp3-reader-postgres] removed disposable database ${databaseNameToDrop}; open connections=0`,
      );
      disposableDatabaseName = null;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (adminPool) {
    try {
      await adminPool.end();
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      maintenancePool = null;
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "WP3 disposable PostgreSQL cleanup failed.");
  }
}

async function seedEligibleBranches() {
  const cleanMismatch = {
    generationMembership: { matches: true },
    normalizedVsWide: { matches: true },
    normalizedVsWideRows: { mismatchCount: 0 },
  };
  await pool.query(`
    INSERT INTO core.branches (branch_code, branch_name, is_active, is_hq) VALUES
      ('001', 'Branch 001', true, false),
      ('006', 'Branch 006', true, false),
      ('900', 'Dry Run Dispatch', true, false);
    INSERT INTO ada.products (
      product_code, product_name_th, product_name, unit_small, is_active
    ) VALUES
      ('PZERO', 'ศูนย์', 'Zero', 'EA', '1'),
      ('PNEG', 'ติดลบ', 'Negative', 'BOX', '1'),
      ('ABSENT', 'ไม่มี', 'Absent', 'EA', '1'),
      ('PINACTIVE', 'ไม่ใช้งาน', 'Inactive', 'EA', 'inactive'),
      ('PRETIRED', 'เลิกใช้', 'Retired', 'EA', '1');
    INSERT INTO ada.product_barcodes (product_code, barcode, barcode_role) VALUES
      ('PZERO', '111', 'primary'),
      ('PNEG', '222', 'primary');
    INSERT INTO ingest.sync_runs (
      sync_run_id, branch_code, status, ingestion_mode, snapshot_mode,
      handoff_status, apply_status, finalized_at, finished_at
    ) VALUES
      (501, '001', 'success', 'hybrid_v2', 'full', 'success', 'applied', now(), now()),
      (506, '006', 'success', 'hybrid_v2', 'full', 'success', 'applied', now(), now());
    INSERT INTO ingest.branch_stock_retirements (
      sync_run_id, status, expected_membership_count, actual_membership_count
    ) VALUES (501, 'done', 2, 2), (506, 'done', 1, 1);
    INSERT INTO ada.branch_stock_current (
      product_code, branch_code, qty, cost_avg, synced_at, last_full_sync_run_id
    ) VALUES
      ('PZERO', '001', 0, NULL, now(), 501),
      ('PNEG', '006', -3, 0, now(), 506),
      ('PINACTIVE', '001', 4, 10, now(), 501),
      ('PRETIRED', '001', 5, 20, now()-interval '2 days', 499);
  `);
  await pool.query(`
    INSERT INTO ingest.branch_stock_reconciliations (
      sync_run_id, status, mismatch_summary
    ) VALUES (501, 'pass', $1::jsonb), (506, 'pass', $1::jsonb)
  `, [JSON.stringify(cleanMismatch)]);
}

if (databaseUrl) {
  test.before(async () => {
    try {
      await createDisposableDatabase();
      await resetSchema();
      await seedEligibleBranches();
    } catch (setupError) {
      try {
        await cleanupDisposableDatabase();
      } catch (cleanupError) {
        throw new AggregateError(
          [setupError, cleanupError],
          "WP3 disposable PostgreSQL setup and cleanup both failed.",
        );
      }
      throw setupError;
    }
  });
  test.after(async () => {
    await cleanupDisposableDatabase();
  });
}

integration("REAL POSTGRES: isolation guard refuses schema reset against the shared test database", async () => {
  const sharedQueries = [];
  const observedSharedPool = {
    query: async (...args) => {
      sharedQueries.push(String(args[0]));
      return maintenancePool.query(...args);
    },
  };

  await assert.rejects(
    resetSchema(observedSharedPool),
    /Refusing destructive WP3 test setup outside its disposable database/,
  );
  assert.equal(await currentDatabase(pool), disposableDatabaseName);
  assert.equal(await currentDatabase(maintenancePool), sharedDatabaseName);
  assert.equal(sharedQueries.length, 1);
  assert.match(sharedQueries[0], /^SELECT current_database\(\)/);
  assert.equal(
    sharedQueries.some((sql) => /\b(?:DROP|CREATE|ALTER|TRUNCATE)\b/i.test(sql)),
    false,
    "the refused shared-database reset must not issue schema-changing SQL",
  );
});

integration("REAL POSTGRES: migration 070 is idempotent, bounded, indexed, and stores no payload column", async () => {
  await pool.query(migrationSql);
  const columns = (await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='ordering'
      AND table_name='stock_recommendation_reader_comparisons'
    ORDER BY ordinal_position
  `)).rows.map((row) => row.column_name);
  assert.equal(columns.some((column) => /payload|stock_rows|recommendation_rows/.test(column)), false);
  assert.ok(columns.includes("expires_at"));
  assert.ok(columns.includes("served_snapshot_generated_at"));
  assert.ok(columns.includes("served_branch_codes"));
  const indexes = (await pool.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname='ordering'
      AND tablename='stock_recommendation_reader_comparisons'
  `)).rows.map((row) => row.indexname);
  assert.ok(indexes.includes("idx_stock_recommendation_reader_comparisons_expiry"));
  assert.ok(indexes.includes("idx_stock_recommendation_reader_comparisons_served_snapshot"));
  await assert.rejects(
    pool.query(`
      INSERT INTO ordering.stock_recommendation_reader_comparisons (
        comparison_id, reader_mode, served_reader, comparison_status,
        mismatch_examples, started_at, expires_at
      ) VALUES ($1, 'shadow', 'legacy', 'mismatch', $2::jsonb, now(), now()+interval '1 day')
    `, [crypto.randomUUID(), JSON.stringify(Array.from({ length: 13 }, () => ({ kind: "x" })))]),
    /check constraint/i,
  );
});

integration("REAL POSTGRES: branch expansion, eligibility, and normalized loader preserve zero/null/negative/absent semantics", async () => {
  const branches = await loadNormalizedActiveBranches(pool, {
    legacyBranchCodes: ["000", "001", "002", "003", "004", "005"],
  });
  assert.deepEqual(branches.map((branch) => branch.branchCode), ["001", "006"]);

  const evidence = await loadNormalizedGenerationEvidence(pool, {
    activeBranchCodes: branches.map((branch) => branch.branchCode),
    maxAgeHours: 24,
  });
  assert.equal(evidence.available, true);
  assert.deepEqual([...evidence.generationByBranch.entries()], [["001", "501"], ["006", "506"]]);

  const positiveCandidates = await loadNormalizedCandidateProductCodes(pool, {
    activeBranchCodes: ["001", "006"],
    generationByBranch: evidence.generationByBranch,
    search: "",
  });
  assert.deepEqual(positiveCandidates, ["PINACTIVE"]);
  assert.deepEqual(await loadNormalizedCandidateProductCodes(pool, {
    activeBranchCodes: ["001", "006"],
    generationByBranch: evidence.generationByBranch,
    search: "Zero",
  }), ["PZERO"]);
  assert.deepEqual(await loadNormalizedCandidateProductCodes(pool, {
    activeBranchCodes: ["001", "006"],
    generationByBranch: evidence.generationByBranch,
    search: "Retired",
  }), ["PRETIRED"]);

  const loaded = await loadNormalizedCurrentStockByProduct(pool, {
    productCodes: ["PZERO", "PNEG", "ABSENT", "PINACTIVE", "PRETIRED"],
    activeBranchCodes: ["001", "006"],
    generationByBranch: evidence.generationByBranch,
  });
  const zero = loaded.stockRows.find((row) => row.productCode === "PZERO");
  const negative = loaded.stockRows.find((row) => row.productCode === "PNEG");
  const absent = loaded.stockRows.find((row) => row.productCode === "ABSENT");
  const inactive = loaded.stockRows.find((row) => row.productCode === "PINACTIVE");
  const retired = loaded.stockRows.find((row) => row.productCode === "PRETIRED");
  assert.equal(zero.branches["001"].sourcePresent, true);
  assert.equal(zero.branches["001"].qty, 0);
  assert.equal(zero.branches["001"].unitCostAvg, null);
  assert.equal(negative.branches["006"].qty, -3);
  assert.equal(negative.branches["006"].unitCostAvg, 0);
  assert.equal(absent.branches["001"].sourcePresent, false);
  assert.equal(absent.branches["006"].sourcePresent, false);
  assert.equal(inactive.branches["001"].sourcePresent, true);
  assert.equal(inactive.branches["001"].qty, 4);
  assert.equal(retired.branches["001"].sourcePresent, false);
  assert.equal(retired.branches["001"].qty, 0);
});

integration("REAL POSTGRES: reconciliation mismatch makes the normalized generation ineligible", async () => {
  await pool.query(`
    UPDATE ingest.branch_stock_reconciliations
    SET mismatch_summary = jsonb_set(mismatch_summary, '{generationMembership,matches}', 'false'::jsonb)
    WHERE sync_run_id=506
  `);
  const evidence = await loadNormalizedGenerationEvidence(pool, {
    activeBranchCodes: ["001", "006"],
    maxAgeHours: 24,
  });
  assert.equal(evidence.available, false);
  assert.ok(evidence.failures.some((failure) => (
    failure.branchCode === "006" && failure.reason === "RECONCILIATION_EVIDENCE_MISMATCH"
  )));
  await pool.query(`
    UPDATE ingest.branch_stock_reconciliations
    SET mismatch_summary = jsonb_set(mismatch_summary, '{generationMembership,matches}', 'true'::jsonb)
    WHERE sync_run_id=506
  `);
});

integration("REAL POSTGRES: repeatable-read helper holds one snapshot across a concurrent committed write", async () => {
  await pool.query("INSERT INTO public.wp3_snapshot_probe (id, qty) VALUES (1, 1)");
  const observed = await withRepeatableReadSnapshot(pool, async (client) => {
    const before = Number((await client.query(
      "SELECT qty FROM public.wp3_snapshot_probe WHERE id=1",
    )).rows[0].qty);
    await pool.query("UPDATE public.wp3_snapshot_probe SET qty=2 WHERE id=1");
    const after = Number((await client.query(
      "SELECT qty FROM public.wp3_snapshot_probe WHERE id=1",
    )).rows[0].qty);
    return { before, after };
  });
  assert.deepEqual(observed.value, { before: 1, after: 1 });
  assert.equal(Number((await pool.query(
    "SELECT qty FROM public.wp3_snapshot_probe WHERE id=1",
  )).rows[0].qty), 2);
});

integration("REAL POSTGRES: comparison persistence links the served cache and retention prunes independently", async () => {
  const expiredId = crypto.randomUUID();
  await pool.query(`
    INSERT INTO ordering.stock_recommendation_reader_comparisons (
      comparison_id, reader_mode, served_reader, comparison_status,
      started_at, expires_at
    ) VALUES ($1, 'shadow', 'legacy', 'match', now()-interval '2 days', now()-interval '1 day')
  `, [expiredId]);
  const comparisonId = await persistReaderComparison(pool, {
    readerMode: "shadow",
    servedReader: "legacy",
    status: "mismatch",
    branchCodes: ["001", "006"],
    comparison: {
      legacyDigest: "a".repeat(64),
      normalizedDigest: "b".repeat(64),
      counts: { inputQuantity: 1 },
      examples: [{ kind: "inputQuantity", productCode: "PZERO", branchCode: "001" }],
    },
    inputCounts: { legacyProducts: 3, normalizedProducts: 3 },
    inputGenerations: [{ branchCode: "001", syncRunId: "501" }],
    availability: { status: "available", failures: [] },
    sourceSnapshot: "10:10:",
    durationMs: 12,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  assert.equal(await linkReaderComparisonToServedSnapshot(pool, {
    comparisonId,
    anchorDate: "2026-09-01",
    targetDays: 90,
    generatedAt: "2026-09-01T02:00:00.000Z",
    rowCount: 3,
    branchCodes: ["001", "006"],
  }), true);
  const row = (await pool.query(`
    SELECT comparison_id, mismatch_counts, mismatch_examples, input_counts,
           input_generations, source_snapshot, duration_ms,
           served_source, served_anchor_date::text, served_target_days,
           served_snapshot_generated_at, served_row_count, served_branch_codes
    FROM ordering.stock_recommendation_reader_comparisons
    WHERE comparison_id=$1
  `, [comparisonId])).rows[0];
  assert.deepEqual(row.mismatch_counts, { inputQuantity: 1 });
  assert.equal(row.mismatch_examples.length, 1);
  assert.equal(row.source_snapshot, "10:10:");
  assert.equal(row.duration_ms, 12);
  assert.equal(row.served_source, "precomputed");
  assert.equal(row.served_anchor_date, "2026-09-01");
  assert.equal(row.served_target_days, 90);
  assert.equal(row.served_snapshot_generated_at.toISOString(), "2026-09-01T02:00:00.000Z");
  assert.equal(row.served_row_count, 3);
  assert.deepEqual(row.served_branch_codes, ["001", "006"]);
  assert.equal((await pool.query(`
    SELECT count(*)::int AS count
    FROM ordering.stock_recommendation_reader_comparisons
    WHERE comparison_id=$1
  `, [expiredId])).rows[0].count, 1);
  assert.equal(await pruneExpiredReaderComparisons(pool), 1);
  assert.equal((await pool.query(`
    SELECT count(*)::int AS count
    FROM ordering.stock_recommendation_reader_comparisons
    WHERE comparison_id=$1
  `, [expiredId])).rows[0].count, 0);
});
