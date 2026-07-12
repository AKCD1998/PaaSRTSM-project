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

function mapFocusProductRow(row) {
  return {
    id: Number(row.id),
    productCode: row.product_code,
    focusType: row.focus_type,
    targetQty: Number(row.target_qty),
    dateFrom: row.date_from,
    dateTo: row.date_to,
    branchCodesRaw: row.branch_codes || null, // null = defaulted to all active branches
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

// Sold qty per branch for a product within a date range, from raw AdaPOS evidence.
async function fetchSoldQtyByBranch(db, productCode, dateFrom, dateTo) {
  const result = await db.query(
    `SELECT
       sh.branch_code,
       SUM(COALESCE(sl.qty_base, sl.qty * NULLIF(sl.stock_factor, 0), sl.qty, 0))::numeric AS sold_qty
     FROM ada.sales_lines sl
     JOIN ada.sales_headers sh
       ON sh.branch_code = sl.branch_code
      AND sh.doc_no = sl.doc_no
     WHERE sl.product_code = $1
       AND sh.doc_date BETWEEN $2 AND $3
       AND LOWER(COALESCE(sh.paid_status, '')) IN ('1', 'true', 't', 'paid', 'success', 'y')
     GROUP BY sh.branch_code`,
    [productCode, dateFrom, dateTo],
  );
  const map = {};
  for (const row of result.rows) {
    map[row.branch_code] = Number(row.sold_qty);
  }
  return map;
}

function computeStatus(focusType, targetQty, soldByBranch, branchCodes) {
  const relevantBranches = branchCodes;
  const totalSold = relevantBranches.reduce((sum, code) => sum + (soldByBranch[code] || 0), 0);

  if (focusType === "salesperson") {
    return {
      totalSold,
      achieved: totalSold >= targetQty,
      branchAchieved: null,
    };
  }

  // pharmacist / store_manager / group_manager: each branch judged independently
  // against the same target_qty.
  const branchAchieved = {};
  for (const code of relevantBranches) {
    branchAchieved[code] = (soldByBranch[code] || 0) >= targetQty;
  }
  const allBranchesAchieved = relevantBranches.length > 0
    && relevantBranches.every((code) => branchAchieved[code]);

  return {
    totalSold,
    // group_manager success requires every branch to individually clear the target;
    // pharmacist/store_manager have no combined verdict (each branch stands alone).
    achieved: focusType === "group_manager" ? allBranchesAchieved : null,
    branchAchieved,
  };
}

async function attachProgress(db, focusRows, allActiveBranchCodes) {
  const productCodes = [...new Set(focusRows.map((row) => row.product_code))];
  const nameMap = await fetchProductNames(db, productCodes);

  const results = [];
  for (const row of focusRows) {
    const branchCodes = normalizeBranchCodes(row.branch_codes) || allActiveBranchCodes;
    const soldByBranch = await fetchSoldQtyByBranch(db, row.product_code, row.date_from, row.date_to);
    const status = computeStatus(row.focus_type, Number(row.target_qty), soldByBranch, branchCodes);

    results.push({
      ...mapFocusProductRow(row),
      productName: nameMap.get(row.product_code) || null,
      branchCodes,
      soldByBranch,
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
  const note = normalizeNullableText(fields.note, NOTE_MAX_CHARS);
  const createdBy = normalizeNullableText(fields.createdBy);

  const inserted = await db.query(
    `INSERT INTO focus.focus_products
       (product_code, focus_type, target_qty, date_from, date_to, branch_codes, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [productCode, focusType, targetQty, dateFrom, dateTo, branchCodes, note, createdBy],
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
  const note = fields.note === undefined ? before.note : normalizeNullableText(fields.note, NOTE_MAX_CHARS);
  const isActive = fields.isActive === undefined ? before.is_active : Boolean(fields.isActive);

  await db.query(
    `UPDATE focus.focus_products
     SET product_code = $2, focus_type = $3, target_qty = $4, date_from = $5, date_to = $6,
         branch_codes = $7, note = $8, is_active = $9, updated_at = now()
     WHERE id = $1`,
    [id, productCode, focusType, targetQty, dateFrom, dateTo, branchCodes, note, isActive],
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
