"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { loadConfig } = require("../apps/admin-api/src/config");

const {
  resolveRecommendationReaderPolicy,
  sanitizeAvailability,
  createInputUnavailableError,
  loadNormalizedActiveBranches,
  loadLegacyCurrentStockByProduct,
  loadLegacyCompatibleProductMetadataByProduct,
  loadNormalizedGenerationEvidence,
  loadNormalizedCurrentStockByProduct,
  compareStockReaderResults,
  shouldRunShadowComparison,
  withRepeatableReadSnapshot,
} = require("../apps/admin-api/src/services/stockRecommendationReaders");

function compactSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function goodGenerationRow(overrides = {}) {
  return {
    branch_code: "001",
    sync_run_id: "501",
    run_status: "success",
    ingestion_mode: "hybrid_v2",
    snapshot_mode: "full",
    handoff_status: "success",
    apply_status: "applied",
    finalized_at: "2026-09-01T01:01:00.000Z",
    finished_at: "2026-09-01T01:01:00.000Z",
    retirement_status: "done",
    expected_membership_count: 2,
    actual_membership_count: 2,
    reconciliation_status: "pass",
    mismatch_summary: {
      generationMembership: { matches: true },
      normalizedVsWide: { matches: true },
      normalizedVsWideRows: { mismatchCount: 0 },
    },
    generation_row_count: 2,
    min_stock_synced_at: "2026-09-01T01:00:00.000Z",
    max_stock_synced_at: "2026-09-01T01:00:00.000Z",
    ...overrides,
  };
}

test("reader policy is legacy by default and does not guess freshness or shadow sampling", () => {
  assert.deepEqual(resolveRecommendationReaderPolicy({}), {
    mode: "legacy",
    maxAgeHours: null,
    shadowSampleRate: null,
    shadowRetentionDays: 30,
    normalizedCanaryBranches: null,
  });
  assert.deepEqual(resolveRecommendationReaderPolicy({
    stockRecommendationReaderMode: "normalized",
    stockRecommendationMaxStockAgeHours: 36,
    stockRecommendationShadowSampleRate: 0.25,
    stockRecommendationShadowRetentionDays: 7,
    stockRecommendationNormalizedCanaryBranches: ["003", "001", "003"],
  }), {
    mode: "normalized",
    maxAgeHours: 36,
    shadowSampleRate: 0.25,
    shadowRetentionDays: 7,
    normalizedCanaryBranches: ["001", "003"],
  });
  assert.equal(resolveRecommendationReaderPolicy({
    stockRecommendationReaderMode: "invalid",
  }).mode, "legacy");
});

test("environment config keeps legacy defaults and parses only explicit valid WP3 policy", () => {
  const defaults = loadConfig({});
  assert.equal(defaults.stockRecommendationReaderMode, "legacy");
  assert.equal(defaults.stockRecommendationMaxStockAgeHours, null);
  assert.equal(defaults.stockRecommendationShadowSampleRate, null);
  assert.equal(defaults.stockRecommendationShadowRetentionDays, 30);
  assert.equal(defaults.stockRecommendationNormalizedCanaryBranches, null);

  const selected = loadConfig({
    STOCK_RECOMMENDATION_READER_MODE: "SHADOW",
    STOCK_RECOMMENDATION_MAX_STOCK_AGE_HOURS: "24",
    STOCK_RECOMMENDATION_SHADOW_SAMPLE_RATE: "0.25",
    STOCK_RECOMMENDATION_SHADOW_RETENTION_DAYS: "7",
    STOCK_RECOMMENDATION_NORMALIZED_CANARY_BRANCHES: "003, 001, invalid",
  });
  assert.equal(selected.stockRecommendationReaderMode, "shadow");
  assert.equal(selected.stockRecommendationMaxStockAgeHours, 24);
  assert.equal(selected.stockRecommendationShadowSampleRate, 0.25);
  assert.equal(selected.stockRecommendationShadowRetentionDays, 7);
  assert.deepEqual(selected.stockRecommendationNormalizedCanaryBranches, ["001", "003"]);

  const invalid = loadConfig({
    STOCK_RECOMMENDATION_READER_MODE: "cutover-now",
    STOCK_RECOMMENDATION_MAX_STOCK_AGE_HOURS: "0",
    STOCK_RECOMMENDATION_SHADOW_SAMPLE_RATE: "2",
    STOCK_RECOMMENDATION_SHADOW_RETENTION_DAYS: "0",
  });
  assert.equal(invalid.stockRecommendationReaderMode, "legacy");
  assert.equal(invalid.stockRecommendationMaxStockAgeHours, null);
  assert.equal(invalid.stockRecommendationShadowSampleRate, null);
  assert.equal(invalid.stockRecommendationShadowRetentionDays, 30);
  assert.equal(invalid.stockRecommendationNormalizedCanaryBranches, null);
});

