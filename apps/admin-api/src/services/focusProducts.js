"use strict";

const FOCUS_TYPES = new Set(["salesperson", "pharmacist", "store_manager", "group_manager"]);
const PUBLICATION_STATUSES = new Set(["draft", "published", "scheduled"]);
const REQUIRED_FOCUS_BRANCHES = ["001", "003", "004", "005"];
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

const MAX_PRODUCT_CODES = 10;

// A focus row may cover several product codes that share ONE target: staff can
// sell any mix of them as long as the combined quantity clears the number (e.g.
// Vicks Vapodrop honey-lemon + orange against a single target of 50). The first
// element stays the leading/display code and must equal `product_code` — see the
// focus_products_product_code_leads CHECK added in migration 061.
function normalizeProductCodes(rawCodes, leadCode) {
  const list = Array.isArray(rawCodes) ? rawCodes : (rawCodes == null ? [] : [rawCodes]);
  const seen = new Set();
  const codes = [];
  for (const value of [leadCode, ...list]) {
    const code = normalizeText(value);
    if (!code) continue;
    const key = code.toLowerCase();
    if (seen.has(key)) continue; // same product listed twice would double-count sales
    seen.add(key);
    codes.push(code);
  }
  if (!codes.length) throw createHttpError("productCode is required.", 400);
  if (codes.length > MAX_PRODUCT_CODES) {
    throw createHttpError(`รวมสินค้าได้สูงสุด ${MAX_PRODUCT_CODES} รหัสต่อหนึ่งเป้า`, 400);
  }
  return codes;
}

// Rows read before migration 061 ran (or from tests using older fixtures) may
// have no array yet; fall back to the single legacy column.
function rowProductCodes(row) {
  return row.product_codes?.length ? row.product_codes : [row.product_code];
}

function normalizeDate(value, field) {
  const text = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createHttpError(`${field} must be a date in YYYY-MM-DD format.`, 400);
  }
  return text;
}

function normalizeScheduledPublishAt(value) {
  const text = normalizeText(value);
  if (!text) throw createHttpError("scheduledPublishAt is required for scheduled publication.", 400);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError("scheduledPublishAt must be a valid date and time.", 400);
  }
  if (parsed.getTime() <= Date.now()) {
    throw createHttpError("scheduledPublishAt must be in the future.", 400);
  }
  return parsed.toISOString();
}

function normalizePublication(fields, before = null) {
  const status = fields.publicationStatus === undefined
    ? (before?.publication_status || "published")
    : normalizeText(fields.publicationStatus);
  if (!PUBLICATION_STATUSES.has(status)) {
    throw createHttpError("publicationStatus is invalid.", 400);
  }

  if (status === "scheduled") {
    const rawSchedule = fields.scheduledPublishAt === undefined
      ? before?.scheduled_publish_at
      : fields.scheduledPublishAt;
    if (fields.publicationStatus === undefined && fields.scheduledPublishAt === undefined && rawSchedule) {
      return { status, scheduledPublishAt: rawSchedule, publishedAt: null };
    }
    return {
      status,
      scheduledPublishAt: normalizeScheduledPublishAt(rawSchedule),
      publishedAt: null,
    };
  }

  if (status === "published") {
    return {
      status,
      scheduledPublishAt: null,
      publishedAt: before?.publication_status === "published" && before?.published_at
        ? before.published_at
        : new Date(),
    };
  }

  return { status, scheduledPublishAt: null, publishedAt: null };
}

function normalizeBranchCodes(value) {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    throw createHttpError("branchCodes must be an array of branch codes.", 400);
  }
  const codes = value.map((code) => normalizeText(code)).filter(Boolean);
  return codes.length > 0 ? codes : null;
}

