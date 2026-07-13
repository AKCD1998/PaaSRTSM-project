"use strict";

const BRANCH_SNAPSHOT_COLUMNS = {
  "000": { qty: "qty_branch_000", cost: "cost_avg_branch_000" },
  "001": { qty: "qty_branch_001", cost: "cost_avg_branch_001" },
  "002": { qty: "qty_branch_002", cost: "cost_avg_branch_002" },
  "003": { qty: "qty_branch_003", cost: "cost_avg_branch_003" },
  "004": { qty: "qty_branch_004", cost: "cost_avg_branch_004" },
  "005": { qty: "qty_branch_005", cost: "cost_avg_branch_005" },
};

const ALLOWED_SORTS = new Set([
  "priority_desc",
  "days_cover_asc",
  "inventory_value_desc",
  "product_code_asc",
]);

const ALLOWED_ACTIONS = new Set([
  "NO_ACTION",
  "TRANSFER_IN",
  "PURCHASE",
  "TRANSFER_AND_PURCHASE",
  "NO_PURCHASE_SLOW_MOVING",
]);

function createHttpError(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeUpperText(value) {
  return normalizeText(value).toUpperCase();
}

function parsePositiveInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseNonNegativeInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function parseBooleanFlag(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeDivide(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

const BANGKOK_TIMEZONE = "Asia/Bangkok";

function bangkokNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: BANGKOK_TIMEZONE }));
}

