"use strict";

// Track R / Gate 6 remediation (Codex CLAIM-X-134 in _ledger/codex.md; Sonnet
// CLAIM-X-134/X-135 and the Option-A/B design loop in _ledger/claude.md,
// 2026-08-06). Codex/human selected Option B: replace the reconciliation
// selectors' `stamp IS NOT NULL` predicate with `stamp = job.sync_run_id`
// (current-generation exact match) PLUS an explicit generation-membership
// verification step comparing current-generation product-code sets between
// normalized and wide against `expected_manifest.uniqueProductCount`.
//
// GLM 5.2's Round-2 adversarial pass (2026-08-06) found that the existing
// worker.test.js mock pattern (`if (/FROM ada\.branch_stock_current/.test(q))
// return { rows: [...] }`) matches on SQL text and returns fixed rows without
// ever evaluating the real WHERE clause -- a test written that way would pass
// or fail based on hand-picked fixtures, never actually exercising the new
// predicate. Every test in this file therefore runs the REAL SQL selectors
// against a real Postgres instance (gated behind CP4_TEST_DATABASE_URL, same
// convention as tests/cp4_postgres_integration.test.js) via the real
// claim/process pipeline (`processOneReconciliation`), not a mock.
//
// Baseline ("OLD") in every test below is the selector pair as currently
// deployed at SHA 4db9b7c (normalized: no filter at all; wide: `stamp IS NOT
// NULL`) -- the actual asymmetric bug that failed run 1917, not the
// intermediate Option-A design. Tests are written RED-first: run this file
// unmodified against the current `readReconciliationInputs` to confirm the
// documented failures are real and non-vacuous, THEN implement Option B and
// re-run to confirm GREEN.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const {
  processOneReconciliation, processOneRetirement,
} = require("../apps/admin-api/src/worker");
const {
  buildBranchStockReconciliationManifest,
} = require("../apps/admin-api/src/services/branchStockReconciliation");

const databaseUrl = process.env.CP4_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8 }) : null;

const ANCHOR = { productCode: "ANCHOR-001", qty: 10, syncedAt: "2026-08-06T01:00:00.000Z" };
const CONTRACT_VERSION = "branch-stock-v1"; // must match BRANCH_STOCK_RECONCILIATION_VERSION

// GLM 5.2 O-1 finding (2026-08-06 review round): this file originally had no
// bootstrap of its own and depended on tests/cp4_postgres_integration.test.js
// having already created schema/tables against the SAME running Postgres
// instance -- it failed with `schema "ingest" does not exist` when run in
// isolation against a genuinely fresh database. Fixed: idempotently bootstrap
// the same minimal schema + migration set (mirrors
// cp4_postgres_integration.test.js's own first test) only if
// ingest.branch_stock_reconciliations does not already exist, so this file
// is self-contained and safe to run alone, first, or after other suites.
if (pool) {
  test.before(async () => {
    const exists = (await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='ingest' AND table_name='branch_stock_reconciliations'`,
    )).rows.length > 0;
    if (exists) return;
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS ingest; CREATE SCHEMA IF NOT EXISTS ada;
      CREATE TABLE IF NOT EXISTS ingest.sync_runs (
        sync_run_id bigserial PRIMARY KEY, sync_type text NOT NULL, source_name text NOT NULL,
        started_at timestamptz NOT NULL, finished_at timestamptz,
        status text NOT NULL CHECK (status IN ('queued','running','success','failed')),
        records_read integer NOT NULL DEFAULT 0, records_sent integer NOT NULL DEFAULT 0,
        message text, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS ada.branch_stock_snapshots (
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
    `);
    for (const file of [
      "060_add_async_ingestion_queue.sql",
      "066_add_ada_branch_stock_current.sql",
      "067_add_branch_stock_reconciliation.sql",
      "068_add_branch_stock_generation_tracking.sql",
      "069_add_branch_stock_retirements.sql",
    ]) {
      await pool.query(fs.readFileSync(path.join(__dirname, "..", "migrations", file), "utf8"));
    }
  });
}

async function resetData() {
  await pool.query(
    "TRUNCATE ingest.branch_stock_retirements, ingest.branch_stock_reconciliations, " +
    "ingest.sync_batches, ingest.sync_runs, ada.branch_stock_snapshots, ada.branch_stock_current RESTART IDENTITY CASCADE",
  );
}