test("availability evidence is bounded and never returns arbitrary error fields", () => {
  const failures = Array.from({ length: 25 }, (_, index) => ({
    branchCode: String(index).padStart(3, "0"),
    reason: "STALE_BRANCH_GENERATION",
    status: "stale",
    secret: `do-not-return-${index}`,
  }));
  const bounded = sanitizeAvailability({ status: "unavailable", failures });
  assert.equal(bounded.failures.length, 20);
  assert.equal(bounded.failuresTruncated, true);
  assert.equal(JSON.stringify(bounded).includes("do-not-return"), false);
  const error = createInputUnavailableError({ status: "unavailable", failures });
  assert.equal(error.statusCode, 503);
  assert.equal(error.code, "STOCK_RECOMMENDATION_INPUT_UNAVAILABLE");
});

test("legacy loader preserves the production query shape, null-to-zero cost quirk, and avoids trace columns by default", async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(compactSql(sql));
      return {
        rows: [{
          product_code: "P1", product_name_thai: "P1 TH", product_name_eng: "P1 EN",
          barcode: "111", unit: "EA", qty_branch_000: 0, qty_branch_001: -2,
          qty_branch_002: 0, qty_branch_003: 0, qty_branch_004: 0, qty_branch_005: 0,
          cost_avg_branch_000: null, cost_avg_branch_001: null,
          cost_avg_branch_002: null, cost_avg_branch_003: null,
          cost_avg_branch_004: null, cost_avg_branch_005: null,
          synced_at: "2026-09-01T01:00:00.000Z",
        }],
      };
    },
  };
  const result = await loadLegacyCurrentStockByProduct(db, { productCodes: ["P1"] });
  assert.equal(queries.length, 1);
  assert.equal(queries[0].includes("full_sync_run_id_branch"), false);
  assert.equal(queries[0].includes("synced_at_branch"), false);
  assert.equal(result.stockRows[0].branches["001"].qty, -2);
  assert.equal(result.stockRows[0].branches["001"].unitCostAvg, 0);
});