// {branch_code: target_qty} overrides — lets a branch have its own distinct
// target for the same product (group_manager: differing per-branch targets
// that must each be cleared; pharmacist/store_manager: a branch whose real
// target isn't known yet, set to 0 as an explicit placeholder). Absent
// branches fall back to the row's global target_qty. Zero is allowed here
// (unlike the row's own target_qty) specifically to represent "not set yet".
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
    if (!Number.isFinite(qty) || qty < 0) {
      throw createHttpError(`branchTargets.${code} must be zero or a positive number.`, 400);
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
  const scheduledPublishAt = row.scheduled_publish_at || null;
  const scheduleHasArrived = row.publication_status === "scheduled"
    && scheduledPublishAt
    && new Date(scheduledPublishAt).getTime() <= Date.now();
  return {
    id: Number(row.id),
    productCode: row.product_code,
    productCodes: rowProductCodes(row),
    focusType: row.focus_type,
    targetQty: Number(row.target_qty),
    dateFrom: row.date_from,
    dateTo: row.date_to,
    branchCodesRaw: row.branch_codes || null, // null = defaulted to all active branches
    branchTargets: row.branch_targets || null, // per-branch target overrides (group_manager only)
    assignedPersonName: row.assigned_person_name || null,
    assignedStaffId: row.assigned_staff_id == null ? null : String(row.assigned_staff_id),
    note: row.note,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publicationStatus: row.publication_status || "published",
    publicationState: scheduleHasArrived ? "published" : (row.publication_status || "published"),
    scheduledPublishAt,
    publishedAt: row.published_at || (scheduleHasArrived ? scheduledPublishAt : null),
    publishedBy: row.published_by || null,
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

// Collapse a multi-code focus row into one per-branch total. Any mix of the
// grouped codes counts toward the same target, so the branch figure is their sum.
function sumSoldAcrossCodes(codeMap, productCodes) {
  const totals = {};
  if (!codeMap) return totals;
  for (const code of productCodes) {
    const perBranch = codeMap.get(code);
    if (!perBranch) continue;
    for (const [branchCode, qty] of Object.entries(perBranch)) {
      totals[branchCode] = (totals[branchCode] || 0) + qty;
    }
  }
  return totals;
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

async function attachProgress(db, focusRows, allActiveBranchCodes, timings = null) {
  const mark = (label, start) => {
    if (timings) timings.push({ label, ms: Date.now() - start });
  };

  let t = Date.now();
  const productCodes = [...new Set(focusRows.flatMap(rowProductCodes))];
  const nameMap = await fetchProductNames(db, productCodes);
  mark("fetchProductNames", t);
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
    for (const code of rowProductCodes(row)) rangeGroups.get(key).add(code);
  }
  const batchByRange = new Map(); // "dateFrom|dateTo" -> Map<productCode, {branchCode: qty}>
  for (const [key, codes] of rangeGroups) {
    t = Date.now();
    const [dateFrom, dateTo] = key.split("|");
    batchByRange.set(key, await fetchSoldQtyBatch(db, [...codes], dateFrom, dateTo));
    mark(`fetchSoldQtyBatch(${codes.size} codes, ${key})`, t);
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
      soldByBranch = sumSoldAcrossCodes(batchByRange.get(key), rowProductCodes(row));
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
      // Every code in the group, so the UI can list each product sharing the target.
      products: rowProductCodes(row).map((code) => ({
        productCode: code,
        productName: nameMap.get(code) || null,
      })),
      branchCodes,
      soldByBranch,
      isFrozen,
      frozenAt,
      ...status,
    });
  }
  return results;
}

async function listFocusProducts(db, { includeInactive = false, debug = false } = {}) {
  const timings = debug ? [] : null;
  const mark = (label, start) => {
    if (timings) timings.push({ label, ms: Date.now() - start });
  };

  let t = Date.now();
  const sql = includeInactive
    ? `SELECT * FROM focus.focus_products ORDER BY created_at DESC`
    : `SELECT * FROM focus.focus_products
       WHERE is_active = TRUE
         AND (publication_status = 'published'
           OR (publication_status = 'scheduled' AND scheduled_publish_at <= now()))
       ORDER BY created_at DESC`;
  const result = await db.query(sql);
  mark("select focus_products", t);

  t = Date.now();
  const activeBranchCodes = await fetchActiveBranchCodes(db);
  mark("fetchActiveBranchCodes", t);

  const rows = await attachProgress(db, result.rows, activeBranchCodes, timings);
  return debug ? { rows, timings } : rows;
}

