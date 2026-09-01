"use strict";

const crypto = require("node:crypto");

const LEGACY_BRANCH_COLUMNS = Object.freeze({
  "000": {
    qty: "qty_branch_000",
    cost: "cost_avg_branch_000",
    generation: "full_sync_run_id_branch_000",
    freshness: "synced_at_branch_000",
  },
  "001": {
    qty: "qty_branch_001",
    cost: "cost_avg_branch_001",
    generation: "full_sync_run_id_branch_001",
    freshness: "synced_at_branch_001",
  },
  "002": {
    qty: "qty_branch_002",
    cost: "cost_avg_branch_002",
    generation: "full_sync_run_id_branch_002",
    freshness: "synced_at_branch_002",
  },
  "003": {
    qty: "qty_branch_003",
    cost: "cost_avg_branch_003",
    generation: "full_sync_run_id_branch_003",
    freshness: "synced_at_branch_003",
  },
  "004": {
    qty: "qty_branch_004",
    cost: "cost_avg_branch_004",
    generation: "full_sync_run_id_branch_004",
    freshness: "synced_at_branch_004",
  },
  "005": {
    qty: "qty_branch_005",
    cost: "cost_avg_branch_005",
    generation: "full_sync_run_id_branch_005",
    freshness: "synced_at_branch_005",
  },
});

const READER_MODES = new Set(["legacy", "shadow", "normalized"]);
const MAX_EVIDENCE_FAILURES = 20;
const MAX_MISMATCH_EXAMPLES = 12;

function resolveRecommendationReaderPolicy(config = {}) {
  const requestedMode = String(config.stockRecommendationReaderMode || "legacy").trim().toLowerCase();
  const maxAge = Number(config.stockRecommendationMaxStockAgeHours);
  const sampleRate = config.stockRecommendationShadowSampleRate == null
    ? null
    : Number(config.stockRecommendationShadowSampleRate);
  const retentionDays = Number(config.stockRecommendationShadowRetentionDays);
  const canaryConfig = config.stockRecommendationNormalizedCanaryBranches;
  const normalizedCanaryBranches = canaryConfig == null
    ? null
    : [...new Set(
      (Array.isArray(canaryConfig) ? canaryConfig : String(canaryConfig).split(","))
        .map((value) => String(value).trim().toLowerCase())
        .filter((value) => value === "all" || /^\d{3}$/.test(value)),
    )].sort();
  return {
    mode: READER_MODES.has(requestedMode) ? requestedMode : "legacy",
    maxAgeHours: Number.isFinite(maxAge) && maxAge > 0 ? maxAge : null,
    // No sampling plan is guessed. Activating shadow without an explicit
    // 0..1 rate keeps serving legacy and reports configuration_required.
    shadowSampleRate: Number.isFinite(sampleRate) && sampleRate >= 0 && sampleRate <= 1
      ? sampleRate
      : null,
    shadowRetentionDays: Number.isFinite(retentionDays) && retentionDays > 0
      ? Math.floor(retentionDays)
      : 30,
    normalizedCanaryBranches,
  };
}

function sanitizeAvailability(evidence = {}) {
  const failures = Array.isArray(evidence.failures) ? evidence.failures : [];
  return {
    status: String(evidence.status || "unavailable"),
    failures: failures.slice(0, MAX_EVIDENCE_FAILURES).map((failure) => ({
      branchCode: failure?.branchCode == null ? null : String(failure.branchCode),
      reason: String(failure?.reason || "UNKNOWN"),
      status: String(failure?.status || "unavailable"),
    })),
    failuresTruncated: failures.length > MAX_EVIDENCE_FAILURES,
  };
}