function toBangkokDateString(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // node-postgres parses a DATE column into a Date object set to midnight
    // in the RUNNING PROCESS's local timezone, not UTC. Reading it back out
    // with .toISOString() (UTC) therefore rolls the calendar date backward
    // by one day on any host running east of UTC (Bangkok included) — the
    // same class of bug toBangkokDateString() elsewhere in this codebase
    // exists to avoid. Use local getters to recover the date pg intended.
    return toBangkokDateString(value);
  }

  const normalized = normalizeText(value);
  if (isIsoDate(normalized)) {
    return normalized;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

async function loadActiveBranches(db) {
  const result = await db.query(
    `
      SELECT branch_code, branch_name, is_hq
      FROM core.branches
      WHERE is_active = TRUE
      ORDER BY branch_code ASC
    `,
  );
  return result.rows.map((row) => ({
    branchCode: String(row.branch_code),
    branchName: row.branch_name || `สาขา ${row.branch_code}`,
    isHq: Boolean(row.is_hq),
  }));
}

async function resolveEffectiveBranchScope(db, auth, requestedBranchCode) {
  const role = String(auth?.role || "");
  const effectiveBranchCode = normalizeText(auth?.effectiveBranchCode || "");
  const normalizedRequested = normalizeText(requestedBranchCode || "");
  const activeBranches = await loadActiveBranches(db);
  const activeBranchCodes = activeBranches
    .map((branch) => branch.branchCode)
    .filter((branchCode) => BRANCH_SNAPSHOT_COLUMNS[branchCode]);

  if (role !== "admin") {
    if (!effectiveBranchCode) {
      throw createHttpError("Branch identity required for non-admin recommendation access.", 403);
    }
    if (!activeBranchCodes.includes(effectiveBranchCode)) {
      throw createHttpError("Authenticated branch is not active for recommendations.", 403);
    }
    return {
      branchCode: effectiveBranchCode,
      branchCodes: [effectiveBranchCode],
      isAllBranches: false,
      activeBranches: activeBranches.filter((branch) => activeBranchCodes.includes(branch.branchCode)),
      activeBranchCodes,
    };
  }

  if (normalizedRequested === "all") {
    return {
      branchCode: "all",
      branchCodes: activeBranchCodes,
      isAllBranches: true,
      activeBranches: activeBranches.filter((branch) => activeBranchCodes.includes(branch.branchCode)),
      activeBranchCodes,
    };
  }

  const branchCode = normalizedRequested || activeBranchCodes[0] || "";
  if (!branchCode || !activeBranchCodes.includes(branchCode)) {
    throw createHttpError("branchCode must be an active branch code or 'all'.", 400);
  }

  return {
    branchCode,
    branchCodes: [branchCode],
    isAllBranches: false,
    activeBranches: activeBranches.filter((branch) => activeBranchCodes.includes(branch.branchCode)),
    activeBranchCodes,
  };
}

function normalizeRecommendationFilters(rawFilters = {}) {
  const targetDays = parsePositiveInt(rawFilters.targetDays, 90);
  const page = parsePositiveInt(rawFilters.page, 1);
  const pageSize = parsePositiveInt(rawFilters.pageSize, 50);
  const offset = parseNonNegativeInt(rawFilters.offset, page && pageSize ? (page - 1) * pageSize : 0);

  if (targetDays == null) {
    throw createHttpError("targetDays must be a positive integer.", 400);
  }
  if (page == null) {
    throw createHttpError("page must be a positive integer.", 400);
  }
  if (pageSize == null || pageSize > 100) {
    throw createHttpError("pageSize must be a positive integer no greater than 100.", 400);
  }
  if (offset == null) {
    throw createHttpError("offset must be a non-negative integer.", 400);
  }

  const action = normalizeUpperText(rawFilters.action || "");
  if (action && !ALLOWED_ACTIONS.has(action)) {
    throw createHttpError("action filter is invalid.", 400);
  }

  const sort = normalizeText(rawFilters.sort || "priority_desc");
  if (!ALLOWED_SORTS.has(sort)) {
    throw createHttpError("sort is invalid.", 400);
  }

  const dateFrom = normalizeText(rawFilters.dateFrom || rawFilters.date_from || "") || null;
  const dateTo = normalizeText(rawFilters.dateTo || rawFilters.date_to || "") || null;
  if (dateFrom && !isIsoDate(dateFrom)) {
    throw createHttpError("dateFrom/date_from must be YYYY-MM-DD.", 400);
  }
  if (dateTo && !isIsoDate(dateTo)) {
    throw createHttpError("dateTo/date_to must be YYYY-MM-DD.", 400);
  }

  return {
    branchCode: normalizeText(rawFilters.branchCode || ""),
    targetDays,
    page,
    pageSize,
    offset,
    search: normalizeText(rawFilters.search || ""),
    action: action || null,
    sort,
    detail: parseBooleanFlag(rawFilters.detail),
    dateFrom,
    dateTo,
  };
}

function buildRecommendationPolicy(filters, anchorDate) {
  return {
    targetDays: filters.targetDays,
    incomingAllocationMode: "equal_split",
    incomingSourceMode: "pending_and_approved_receipts",
    demandMode: "sales_90d_with_30d_trend_adjustment",
    anchorDate,
    salesWindow30dFrom: addDays(anchorDate, -29),
    salesWindow90dFrom: addDays(anchorDate, -89),
  };
}

// Pinned to "yesterday in Bangkok" instead of live MAX(period_end) from a
// table branch senders sync into every ~10 minutes. That live value moves
// (and was observed to move backward transiently, likely from a sync agent
// replacing rows rather than pure upsert) within the same few minutes,
// which made precomputed snapshots — generated with one fixed anchor_date —
// miss their cache key constantly and fall back to the slow live-compute
// path on nearly every request. A 90-day trailing-demand figure doesn't need
// minute-level freshness, so pinning to a date that only changes once daily
// (at midnight) removes the flicker entirely for the default (no explicit
// dateTo) case.
async function resolveAnchorDate(db, filters) {
  if (filters.dateTo) {
    return filters.dateTo;
  }

  const pinnedAnchorDate = addDays(toBangkokDateString(bangkokNow()), -1);
  const pinnedCheck = await db.query(
    `
      SELECT 1
      FROM analytics.product_sales_summary_periods
      WHERE period_days IN (30, 90)
        AND period_end = $1::date
      LIMIT 1
    `,
    [pinnedAnchorDate],
  );
  if (pinnedCheck.rowCount > 0) {
    return pinnedAnchorDate;
  }

  // Edge case only: "yesterday" has no synced data at all yet (e.g. very
  // first day this ever ran). Fall back to whatever's actually there so the
  // feature still works instead of resolving to an empty date with no rows.
  const result = await db.query(
    `
      SELECT MAX(period_end)::date AS latest_date
      FROM analytics.product_sales_summary_periods
      WHERE period_days IN (30, 90)
    `,
  );
  const latestAnalyticsDate = formatDateOnly(result.rows[0]?.latest_date || null);
  if (latestAnalyticsDate) {
    return latestAnalyticsDate;
  }

  const fallbackResult = await db.query(
    `
      SELECT MAX(doc_date)::date AS latest_date
      FROM ada.sales_headers
      WHERE COALESCE(NULLIF(raw_payload->>'FTShdDocType', ''), '1') = '1'
        AND COALESCE(NULLIF(raw_payload->>'FTShdStaPaid', ''), paid_status, '') = '3'
    `,
  );
  const latestDate = fallbackResult.rows[0]?.latest_date || null;
  const normalizedLatestDate = formatDateOnly(latestDate);
  if (!normalizedLatestDate) {
    return toBangkokDateString(bangkokNow());
  }
  return normalizedLatestDate;
}

function buildBranchQtyPositiveSql(branchCodes, alias = "bs") {
  const parts = branchCodes
    .filter((branchCode) => BRANCH_SNAPSHOT_COLUMNS[branchCode])
    .map((branchCode) => `COALESCE(${alias}.${BRANCH_SNAPSHOT_COLUMNS[branchCode].qty}, 0) > 0`);
  return parts.length ? `(${parts.join(" OR ")})` : "FALSE";
}

async function loadCandidateProductCodes(db, { scope, search, rawSalesAgg }) {
  const normalizedSearch = normalizeText(search || "");
  const productCodes = new Set();

  if (normalizedSearch) {
    const searchResult = await db.query(
      `
        SELECT DISTINCT bs.product_code
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
        WHERE bs.product_code ILIKE '%' || $1 || '%'
           OR COALESCE(bs.product_name_thai, p.product_name_th, bs.product_name_eng, p.product_name, '') ILIKE '%' || $1 || '%'
           OR COALESCE(bs.barcode, pb.barcode, '') ILIKE '%' || $1 || '%'
        ORDER BY bs.product_code ASC
      `,
      [normalizedSearch],
    );
    for (const row of searchResult.rows) {
      if (row.product_code) productCodes.add(String(row.product_code));
    }
  }

  const stockResult = await db.query(
    `
      SELECT bs.product_code
      FROM ada.branch_stock_snapshots bs
      WHERE ${buildBranchQtyPositiveSql(scope.branchCodes)}
      ORDER BY bs.product_code ASC
    `,
  );
  for (const row of stockResult.rows) {
    if (row.product_code) productCodes.add(String(row.product_code));
  }

  for (const key of rawSalesAgg.keys()) {
    const agg = rawSalesAgg.get(key);
    if (agg.soldQty30d > 0 || agg.soldQty90d > 0) {
      productCodes.add(key.slice(0, key.lastIndexOf("|")));
    }
  }

  const incomingResult = await db.query(
    `
      SELECT DISTINCT product_code
      FROM (
        SELECT l.product_code
        FROM ada.pending_receipt_lines l
        JOIN ada.pending_receipt_headers h
          ON h.doc_no = l.doc_no
        UNION
        SELECT l.product_code
        FROM ada.approved_receipt_lines l
        JOIN ada.approved_receipt_headers h
          ON h.doc_no = l.doc_no
      ) incoming
    `,
  );
  for (const row of incomingResult.rows) {
    if (row.product_code) productCodes.add(String(row.product_code));
  }

  return [...productCodes].sort();
}

async function loadCurrentStockByProduct(db, { productCodes }) {
  if (!Array.isArray(productCodes) || productCodes.length === 0) {
    return [];
  }
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
        bs.synced_at
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

  return result.rows.map((row) => ({
    productCode: row.product_code,
    productNameThai: row.product_name_thai || row.product_code,
    productNameEng: row.product_name_eng || row.product_code,
    barcode: row.barcode || null,
    unit: row.unit || null,
    syncedAt: row.synced_at || null,
    branches: Object.entries(BRANCH_SNAPSHOT_COLUMNS).reduce((acc, [branchCode, columns]) => {
      acc[branchCode] = {
        qty: numberOrZero(row[columns.qty]),
        unitCostAvg: numberOrNull(row[columns.cost]),
      };
      return acc;
    }, {}),
  }));
}

// Reads straight from ada.sales_lines/ada.sales_headers instead of
// analytics.product_sales_summary_periods: that table's period_days=90 bucket
// is only ever populated by ada.refresh_sales_summary_period_into_analytics()
// (migration 017), which filters on paid_status IN ('1', ...) — real data uses
// paid_status='3' (see movement-analytics.js / focusProducts.js), so that
// function's output is effectively empty and hasn't refreshed since
// 2026-05-20. The only live feed (adapos_sync, from the branch senders) only
// ever pushes period_days=30, so soldQty90d was always 0 and every product
// looked like a 90-day non-mover. Querying the raw tables directly with the
// correct paid filter fixes both windows at the source.
async function loadRawSalesAggByBranch(db, { branchCodes, window30From, window90From, anchorDate }) {
  if (!Array.isArray(branchCodes) || branchCodes.length === 0) {
    return new Map();
  }

  const result = await db.query(
    `
      SELECT
        sl.product_code,
        sh.branch_code,
        COALESCE(SUM(COALESCE(sl.qty_base, sl.qty, 0)) FILTER (WHERE sh.doc_date >= $4::date), 0)::numeric AS sold_qty_30d,
        COALESCE(SUM(COALESCE(sl.qty_base, sl.qty, 0)), 0)::numeric AS sold_qty_90d
      FROM ada.sales_headers sh
      JOIN ada.sales_lines sl
        ON sl.branch_code = sh.branch_code
       AND sl.doc_no = sh.doc_no
      WHERE sh.branch_code = ANY($1::text[])
        AND sh.doc_date BETWEEN $2::date AND $3::date
        AND COALESCE(NULLIF(sh.raw_payload->>'FTShdDocType', ''), '1') = '1'
        AND COALESCE(NULLIF(sh.raw_payload->>'FTShdStaPaid', ''), sh.paid_status, '') = '3'
      GROUP BY sl.product_code, sh.branch_code
    `,
    [branchCodes, window90From, anchorDate, window30From],
  );

  const map = new Map();
  for (const row of result.rows) {
    map.set(`${row.product_code}|${row.branch_code}`, {
      soldQty30d: numberOrZero(row.sold_qty_30d),
      soldQty90d: numberOrZero(row.sold_qty_90d),
    });
  }
  return map;
}

async function loadIncomingReceiptAggByProduct(db, { productCodes, mode = "pending_and_approved_receipts" }) {
  if (!Array.isArray(productCodes) || productCodes.length === 0) {
    return new Map();
  }

  const includePending = mode === "pending_and_approved_receipts" || mode === "pending_only";
  const includeApproved = mode === "pending_and_approved_receipts" || mode === "approved_only";
  const unions = [];

  if (includePending) {
    unions.push(`
      SELECT
        l.product_code,
        COALESCE(l.qty_base, COALESCE(l.qty, 0) * COALESCE(l.stock_factor, 1), COALESCE(l.qty, 0)) AS qty
      FROM ada.pending_receipt_lines l
      JOIN ada.pending_receipt_headers h
        ON h.doc_no = l.doc_no
      WHERE l.product_code = ANY($1::text[])
    `);
  }

  if (includeApproved) {
    unions.push(`
      SELECT
        l.product_code,
        COALESCE(l.qty_base, COALESCE(l.qty, 0) * COALESCE(l.stock_factor, 1), COALESCE(l.qty, 0)) AS qty
      FROM ada.approved_receipt_lines l
      JOIN ada.approved_receipt_headers h
        ON h.doc_no = l.doc_no
      WHERE l.product_code = ANY($1::text[])
    `);
  }

  if (unions.length === 0) {
    return new Map();
  }

  const result = await db.query(
    `
      WITH incoming_lines AS (
        ${unions.join("\nUNION ALL\n")}
      )
      SELECT product_code, COALESCE(SUM(qty), 0)::numeric AS incoming_qty_total
      FROM incoming_lines
      GROUP BY product_code
    `,
    [productCodes],
  );

  const map = new Map();
  for (const row of result.rows) {
    map.set(row.product_code, numberOrZero(row.incoming_qty_total));
  }
  return map;
}

function mapSnapshotRow(row) {
  return {
    branchCode: row.branch_code,
    branchLabel: row.branch_label || `สาขา ${row.branch_code}`,
    productCode: row.product_code,
    productNameThai: row.product_name_thai || row.product_code,
    productNameEng: row.product_name_eng || row.product_code,
    barcode: row.barcode || null,
    unit: row.unit || null,
    currentStock: numberOrZero(row.current_stock),
    unitCostAvg: numberOrNull(row.unit_cost_avg),
    inventoryValue: numberOrZero(row.inventory_value),
    soldQty30d: numberOrZero(row.sold_qty_30d),
    soldQty90d: numberOrZero(row.sold_qty_90d),
    soldQtySamePeriodLastYear: row.sold_qty_same_period_last_year == null ? null : numberOrZero(row.sold_qty_same_period_last_year),
    adu30: numberOrZero(row.adu_30),
    adu90: numberOrZero(row.adu_90),
    trendRatio30Vs90: numberOrNull(row.trend_ratio_30_vs_90),
    adjustedAdu: numberOrZero(row.adjusted_adu),
    incomingPoQtyTotal: numberOrZero(row.incoming_po_qty_total),
    incomingPoAllocationQty: numberOrZero(row.incoming_po_allocation_qty),
    effectiveStock: numberOrZero(row.effective_stock),
    currentDaysCover: numberOrNull(row.current_days_cover),
    effectiveDaysCover: numberOrNull(row.effective_days_cover),
    targetDays: Number(row.target_days || 90),
    targetQty: numberOrZero(row.target_qty),
    surplusQty: numberOrZero(row.surplus_qty),
    shortageQty: numberOrZero(row.shortage_qty),
    transferPlanQty: numberOrZero(row.transfer_plan_qty),
    purchaseQty: numberOrZero(row.purchase_qty),
    priorityScore: numberOrZero(row.priority_score),
    action: row.action,
    reason: row.recommendation_reason || "",
    recommendationReason: row.recommendation_reason || "",
    flags: Array.isArray(row.recommendation_flags) ? row.recommendation_flags : [],
    donors: Array.isArray(row.donors_json) ? row.donors_json : [],
    primarySuggestedDonorBranchCode: row.primary_suggested_donor_branch_code || null,
    syncedAt: row.synced_at || null,
    generatedAt: row.generated_at || null,
  };
}

function buildBranchMetricsByProduct({ stockRow, salesAggByProductBranch, incomingByProduct, scope, policy }) {
  const incomingTotal = incomingByProduct.get(stockRow.productCode) || 0;
  const activeBranchCount = Math.max(1, scope.activeBranchCodes.length);
  const allocatedIncoming = incomingTotal / activeBranchCount;
  const metricsByBranch = new Map();

  for (const branchCode of scope.activeBranchCodes) {
    const branchSnapshot = stockRow.branches[branchCode] || { qty: 0, unitCostAvg: null };
    const sales = salesAggByProductBranch.get(`${stockRow.productCode}|${branchCode}`) || {
      soldQty30d: 0,
      soldQty90d: 0,
    };
    const currentStock = numberOrZero(branchSnapshot.qty);
    const unitCostAvg = numberOrNull(branchSnapshot.unitCostAvg);
    const inventoryValue = unitCostAvg == null ? 0 : currentStock * unitCostAvg;
    const adu30 = safeDivide(sales.soldQty30d, 30);
    const adu90 = safeDivide(sales.soldQty90d, 90);
    const baseAdu = adu90;
    const trendRatio = adu90 > 0 ? adu30 / adu90 : 0;

    let adjustedAdu = baseAdu;
    if (baseAdu > 0) {
      if (trendRatio >= 1.2) adjustedAdu = baseAdu * 1.1;
      else if (trendRatio <= 0.8) adjustedAdu = baseAdu * 0.9;
    }

    const incomingPoAllocationQty = allocatedIncoming;
    const effectiveStock = currentStock + incomingPoAllocationQty;
    const currentDaysCover = adjustedAdu > 0 ? currentStock / adjustedAdu : null;
    const effectiveDaysCover = adjustedAdu > 0 ? effectiveStock / adjustedAdu : null;
    const targetQty = adjustedAdu * policy.targetDays;
    const gapQty = effectiveStock - targetQty;
    const surplusQty = Math.max(gapQty, 0);
    const shortageQty = Math.max(-gapQty, 0);
    const donorTransferableQty = adjustedAdu > 0 ? Math.max(effectiveStock - targetQty, 0) : Math.max(currentStock, 0);

    metricsByBranch.set(branchCode, {
      branchCode,
      currentStock: round(currentStock, 4),
      unitCostAvg: unitCostAvg == null ? null : round(unitCostAvg, 4),
      inventoryValue: round(inventoryValue, 2),
      soldQty30d: round(sales.soldQty30d, 4),
      soldQty90d: round(sales.soldQty90d, 4),
      adu30: round(adu30, 6),
      adu90: round(adu90, 6),
      trendRatio30Vs90: adu90 > 0 ? round(trendRatio, 4) : null,
      adjustedAdu: round(adjustedAdu, 6),
      incomingPoQtyTotal: round(incomingTotal, 4),
      incomingPoAllocationQty: round(incomingPoAllocationQty, 4),
      effectiveStock: round(effectiveStock, 4),
      currentDaysCover: currentDaysCover == null ? null : round(currentDaysCover, 2),
      effectiveDaysCover: effectiveDaysCover == null ? null : round(effectiveDaysCover, 2),
      targetQty: round(targetQty, 4),
      surplusQty: round(surplusQty, 4),
      shortageQty: round(shortageQty, 4),
      donorTransferableQty: round(donorTransferableQty, 4),
    });
  }

  return metricsByBranch;
}

function buildDonorPlan(metricsByBranch, receiverBranchCode) {
  const receiver = metricsByBranch.get(receiverBranchCode);
  if (!receiver || receiver.shortageQty <= 0) {
    return { transferPlanQty: 0, purchaseQty: 0, donors: [] };
  }

  const donors = [];
  for (const [branchCode, metric] of metricsByBranch.entries()) {
    if (branchCode === receiverBranchCode) continue;
    if (metric.donorTransferableQty > 0) {
      donors.push({
        branchCode,
        branchName: null,
        availableQty: metric.donorTransferableQty,
        adjustedAdu: metric.adjustedAdu,
        currentDaysCover: metric.currentDaysCover,
        effectiveDaysCover: metric.effectiveDaysCover,
        targetQty: metric.targetQty,
        effectiveStock: metric.effectiveStock,
      });
    }
  }

  donors.sort((a, b) => b.availableQty - a.availableQty || a.branchCode.localeCompare(b.branchCode));

  let remaining = receiver.shortageQty;
  const plan = [];
  for (const donor of donors) {
    if (remaining <= 0) break;
    const qty = Math.min(remaining, donor.availableQty);
    remaining -= qty;
    plan.push({
      branchCode: donor.branchCode,
      qty: round(qty, 4),
      daysCoverAfterTransfer: donor.adjustedAdu > 0
        ? round((donor.effectiveStock - qty) / donor.adjustedAdu, 2)
        : null,
    });
  }

  return {
    transferPlanQty: round(plan.reduce((sum, donor) => sum + donor.qty, 0), 4),
    purchaseQty: round(Math.max(remaining, 0), 4),
    donors: plan,
  };
}

function buildRecommendationReason(metric, action, donors, purchaseQty) {
  if (action === "NO_PURCHASE_SLOW_MOVING") {
    return "90 วันที่ผ่านมาไม่มีการขาย ยังไม่ควรสั่งเพิ่ม";
  }
  if (action === "NO_ACTION") {
    if (metric.effectiveDaysCover != null) {
      return `สต๊อกหลังรวม incoming PO พอประมาณ ${round(metric.effectiveDaysCover, 0)} วัน สูงพอสำหรับเป้าหมายแล้ว`;
    }
    return "สต๊อกปัจจุบันยังไม่ต้องสั่งเพิ่ม";
  }
  if (action === "TRANSFER_IN" && donors.length > 0) {
    return `สต๊อกหลังรวม incoming PO ยังต่ำกว่าเป้าหมาย แนะนำขอจากสาขา ${donors[0].branchCode} ก่อน`;
  }
  if (action === "PURCHASE") {
    return "สต๊อกหลังรวม incoming PO ยังต่ำกว่าเป้าหมาย และยังไม่มีสาขาอื่นช่วยเติมได้";
  }
  if (action === "TRANSFER_AND_PURCHASE" && donors.length > 0) {
    return `แนะนำขอจากสาขา ${donors[0].branchCode} ก่อน และสั่งเพิ่มอีก ${round(purchaseQty, 0)}`;
  }
  return "ระบบแนะนำจากยอดขายย้อนหลัง สต๊อกปัจจุบัน และ incoming PO";
}

function buildRecommendationRows({ stockRows, salesAggByProductBranch, incomingByProduct, scope, policy, branchNameByCode }) {
  const rows = [];

  for (const stockRow of stockRows) {
    const metricsByBranch = buildBranchMetricsByProduct({
      stockRow,
      salesAggByProductBranch,
      incomingByProduct,
      scope,
      policy,
    });

    for (const branchCode of scope.branchCodes) {
      const metric = metricsByBranch.get(branchCode);
      if (!metric) continue;

      const hasMeaningfulData =
        metric.currentStock > 0 ||
        metric.soldQty30d > 0 ||
        metric.soldQty90d > 0 ||
        metric.incomingPoAllocationQty > 0;

      if (!hasMeaningfulData) {
        continue;
      }

      let action = "NO_ACTION";
      let transferPlanQty = 0;
      let purchaseQty = 0;
      let donors = [];
      const flags = [];

      if (metric.soldQty90d <= 0) {
        action = metric.currentStock > 0 ? "NO_PURCHASE_SLOW_MOVING" : "NO_ACTION";
        if (metric.currentStock > 0) flags.push("SLOW_MOVING");
      } else if (metric.shortageQty > 0) {
        const donorPlan = buildDonorPlan(metricsByBranch, branchCode);
        transferPlanQty = donorPlan.transferPlanQty;
        purchaseQty = donorPlan.purchaseQty;
        donors = donorPlan.donors.map((donor) => ({
          ...donor,
          branchName: branchNameByCode.get(donor.branchCode) || `สาขา ${donor.branchCode}`,
        }));

        if (transferPlanQty >= metric.shortageQty && transferPlanQty > 0) {
          action = "TRANSFER_IN";
        } else if (transferPlanQty > 0 && purchaseQty > 0) {
          action = "TRANSFER_AND_PURCHASE";
        } else {
          action = "PURCHASE";
        }
      }

      if (metric.incomingPoAllocationQty > 0) flags.push("HAS_INCOMING_PO");
      if (metric.unitCostAvg == null && metric.currentStock > 0) flags.push("MISSING_COST");
      if (metric.effectiveDaysCover != null && metric.effectiveDaysCover > 120) flags.push("OVERSTOCK");
      if (metric.currentStock < 0) flags.push("NEGATIVE_STOCK");

      const primaryDonor = donors[0] || null;
      const recommendationReason = buildRecommendationReason(metric, action, donors, purchaseQty);
      // Priority must reflect only the qty this action will actually move — deriving it from
      // metric.shortageQty (which can be spuriously positive off negative currentStock when
      // there's no recent demand, e.g. branch 000's warehouse never sells) put NO_ACTION /
      // NO_PURCHASE_SLOW_MOVING rows ahead of genuine PURCHASE/TRANSFER_IN shortages.
      const priorityActionQty =
        action === "PURCHASE" || action === "TRANSFER_AND_PURCHASE"
          ? purchaseQty
          : action === "TRANSFER_IN"
            ? transferPlanQty
            : 0;
      const priorityScore = round(priorityActionQty * (metric.unitCostAvg || 0), 2);

      rows.push({
        branchCode,
        branchLabel: branchNameByCode.get(branchCode) || `สาขา ${branchCode}`,
        productCode: stockRow.productCode,
        productNameThai: stockRow.productNameThai,
        productNameEng: stockRow.productNameEng,
        barcode: stockRow.barcode,
        unit: stockRow.unit,
        currentStock: metric.currentStock,
        unitCostAvg: metric.unitCostAvg,
        inventoryValue: metric.inventoryValue,
        soldQty30d: metric.soldQty30d,
        soldQty90d: metric.soldQty90d,
        soldQtySamePeriodLastYear: null,
        adu30: metric.adu30,
        adu90: metric.adu90,
        trendRatio30Vs90: metric.trendRatio30Vs90,
        adjustedAdu: metric.adjustedAdu,
        incomingPoQtyTotal: metric.incomingPoQtyTotal,
        incomingPoAllocationQty: metric.incomingPoAllocationQty,
        effectiveStock: metric.effectiveStock,
        currentDaysCover: metric.currentDaysCover,
        effectiveDaysCover: metric.effectiveDaysCover,
        targetDays: policy.targetDays,
        targetQty: metric.targetQty,
        surplusQty: metric.surplusQty,
        shortageQty: metric.shortageQty,
        transferPlanQty: round(transferPlanQty, 4),
        purchaseQty: round(purchaseQty, 4),
        priorityScore,
        action,
        reason: recommendationReason,
        recommendationReason,
        flags,
        donors,
        primarySuggestedDonorBranchCode: primaryDonor ? primaryDonor.branchCode : null,
        syncedAt: stockRow.syncedAt,
      });
    }
  }

  return rows;
}

function applyActionFilter(rows, action) {
  if (!action) return rows;
  return rows.filter((row) => row.action === action);
}

function sortRows(rows, sort) {
  const sorted = [...rows];
  switch (sort) {
    case "days_cover_asc":
      sorted.sort((a, b) => {
        const aVal = a.effectiveDaysCover == null ? Number.POSITIVE_INFINITY : a.effectiveDaysCover;
        const bVal = b.effectiveDaysCover == null ? Number.POSITIVE_INFINITY : b.effectiveDaysCover;
        return aVal - bVal || a.productCode.localeCompare(b.productCode);
      });
      break;
    case "inventory_value_desc":
      sorted.sort((a, b) => b.inventoryValue - a.inventoryValue || a.productCode.localeCompare(b.productCode));
      break;
    case "product_code_asc":
      sorted.sort((a, b) => a.productCode.localeCompare(b.productCode) || a.branchCode.localeCompare(b.branchCode));
      break;
    case "priority_desc":
    default:
      sorted.sort((a, b) => b.priorityScore - a.priorityScore || b.shortageQty - a.shortageQty || a.productCode.localeCompare(b.productCode));
      break;
  }
  return sorted;
}

function buildListSummary(rows) {
  const currentInventoryValue = round(rows.reduce((sum, row) => sum + numberOrZero(row.inventoryValue), 0), 2);
  const projectedInventoryValueAtTarget = round(
    rows.reduce((sum, row) => sum + ((row.unitCostAvg || 0) * numberOrZero(row.targetQty)), 0),
    2,
  );
  const potentialReductionValue = round(
    rows.reduce((sum, row) => sum + Math.max(numberOrZero(row.inventoryValue) - ((row.unitCostAvg || 0) * numberOrZero(row.targetQty)), 0), 0),
    2,
  );

  return {
    skuCount: rows.length,
    recommendTransferCount: rows.filter((row) => row.action === "TRANSFER_IN").length,
    recommendPurchaseCount: rows.filter((row) => row.action === "PURCHASE").length,
    recommendMixedCount: rows.filter((row) => row.action === "TRANSFER_AND_PURCHASE").length,
    slowMovingCount: rows.filter((row) => row.action === "NO_PURCHASE_SLOW_MOVING").length,
    currentInventoryValue,
    projectedInventoryValueAtTarget,
    potentialReductionValue,
  };
}

// Plain per-SKU AVG(current_days_cover) is dominated by long-tail dead stock:
// a SKU with 1 unit sold in 90 days but a few units on hand gets a days_cover
// in the thousands, and it counts exactly as much as a core fast-mover that
// carries most of the branch's actual stock value. Weight by inventory_value
// instead so the number reflects how long the money tied up in stock would
// last at the current burn rate, not the average SKU's arithmetic cover.
function computeValueWeightedDaysCover(rows) {
  let totalValue = 0;
  let totalDailyValue = 0;
  for (const row of rows) {
    const value = numberOrZero(row.inventoryValue);
    totalValue += value;
    const cover = row.currentDaysCover;
    if (cover != null && cover > 0 && value > 0) {
      totalDailyValue += value / cover;
    }
  }
  return totalDailyValue > 0 ? round(totalValue / totalDailyValue, 2) : null;
}

function buildCompanySummary(rows) {
  const listSummary = buildListSummary(rows);
  const averageDaysCover = computeValueWeightedDaysCover(rows);

  return {
    currentInventoryValue: listSummary.currentInventoryValue,
    projectedInventoryValueAtTarget: listSummary.projectedInventoryValueAtTarget,
    potentialReductionValue: listSummary.potentialReductionValue,
    averageDaysCover,
    skuCountRecommendTransfer: listSummary.recommendTransferCount,
    skuCountRecommendPurchase: listSummary.recommendPurchaseCount + listSummary.recommendMixedCount,
    requestMatchRecommendationCount: 0,
    requestOverrideRecommendationCount: 0,
    adminOverrideBranchRequestCount: 0,
    adminOverrideSystemRecommendationCount: 0,
  };
}

function buildBranchSummaries(rows, activeBranches) {
  return activeBranches.map((branch) => {
    const branchRows = rows.filter((row) => row.branchCode === branch.branchCode);
    return {
      branchCode: branch.branchCode,
      label: branch.branchName || `สาขา ${branch.branchCode}`,
      currentInventoryValue: round(branchRows.reduce((sum, row) => sum + numberOrZero(row.inventoryValue), 0), 2),
      averageDaysCover: computeValueWeightedDaysCover(branchRows),
      recommendTransferCount: branchRows.filter((row) => row.action === "TRANSFER_IN").length,
      recommendPurchaseCount: branchRows.filter((row) => row.action === "PURCHASE" || row.action === "TRANSFER_AND_PURCHASE").length,
    };
  });
}

function buildSnapshotOrderBy(sort) {
  switch (sort) {
    case "days_cover_asc":
      return "effective_days_cover ASC NULLS LAST, product_code ASC, branch_code ASC";
    case "inventory_value_desc":
      return "inventory_value DESC NULLS LAST, product_code ASC, branch_code ASC";
    case "product_code_asc":
      return "product_code ASC, branch_code ASC";
    case "priority_desc":
    default:
      return "priority_score DESC NULLS LAST, shortage_qty DESC NULLS LAST, product_code ASC, branch_code ASC";
  }
}

async function resolveSnapshotMeta(db, { scope, targetDays, anchorDate }) {
  const result = await db.query(
    `
      SELECT
        anchor_date,
        target_days,
        COUNT(*)::int AS row_count,
        MAX(generated_at) AS generated_at
      FROM ordering.stock_recommendation_snapshots
      WHERE branch_code = ANY($1::text[])
        AND target_days = $2
        AND anchor_date = $3::date
      GROUP BY anchor_date, target_days
      LIMIT 1
    `,
    [scope.branchCodes, targetDays, anchorDate],
  );
  return result.rows[0] || null;
}

// Whatever anchor_date the snapshot table actually has data for, for this
// scope/target_days — not whatever "today" happens to live-resolve to right
// now. Used for the default (no explicit dateTo) read path so a request
// never has to match a moving target: see resolveAnchorDate for why that
// target moves, and computeRecommendationDataset for how this is used.
async function resolveLatestSnapshotAnchorDate(db, { scope, targetDays }) {
  const result = await db.query(
    `
      SELECT MAX(anchor_date)::date AS latest_anchor_date
      FROM ordering.stock_recommendation_snapshots
      WHERE branch_code = ANY($1::text[])
        AND target_days = $2
    `,
    [scope.branchCodes, targetDays],
  );
  return formatDateOnly(result.rows[0]?.latest_anchor_date || null);
}

async function listPrecomputedStockRecommendations(db, dataset) {
  const { scope, filters, anchorDate, policy } = dataset;
  const search = normalizeText(filters.search || "");
  const action = filters.action || null;
  const orderBy = buildSnapshotOrderBy(filters.sort);

  const summaryResult = await db.query(
    `
      WITH filtered AS (
        SELECT *
        FROM ordering.stock_recommendation_snapshots
        WHERE branch_code = ANY($1::text[])
          AND target_days = $2
          AND anchor_date = $3::date
          AND ($4::text = ''
            OR product_code ILIKE '%' || $4 || '%'
            OR COALESCE(product_name_thai, product_name_eng, '') ILIKE '%' || $4 || '%'
            OR COALESCE(barcode, '') ILIKE '%' || $4 || '%')
          AND ($5::text IS NULL OR action = $5)
      )
      SELECT
        COUNT(*)::int AS sku_count,
        COUNT(*) FILTER (WHERE action = 'TRANSFER_IN')::int AS recommend_transfer_count,
        COUNT(*) FILTER (WHERE action = 'PURCHASE')::int AS recommend_purchase_count,
        COUNT(*) FILTER (WHERE action = 'TRANSFER_AND_PURCHASE')::int AS recommend_mixed_count,
        COUNT(*) FILTER (WHERE action = 'NO_PURCHASE_SLOW_MOVING')::int AS slow_moving_count,
        COALESCE(SUM(inventory_value), 0)::numeric AS current_inventory_value,
        COALESCE(SUM(COALESCE(unit_cost_avg, 0) * COALESCE(target_qty, 0)), 0)::numeric AS projected_inventory_value_at_target,
        COALESCE(SUM(GREATEST(COALESCE(inventory_value, 0) - (COALESCE(unit_cost_avg, 0) * COALESCE(target_qty, 0)), 0)), 0)::numeric AS potential_reduction_value
      FROM filtered
    `,
    [scope.branchCodes, policy.targetDays, anchorDate, search, action],
  );

  const rowsResult = await db.query(
    `
      SELECT *
      FROM ordering.stock_recommendation_snapshots
      WHERE branch_code = ANY($1::text[])
        AND target_days = $2
        AND anchor_date = $3::date
        AND ($4::text = ''
          OR product_code ILIKE '%' || $4 || '%'
          OR COALESCE(product_name_thai, product_name_eng, '') ILIKE '%' || $4 || '%'
          OR COALESCE(barcode, '') ILIKE '%' || $4 || '%')
        AND ($5::text IS NULL OR action = $5)
      ORDER BY ${orderBy}
      LIMIT $6 OFFSET $7
    `,
    [scope.branchCodes, policy.targetDays, anchorDate, search, action, filters.pageSize, filters.offset],
  );

  return {
    summary: {
      skuCount: Number(summaryResult.rows[0]?.sku_count || 0),
      recommendTransferCount: Number(summaryResult.rows[0]?.recommend_transfer_count || 0),
      recommendPurchaseCount: Number(summaryResult.rows[0]?.recommend_purchase_count || 0),
      recommendMixedCount: Number(summaryResult.rows[0]?.recommend_mixed_count || 0),
      slowMovingCount: Number(summaryResult.rows[0]?.slow_moving_count || 0),
      currentInventoryValue: numberOrZero(summaryResult.rows[0]?.current_inventory_value),
      projectedInventoryValueAtTarget: numberOrZero(summaryResult.rows[0]?.projected_inventory_value_at_target),
      potentialReductionValue: numberOrZero(summaryResult.rows[0]?.potential_reduction_value),
    },
    rows: rowsResult.rows.map(mapSnapshotRow),
    total: Number(summaryResult.rows[0]?.sku_count || 0),
  };
}

async function loadPrecomputedBranchSummaries(db, dataset) {
  const { scope, anchorDate, policy } = dataset;
  const branchResult = await db.query(
    `
      SELECT
        branch_code,
        MAX(branch_label) AS branch_label,
        COALESCE(SUM(inventory_value), 0)::numeric AS current_inventory_value,
        ROUND(
          COALESCE(SUM(inventory_value), 0)
            / NULLIF(SUM(inventory_value / NULLIF(current_days_cover, 0))
                FILTER (WHERE current_days_cover IS NOT NULL AND current_days_cover > 0), 0),
          2
        ) AS average_days_cover,
        COUNT(*) FILTER (WHERE action = 'TRANSFER_IN')::int AS recommend_transfer_count,
        COUNT(*) FILTER (WHERE action IN ('PURCHASE', 'TRANSFER_AND_PURCHASE'))::int AS recommend_purchase_count
      FROM ordering.stock_recommendation_snapshots
      WHERE branch_code = ANY($1::text[])
        AND target_days = $2
        AND anchor_date = $3::date
      GROUP BY branch_code
      ORDER BY branch_code ASC
    `,
    [scope.branchCodes, policy.targetDays, anchorDate],
  );

  const found = new Map(branchResult.rows.map((row) => [String(row.branch_code), row]));
  return scope.activeBranches.map((branch) => {
    const row = found.get(branch.branchCode);
    return {
      branchCode: branch.branchCode,
      label: row?.branch_label || branch.branchName || `สาขา ${branch.branchCode}`,
      currentInventoryValue: numberOrZero(row?.current_inventory_value),
      averageDaysCover: row?.average_days_cover == null ? null : numberOrZero(row.average_days_cover),
      recommendTransferCount: Number(row?.recommend_transfer_count || 0),
      recommendPurchaseCount: Number(row?.recommend_purchase_count || 0),
    };
  });
}

async function loadPrecomputedCompanySummary(db, dataset) {
  const { scope, anchorDate, policy } = dataset;
  const result = await db.query(
    `
      SELECT
        COALESCE(SUM(inventory_value), 0)::numeric AS current_inventory_value,
        COALESCE(SUM(COALESCE(unit_cost_avg, 0) * COALESCE(target_qty, 0)), 0)::numeric AS projected_inventory_value_at_target,
        COALESCE(SUM(GREATEST(COALESCE(inventory_value, 0) - (COALESCE(unit_cost_avg, 0) * COALESCE(target_qty, 0)), 0)), 0)::numeric AS potential_reduction_value,
        ROUND(
          COALESCE(SUM(inventory_value), 0)
            / NULLIF(SUM(inventory_value / NULLIF(current_days_cover, 0))
                FILTER (WHERE current_days_cover IS NOT NULL AND current_days_cover > 0), 0),
          2
        ) AS average_days_cover,
        COUNT(*) FILTER (WHERE action = 'TRANSFER_IN')::int AS sku_count_recommend_transfer,
        COUNT(*) FILTER (WHERE action IN ('PURCHASE', 'TRANSFER_AND_PURCHASE'))::int AS sku_count_recommend_purchase
      FROM ordering.stock_recommendation_snapshots
      WHERE branch_code = ANY($1::text[])
        AND target_days = $2
        AND anchor_date = $3::date
    `,
    [scope.branchCodes, policy.targetDays, anchorDate],
  );
  return {
    currentInventoryValue: numberOrZero(result.rows[0]?.current_inventory_value),
    projectedInventoryValueAtTarget: numberOrZero(result.rows[0]?.projected_inventory_value_at_target),
    potentialReductionValue: numberOrZero(result.rows[0]?.potential_reduction_value),
    averageDaysCover: result.rows[0]?.average_days_cover == null ? null : numberOrZero(result.rows[0].average_days_cover),
    skuCountRecommendTransfer: Number(result.rows[0]?.sku_count_recommend_transfer || 0),
    skuCountRecommendPurchase: Number(result.rows[0]?.sku_count_recommend_purchase || 0),
    requestMatchRecommendationCount: 0,
    requestOverrideRecommendationCount: 0,
    adminOverrideBranchRequestCount: 0,
    adminOverrideSystemRecommendationCount: 0,
  };
}

async function getPrecomputedRecommendationDetail(db, dataset, productCode) {
  const result = await db.query(
    `
      SELECT *
      FROM ordering.stock_recommendation_snapshots
      WHERE branch_code = $1
        AND target_days = $2
        AND anchor_date = $3::date
        AND product_code = $4
      LIMIT 1
    `,
    [dataset.scope.branchCodes[0], dataset.policy.targetDays, dataset.anchorDate, productCode],
  );
  return result.rows[0] ? mapSnapshotRow(result.rows[0]) : null;
}

async function computeLiveRecommendationDataset(db, auth, filters = {}) {
  const normalizedFilters = normalizeRecommendationFilters(filters);
  const scope = await resolveEffectiveBranchScope(db, auth, normalizedFilters.branchCode);
  const anchorDate = await resolveAnchorDate(db, normalizedFilters);
  const policy = buildRecommendationPolicy(normalizedFilters, anchorDate);
  const branchNameByCode = new Map(scope.activeBranches.map((branch) => [branch.branchCode, branch.branchName]));

  const rawSalesAgg = await loadRawSalesAggByBranch(db, {
    branchCodes: scope.activeBranchCodes,
    window30From: policy.salesWindow30dFrom,
    window90From: policy.salesWindow90dFrom,
    anchorDate,
  });
  const candidateProductCodes = await loadCandidateProductCodes(db, {
    scope,
    search: normalizedFilters.search,
    rawSalesAgg,
  });
  const stockRows = await loadCurrentStockByProduct(db, { productCodes: candidateProductCodes });
  const productCodes = stockRows.map((row) => row.productCode);
  const salesAggByProductBranch = rawSalesAgg;
  const incomingByProduct = await loadIncomingReceiptAggByProduct(db, {
    productCodes,
    mode: policy.incomingSourceMode,
  });

  const allRows = buildRecommendationRows({
    stockRows,
    salesAggByProductBranch,
    incomingByProduct,
    scope,
    policy,
    branchNameByCode,
  });

  return {
    filters: normalizedFilters,
    scope,
    anchorDate,
    policy,
    branchNameByCode,
    rows: allRows,
    source: "live",
  };
}

async function computeRecommendationDataset(db, auth, filters = {}) {
  const normalizedFilters = normalizeRecommendationFilters(filters);
  const scope = await resolveEffectiveBranchScope(db, auth, normalizedFilters.branchCode);
  const branchNameByCode = new Map(scope.activeBranches.map((branch) => [branch.branchCode, branch.branchName]));

  // A specific dateTo is a deliberate historical/point-in-time query — honor
  // it exactly (existing behavior: match-or-live-compute for that date). The
  // default "just show me the current view" case instead serves whatever
  // snapshot actually exists, so a moving live anchor date or a missed cron
  // run never forces a slow live recompute — see resolveLatestSnapshotAnchorDate.
  const anchorDate = normalizedFilters.dateTo
    ? normalizedFilters.dateTo
    : await resolveLatestSnapshotAnchorDate(db, { scope, targetDays: normalizedFilters.targetDays });

  if (anchorDate) {
    const policy = buildRecommendationPolicy(normalizedFilters, anchorDate);
    const snapshotMeta = await resolveSnapshotMeta(db, {
      scope,
      targetDays: policy.targetDays,
      anchorDate,
    });

    if (snapshotMeta && Number(snapshotMeta.row_count || 0) > 0) {
      return {
        filters: normalizedFilters,
        scope,
        anchorDate,
        policy,
        branchNameByCode,
        rows: [],
        source: "precomputed",
        snapshotMeta: {
          rowCount: Number(snapshotMeta.row_count || 0),
          generatedAt: snapshotMeta.generated_at || null,
        },
      };
    }
  }

  return computeLiveRecommendationDataset(db, auth, normalizedFilters);
}

async function listStockRecommendations({ db, auth, filters = {} }) {
  const dataset = await computeRecommendationDataset(db, auth, filters);
  let pagedRows;
  let summary;
  let total;

  if (dataset.source === "precomputed") {
    const precomputed = await listPrecomputedStockRecommendations(db, dataset);
    pagedRows = precomputed.rows;
    summary = precomputed.summary;
    total = precomputed.total;
  } else {
    const filteredRows = sortRows(applyActionFilter(dataset.rows, dataset.filters.action), dataset.filters.sort);
    pagedRows = filteredRows.slice(dataset.filters.offset, dataset.filters.offset + dataset.filters.pageSize);
    summary = buildListSummary(filteredRows);
    total = filteredRows.length;
  }

  return {
    branchCode: dataset.scope.branchCode,
    targetDays: dataset.policy.targetDays,
    generatedAt: dataset.snapshotMeta?.generatedAt || new Date().toISOString(),
    policy: dataset.policy,
    summary,
    pagination: {
      page: dataset.filters.page,
      pageSize: dataset.filters.pageSize,
      total,
    },
    rows: pagedRows,
    meta: {
      isAllBranches: dataset.scope.isAllBranches,
      activeBranchCodes: dataset.scope.activeBranchCodes,
      branchCodesInScope: dataset.scope.branchCodes,
      anchorDate: dataset.anchorDate,
      source: dataset.source,
    },
  };
}

async function getStockRecommendationSummary({ db, auth, filters = {} }) {
  const dataset = await computeRecommendationDataset(db, auth, {
    ...filters,
    branchCode: filters.branchCode || "all",
  });

  const company =
    dataset.source === "precomputed"
      ? await loadPrecomputedCompanySummary(db, dataset)
      : buildCompanySummary(dataset.rows);
  const branches =
    dataset.source === "precomputed"
      ? await loadPrecomputedBranchSummaries(db, dataset)
      : buildBranchSummaries(dataset.rows, dataset.scope.activeBranches);

  return {
    branchCode: dataset.scope.branchCode,
    targetDays: dataset.policy.targetDays,
    generatedAt: dataset.snapshotMeta?.generatedAt || new Date().toISOString(),
    policy: dataset.policy,
    company,
    branches,
    meta: {
      isAllBranches: dataset.scope.isAllBranches,
      anchorDate: dataset.anchorDate,
      source: dataset.source,
    },
  };
}

async function getStockRecommendationDetail({ db, auth, branchCode, productCode, filters = {} }) {
  const normalizedProductCode = normalizeText(productCode);
  if (!normalizedProductCode) {
    throw createHttpError("productCode is required.", 400);
  }

  const dataset = await computeRecommendationDataset(db, auth, {
    ...filters,
    branchCode,
  });

  const row = dataset.source === "precomputed"
    ? await getPrecomputedRecommendationDetail(db, dataset, normalizedProductCode)
    : (
      dataset.rows.find(
        (candidate) => candidate.branchCode === dataset.scope.branchCodes[0] && candidate.productCode === normalizedProductCode,
      ) || null
    );

  return {
    branchCode: dataset.scope.branchCode,
    productCode: normalizedProductCode,
    targetDays: dataset.policy.targetDays,
    generatedAt: dataset.snapshotMeta?.generatedAt || new Date().toISOString(),
    policy: dataset.policy,
    recommendation: row,
    branchRequest: null,
    adminDecision: null,
    meta: {
      anchorDate: dataset.anchorDate,
      source: dataset.source,
    },
  };
}

async function refreshStockRecommendationSnapshots(db, options = {}) {
  const targetDays = parsePositiveInt(options.targetDays, 90);
  if (targetDays == null) {
    throw createHttpError("targetDays must be a positive integer.", 400);
  }

  const requestedBranchCodes = Array.isArray(options.branchCodes)
    ? options.branchCodes.map((value) => normalizeText(value)).filter((value) => BRANCH_SNAPSHOT_COLUMNS[value])
    : null;

  const liveDataset = await computeLiveRecommendationDataset(db, { role: "admin" }, {
    branchCode: "all",
    targetDays,
  });

  const rowsToPersist = requestedBranchCodes && requestedBranchCodes.length > 0
    ? liveDataset.rows.filter((row) => requestedBranchCodes.includes(row.branchCode))
    : liveDataset.rows;
  const generatedAt = new Date().toISOString();

  const client = typeof db.connect === "function" ? await db.connect() : db;
  try {
    if (typeof client.query === "function" && typeof client.release === "function") {
      await client.query("BEGIN");
    }

    if (requestedBranchCodes && requestedBranchCodes.length > 0) {
      await client.query(
        `
          DELETE FROM ordering.stock_recommendation_snapshots
          WHERE anchor_date = $1::date
            AND target_days = $2
            AND branch_code = ANY($3::text[])
        `,
        [liveDataset.anchorDate, targetDays, requestedBranchCodes],
      );
    } else {
      await client.query(
        `
          DELETE FROM ordering.stock_recommendation_snapshots
          WHERE anchor_date = $1::date
            AND target_days = $2
        `,
        [liveDataset.anchorDate, targetDays],
      );
    }

    const chunkSize = 500;
    for (let index = 0; index < rowsToPersist.length; index += chunkSize) {
      const chunk = rowsToPersist.slice(index, index + chunkSize).map((row) => ({
        anchor_date: liveDataset.anchorDate,
        target_days: targetDays,
        branch_code: row.branchCode,
        branch_label: row.branchLabel,
        product_code: row.productCode,
        product_name_thai: row.productNameThai,
        product_name_eng: row.productNameEng,
        barcode: row.barcode,
        unit: row.unit,
        current_stock: row.currentStock,
        unit_cost_avg: row.unitCostAvg,
        inventory_value: row.inventoryValue,
        sold_qty_30d: row.soldQty30d,
        sold_qty_90d: row.soldQty90d,
        sold_qty_same_period_last_year: row.soldQtySamePeriodLastYear,
        adu_30: row.adu30,
        adu_90: row.adu90,
        trend_ratio_30_vs_90: row.trendRatio30Vs90,
        adjusted_adu: row.adjustedAdu,
        incoming_po_qty_total: row.incomingPoQtyTotal,
        incoming_po_allocation_qty: row.incomingPoAllocationQty,
        effective_stock: row.effectiveStock,
        current_days_cover: row.currentDaysCover,
        effective_days_cover: row.effectiveDaysCover,
        target_qty: row.targetQty,
        surplus_qty: row.surplusQty,
        shortage_qty: row.shortageQty,
        transfer_plan_qty: row.transferPlanQty,
        purchase_qty: row.purchaseQty,
        priority_score: row.priorityScore,
        action: row.action,
        recommendation_reason: row.recommendationReason,
        recommendation_flags: row.flags || [],
        donors_json: row.donors || [],
        primary_suggested_donor_branch_code: row.primarySuggestedDonorBranchCode,
        synced_at: row.syncedAt,
        generated_at: generatedAt,
      }));

      await client.query(
        `
          INSERT INTO ordering.stock_recommendation_snapshots (
            anchor_date, target_days, branch_code, branch_label, product_code,
            product_name_thai, product_name_eng, barcode, unit,
            current_stock, unit_cost_avg, inventory_value,
            sold_qty_30d, sold_qty_90d, sold_qty_same_period_last_year,
            adu_30, adu_90, trend_ratio_30_vs_90, adjusted_adu,
            incoming_po_qty_total, incoming_po_allocation_qty, effective_stock,
            current_days_cover, effective_days_cover,
            target_qty, surplus_qty, shortage_qty,
            transfer_plan_qty, purchase_qty, priority_score,
            action, recommendation_reason, recommendation_flags, donors_json,
            primary_suggested_donor_branch_code, synced_at, generated_at
          )
          SELECT
            x.anchor_date, x.target_days, x.branch_code, x.branch_label, x.product_code,
            x.product_name_thai, x.product_name_eng, x.barcode, x.unit,
            x.current_stock, x.unit_cost_avg, x.inventory_value,
            x.sold_qty_30d, x.sold_qty_90d, x.sold_qty_same_period_last_year,
            x.adu_30, x.adu_90, x.trend_ratio_30_vs_90, x.adjusted_adu,
            x.incoming_po_qty_total, x.incoming_po_allocation_qty, x.effective_stock,
            x.current_days_cover, x.effective_days_cover,
            x.target_qty, x.surplus_qty, x.shortage_qty,
            x.transfer_plan_qty, x.purchase_qty, x.priority_score,
            x.action, x.recommendation_reason, x.recommendation_flags, x.donors_json,
            x.primary_suggested_donor_branch_code, x.synced_at, x.generated_at
          FROM jsonb_to_recordset($1::jsonb) AS x(
            anchor_date date,
            target_days integer,
            branch_code text,
            branch_label text,
            product_code text,
            product_name_thai text,
            product_name_eng text,
            barcode text,
            unit text,
            current_stock numeric,
            unit_cost_avg numeric,
            inventory_value numeric,
            sold_qty_30d numeric,
            sold_qty_90d numeric,
            sold_qty_same_period_last_year numeric,
            adu_30 numeric,
            adu_90 numeric,
            trend_ratio_30_vs_90 numeric,
            adjusted_adu numeric,
            incoming_po_qty_total numeric,
            incoming_po_allocation_qty numeric,
            effective_stock numeric,
            current_days_cover numeric,
            effective_days_cover numeric,
            target_qty numeric,
            surplus_qty numeric,
            shortage_qty numeric,
            transfer_plan_qty numeric,
            purchase_qty numeric,
            priority_score numeric,
            action text,
            recommendation_reason text,
            recommendation_flags jsonb,
            donors_json jsonb,
            primary_suggested_donor_branch_code text,
            synced_at timestamptz,
            generated_at timestamptz
          )
        `,
        [JSON.stringify(chunk)],
      );
    }

    if (typeof client.query === "function" && typeof client.release === "function") {
      await client.query("COMMIT");
    }
  } catch (error) {
    if (typeof client.query === "function" && typeof client.release === "function") {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    if (typeof client.release === "function") {
      client.release();
    }
  }

  return {
    anchorDate: liveDataset.anchorDate,
    targetDays,
    generatedAt,
    rowCount: rowsToPersist.length,
    branchCount: new Set(rowsToPersist.map((row) => row.branchCode)).size,
    source: "live_to_snapshot",
  };
}

module.exports = {
  listStockRecommendations,
  getStockRecommendationSummary,
  getStockRecommendationDetail,
  refreshStockRecommendationSnapshots,
};