async function createFocusProduct(db, fields) {
  // New rows must be operationally complete even when saved as drafts.  Keep
  // this at the service boundary so API callers cannot bypass the admin UI.
  const [completeFields] = validateBulkRows([fields]);
  fields = completeFields;
  const productCodes = normalizeProductCodes(fields.productCodes, fields.productCode);
  const productCode = productCodes[0];

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
  let assignedPersonName = null;
  let assignedStaffId = null;
  if (focusType === "salesperson") {
    const staffId = Number(fields.assignedStaffId);
    if (!Number.isInteger(staffId) || staffId <= 0) throw createHttpError("ต้องเลือกพนักงานขายจากรายชื่อ", 400);
    const staff = await db.query(
      `SELECT staff_id, display_name FROM core.branch_staff
       WHERE staff_id = $1 AND role = 'sales' AND is_active = TRUE
         AND branch_code = ANY($2::text[])`,
      [staffId, REQUIRED_FOCUS_BRANCHES],
    );
    if (!staff.rowCount) throw createHttpError("พนักงานที่เลือกไม่ใช่พนักงานขาย Active ของสาขาที่กำหนด", 400);
    assignedStaffId = Number(staff.rows[0].staff_id);
    assignedPersonName = staff.rows[0].display_name;
  }
  const publication = normalizePublication(fields);
  const publishedBy = publication.status === "published" ? normalizeNullableText(fields.createdBy) : null;

  const inserted = await db.query(
    `INSERT INTO focus.focus_products
       (product_code, product_codes, focus_type, target_qty, date_from, date_to, branch_codes, note, created_by,
        assigned_person_name, branch_targets, publication_status, scheduled_publish_at, published_at, published_by, assigned_staff_id)
     VALUES ($1, $16::text[], $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15)
     RETURNING id`,
    [productCode, focusType, targetQty, dateFrom, dateTo, branchCodes, note, createdBy,
      assignedPersonName, branchTargets ? JSON.stringify(branchTargets) : null,
      publication.status, publication.scheduledPublishAt, publication.publishedAt, publishedBy, assignedStaffId,
      productCodes],
  );
  const row = await fetchFocusProductRow(db, inserted.rows[0].id);
  const activeBranchCodes = await fetchActiveBranchCodes(db);
  const [withProgress] = await attachProgress(db, [row], activeBranchCodes);
  return withProgress;
}

function validateBulkRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw createHttpError("focusProducts must contain at least one item.", 400);
  }
  if (rows.length > 100) throw createHttpError("A batch cannot contain more than 100 items.", 400);

  const seen = new Set();
  return rows.map((source, index) => {
    const row = source && typeof source === "object" ? source : {};
    const productCode = normalizeText(row.productCode);
    const focusType = normalizeText(row.focusType);
    const targetQty = Number(row.targetQty);
    const assignedPersonName = normalizeNullableText(row.assignedPersonName);
    const assignedStaffId = row.assignedStaffId == null ? null : Number(row.assignedStaffId);
    const branchCodes = normalizeBranchCodes(row.branchCodes) || [];
    const branchTargets = normalizeBranchTargets(row.branchTargets);
    const missingBranches = REQUIRED_FOCUS_BRANCHES.filter((code) => !branchCodes.includes(code));

    if (!productCode) throw createHttpError(`รายการที่ ${index + 1}: ต้องเลือกสินค้า`, 400, { rowIndex: index });
    const productCodes = normalizeProductCodes(row.productCodes, productCode);
    if (!FOCUS_TYPES.has(focusType)) throw createHttpError(`รายการที่ ${index + 1}: ประเภทโฟกัสไม่ถูกต้อง`, 400, { rowIndex: index });
    if (!Number.isFinite(targetQty) || targetQty <= 0) throw createHttpError(`รายการที่ ${index + 1}: เป้าหมายต้องมากกว่า 0`, 400, { rowIndex: index });
    if (missingBranches.length || branchCodes.some((code) => !REQUIRED_FOCUS_BRANCHES.includes(code))) {
      throw createHttpError(`รายการที่ ${index + 1}: ต้องเลือกสาขา 001, 003, 004 และ 005 ให้ครบ`, 400, { rowIndex: index });
    }
    if (focusType === "salesperson" && (!Number.isInteger(assignedStaffId) || assignedStaffId <= 0)) {
      throw createHttpError(`รายการที่ ${index + 1}: ต้องเลือกพนักงานขาย`, 400, { rowIndex: index });
    }
    if (focusType !== "salesperson") {
      const incomplete = REQUIRED_FOCUS_BRANCHES.filter((code) => !Number.isFinite(Number(branchTargets?.[code])) || Number(branchTargets[code]) <= 0);
      if (incomplete.length) {
        throw createHttpError(`รายการที่ ${index + 1}: เป้าสาขา ${incomplete.join(", ")} ต้องมากกว่า 0`, 400, { rowIndex: index });
      }
    }
    // Checked per code, not per row: two rows must not claim the same product
    // even when only one of them lists it as a secondary code, or its sales
    // would be counted toward both targets.
    for (const code of productCodes) {
      const duplicateKey = focusType === "salesperson"
        ? `${focusType}|${code.toLowerCase()}|${assignedStaffId}`
        : `${focusType}|${code.toLowerCase()}`;
      if (seen.has(duplicateKey)) throw createHttpError(`รายการที่ ${index + 1}: มีสินค้า/ผู้รับผิดชอบซ้ำในชุดนี้`, 409, { rowIndex: index });
      seen.add(duplicateKey);
    }
    return { ...row, productCode, productCodes, focusType, targetQty, assignedPersonName, assignedStaffId, branchCodes: [...REQUIRED_FOCUS_BRANCHES], branchTargets };
  });
}

async function createFocusProductsBulk(db, fields) {
  const rows = validateBulkRows(fields.focusProducts);
  const dateFrom = normalizeDate(fields.dateFrom, "dateFrom");
  const dateTo = normalizeDate(fields.dateTo, "dateTo");
  if (dateTo < dateFrom) throw createHttpError("dateTo must not be before dateFrom.", 400);
  normalizePublication(fields);

  const client = typeof db.connect === "function" ? await db.connect() : db;
  const ownsClient = client !== db;
  try {
    await client.query("BEGIN");
    const productCodes = [...new Set(rows.flatMap((row) => row.productCodes))];
    const productResult = await client.query(
      `SELECT company_code FROM public.skus WHERE company_code = ANY($1::text[])`,
      [productCodes],
    );
    const validCodes = new Set(productResult.rows.map((row) => row.company_code));
    const invalidCodes = productCodes.filter((code) => !validCodes.has(code));
    if (invalidCodes.length) throw createHttpError(`ไม่พบรหัสสินค้า: ${invalidCodes.join(", ")}`, 400);

    for (const row of rows) {
      const duplicateParams = [row.productCodes, row.focusType, dateFrom, dateTo];
      let personSql = "";
      if (row.focusType === "salesperson") {
        duplicateParams.push(row.assignedStaffId);
        personSql = `AND assigned_staff_id = $5`;
      }
      // Overlap (&&), not equality: a clash is any shared code between the two
      // groups, since that product's sales would otherwise feed two targets.
      const duplicate = await client.query(
        `SELECT id FROM focus.focus_products
         WHERE is_active = TRUE AND product_codes && $1::text[] AND focus_type = $2
           AND date_from <= $4::date AND date_to >= $3::date ${personSql}
         LIMIT 1`,
        duplicateParams,
      );
      if (duplicate.rowCount) throw createHttpError(`มีสินค้าโฟกัสซ้ำอยู่แล้ว: ${row.productCodes.join(", ")}`, 409, { existingId: Number(duplicate.rows[0].id) });
    }

    const created = [];
    for (const row of rows) {
      created.push(await createFocusProduct(client, {
        ...row,
        dateFrom,
        dateTo,
        publicationStatus: fields.publicationStatus,
        scheduledPublishAt: fields.scheduledPublishAt,
        createdBy: fields.createdBy,
      }));
    }
    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsClient && typeof client.release === "function") client.release();
  }
}