function createInputUnavailableError(evidence) {
  return Object.assign(
    new Error("Recommendation input is unavailable until every recommendation branch has fresh, reconciled evidence."),
    {
      statusCode: 503,
      code: "STOCK_RECOMMENDATION_INPUT_UNAVAILABLE",
      availability: sanitizeAvailability(evidence),
    },
  );
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Keep the legacy reader's existing null coercion exactly: Number(null) is 0.
// The normalized reader intentionally keeps SQL NULL distinct from numeric 0,
// and the shadow comparator reports that semantic drift.
function legacyNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function idOrNull(value) {
  return value == null || value === "" ? null : String(value);
}

function timestampOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function booleanTrue(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function readJsonObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

async function loadNormalizedActiveBranches(db, { legacyBranchCodes = [] } = {}) {
  const result = await db.query(
    `
      SELECT branch.branch_code, branch.branch_name, branch.is_hq
      FROM core.branches branch
      WHERE branch.is_active = TRUE
        AND (
          branch.branch_code = ANY($1::text[])
          OR EXISTS (
            SELECT 1
            FROM ingest.sync_runs run
            WHERE run.branch_code = branch.branch_code
              AND run.snapshot_mode = 'full'
          )
        )
      ORDER BY branch.branch_code ASC
    `,
    [legacyBranchCodes],
  );
  return result.rows.map((row) => ({
    branchCode: String(row.branch_code),
    branchName: row.branch_name || `สาขา ${row.branch_code}`,
    isHq: Boolean(row.is_hq),
  }));
}

function legacyTraceColumnsSql() {
  return Object.values(LEGACY_BRANCH_COLUMNS)
    .flatMap((columns) => [`bs.${columns.generation}`, `bs.${columns.freshness}`])
    .join(",\n        ");
}

async function loadLegacyCurrentStockByProduct(db, { productCodes, includeTrace = false }) {
  if (!Array.isArray(productCodes) || productCodes.length === 0) {
    return { stockRows: [], evidence: { productGenerations: new Map() } };
  }

  const traceColumns = includeTrace ? `,\n        ${legacyTraceColumnsSql()}` : "";
  const result = await db.query(
    `
      SELECT
        bs.product_code,
        COALESCE(NULLIF(bs.product_name_thai, ''), NULLIF(p.product_name_th, ''), NULLIF(bs.product_name_eng, ''), NULLIF(p.product_name, ''), bs.product_code) AS product_name_thai,
        COALESCE(NULLIF(bs.product_name_eng, ''), NULLIF(p.product_name, ''), NULLIF(bs.product_name_thai, ''), NULLIF(p.product_name_th, ''), bs.product_code) AS product_name_eng,
        COALESCE(bs.barcode, pb.barcode, '') AS barcode,
        COALESCE(bs.unit, p.unit_small, p.unit_medium, p.unit_large, '') AS unit,
        bs.qty_branch_000,
        bs.qty_branch_001,
        bs.qty_branch_002,
        bs.qty_branch_003,
        bs.qty_branch_004,
        bs.qty_branch_005,
        bs.cost_avg_branch_000,
        bs.cost_avg_branch_001,
        bs.cost_avg_branch_002,
        bs.cost_avg_branch_003,
        bs.cost_avg_branch_004,
        bs.cost_avg_branch_005,
        bs.synced_at${traceColumns}
      FROM ada.branch_stock_snapshots bs
      LEFT JOIN ada.products p
        ON p.product_code = bs.product_code
      LEFT JOIN LATERAL (
        SELECT barcode
        FROM ada.product_barcodes pb
        WHERE pb.product_code = bs.product_code
        ORDER BY
          CASE pb.barcode_role
            WHEN 'primary' THEN 0
            ELSE 1
          END,
          pb.updated_at DESC,
          pb.barcode ASC
        LIMIT 1
      ) pb ON TRUE
      WHERE bs.product_code = ANY($1::text[])
      ORDER BY bs.product_code ASC
    `,
    [productCodes],
  );

  const productGenerations = new Map();
  const stockRows = result.rows.map((row) => {
    const branches = {};
    for (const [branchCode, columns] of Object.entries(LEGACY_BRANCH_COLUMNS)) {
      const generationId = includeTrace ? idOrNull(row[columns.generation]) : null;
      const branchSyncedAt = includeTrace
        ? timestampOrNull(row[columns.freshness] || row.synced_at)
        : null;
      branches[branchCode] = {
        qty: numberOrZero(row[columns.qty]),
        unitCostAvg: legacyNumberOrNull(row[columns.cost]),
        sourcePresent: true,
        generationId,
        syncedAt: branchSyncedAt,
      };
      if (generationId) productGenerations.set(`${row.product_code}|${branchCode}`, generationId);
    }
    return {
      productCode: String(row.product_code),
      productNameThai: row.product_name_thai || row.product_code,
      productNameEng: row.product_name_eng || row.product_code,
      barcode: row.barcode || null,
      unit: row.unit || null,
      // Preserve the pg driver value used by the existing engine/response.
      syncedAt: row.synced_at || null,
      branches,
    };
  });

  return { stockRows, evidence: { productGenerations } };
}

function generationFailure(branchCode, reason, status = "unavailable") {
  return { branchCode, reason, status };
}

async function loadNormalizedGenerationEvidence(db, options = {}) {
  const activeBranchCodes = [...new Set((options.activeBranchCodes || []).map(String))].sort();
  const maxAgeHours = Number(options.maxAgeHours);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    return {
      available: false,
      status: "unavailable",
      failures: activeBranchCodes.map((branchCode) => (
        generationFailure(branchCode, "FRESHNESS_POLICY_NOT_CONFIGURED")
      )),
      generationByBranch: new Map(),
      inputGenerations: [],
    };
  }
  if (activeBranchCodes.length === 0) {
    return {
      available: false,
      status: "unavailable",
      failures: [generationFailure(null, "NO_RECOMMENDATION_BRANCHES")],
      generationByBranch: new Map(),
      inputGenerations: [],
    };
  }

  const result = await db.query(
    `
      WITH required(branch_code) AS (SELECT unnest($1::text[])),
      latest AS (
        SELECT required.branch_code, run.*
        FROM required
        LEFT JOIN LATERAL (
          SELECT candidate.sync_run_id, candidate.status, candidate.ingestion_mode,
                 candidate.snapshot_mode, candidate.handoff_status,
                 candidate.apply_status, candidate.finalized_at, candidate.finished_at
          FROM ingest.sync_runs candidate
          WHERE candidate.branch_code = required.branch_code
            AND candidate.snapshot_mode = 'full'
          ORDER BY candidate.sync_run_id DESC
          LIMIT 1
        ) run ON TRUE
      )
      SELECT
        latest.branch_code,
        latest.sync_run_id,
        latest.status AS run_status,
        latest.ingestion_mode,
        latest.snapshot_mode,
        latest.handoff_status,
        latest.apply_status,
        latest.finalized_at,
        latest.finished_at,
        retirement.status AS retirement_status,
        retirement.expected_membership_count,
        retirement.actual_membership_count,
        reconciliation.status AS reconciliation_status,
        reconciliation.mismatch_summary,
        stock.generation_row_count,
        stock.min_stock_synced_at,
        stock.max_stock_synced_at
      FROM latest
      LEFT JOIN ingest.branch_stock_retirements retirement
        ON retirement.sync_run_id = latest.sync_run_id
      LEFT JOIN ingest.branch_stock_reconciliations reconciliation
        ON reconciliation.sync_run_id = latest.sync_run_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (
            WHERE current.last_full_sync_run_id = latest.sync_run_id
          )::int AS generation_row_count,
          MIN(current.synced_at) FILTER (
            WHERE current.last_full_sync_run_id = latest.sync_run_id
          ) AS min_stock_synced_at,
          MAX(current.synced_at) FILTER (
            WHERE current.last_full_sync_run_id = latest.sync_run_id
          ) AS max_stock_synced_at
        FROM ada.branch_stock_current current
        WHERE current.branch_code = latest.branch_code
      ) stock ON TRUE
      ORDER BY latest.branch_code
    `,
    [activeBranchCodes],
  );

  const rowByBranch = new Map(result.rows.map((row) => [String(row.branch_code), row]));
  const failures = [];
  const generationByBranch = new Map();
  const inputGenerations = [];
  const staleBefore = now.getTime() - (maxAgeHours * 60 * 60 * 1000);

  for (const branchCode of activeBranchCodes) {
    const row = rowByBranch.get(branchCode);
    if (!row || row.sync_run_id == null) {
      failures.push(generationFailure(branchCode, "MISSING_BRANCH_GENERATION", "missing"));
      continue;
    }

    if (row.run_status !== "success") {
      failures.push(generationFailure(branchCode, "SYNC_RUN_NOT_SUCCESS", row.run_status || "failed"));
    }
    if (row.snapshot_mode !== "full") {
      failures.push(generationFailure(branchCode, "GENERATION_NOT_FULL"));
    }
    if (
      row.ingestion_mode === "hybrid_v2"
      && (!row.finalized_at || row.handoff_status !== "success" || row.apply_status !== "applied")
    ) {
      failures.push(generationFailure(branchCode, "GENERATION_NOT_FINALIZED", "pending"));
    }
    if (row.retirement_status !== "done") {
      failures.push(generationFailure(
        branchCode,
        "RETIREMENT_NOT_DONE",
        row.retirement_status || "pending",
      ));
    }
    if (row.reconciliation_status !== "pass") {
      failures.push(generationFailure(
        branchCode,
        "RECONCILIATION_NOT_PASS",
        row.reconciliation_status || "pending",
      ));
    }

    const expectedCount = Number(row.expected_membership_count);
    const actualCount = Number(row.actual_membership_count);
    const generationCount = Number(row.generation_row_count);
    if (
      !Number.isInteger(expectedCount)
      || expectedCount < 0
      || expectedCount !== actualCount
      || expectedCount !== generationCount
    ) {
      failures.push(generationFailure(branchCode, "GENERATION_MEMBERSHIP_MISMATCH", "failed"));
    }

    const mismatch = readJsonObject(row.mismatch_summary);
    if (
      !booleanTrue(mismatch.generationMembership?.matches)
      || !booleanTrue(mismatch.normalizedVsWide?.matches)
      || Number(mismatch.normalizedVsWideRows?.mismatchCount) !== 0
    ) {
      failures.push(generationFailure(branchCode, "RECONCILIATION_EVIDENCE_MISMATCH", "failed"));
    }

    const oldestSyncedAt = timestampOrNull(row.min_stock_synced_at);
    const newestSyncedAt = timestampOrNull(row.max_stock_synced_at);
    const emptyGeneration = expectedCount === 0 && actualCount === 0 && generationCount === 0;
    const freshnessAt = emptyGeneration ? timestampOrNull(row.finished_at) : oldestSyncedAt;
    if (!freshnessAt || new Date(freshnessAt).getTime() < staleBefore) {
      failures.push(generationFailure(branchCode, "STALE_BRANCH_GENERATION", "stale"));
    }

    const syncRunId = String(row.sync_run_id);
    generationByBranch.set(branchCode, syncRunId);
    inputGenerations.push({
      branchCode,
      syncRunId,
      oldestSyncedAt,
      newestSyncedAt,
    });
  }

  const available = failures.length === 0;
  return {
    available,
    status: available
      ? "available"
      : (failures.some((failure) => failure.status === "failed") ? "failed" : "unavailable"),
    failures,
    generationByBranch,
    inputGenerations,
  };
}

async function loadNormalizedCandidateProductCodes(db, options = {}) {
  const activeBranchCodes = [...new Set((options.activeBranchCodes || []).map(String))].sort();
  const generationIds = activeBranchCodes.map((branchCode) => options.generationByBranch.get(branchCode));
  if (activeBranchCodes.length === 0 || generationIds.some((generation) => generation == null)) return [];
  const search = String(options.search || "").trim();
  const result = await db.query(
    `
      SELECT DISTINCT current.product_code
      FROM ada.branch_stock_current current
      JOIN unnest($1::text[], $2::bigint[]) AS eligible(branch_code, sync_run_id)
        ON eligible.branch_code = current.branch_code
      LEFT JOIN ada.products product
        ON product.product_code = current.product_code
      LEFT JOIN LATERAL (
        SELECT barcode
        FROM ada.product_barcodes candidate
        WHERE candidate.product_code = current.product_code
        ORDER BY CASE candidate.barcode_role WHEN 'primary' THEN 0 ELSE 1 END,
          candidate.updated_at DESC, candidate.barcode ASC
        LIMIT 1
      ) barcode ON TRUE
      WHERE (
          (current.last_full_sync_run_id = eligible.sync_run_id AND current.qty > 0)
          OR $3::text <> ''
        )
        AND (
          $3::text = ''
          OR current.product_code ILIKE '%' || $3 || '%'
          OR COALESCE(product.product_name_th, product.product_name, '') ILIKE '%' || $3 || '%'
          OR COALESCE(barcode.barcode, '') ILIKE '%' || $3 || '%'
        )
      ORDER BY current.product_code
    `,
    [activeBranchCodes, generationIds, search],
  );
  return result.rows.map((row) => String(row.product_code));
}

async function loadNormalizedCurrentStockByProduct(db, options = {}) {
  const productCodes = [...new Set((options.productCodes || []).map(String))].sort();
  const activeBranchCodes = [...new Set((options.activeBranchCodes || []).map(String))].sort();
  if (productCodes.length === 0 || activeBranchCodes.length === 0) {
    return { stockRows: [], evidence: { productGenerations: new Map() } };
  }
  const generationIds = activeBranchCodes.map((branchCode) => options.generationByBranch.get(branchCode));
  if (generationIds.some((generation) => generation == null)) {
    throw createInputUnavailableError({
      status: "unavailable",
      failures: activeBranchCodes
        .filter((_, index) => generationIds[index] == null)
        .map((branchCode) => generationFailure(branchCode, "MISSING_ELIGIBLE_GENERATION")),
    });
  }

  const result = await db.query(
    `
      WITH candidates(product_code) AS (SELECT unnest($1::text[])),
      eligible(branch_code, sync_run_id) AS (
        SELECT * FROM unnest($2::text[], $3::bigint[])
      )
      SELECT
        candidates.product_code,
        COALESCE(NULLIF(product.product_name_th, ''), NULLIF(product.product_name, ''), candidates.product_code) AS product_name_thai,
        COALESCE(NULLIF(product.product_name, ''), NULLIF(product.product_name_th, ''), candidates.product_code) AS product_name_eng,
        barcode.barcode,
        COALESCE(product.unit_small, product.unit_medium, product.unit_large, '') AS unit,
        eligible.branch_code,
        eligible.sync_run_id AS eligible_sync_run_id,
        current.product_code AS stock_product_code,
        current.qty,
        current.cost_avg,
        current.synced_at,
        current.last_full_sync_run_id
      FROM candidates
      CROSS JOIN eligible
      LEFT JOIN ada.products product
        ON product.product_code = candidates.product_code
      LEFT JOIN LATERAL (
        SELECT candidate.barcode
        FROM ada.product_barcodes candidate
        WHERE candidate.product_code = candidates.product_code
        ORDER BY CASE candidate.barcode_role WHEN 'primary' THEN 0 ELSE 1 END,
          candidate.updated_at DESC, candidate.barcode ASC
        LIMIT 1
      ) barcode ON TRUE
      LEFT JOIN ada.branch_stock_current current
        ON current.product_code = candidates.product_code
       AND current.branch_code = eligible.branch_code
       AND current.last_full_sync_run_id = eligible.sync_run_id
      ORDER BY candidates.product_code, eligible.branch_code
    `,
    [productCodes, activeBranchCodes, generationIds],
  );

  const byProduct = new Map();
  const productGenerations = new Map();
  for (const row of result.rows) {
    const productCode = String(row.product_code);
    let stockRow = byProduct.get(productCode);
    if (!stockRow) {
      stockRow = {
        productCode,
        productNameThai: row.product_name_thai || productCode,
        productNameEng: row.product_name_eng || productCode,
        barcode: row.barcode || null,
        unit: row.unit || null,
        syncedAt: null,
        branches: {},
      };
      byProduct.set(productCode, stockRow);
    }
    const branchCode = String(row.branch_code);
    const sourcePresent = row.stock_product_code != null;
    const generationId = sourcePresent ? idOrNull(row.last_full_sync_run_id) : null;
    const syncedAt = sourcePresent ? timestampOrNull(row.synced_at) : null;
    stockRow.branches[branchCode] = {
      qty: sourcePresent ? numberOrZero(row.qty) : 0,
      unitCostAvg: sourcePresent ? nullableNumber(row.cost_avg) : null,
      sourcePresent,
      generationId,
      syncedAt,
    };
    if (syncedAt && (!stockRow.syncedAt || new Date(syncedAt) > new Date(stockRow.syncedAt))) {
      stockRow.syncedAt = syncedAt;
    }
    if (generationId) productGenerations.set(`${productCode}|${branchCode}`, generationId);
  }

  return { stockRows: [...byProduct.values()], evidence: { productGenerations } };
}

function stableValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function digest(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function rowKey(row) {
  return `${row.productCode}|${row.branchCode}`;
}

function normalizedDonors(donors) {
  return (donors || []).map((donor) => ({
    branchCode: donor.branchCode,
    qty: numberOrZero(donor.qty ?? donor.transferQty ?? donor.availableQty),
  }));
}

function compareStockReaderResults(legacy, normalized, options = {}) {
  const maxExamples = Number.isInteger(options.maxExamples) && options.maxExamples >= 0
    ? Math.min(options.maxExamples, MAX_MISMATCH_EXAMPLES)
    : MAX_MISMATCH_EXAMPLES;
  const counts = {
    inputProductMembership: 0,
    inputBranchMembership: 0,
    inputQuantity: 0,
    inputCost: 0,
    inputProductNameThai: 0,
    inputProductNameEng: 0,
    inputBarcode: 0,
    inputUnit: 0,
    inputFreshness: 0,
    inputGeneration: 0,
    outputRowMembership: 0,
    outputAction: 0,
    outputCurrentStock: 0,
    outputTargetQuantity: 0,
    outputShortageQuantity: 0,
    outputTransferQuantity: 0,
    outputPurchaseQuantity: 0,
    outputDonorPlan: 0,
    outputPriority: 0,
    outputFlags: 0,
    outputSummary: 0,
  };
  const examples = [];
  const addExample = (kind, productCode = null, branchCode = null) => {
    if (examples.length < maxExamples) examples.push({ kind, productCode, branchCode });
  };

  const oldStock = new Map((legacy.stockRows || []).map((row) => [row.productCode, row]));
  const newStock = new Map((normalized.stockRows || []).map((row) => [row.productCode, row]));
  for (const productCode of new Set([...oldStock.keys(), ...newStock.keys()])) {
    const oldProduct = oldStock.get(productCode);
    const newProduct = newStock.get(productCode);
    if (!oldProduct || !newProduct) {
      counts.inputProductMembership += 1;
      addExample("inputProductMembership", productCode);
      continue;
    }
    for (const field of ["productNameThai", "productNameEng", "barcode", "unit"]) {
      const countKey = `input${field[0].toUpperCase()}${field.slice(1)}`;
      if ((oldProduct[field] || null) !== (newProduct[field] || null)) {
        counts[countKey] += 1;
        addExample(countKey, productCode);
      }
    }
    if (timestampOrNull(oldProduct.syncedAt) !== timestampOrNull(newProduct.syncedAt)) {
      counts.inputFreshness += 1;
      addExample("inputFreshness", productCode);
    }

    const oldBranches = oldProduct.branches || {};
    const newBranches = newProduct.branches || {};
    for (const branchCode of new Set([...Object.keys(oldBranches), ...Object.keys(newBranches)])) {
      const oldBranch = oldBranches[branchCode] || {};
      const newBranch = newBranches[branchCode] || {};
      if (Boolean(oldBranch.sourcePresent) !== Boolean(newBranch.sourcePresent)) {
        counts.inputBranchMembership += 1;
        addExample("inputBranchMembership", productCode, branchCode);
      }
      if (numberOrZero(oldBranch.qty) !== numberOrZero(newBranch.qty)) {
        counts.inputQuantity += 1;
        addExample("inputQuantity", productCode, branchCode);
      }
      if (nullableNumber(oldBranch.unitCostAvg) !== nullableNumber(newBranch.unitCostAvg)) {
        counts.inputCost += 1;
        addExample("inputCost", productCode, branchCode);
      }
      if (timestampOrNull(oldBranch.syncedAt) !== timestampOrNull(newBranch.syncedAt)) {
        counts.inputFreshness += 1;
        addExample("inputFreshness", productCode, branchCode);
      }
      if (idOrNull(oldBranch.generationId) !== idOrNull(newBranch.generationId)) {
        counts.inputGeneration += 1;
        addExample("inputGeneration", productCode, branchCode);
      }
    }
  }

  const oldRows = new Map((legacy.rows || []).map((row) => [rowKey(row), row]));
  const newRows = new Map((normalized.rows || []).map((row) => [rowKey(row), row]));
  for (const key of new Set([...oldRows.keys(), ...newRows.keys()])) {
    const oldRow = oldRows.get(key);
    const newRow = newRows.get(key);
    const separator = key.lastIndexOf("|");
    const productCode = key.slice(0, separator);
    const branchCode = key.slice(separator + 1);
    if (!oldRow || !newRow) {
      counts.outputRowMembership += 1;
      addExample("outputRowMembership", productCode, branchCode);
      continue;
    }
    for (const [field, countKey] of [
      ["action", "outputAction"],
      ["currentStock", "outputCurrentStock"],
      ["targetQty", "outputTargetQuantity"],
      ["shortageQty", "outputShortageQuantity"],
      ["transferPlanQty", "outputTransferQuantity"],
      ["purchaseQty", "outputPurchaseQuantity"],
      ["priorityScore", "outputPriority"],
    ]) {
      const oldValue = field === "action" ? oldRow[field] : numberOrZero(oldRow[field]);
      const newValue = field === "action" ? newRow[field] : numberOrZero(newRow[field]);
      if (oldValue !== newValue) {
        counts[countKey] += 1;
        addExample(countKey, productCode, branchCode);
      }
    }
    if (stableJson(normalizedDonors(oldRow.donors)) !== stableJson(normalizedDonors(newRow.donors))) {
      counts.outputDonorPlan += 1;
      addExample("outputDonorPlan", productCode, branchCode);
    }
    if (stableJson(oldRow.flags || []) !== stableJson(newRow.flags || [])) {
      counts.outputFlags += 1;
      addExample("outputFlags", productCode, branchCode);
    }
  }

  if (stableJson(legacy.summary || {}) !== stableJson(normalized.summary || {})) {
    counts.outputSummary = 1;
    addExample("outputSummary");
  }

  const oldGenerations = new Map((legacy.inputGenerations || []).map((item) => [
    item.branchCode,
    String(item.syncRunId),
  ]));
  const newGenerations = new Map((normalized.inputGenerations || []).map((item) => [
    item.branchCode,
    String(item.syncRunId),
  ]));
  for (const branchCode of new Set([...oldGenerations.keys(), ...newGenerations.keys()])) {
    if (oldGenerations.get(branchCode) !== newGenerations.get(branchCode)) {
      counts.inputGeneration += 1;
      addExample("inputGeneration", null, branchCode);
    }
  }

  const comparable = (dataset) => ({
    stockRows: dataset.stockRows,
    rows: dataset.rows,
    summary: dataset.summary,
    inputGenerations: dataset.inputGenerations,
  });
  return {
    matches: Object.values(counts).every((count) => count === 0),
    counts,
    examples,
    examplesTruncated: Object.values(counts).reduce((sum, count) => sum + count, 0) > examples.length,
    legacyDigest: digest(comparable(legacy)),
    normalizedDigest: digest(comparable(normalized)),
  };
}

function shouldRunShadowComparison(readerPolicy, sampleToken) {
  const rate = readerPolicy.shadowSampleRate;
  if (rate == null) return { run: false, status: "configuration_required" };
  if (rate <= 0) return { run: false, status: "sampled_out" };
  if (rate >= 1) return { run: true, status: "selected" };
  const token = String(sampleToken || crypto.randomUUID());
  const sample = crypto.createHash("sha256").update(token).digest().readUInt32BE(0) / 0x1_0000_0000;
  return { run: sample < rate, status: sample < rate ? "selected" : "sampled_out" };
}

async function persistReaderComparison(db, record) {
  const comparisonId = record.comparisonId || crypto.randomUUID();
  await db.query(
    `
      INSERT INTO ordering.stock_recommendation_reader_comparisons (
        comparison_id, reader_mode, served_reader, comparison_status,
        branch_codes, legacy_digest, normalized_digest, mismatch_counts,
        mismatch_examples, input_counts, input_generations, availability,
        source_snapshot, duration_ms, started_at, completed_at, expires_at
      ) VALUES (
        $1::uuid, $2, $3, $4, $5::text[], $6, $7, $8::jsonb,
        $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
        $13, $14, $15, now(), $16
      )
    `,
    [
      comparisonId,
      record.readerMode || "shadow",
      record.servedReader || "legacy",
      record.status || "error",
      record.branchCodes || [],
      record.comparison?.legacyDigest || null,
      record.comparison?.normalizedDigest || null,
      JSON.stringify(record.comparison?.counts || {}),
      JSON.stringify((record.comparison?.examples || []).slice(0, MAX_MISMATCH_EXAMPLES)),
      JSON.stringify(record.inputCounts || {}),
      JSON.stringify(record.inputGenerations || []),
      JSON.stringify(sanitizeAvailability(record.availability || { status: "available" })),
      record.sourceSnapshot || null,
      Number.isFinite(Number(record.durationMs)) ? Math.max(0, Math.round(Number(record.durationMs))) : null,
      record.startedAt || new Date().toISOString(),
      record.expiresAt,
    ],
  );
  return comparisonId;
}

async function linkReaderComparisonToServedSnapshot(db, record) {
  if (!record?.comparisonId) return false;
  const result = await db.query(
    `
      UPDATE ordering.stock_recommendation_reader_comparisons
      SET served_source = 'precomputed',
          served_anchor_date = $2::date,
          served_target_days = $3,
          served_snapshot_generated_at = $4,
          served_row_count = $5,
          served_branch_codes = $6::text[]
      WHERE comparison_id = $1::uuid
    `,
    [
      record.comparisonId,
      record.anchorDate,
      record.targetDays,
      record.generatedAt,
      record.rowCount,
      record.branchCodes || [],
    ],
  );
  return Number(result.rowCount || 0) === 1;
}

async function pruneExpiredReaderComparisons(db, { limit = 100 } = {}) {
  const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 100;
  const result = await db.query(
    `
      DELETE FROM ordering.stock_recommendation_reader_comparisons
      WHERE comparison_id IN (
        SELECT comparison_id
        FROM ordering.stock_recommendation_reader_comparisons
        WHERE expires_at < now()
        ORDER BY expires_at ASC
        LIMIT $1
      )
    `,
    [boundedLimit],
  );
  return Number(result.rowCount || 0);
}

async function withRepeatableReadSnapshot(db, callback) {
  if (!db || typeof db.connect !== "function") {
    throw createInputUnavailableError({
      status: "unavailable",
      failures: [generationFailure(null, "CONSISTENT_SNAPSHOT_UNAVAILABLE")],
    });
  }
  const client = await db.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const sourceSnapshot = (await client.query(
      "SELECT txid_current_snapshot()::text AS source_snapshot",
    )).rows[0]?.source_snapshot || null;
    const value = await callback(client, sourceSnapshot);
    await client.query("COMMIT");
    transactionOpen = false;
    return { value, sourceSnapshot };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {
        // Preserve the original error.
      }
    }
    throw error;
  } finally {
    if (typeof client.release === "function") client.release();
  }
}

module.exports = {
  LEGACY_BRANCH_COLUMNS,
  MAX_MISMATCH_EXAMPLES,
  resolveRecommendationReaderPolicy,
  sanitizeAvailability,
  createInputUnavailableError,
  loadNormalizedActiveBranches,
  loadLegacyCurrentStockByProduct,
  loadNormalizedGenerationEvidence,
  loadNormalizedCandidateProductCodes,
  loadNormalizedCurrentStockByProduct,
  compareStockReaderResults,
  shouldRunShadowComparison,
  persistReaderComparison,
  linkReaderComparisonToServedSnapshot,
  pruneExpiredReaderComparisons,
  withRepeatableReadSnapshot,
};
