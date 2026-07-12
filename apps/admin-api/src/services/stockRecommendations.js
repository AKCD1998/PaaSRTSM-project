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
    return value.toISOString().slice(0, 10);
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

async function resolveAnchorDate(db, filters) {
  if (filters.dateTo) {
    return filters.dateTo;
  }

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
    return new Date().toISOString().slice(0, 10);
  }
  return normalizedLatestDate;
}

async function loadCurrentStockByProduct(db, { search }) {
  const normalizedSearch = normalizeLowerText(search || "");
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
      WHERE (
        $1::text = ''
        OR bs.product_code ILIKE '%' || $1 || '%'
        OR COALESCE(bs.product_name_thai, p.product_name_th, bs.product_name_eng, p.product_name, '') ILIKE '%' || $1 || '%'
        OR COALESCE(bs.barcode, pb.barcode, '') ILIKE '%' || $1 || '%'
      )
      ORDER BY bs.product_code ASC
    `,
    [normalizedSearch],
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

async function loadSalesAggByProductBranch(db, { productCodes, branchCodes, anchorDate }) {
  if (!Array.isArray(productCodes) || productCodes.length === 0 || !Array.isArray(branchCodes) || branchCodes.length === 0) {
    return new Map();
  }

  const result = await db.query(
    `
      SELECT
        product_code,
        branch_code,
        COALESCE(SUM(sold_qty_base) FILTER (WHERE period_days = 30), 0)::numeric AS sold_qty_30d,
        COALESCE(SUM(sold_qty_base) FILTER (WHERE period_days = 90), 0)::numeric AS sold_qty_90d
      FROM analytics.product_sales_summary_periods
      WHERE branch_code = ANY($1::text[])
        AND product_code = ANY($2::text[])
        AND period_end = $3::date
        AND period_days IN (30, 90)
      GROUP BY product_code, branch_code
    `,
    [branchCodes, productCodes, anchorDate],
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

      const primaryDonor = donors[0] || null;
      const recommendationReason = buildRecommendationReason(metric, action, donors, purchaseQty);
      const priorityScore = round(metric.shortageQty * (metric.unitCostAvg || 0), 2);

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

function buildCompanySummary(rows) {
  const listSummary = buildListSummary(rows);
  const coverRows = rows.filter((row) => row.currentDaysCover != null);
  const averageDaysCover = coverRows.length
    ? round(coverRows.reduce((sum, row) => sum + row.currentDaysCover, 0) / coverRows.length, 2)
    : null;

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
    const coverRows = branchRows.filter((row) => row.currentDaysCover != null);
    return {
      branchCode: branch.branchCode,
      label: branch.branchName || `สาขา ${branch.branchCode}`,
      currentInventoryValue: round(branchRows.reduce((sum, row) => sum + numberOrZero(row.inventoryValue), 0), 2),
      averageDaysCover: coverRows.length
        ? round(coverRows.reduce((sum, row) => sum + row.currentDaysCover, 0) / coverRows.length, 2)
        : null,
      recommendTransferCount: branchRows.filter((row) => row.action === "TRANSFER_IN").length,
      recommendPurchaseCount: branchRows.filter((row) => row.action === "PURCHASE" || row.action === "TRANSFER_AND_PURCHASE").length,
    };
  });
}

async function computeRecommendationDataset(db, auth, filters = {}) {
  const normalizedFilters = normalizeRecommendationFilters(filters);
  const scope = await resolveEffectiveBranchScope(db, auth, normalizedFilters.branchCode);
  const anchorDate = await resolveAnchorDate(db, normalizedFilters);
  const policy = buildRecommendationPolicy(normalizedFilters, anchorDate);
  const branchNameByCode = new Map(scope.activeBranches.map((branch) => [branch.branchCode, branch.branchName]));

  const stockRows = await loadCurrentStockByProduct(db, { search: normalizedFilters.search });
  const productCodes = stockRows.map((row) => row.productCode);
  const salesAggByProductBranch = await loadSalesAggByProductBranch(db, {
    productCodes,
    branchCodes: scope.activeBranchCodes,
    anchorDate,
  });
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
  };
}

async function listStockRecommendations({ db, auth, filters = {} }) {
  const dataset = await computeRecommendationDataset(db, auth, filters);
  const filteredRows = sortRows(applyActionFilter(dataset.rows, dataset.filters.action), dataset.filters.sort);
  const pagedRows = filteredRows.slice(dataset.filters.offset, dataset.filters.offset + dataset.filters.pageSize);
  const summary = buildListSummary(filteredRows);

  return {
    branchCode: dataset.scope.branchCode,
    targetDays: dataset.policy.targetDays,
    generatedAt: new Date().toISOString(),
    policy: dataset.policy,
    summary,
    pagination: {
      page: dataset.filters.page,
      pageSize: dataset.filters.pageSize,
      total: filteredRows.length,
    },
    rows: pagedRows,
    meta: {
      isAllBranches: dataset.scope.isAllBranches,
      activeBranchCodes: dataset.scope.activeBranchCodes,
      branchCodesInScope: dataset.scope.branchCodes,
      anchorDate: dataset.anchorDate,
    },
  };
}

async function getStockRecommendationSummary({ db, auth, filters = {} }) {
  const dataset = await computeRecommendationDataset(db, auth, {
    ...filters,
    branchCode: filters.branchCode || "all",
  });

  return {
    branchCode: dataset.scope.branchCode,
    targetDays: dataset.policy.targetDays,
    generatedAt: new Date().toISOString(),
    policy: dataset.policy,
    company: buildCompanySummary(dataset.rows),
    branches: buildBranchSummaries(dataset.rows, dataset.scope.activeBranches),
    meta: {
      isAllBranches: dataset.scope.isAllBranches,
      anchorDate: dataset.anchorDate,
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

  const row = dataset.rows.find(
    (candidate) => candidate.branchCode === dataset.scope.branchCodes[0] && candidate.productCode === normalizedProductCode,
  ) || null;

  return {
    branchCode: dataset.scope.branchCode,
    productCode: normalizedProductCode,
    targetDays: dataset.policy.targetDays,
    generatedAt: new Date().toISOString(),
    policy: dataset.policy,
    recommendation: row,
    branchRequest: null,
    adminDecision: null,
    meta: {
      anchorDate: dataset.anchorDate,
    },
  };
}

module.exports = {
  listStockRecommendations,
  getStockRecommendationSummary,
  getStockRecommendationDetail,
};
