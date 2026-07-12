"use strict";

const FOCUS_TYPES = new Set(["salesperson", "pharmacist", "store_manager", "group_manager"]);
const NOTE_MAX_CHARS = 2000;

function createHttpError(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeNullableText(value, maxChars = null) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (!maxChars || normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars);
}

function normalizeDate(value, field) {
  const text = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createHttpError(`${field} must be a date in YYYY-MM-DD format.`, 400);
  }
  return text;
}

function normalizeBranchCodes(value) {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    throw createHttpError("branchCodes must be an array of branch codes.", 400);
  }
  const codes = value.map((code) => normalizeText(code)).filter(Boolean);
  return codes.length > 0 ? codes : null;
}

// {branch_code: target_qty} overrides — only meaningful for group_manager
// rows, where each branch can have its own distinct target for the same
// product. Absent/empty branches fall back to the row's global target_qty.
function normalizeBranchTargets(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw createHttpError("branchTargets must be an object of branchCode -> targetQty.", 400);
  }
  const entries = [];
  for (const [rawCode, rawQty] of Object.entries(value)) {
    const code = normalizeText(rawCode);
    if (!code) continue;
    const qty = Number(rawQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw createHttpError(`branchTargets.${code} must be a positive number.`, 400);
    }
    entries.push([code, qty]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

// "Today" for freeze comparisons — Bangkok wall-clock date, matching the
// convention used elsewhere in the sync pipeline (adapos-sync/src/transform.js).
function todayBangkokIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

// pg returns DATE columns as either a JS Date or a "YYYY-MM-DD" string
// depending on driver config — normalize to the date-only string either way.
function toIsoDateOnly(value) {
  if (!value) return "";
  return value instanceof Date
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(value)
    : String(value).slice(0, 10);
}

function mapFocusProductRow(row) {
  return {
    id: Number(row.id),
    productCode: row.product_code,
    focusType: row.focus_type,
    targetQty: Number(row.target_qty),
    dateFrom: row.date_from,
    dateTo: row.date_to,
    branchCodesRaw: row.branch_codes || null, // null = defaulted to all active branches
    branchTargets: row.branch_targets || null, // per-branch target overrides (group_manager only)
    assignedPersonName: row.assigned_person_name || null,
    note: row.note,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchFocusProductRow(db, id) {
  const result = await db.query(
    `SELECT * FROM focus.focus_products WHERE id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

async function fetchActiveBranchCodes(db) {
  const result = await db.query(
    `SELECT branch_code FROM core.branches WHERE is_active = TRUE ORDER BY branch_code ASC`,
  );
  return result.rows.map((row) => row.branch_code);
}

async function fetchProductNames(db, productCodes) {
  if (!productCodes.length) return new Map();
  const result = await db.query(
    `SELECT
       pt.product_code,
       COALESCE(bss.product_name_thai, ap.product_name_th, ap.product_name, s.display_name) AS product_name
     FROM (SELECT DISTINCT unnest($1::text[]) AS product_code) pt
     LEFT JOIN ada.branch_stock_snapshots bss ON bss.product_code = pt.product_code
     LEFT JOIN ada.products ap                ON ap.product_code = pt.product_code
     LEFT JOIN public.skus s                  ON s.company_code   = pt.product_code`,
    [productCodes],
  );
  const map = new Map();
  for (const row of result.rows) {
    map.set(row.product_code, row.product_name || null);
  }
  return map;
}

// Sold qty per branch for a batch of products sharing one date range, from raw
// AdaPOS evidence — one query per distinct date range rather than one per row,
// since sequential per-row queries (the original design) took minutes once
// dozens of focus rows existed. Returns Map<productCode, {branchCode: qty}>.
async function fetchSoldQtyBatch(db, productCodes, dateFrom, dateTo) {
  if (!productCodes.length) return new Map();
  const result = await db.query(
    `SELECT
       sl.product_code,
       sh.branch_code,
       SUM(COALESCE(sl.qty_base, COALESCE(sl.qty, 0) * COALESCE(sl.stock_factor, 1), COALESCE(sl.qty, 0)))::numeric AS sold_qty
     FROM ada.sales_lines sl
     JOIN ada.sales_headers sh
       ON sh.branch_code = sl.branch_code
      AND sh.doc_no = sl.doc_no
     WHERE sl.product_code = ANY($1::text[])
       AND sh.doc_date BETWEEN $2::date AND $3::date
       AND COALESCE(NULLIF(sh.raw_payload->>'FTShdDocType', ''), '1') = '1'
       AND COALESCE(NULLIF(sh.raw_payload->>'FTShdStaPaid', ''), sh.paid_status, '') = '3'
     GROUP BY sl.product_code, sh.branch_code`,
    [productCodes, dateFrom, dateTo],
  );
  const map = new Map();
  for (const row of result.rows) {
    if (!map.has(row.product_code)) map.set(row.product_code, {});
    map.get(row.product_code)[row.branch_code] = Number(row.sold_qty);
  }
  return map;
}

function computeStatus(focusType, targetQty, soldByBranch, branchCodes, branchTargets) {
  const relevantBranches = branchCodes;
  const totalSold = relevantBranches.reduce((sum, code) => sum + (soldByBranch[code] || 0), 0);

  if (focusType === "salesperson") {
    return {
      totalSold,
      achieved: totalSold >= targetQty,
      branchAchieved: null,
      branchTargetsEffective: null,
    };
  }

  // pharmacist / store_manager / group_manager: each branch judged independently.
  // group_manager may have a distinct target per branch (branchTargets); the
  // other two types always compare against the row's single target_qty.
  const branchAchieved = {};
  const branchTargetsEffective = {};
  for (const code of relevantBranches) {
    const effectiveTarget = branchTargets?.[code] ?? targetQty;
    branchTargetsEffective[code] = effectiveTarget;
    branchAchieved[code] = (soldByBranch[code] || 0) >= effectiveTarget;
  }
  const allBranchesAchieved = relevantBranches.length > 0
    && relevantBranches.every((code) => branchAchieved[code]);

  return {
    totalSold,
    // group_manager success requires every branch to individually clear its target;
    // pharmacist/store_manager have no combined verdict (each branch stands alone).
    achieved: focusType === "group_manager" ? allBranchesAchieved : null,
    branchAchieved,
    branchTargetsEffective,
  };
}

// Once a focus row's date_to has passed, snapshot its sold-qty progress once
// and lock it — protects the historical/HR record from being silently
// rewritten by late-arriving AdaPOS corrections (voids/refunds synced after
// month-end). Uses a conditional UPDATE so concurrent reads can't double-write.
async function freezeFocusProduct(db, id, soldByBranch, totalSold) {
  const result = await db.query(
    `UPDATE focus.focus_products
     SET frozen_sold_by_branch = $2::jsonb, frozen_total_sold = $3, frozen_at = now()
     WHERE id = $1 AND frozen_at IS NULL
     RETURNING frozen_sold_by_branch, frozen_total_sold, frozen_at`,
    [id, JSON.stringify(soldByBranch), totalSold],
  );
  return result.rows[0] || null;
}

async function attachProgress(db, focusRows, allActiveBranchCodes) {
  const productCodes = [...new Set(focusRows.map((row) => row.product_code))];
  const nameMap = await fetchProductNames(db, productCodes);
  const today = todayBangkokIso();

  // Frozen rows never need a live sales query. Unfrozen rows are grouped by
  // (dateFrom, dateTo) — usually just one group, since most focus rows share
  // a month's date range — so we run one batched query per distinct range
  // instead of one query per row.
  const unfrozenRows = focusRows.filter((row) => !row.frozen_at);
  const rangeGroups = new Map(); // "dateFrom|dateTo" -> Set<productCode>
  for (const row of unfrozenRows) {
    const key = `${toIsoDateOnly(row.date_from)}|${toIsoDateOnly(row.date_to)}`;
    if (!rangeGroups.has(key)) rangeGroups.set(key, new Set());
    rangeGroups.get(key).add(row.product_code);
  }
  const batchByRange = new Map(); // "dateFrom|dateTo" -> Map<productCode, {branchCode: qty}>
  for (const [key, codes] of rangeGroups) {
    const [dateFrom, dateTo] = key.split("|");
    batchByRange.set(key, await fetchSoldQtyBatch(db, [...codes], dateFrom, dateTo));
  }

  const results = [];
  for (const row of focusRows) {
    const branchCodes = normalizeBranchCodes(row.branch_codes) || allActiveBranchCodes;
    let soldByBranch;
    let isFrozen = false;
    let frozenAt = row.frozen_at || null;

    if (row.frozen_at) {
      soldByBranch = row.frozen_sold_by_branch || {};
      isFrozen = true;
    } else {
      const key = `${toIsoDateOnly(row.date_from)}|${toIsoDateOnly(row.date_to)}`;
      soldByBranch = batchByRange.get(key)?.get(row.product_code) || {};
      if (toIsoDateOnly(row.date_to) < today) {
        const totalSold = Object.values(soldByBranch).reduce((sum, v) => sum + v, 0);
        const frozen = await freezeFocusProduct(db, row.id, soldByBranch, totalSold);
        if (frozen) {
          soldByBranch = frozen.frozen_sold_by_branch || soldByBranch;
          frozenAt = frozen.frozen_at;
        }
        isFrozen = true;
      }
    }

    const status = computeStatus(row.focus_type, Number(row.target_qty), soldByBranch, branchCodes, row.branch_targets || null);

    results.push({
      ...mapFocusProductRow(row),
      productName: nameMap.get(row.product_code) || null,
      branchCodes,
      soldByBranch,
      isFrozen,
      frozenAt,
      ...status,
    });
  }
  return results;
}

async function listFocusProducts(db, { includeInactive = false } = {}) {
  const sql = includeInactive
    ? `SELECT * FROM focus.focus_products ORDER BY created_at DESC`
    : `SELECT * FROM focus.focus_products WHERE is_active = TRUE ORDER BY created_at DESC`;
  const result = await db.query(sql);
  const activeBranchCodes = await fetchActiveBranchCodes(db);
  return attachProgress(db, result.rows, activeBranchCodes);
}

async function createFocusProduct(db, fields) {
  const productCode = normalizeText(fields.productCode);
  if (!productCode) throw createHttpError("productCode is required.", 400);

  const focusType = normalizeText(fields.focusType);
  if (!FOCUS_TYPES.has(focusType)) throw createHttpError("focusType is invalid.", 400);

  const targetQty = Number(fields.targetQty);
  if (!Number.isFinite(targetQty) || targetQty <= 0) {
    throw createHttpError("targetQty must be a positive number.", 400);
  }

  const dateFrom = normalizeDate(fields.dateFrom, "dateFrom");
  const dateTo = normalizeDate(fields.dateTo, "dateTo");
  if (dateTo < dateFrom) throw createHttpError("dateTo must not be before dateFrom.", 400);

  const branchCodes = normalizeBranchCodes(fields.branchCodes);
  const branchTargets = normalizeBranchTargets(fields.branchTargets);
  const note = normalizeNullableText(fields.note, NOTE_MAX_CHARS);
  const createdBy = normalizeNullableText(fields.createdBy);
  const assignedPersonName = normalizeNullableText(fields.assignedPersonName);

  const inserted = await db.query(
    `INSERT INTO focus.focus_products
       (product_code, focus_type, target_qty, date_from, date_to, branch_codes, note, created_by, assigned_person_name, branch_targets)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING id`,
    [productCode, focusType, targetQty, dateFrom, dateTo, branchCodes, note, createdBy, assignedPersonName, branchTargets ? JSON.stringify(branchTargets) : null],
  );
  const row = await fetchFocusProductRow(db, inserted.rows[0].id);
  const activeBranchCodes = await fetchActiveBranchCodes(db);
  const [withProgress] = await attachProgress(db, [row], activeBranchCodes);
  return withProgress;
}

async function updateFocusProduct(db, id, fields) {
  const before = await fetchFocusProductRow(db, id);
  if (!before) throw createHttpError("Focus product not found.", 404);

  const productCode = fields.productCode === undefined ? before.product_code : normalizeText(fields.productCode);
  if (!productCode) throw createHttpError("productCode is required.", 400);

  const focusType = fields.focusType === undefined ? before.focus_type : normalizeText(fields.focusType);
  if (!FOCUS_TYPES.has(focusType)) throw createHttpError("focusType is invalid.", 400);

  const targetQty = fields.targetQty === undefined ? Number(before.target_qty) : Number(fields.targetQty);
  if (!Number.isFinite(targetQty) || targetQty <= 0) {
    throw createHttpError("targetQty must be a positive number.", 400);
  }

  const dateFrom = fields.dateFrom === undefined ? before.date_from : normalizeDate(fields.dateFrom, "dateFrom");
  const dateTo = fields.dateTo === undefined ? before.date_to : normalizeDate(fields.dateTo, "dateTo");
  if (dateTo < dateFrom) throw createHttpError("dateTo must not be before dateFrom.", 400);

  const branchCodes = fields.branchCodes === undefined ? before.branch_codes : normalizeBranchCodes(fields.branchCodes);
  const branchTargets = fields.branchTargets === undefined ? before.branch_targets : normalizeBranchTargets(fields.branchTargets);
  const note = fields.note === undefined ? before.note : normalizeNullableText(fields.note, NOTE_MAX_CHARS);
  const isActive = fields.isActive === undefined ? before.is_active : Boolean(fields.isActive);
  const assignedPersonName = fields.assignedPersonName === undefined
    ? before.assigned_person_name
    : normalizeNullableText(fields.assignedPersonName);

  // Editing the date range invalidates any existing freeze snapshot — it was
  // computed for the old range and no longer applies.
  const dateRangeChanged = dateFrom !== toIsoDateOnly(before.date_from) || dateTo !== toIsoDateOnly(before.date_to);

  await db.query(
    `UPDATE focus.focus_products
     SET product_code = $2, focus_type = $3, target_qty = $4, date_from = $5, date_to = $6,
         branch_codes = $7, note = $8, is_active = $9, assigned_person_name = $10, branch_targets = $11::jsonb, updated_at = now()
         ${dateRangeChanged ? ", frozen_sold_by_branch = NULL, frozen_total_sold = NULL, frozen_at = NULL" : ""}
     WHERE id = $1`,
    [id, productCode, focusType, targetQty, dateFrom, dateTo, branchCodes, note, isActive, assignedPersonName, branchTargets ? JSON.stringify(branchTargets) : null],
  );
  const row = await fetchFocusProductRow(db, id);
  const activeBranchCodes = await fetchActiveBranchCodes(db);
  const [withProgress] = await attachProgress(db, [row], activeBranchCodes);
  return withProgress;
}

async function deactivateFocusProduct(db, id) {
  const before = await fetchFocusProductRow(db, id);
  if (!before) throw createHttpError("Focus product not found.", 404);
  await db.query(
    `UPDATE focus.focus_products SET is_active = FALSE, updated_at = now() WHERE id = $1`,
    [id],
  );
}

module.exports = {
  FOCUS_TYPES,
  createHttpError,
  listFocusProducts,
  createFocusProduct,
  updateFocusProduct,
  deactivateFocusProduct,
  mapFocusProductRow,
  attachProgress,
  fetchFocusProductRow,
};