test("normalized branch scope includes supported legacy branches and real full-sync expansion, but excludes active dry-run branches", async () => {
  let params;
  const db = {
    async query(sql, values) {
      params = values;
      assert.match(compactSql(sql), /exists \( select 1 from ingest\.sync_runs run/);
      return {
        rows: [
          { branch_code: "001", branch_name: "One", is_hq: false },
          { branch_code: "006", branch_name: "Six", is_hq: false },
        ],
      };
    },
  };
  const branches = await loadNormalizedActiveBranches(db, { legacyBranchCodes: ["000", "001"] });
  assert.deepEqual(params, [["000", "001"]]);
  assert.deepEqual(branches.map((branch) => branch.branchCode), ["001", "006"]);
});

test("normalized eligibility accepts only fresh, terminal, reconciled, generation-exact evidence", async () => {
  const db = { async query() { return { rows: [goodGenerationRow()] }; } };
  const result = await loadNormalizedGenerationEvidence(db, {
    activeBranchCodes: ["001"],
    maxAgeHours: 24,
    now: new Date("2026-09-01T02:00:00.000Z"),
  });
  assert.equal(result.available, true);
  assert.equal(result.generationByBranch.get("001"), "501");
  assert.deepEqual(result.inputGenerations, [{
    branchCode: "001",
    syncRunId: "501",
    oldestSyncedAt: "2026-09-01T01:00:00.000Z",
    newestSyncedAt: "2026-09-01T01:00:00.000Z",
  }]);
});

test("normalized eligibility accepts a reconciled empty generation using terminal run freshness", async () => {
  const db = {
    async query() {
      return {
        rows: [goodGenerationRow({
          expected_membership_count: 0,
          actual_membership_count: 0,
          generation_row_count: 0,
          min_stock_synced_at: null,
          max_stock_synced_at: null,
          finished_at: "2026-09-01T01:00:00.000Z",
        })],
      };
    },
  };
  const result = await loadNormalizedGenerationEvidence(db, {
    activeBranchCodes: ["001"],
    maxAgeHours: 24,
    now: new Date("2026-09-01T02:00:00.000Z"),
  });
  assert.equal(result.available, true);
  assert.deepEqual(result.inputGenerations, [{
    branchCode: "001",
    syncRunId: "501",
    oldestSyncedAt: null,
    newestSyncedAt: null,
  }]);
});

for (const scenario of [
  {
    name: "missing reconciliation",
    overrides: { reconciliation_status: "pending" },
    reason: "RECONCILIATION_NOT_PASS",
  },
  {
    name: "retirement not done",
    overrides: { retirement_status: "processing" },
    reason: "RETIREMENT_NOT_DONE",
  },
  {
    name: "generation count drift",
    overrides: { generation_row_count: 1 },
    reason: "GENERATION_MEMBERSHIP_MISMATCH",
  },
  {
    name: "reconciliation generation mismatch",
    overrides: {
      mismatch_summary: {
        generationMembership: { matches: false },
        normalizedVsWide: { matches: true },
        normalizedVsWideRows: { mismatchCount: 0 },
      },
    },
    reason: "RECONCILIATION_EVIDENCE_MISMATCH",
  },
  {
    name: "oldest row stale even when newest row is fresh",
    overrides: {
      min_stock_synced_at: "2026-08-20T00:00:00.000Z",
      max_stock_synced_at: "2026-09-01T01:00:00.000Z",
    },
    reason: "STALE_BRANCH_GENERATION",
  },
]) {
  test(`normalized eligibility fails closed for ${scenario.name}`, async () => {
    const db = { async query() { return { rows: [goodGenerationRow(scenario.overrides)] }; } };
    const result = await loadNormalizedGenerationEvidence(db, {
      activeBranchCodes: ["001"],
      maxAgeHours: 24,
      now: new Date("2026-09-01T02:00:00.000Z"),
    });
    assert.equal(result.available, false);
    assert.ok(result.failures.some((failure) => failure.reason === scenario.reason));
  });
}

test("normalized eligibility refuses to query when the freshness policy is not configured", async () => {
  let queried = false;
  const db = { async query() { queried = true; return { rows: [] }; } };
  const result = await loadNormalizedGenerationEvidence(db, {
    activeBranchCodes: ["001"],
    maxAgeHours: null,
  });
  assert.equal(queried, false);
  assert.equal(result.failures[0].reason, "FRESHNESS_POLICY_NOT_CONFIGURED");
});

test("normalized loader preserves absent vs present-zero, null vs zero cost, negative quantity, and expanded branches", async () => {
  const queries = [];
  const db = {
    async query(sql, params) {
      const normalizedSql = compactSql(sql);
      queries.push({ sql: normalizedSql, params });
      if (normalizedSql.includes("left join ada.branch_stock_snapshots bs")) {
        assert.deepEqual(params, [["ABSENT", "P1"], ""]);
        return {
          rows: [
            { product_code: "ABSENT", product_name_thai: "ไม่มี", product_name_eng: "Absent", barcode: null, unit: "EA" },
            { product_code: "P1", product_name_thai: "หนึ่งจาก wide", product_name_eng: "One from wide", barcode: "WIDE111", unit: "BOX" },
          ],
        };
      }
      assert.match(normalizedSql, /cross join eligible/);
      assert.match(normalizedSql, /left join ada\.branch_stock_current current/);
      assert.equal(normalizedSql.includes("branch_stock_snapshots"), false);
      assert.equal(normalizedSql.includes("qty_branch_"), false);
      assert.deepEqual(params, [["ABSENT", "P1"], ["001", "006"], ["501", "506"]]);
      return {
        rows: [
          { product_code: "ABSENT", branch_code: "001", stock_product_code: null, qty: null, cost_avg: null, synced_at: null, last_full_sync_run_id: null },
          { product_code: "ABSENT", branch_code: "006", stock_product_code: null, qty: null, cost_avg: null, synced_at: null, last_full_sync_run_id: null },
          { product_code: "P1", branch_code: "001", stock_product_code: "P1", qty: "0", cost_avg: null, synced_at: "2026-09-01T01:00:00Z", last_full_sync_run_id: "501" },
          { product_code: "P1", branch_code: "006", stock_product_code: "P1", qty: "-3", cost_avg: "0", synced_at: "2026-09-01T01:01:00Z", last_full_sync_run_id: "506" },
        ],
      };
    },
  };
  const result = await loadNormalizedCurrentStockByProduct(db, {
    productCodes: ["P1", "ABSENT", "P1"],
    activeBranchCodes: ["006", "001"],
    generationByBranch: new Map([["001", "501"], ["006", "506"]]),
  });
  const absent = result.stockRows.find((row) => row.productCode === "ABSENT");
  const p1 = result.stockRows.find((row) => row.productCode === "P1");
  assert.equal(absent.branches["001"].sourcePresent, false);
  assert.equal(absent.branches["001"].qty, 0);
  assert.equal(p1.branches["001"].sourcePresent, true);
  assert.equal(p1.branches["001"].qty, 0);
  assert.equal(p1.branches["001"].unitCostAvg, null);
  assert.equal(p1.branches["006"].qty, -3);
  assert.equal(p1.branches["006"].unitCostAvg, 0);
  assert.deepEqual(
    [p1.productNameThai, p1.productNameEng, p1.barcode, p1.unit],
    ["หนึ่งจาก wide", "One from wide", "WIDE111", "BOX"],
  );
  assert.equal(queries.length, 2);
});

test("legacy-compatible metadata loader keeps visible wide metadata and uses sparse master data only as fallback", async () => {
  const db = {
    async query(sql, params) {
      const normalizedSql = compactSql(sql);
      assert.match(normalizedSql, /left join ada\.branch_stock_snapshots bs/);
      assert.match(normalizedSql, /left join ada\.products p/);
      assert.equal(normalizedSql.includes("qty_branch_"), false);
      assert.equal(normalizedSql.includes("branch_stock_current"), false);
      assert.deepEqual(params, [["P1"], "สินค้า"]);
      return {
        rows: [{
          product_code: "P1",
          product_name_thai: "สินค้าจาก wide",
          product_name_eng: "Wide product",
          barcode: "WIDE111",
          unit: "กล่อง",
        }],
      };
    },
  };
  const metadata = await loadLegacyCompatibleProductMetadataByProduct(db, {
    productCodes: ["P1"],
    search: "สินค้า",
  });
  assert.deepEqual(metadata.get("P1"), {
    productCode: "P1",
    productNameThai: "สินค้าจาก wide",
    productNameEng: "Wide product",
    barcode: "WIDE111",
    unit: "กล่อง",
  });
});

test("shadow comparator covers input membership/metadata/freshness/generation and output actions/quantities/donors/summary with bounded identifiers", () => {
  const baseStock = {
    productCode: "P1", productNameThai: "Old", productNameEng: "Old EN",
    barcode: "OLD", unit: "BOX", syncedAt: "2026-09-01T01:00:00Z",
    branches: {
      "001": { qty: 1, unitCostAvg: null, sourcePresent: true, generationId: "1", syncedAt: "2026-09-01T01:00:00Z" },
    },
  };
  const legacy = {
    stockRows: [baseStock],
    rows: [{ productCode: "P1", branchCode: "001", action: "PURCHASE", currentStock: 1, targetQty: 5, shortageQty: 4, transferPlanQty: 0, purchaseQty: 4, priorityScore: 20, donors: [], flags: ["MISSING_COST"] }],
    summary: { skuCount: 1 },
    inputGenerations: [{ branchCode: "001", syncRunId: "1" }],
  };
  const normalized = structuredClone(legacy);
  Object.assign(normalized.stockRows[0], {
    productNameThai: "New", barcode: "NEW", syncedAt: "2026-09-01T01:05:00Z",
  });
  Object.assign(normalized.stockRows[0].branches["001"], {
    qty: 0, unitCostAvg: 0, sourcePresent: false, generationId: "2",
  });
  Object.assign(normalized.rows[0], {
    action: "TRANSFER_IN", currentStock: 0, targetQty: 6, shortageQty: 6,
    transferPlanQty: 4, purchaseQty: 2, priorityScore: 30,
    donors: [{ branchCode: "006", qty: 4 }], flags: ["CHANGED"],
  });
  normalized.summary = { skuCount: 2 };
  normalized.inputGenerations = [{ branchCode: "001", syncRunId: "2" }];

  const comparison = compareStockReaderResults(legacy, normalized, {
    maxExamples: 3,
    activeBranchCodes: ["001", "006"],
  });
  assert.equal(comparison.matches, false);
  assert.equal(comparison.counts.inputBranchMembership, 1);
  assert.equal(comparison.counts.inputQuantity, 1);
  assert.equal(comparison.counts.inputCost, 1);
  assert.equal(comparison.counts.outputAction, 1);
  assert.equal(comparison.counts.outputCurrentStock, 1);
  assert.equal(comparison.counts.outputTargetQuantity, 1);
  assert.equal(comparison.counts.outputShortageQuantity, 1);
  assert.equal(comparison.counts.outputTransferQuantity, 1);
  assert.equal(comparison.counts.outputPurchaseQuantity, 1);
  assert.equal(comparison.counts.outputDonorPlan, 1);
  assert.equal(comparison.counts.outputPriority, 1);
  assert.equal(comparison.counts.outputFlags, 1);
  assert.equal(comparison.counts.outputSummary, 1);
  assert.equal(comparison.examples.length, 3);
  assert.equal(JSON.stringify(comparison).includes("NEW"), false);
  assert.match(comparison.legacyDigest, /^[0-9a-f]{64}$/);
});

test("shadow comparator ignores inactive legacy placeholders and aggregate freshness advanced by 002", () => {
  const activeBranch = {
    qty: 4,
    unitCostAvg: 10,
    sourcePresent: true,
    generationId: "501",
    syncedAt: "2026-09-02T01:00:00Z",
  };
  const visibleMetadata = {
    productCode: "P1",
    productNameThai: "หนึ่ง",
    productNameEng: "One",
    barcode: "111",
    unit: "EA",
    syncedAt: "2026-09-02T01:00:00Z",
  };
  const legacy = {
    stockRows: [{
      ...visibleMetadata,
      syncedAt: "2026-09-03T01:00:00Z",
      branches: {
        "001": activeBranch,
        "002": { qty: 0, unitCostAvg: 0, sourcePresent: true, generationId: "old-002", syncedAt: "2026-09-03T01:00:00Z" },
        "999": { qty: 8, unitCostAvg: 99, sourcePresent: true, generationId: "old-999", syncedAt: "2020-01-01T00:00:00Z" },
      },
    }],
    rows: [{ productCode: "P1", branchCode: "001", action: "HOLD", donors: [], flags: [] }],
    summary: { skuCount: 1 },
    inputGenerations: [
      { branchCode: "001", syncRunId: "501" },
      { branchCode: "002", syncRunId: "old-002" },
      { branchCode: "999", syncRunId: "old-999" },
    ],
  };
  const normalized = {
    stockRows: [{ ...visibleMetadata, branches: { "001": { ...activeBranch } } }],
    rows: structuredClone(legacy.rows),
    summary: structuredClone(legacy.summary),
    inputGenerations: [{ branchCode: "001", syncRunId: "501" }],
  };
  const comparison = compareStockReaderResults(legacy, normalized, {
    activeBranchCodes: ["001"],
  });
  assert.equal(comparison.matches, true);
  assert.equal(comparison.counts.inputFreshness, 0);
  assert.equal(Object.values(comparison.counts).every((count) => count === 0), true);
  assert.equal(comparison.legacyDigest, comparison.normalizedDigest);
});

test("shadow comparator still reports freshness drift on an active branch", () => {
  const legacy = {
    stockRows: [{
      productCode: "P1", productNameThai: "หนึ่ง", productNameEng: "One",
      barcode: "111", unit: "EA", syncedAt: "2026-09-02T02:00:00Z",
      branches: {
        "001": {
          qty: 4, unitCostAvg: 10, sourcePresent: true, generationId: "501",
          syncedAt: "2026-09-02T01:00:00Z",
        },
      },
    }],
    rows: [{ productCode: "P1", branchCode: "001", action: "HOLD", donors: [], flags: [] }],
    summary: { skuCount: 1 },
    inputGenerations: [{ branchCode: "001", syncRunId: "501" }],
  };
  const normalized = structuredClone(legacy);
  normalized.stockRows[0].branches["001"].syncedAt = "2026-09-02T02:00:00Z";
  const comparison = compareStockReaderResults(legacy, normalized, {
    activeBranchCodes: ["001"],
  });
  assert.equal(comparison.matches, false);
  assert.equal(comparison.counts.inputFreshness, 1);
  assert.notEqual(comparison.legacyDigest, comparison.normalizedDigest);
  assert.ok(comparison.examples.some((example) => (
    example.kind === "inputFreshness" && example.branchCode === "001"
  )));
});

test("shadow comparator still reports an actually active branch missing from normalized stock", () => {
  const legacy = {
    stockRows: [{
      productCode: "P1", productNameThai: "หนึ่ง", productNameEng: "One",
      barcode: "111", unit: "EA", syncedAt: "2026-09-02T01:00:00Z",
      branches: {
        "001": { qty: 1, unitCostAvg: 10, sourcePresent: true, generationId: "501", syncedAt: "2026-09-02T01:00:00Z" },
        "003": { qty: 2, unitCostAvg: 10, sourcePresent: true, generationId: "503", syncedAt: "2026-09-02T01:00:00Z" },
      },
    }],
    rows: [],
    summary: {},
    inputGenerations: [{ branchCode: "001", syncRunId: "501" }, { branchCode: "003", syncRunId: "503" }],
  };
  const normalized = structuredClone(legacy);
  delete normalized.stockRows[0].branches["003"];
  normalized.inputGenerations = [{ branchCode: "001", syncRunId: "501" }];
  const comparison = compareStockReaderResults(legacy, normalized, {
    activeBranchCodes: ["001", "003"],
  });
  assert.equal(comparison.matches, false);
  assert.equal(comparison.counts.inputBranchMembership, 1);
  assert.ok(comparison.counts.inputGeneration >= 1);
  assert.ok(comparison.examples.some((example) => example.branchCode === "003"));
});

test("shadow sampling requires an explicit rate and is deterministic for an evidence token", () => {
  assert.deepEqual(shouldRunShadowComparison({ shadowSampleRate: null }, "x"), {
    run: false,
    status: "configuration_required",
  });
  assert.deepEqual(shouldRunShadowComparison({ shadowSampleRate: 0 }, "x"), {
    run: false,
    status: "sampled_out",
  });
  assert.deepEqual(shouldRunShadowComparison({ shadowSampleRate: 1 }, "x"), {
    run: true,
    status: "selected",
  });
  assert.deepEqual(
    shouldRunShadowComparison({ shadowSampleRate: 0.5 }, "stable-token"),
    shouldRunShadowComparison({ shadowSampleRate: 0.5 }, "stable-token"),
  );
});

test("repeatable-read helper opens read-only isolation, captures snapshot ID, commits, and releases once", async () => {
  const commands = [];
  let released = 0;
  const client = {
    async query(sql) {
      commands.push(compactSql(sql));
      if (compactSql(sql).startsWith("select txid_current_snapshot")) {
        return { rows: [{ source_snapshot: "10:10:" }] };
      }
      return { rows: [] };
    },
    release() { released += 1; },
  };
  const result = await withRepeatableReadSnapshot(
    { async connect() { return client; } },
    async (snapshotClient, snapshotId) => {
      assert.equal(snapshotClient, client);
      assert.equal(snapshotId, "10:10:");
      return "ok";
    },
  );
  assert.deepEqual(result, { value: "ok", sourceSnapshot: "10:10:" });
  assert.deepEqual(commands, [
    "begin isolation level repeatable read read only",
    "select txid_current_snapshot()::text as source_snapshot",
    "commit",
  ]);
  assert.equal(released, 1);
});