async function updateFocusProduct(db, id, fields) {
  const before = await fetchFocusProductRow(db, id);
  if (!before) throw createHttpError("Focus product not found.", 404);

  const productCodes = fields.productCode === undefined && fields.productCodes === undefined
    ? rowProductCodes(before)
    : normalizeProductCodes(
      fields.productCodes === undefined ? rowProductCodes(before).slice(1) : fields.productCodes,
      fields.productCode === undefined ? before.product_code : fields.productCode,
    );
  const productCode = productCodes[0];

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
  let assignedStaffId = fields.assignedStaffId === undefined ? before.assigned_staff_id : Number(fields.assignedStaffId);
  let resolvedAssignedPersonName = assignedPersonName;
  if (focusType === "salesperson" && fields.assignedStaffId !== undefined) {
    const staff = await db.query(
      `SELECT staff_id, display_name FROM core.branch_staff
       WHERE staff_id = $1 AND role = 'sales' AND is_active = TRUE
         AND branch_code = ANY($2::text[])`,
      [assignedStaffId, REQUIRED_FOCUS_BRANCHES],
    );
    if (!staff.rowCount) throw createHttpError("ต้องเลือกพนักงานขาย Active ของสาขาที่กำหนด", 400);
    assignedStaffId = Number(staff.rows[0].staff_id);
    resolvedAssignedPersonName = staff.rows[0].display_name;
  } else if (focusType !== "salesperson") {
    assignedStaffId = null;
    resolvedAssignedPersonName = null;
  }
  const publication = normalizePublication(fields, before);
  const actor = normalizeNullableText(fields.updatedBy);
  const publishedBy = publication.status === "published"
    ? (before.publication_status === "published" ? before.published_by : actor)
    : null;

  // Editing the date range invalidates any existing freeze snapshot — it was
  // computed for the old range and no longer applies.
  const dateRangeChanged = dateFrom !== toIsoDateOnly(before.date_from) || dateTo !== toIsoDateOnly(before.date_to);

  await db.query(
    `UPDATE focus.focus_products
     SET product_code = $2, product_codes = $17::text[], focus_type = $3, target_qty = $4, date_from = $5, date_to = $6,
         branch_codes = $7, note = $8, is_active = $9, assigned_person_name = $10, branch_targets = $11::jsonb,
         publication_status = $12, scheduled_publish_at = $13, published_at = $14, published_by = $15, assigned_staff_id = $16,
         updated_at = now()
         ${dateRangeChanged ? ", frozen_sold_by_branch = NULL, frozen_total_sold = NULL, frozen_at = NULL" : ""}
     WHERE id = $1`,
    [id, productCode, focusType, targetQty, dateFrom, dateTo, branchCodes, note, isActive,
      resolvedAssignedPersonName, branchTargets ? JSON.stringify(branchTargets) : null,
      publication.status, publication.scheduledPublishAt, publication.publishedAt, publishedBy, assignedStaffId,
      productCodes],
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
  PUBLICATION_STATUSES,
  createHttpError,
  listFocusProducts,
  createFocusProduct,
  updateFocusProduct,
  deactivateFocusProduct,
  mapFocusProductRow,
  attachProgress,
  fetchFocusProductRow,
  normalizePublication,
  computeStatus,
  REQUIRED_FOCUS_BRANCHES,
  validateBulkRows,
  createFocusProductsBulk,
};