// Inserts a v1 sync_run + a durably-`done` retirement row for it (bypassing
// the retirement pipeline itself, which is not under test here -- this file
// isolates the RECONCILIATION SELECTOR) + a claimable reconciliation row
// carrying the supplied payload as `expected_manifest`. Returns the run id.
// Consumes sync_run_id 1 with a throwaway earlier run so the "current"
// run created right after is guaranteed >= 2 -- tests that need a distinct,
// real, non-null "older generation" stamp (e.g. `syncRunId - 1`) would
// otherwise silently degrade to `stamp: null` for the first run in a
// freshly-TRUNCATEd/RESTART-IDENTITY'd table, changing what they test.
async function consumeAnOlderRunId() {
  const dummy = await pool.query(
    `INSERT INTO ingest.sync_runs (sync_type, source_name, branch_code, ingestion_mode, status, started_at, finished_at)
     VALUES ('legacy', 'v1', '000', 'v1', 'success', now() - interval '1 day', now() - interval '1 day') RETURNING sync_run_id`,
  );
  return dummy.rows[0].sync_run_id;
}

async function setupClaimableRun(payloadRecords) {
  const run = await pool.query(
    `INSERT INTO ingest.sync_runs (sync_type, source_name, branch_code, ingestion_mode, status, started_at, finished_at)
     VALUES ('legacy', 'v1', '000', 'v1', 'success', now(), now()) RETURNING sync_run_id`,
  );
  const syncRunId = run.rows[0].sync_run_id;
  await pool.query(
    `INSERT INTO ingest.branch_stock_retirements
       (sync_run_id, branch_code, status, expected_membership_count, actual_membership_count,
        retired_normalized_count, retired_wide_count, completed_at)
     VALUES ($1, '000', 'done', 0, 0, 0, 0, now())`,
    [syncRunId],
  );
  const expectedManifest = buildBranchStockReconciliationManifest(payloadRecords);
  await pool.query(
    `INSERT INTO ingest.branch_stock_reconciliations (sync_run_id, branch_code, contract_version, expected_manifest, status)
     VALUES ($1, '000', $2, $3::jsonb, 'pending')`,
    [syncRunId, CONTRACT_VERSION, JSON.stringify(expectedManifest)],
  );
  return syncRunId;
}

async function insertNormalized(rows) {
  for (const row of rows) {
    await pool.query(
      `INSERT INTO ada.branch_stock_current (product_code, branch_code, qty, synced_at, last_full_sync_run_id, retired_at, retired_by_sync_run_id)
       VALUES ($1, '000', $2, $3, $4, $5, $6)`,
      [row.productCode, row.qty, row.syncedAt, row.stamp ?? null, row.retiredAt ?? null, row.retiredBy ?? null],
    );
  }
}

async function insertWide(rows) {
  for (const row of rows) {
    // `synced_at`/`source_synced_at` (the shared legacy freshness columns)
    // are NOT NULL on this table; `synced_at_branch_000` (the per-branch
    // column actually read by readReconciliationInputs) is nullable and is
    // set to exactly what the fixture specifies, including null.
    const sharedFallback = row.syncedAt ?? "2020-01-01T00:00:00.000Z";
    await pool.query(
      `INSERT INTO ada.branch_stock_snapshots
         (product_code, qty_branch_000, synced_at_branch_000, full_sync_run_id_branch_000, synced_at, source_synced_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [row.productCode, row.qty, row.syncedAt, row.stamp ?? null, sharedFallback],
    );
  }
}

async function reconcileAndGetOutcome(syncRunId) {
  assert.equal(await processOneReconciliation(pool), true, "reconciliation job must be claimable");
  const evidence = (await pool.query(
    "SELECT status, mismatch_summary FROM ingest.branch_stock_reconciliations WHERE sync_run_id=$1",
    [syncRunId],
  )).rows[0];
  return evidence;
}

// --- Truth-table row 3: TEST001/1917 shape --------------------------------
// absent from payload, retired-shape row with NO stamp (qty=0, stamp=NULL)
// on both tables. OLD selectors: normalized has no filter (always includes
// it) but wide requires `stamp IS NOT NULL` (excludes it) -> asymmetric ->
// FAIL. This is the exact real-world run-1917 mechanism.
integration("row 3 (TEST001-shape, unstamped retired row): OLD selectors FAIL, Option B PASSES", async () => {
  await resetData();
  const syncRunId = await setupClaimableRun([ANCHOR]);
  await insertNormalized([
    { ...ANCHOR, stamp: syncRunId },
    { productCode: "TEST001", qty: 0, syncedAt: "2026-06-23T03:08:23.171Z", stamp: null, retiredAt: new Date().toISOString(), retiredBy: syncRunId },
  ]);
  await insertWide([
    { ...ANCHOR, stamp: syncRunId },
    { productCode: "TEST001", qty: 0, syncedAt: null, stamp: null },
  ]);
  const evidence = await reconcileAndGetOutcome(syncRunId);
  // RED (current/OLD selectors, run this file unmodified): "fail" -- reproduces
  // the real run-1917 mismatch non-vacuously. GREEN (after Option B): "pass".
  assert.equal(evidence.status, "pass");
});

// --- Truth-table row 4: Codex's counter-example (CLAIM-X-134, codex.md) ---
// absent from payload, retired-shape row with an OLD, non-NULL stamp (qty=0,
// stamp=N-5). OLD selectors: normalized (no filter) AND wide (stamp
// non-NULL) both include it -> normalizedVsWide matches -> but
// payloadVsNormalized fails because the payload (real Agent snapshot) never
// had this product -> still FAIL, just via a different comparison than row 3.
integration("row 4 (Codex's P, old non-NULL stamp): OLD selectors FAIL via payloadVsNormalized, Option B PASSES", async () => {
  await resetData();
  const oldStamp = await consumeAnOlderRunId();
  const syncRunId = await setupClaimableRun([ANCHOR]);
  assert.notEqual(oldStamp, syncRunId, "sanity: the old stamp must be a genuinely distinct generation");
  await insertNormalized([
    { ...ANCHOR, stamp: syncRunId },
    { productCode: "P", qty: 0, syncedAt: "2026-07-01T00:00:00.000Z", stamp: oldStamp },
  ]);
  await insertWide([
    { ...ANCHOR, stamp: syncRunId },
    { productCode: "P", qty: 0, syncedAt: "2026-07-01T00:00:00.000Z", stamp: oldStamp },
  ]);
  const evidence = await reconcileAndGetOutcome(syncRunId);
  // RED: "fail" -- reproduces Codex's counter-example non-vacuously.
  // GREEN (after Option B): "pass".
  assert.equal(evidence.status, "pass");
});

// --- Truth-table row 5/6: nonzero ghost still detected --------------------
// present in normalized/wide at nonzero qty, absent from payload, no stamp.
// Must FAIL under BOTH old and new selectors -- Option B must never hide a
// real nonzero stale/ghost row (the hard constraint from GATE6 delegation).
integration("row 5 (nonzero ghost, unstamped): FAILS under both OLD and Option B", async () => {
  await resetData();
  const syncRunId = await setupClaimableRun([ANCHOR]);
  await insertNormalized([
    { ...ANCHOR, stamp: syncRunId },
    { productCode: "GHOST", qty: 5, syncedAt: "2026-05-01T00:00:00.000Z", stamp: null },
  ]);
  await insertWide([
    { ...ANCHOR, stamp: syncRunId },
    { productCode: "GHOST", qty: 5, syncedAt: "2026-05-01T00:00:00.000Z", stamp: null },
  ]);
  const evidence = await reconcileAndGetOutcome(syncRunId);
  assert.equal(evidence.status, "fail", "a genuine nonzero ghost must never be hidden by either design");
});

// --- Truth-table row 7: membership-boundary generation mismatch ----------
// SLOW is reported by the payload THIS generation at qty=0 (a real,
// legitimate zero-stock confirmation). normalized correctly stamps it
// current; wide's write lagged and still carries the PREVIOUS generation's
// stamp. Both qty=0 -> OLD selectors' digest comparison is BLIND to the
// stamp difference (compareManifests never reads stamp) and silently PASSES
// -- a real false negative. Option B's membership-boundary exclusion (wide
// excludes a stale-stamped zero-qty row) must convert this into a real FAIL.
integration("row 7 (generation-mismatch, coincidentally-equal zero qty): OLD selectors silently PASS (false negative), Option B FAILS (correctly detected)", async () => {
  await resetData();
  const staleStamp = await consumeAnOlderRunId();
  const syncRunId = await setupClaimableRun([ANCHOR, { productCode: "SLOW", qty: 0, syncedAt: "2026-08-06T01:00:00.000Z" }]);
  assert.notEqual(staleStamp, syncRunId, "sanity: the stale stamp must be a genuinely distinct generation");
  await insertNormalized([
    { ...ANCHOR, stamp: syncRunId },
    { productCode: "SLOW", qty: 0, syncedAt: "2026-08-06T01:00:00.000Z", stamp: syncRunId },
  ]);
  await insertWide([
    { ...ANCHOR, stamp: syncRunId },
    // synced_at deliberately held IDENTICAL to the normalized side -- only
    // `stamp` differs, isolating the membership-boundary effect under test
    // from buildBranchStockReconciliationManifest's separate
    // sourceSnapshotMinAt/MaxAt fields (which independently compare
    // timestamps and would otherwise mask what this test is actually
    // checking; discovered empirically while writing this fixture -- an
    // unrelated, timestamp-only detection channel that exists today but
    // is not a substitute for real stamp-aware membership checking, since
    // it only fires when synced_at happens to differ too).
    { productCode: "SLOW", qty: 0, syncedAt: "2026-08-06T01:00:00.000Z", stamp: staleStamp },
  ]);
  const evidence = await reconcileAndGetOutcome(syncRunId);
  // RED (current/OLD selectors): this assertion FAILS -- the harness will
  // report evidence.status === "pass", documenting the OLD design's real
  // false negative (a genuine cross-table generation lag is silently
  // missed, because compareManifests' digest never reads the stamp).
  // GREEN (after Option B): "fail" -- membership divergence correctly caught.
  assert.equal(evidence.status, "fail");
});

// --- Decisive Option-B case (Codex final review, 2026-08-06): a genuinely
// nonzero row, EQUAL quantity on both tables, differing only in generation
// stamp. This is Option A's residual limitation (`qty <> 0 OR stamp IS NOT
// NULL` puts any nonzero row in-domain regardless of stamp, and the manifest
// digest never reads the stamp -- see branchStockReconciliation.js
// canonicalRows) and the exact case that justified choosing Option B over
// Option A: the qty-domain manifests alone cannot catch this, only the
// explicit generation-membership check can. Calls processOneReconciliation
// directly (the real pipeline) -- compareGenerationMembership is
// deliberately NOT copied out and unit-tested in isolation, per Codex's
// explicit instruction, so this test exercises the real, wired-up code path
// end to end, not a reimplementation of it.
integration("decisive case (DRIFT): equal nonzero qty, differing stamp -- qty-domain manifests match, generationMembership catches it, Option A would have missed it", async () => {
  await resetData();
  const oldStamp = await consumeAnOlderRunId();
  const syncRunId = await setupClaimableRun([ANCHOR, { productCode: "DRIFT", qty: 5, syncedAt: "2026-08-06T01:00:00.000Z" }]);
  assert.notEqual(oldStamp, syncRunId, "sanity: the old stamp must be a genuinely distinct generation");
  await insertNormalized([
    { ...ANCHOR, stamp: syncRunId },
    { productCode: "DRIFT", qty: 5, syncedAt: "2026-08-06T01:00:00.000Z", stamp: syncRunId },
  ]);
  await insertWide([
    { ...ANCHOR, stamp: syncRunId },
    // Same qty, same synced_at as normalized -- ONLY the stamp differs, so
    // the qty-domain manifest digest (productCode + quantity only) must
    // match. If it did not match, this test would not isolate the
    // membership check from an ordinary quantity mismatch.
    { productCode: "DRIFT", qty: 5, syncedAt: "2026-08-06T01:00:00.000Z", stamp: oldStamp },
  ]);
  const evidence = await reconcileAndGetOutcome(syncRunId);
  assert.equal(evidence.mismatch_summary.normalizedVsWide.matches, true,
    "qty-domain manifests must match -- DRIFT is in-domain on both sides via qty<>0, same qty, same synced_at");
  assert.equal(evidence.mismatch_summary.generationMembership.matches, false,
    "generationMembership must be the ONLY thing that catches this -- DRIFT is current-generation-confirmed on normalized but not on wide");
  assert.ok(
    evidence.mismatch_summary.generationMembership.onlyInNormalized.includes("DRIFT"),
    "DRIFT must be named in the membership difference, not just an aggregate boolean",
  );
  assert.equal(evidence.status, "fail");
});

// --- Truth-table row 8: retired-then-re-added within the same generation -
// REBORN is a normal, current-generation, nonzero-qty row -- no special
// casing required by either design; included via the `qty <> 0` branch.
integration("row 8 (retired-then-readd, same generation, nonzero): PASSES under both OLD and Option B", async () => {
  await resetData();
  const syncRunId = await setupClaimableRun([ANCHOR, { productCode: "REBORN", qty: 3, syncedAt: "2026-08-06T01:00:00.000Z" }]);
  await insertNormalized([
    { ...ANCHOR, stamp: syncRunId },
    { productCode: "REBORN", qty: 3, syncedAt: "2026-08-06T01:00:00.000Z", stamp: syncRunId },
  ]);
  await insertWide([
    { ...ANCHOR, stamp: syncRunId },
    { productCode: "REBORN", qty: 3, syncedAt: "2026-08-06T01:00:00.000Z", stamp: syncRunId },
  ]);
  const evidence = await reconcileAndGetOutcome(syncRunId);
  assert.equal(evidence.status, "pass");
});

// --- Regression guard (GLM-proposed, 2026-08-06): the retirement sweep must
// never stamp the rows it zeroes -- Option A/B's exclusion of freshly-retired
// rows (row 3's shape) is CONTINGENT on this. If a future change to the
// sweep started setting the stamp, that row would silently re-enter the
// `stamp = job.sync_run_id` domain and this fix would quietly regress.
integration("regression guard: retirement sweep zeroes qty but never sets the generation stamp", async () => {
  await resetData();
  const run = await pool.query(
    `INSERT INTO ingest.sync_runs (sync_type, source_name, branch_code, ingestion_mode, status, started_at, finished_at, apply_status)
     VALUES ('legacy', 'v1', '000', 'v1', 'success', now(), now(), 'not_applicable') RETURNING sync_run_id`,
  );
  const syncRunId = run.rows[0].sync_run_id;
  // ANCHOR simulates a real batch apply that already ran and stamped this
  // generation (retirement's membership-proof check requires actual stamped
  // rows to match the registered manifest's uniqueProductCount).
  await insertNormalized([{ ...ANCHOR, stamp: syncRunId }]);
  await insertWide([{ ...ANCHOR, stamp: syncRunId }]);
  // A stale, unretired ghost row eligible for this generation's sweep.
  await insertNormalized([{ productCode: "STALE", qty: 5, syncedAt: "2026-05-01T00:00:00.000Z", stamp: null }]);
  await insertWide([{ productCode: "STALE", qty: 5, syncedAt: "2026-05-01T00:00:00.000Z", stamp: null }]);
  const expectedManifest = buildBranchStockReconciliationManifest([ANCHOR]); // STALE absent -> eligible for retirement
  // For v1, computeExpectedMembershipCount reads `expected_manifest` from
  // ingest.branch_stock_reconciliations (registered alongside finalize in
  // production), not from the retirement row itself -- must exist here too,
  // or the membership check finds it null and retries instead of proceeding.
  await pool.query(
    `INSERT INTO ingest.branch_stock_reconciliations (sync_run_id, branch_code, contract_version, expected_manifest, status)
     VALUES ($1, '000', $2, $3::jsonb, 'pending')`,
    [syncRunId, CONTRACT_VERSION, JSON.stringify(expectedManifest)],
  );
  await pool.query(
    `INSERT INTO ingest.branch_stock_retirements (sync_run_id, branch_code, status, expected_membership_count)
     VALUES ($1, '000', 'pending', $2)`,
    [syncRunId, expectedManifest.uniqueProductCount],
  );
  assert.equal(await processOneRetirement(pool), true);
  const row = (await pool.query(
    "SELECT qty, last_full_sync_run_id FROM ada.branch_stock_current WHERE product_code='STALE'",
  )).rows[0];
  assert.equal(Number(row.qty), 0, "sweep must zero the stale row");
  assert.equal(row.last_full_sync_run_id, null, "sweep must NOT stamp the row it zeroes -- Option B's exclusion depends on this staying true");
});

if (pool) test.after(async () => pool.end());
