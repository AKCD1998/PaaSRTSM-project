"use strict";

const { randomBytes } = require("node:crypto");

const DRAFT_NOTE_MAX_CHARS = 2000;
const DRAFT_LINE_NOTE_MAX_CHARS = 500;
const ALLOWED_SUBMITTER_ROLES = new Set(["admin", "branch", "staff"]);
const VALID_REQUEST_MODES = new Set(["STANDARD", "ADMIN_ALERT"]);
const VALID_RECOMMENDED_ACTIONS = new Set([
  "NO_ACTION",
  "TRANSFER",
  "TRANSFER_IN",
  "PURCHASE",
  "TRANSFER_AND_PURCHASE",
  "NO_PURCHASE_SLOW_MOVING",
]);
const VALID_INCOMING_MODES = new Set(["UNKNOWN", "EQUAL_SPLIT", "BRANCH_SPECIFIC", "MANUAL", "LIVE_RECEIPTS"]);

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

function parsePositiveNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

function parseOptionalNonNegativeNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

function parseIsoTimestamp(value) {
  const normalized = normalizeNullableText(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseIsoDate(value) {
  const normalized = normalizeNullableText(value, 32);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return normalized;
}

function parseOptionalInteger(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number)) return null;
  return number;
}

function normalizeJsonArray(value, path) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw createHttpError(`${path} must be an array.`, 400);
  return value;
}

function normalizeJsonObject(value, path) {
  if (value == null) return {};
  if (Array.isArray(value) || typeof value !== "object") {
    throw createHttpError(`${path} must be an object.`, 400);
  }
  return value;
}

function normalizeRecommendationPayload(value, { path, productCode, sourceBranchCode, requestedQty }) {
  if (value == null) return null;
  if (Array.isArray(value) || typeof value !== "object") {
    throw createHttpError(`${path} must be an object.`, 400);
  }

  const targetDays = parseOptionalInteger(value.targetDays);
  if (value.targetDays != null && targetDays == null) {
    throw createHttpError(`${path}.targetDays must be an integer.`, 400);
  }

  const incomingAllocationMode = normalizeText(value.incomingAllocationMode || "UNKNOWN").toUpperCase();
  const incomingSourceMode = normalizeText(value.incomingSourceMode || "UNKNOWN").toUpperCase();
  if (!VALID_INCOMING_MODES.has(incomingAllocationMode)) {
    throw createHttpError(`${path}.incomingAllocationMode is invalid.`, 400);
  }
  if (!VALID_INCOMING_MODES.has(incomingSourceMode)) {
    throw createHttpError(`${path}.incomingSourceMode is invalid.`, 400);
  }

  const recommendationGeneratedAt = parseIsoTimestamp(value.recommendationGeneratedAt);
  if (value.recommendationGeneratedAt != null && !recommendationGeneratedAt) {
    throw createHttpError(`${path}.recommendationGeneratedAt is invalid.`, 400);
  }

  const recommendationBasisDateFrom = parseIsoDate(value.recommendationBasisDateFrom);
  const recommendationBasisDateTo = parseIsoDate(value.recommendationBasisDateTo);
  if (value.recommendationBasisDateFrom != null && !recommendationBasisDateFrom) {
    throw createHttpError(`${path}.recommendationBasisDateFrom is invalid.`, 400);
  }
  if (value.recommendationBasisDateTo != null && !recommendationBasisDateTo) {
    throw createHttpError(`${path}.recommendationBasisDateTo is invalid.`, 400);
  }

  const recommendedAction = normalizeText(value.recommendedAction || "NO_ACTION").toUpperCase();
  if (!VALID_RECOMMENDED_ACTIONS.has(recommendedAction)) {
    throw createHttpError(`${path}.recommendedAction is invalid.`, 400);
  }

  const primarySuggestedDonorBranchCode = normalizeNullableText(value.primarySuggestedDonorBranchCode, 16);

  return {
    targetDays: targetDays == null ? 90 : targetDays,
    incomingAllocationMode,
    incomingSourceMode,
    recommendationGeneratedAt,
    recommendationBasisDateFrom,
    recommendationBasisDateTo,
    productCode: normalizeNullableText(value.productCode, 64) || productCode,
    sourceBranchCode: normalizeNullableText(value.sourceBranchCode, 16) || sourceBranchCode,
    currentStock: parseOptionalNonNegativeNumber(value.currentStock),
    unitCostAvg: parseOptionalNonNegativeNumber(value.unitCostAvg),
    inventoryValue: parseOptionalNonNegativeNumber(value.inventoryValue),
    soldQty30d: parseOptionalNonNegativeNumber(value.soldQty30d),
    soldQty90d: parseOptionalNonNegativeNumber(value.soldQty90d),
    adu30: parseOptionalNonNegativeNumber(value.adu30),
    adu90: parseOptionalNonNegativeNumber(value.adu90),
    adjustedAdu: parseOptionalNonNegativeNumber(value.adjustedAdu),
    incomingPoQtyTotal: parseOptionalNonNegativeNumber(value.incomingPoQtyTotal),
    incomingPoAllocationQty: parseOptionalNonNegativeNumber(value.incomingPoAllocationQty),
    effectiveStock: parseOptionalNonNegativeNumber(value.effectiveStock),
    currentDaysCover: parseOptionalNonNegativeNumber(value.currentDaysCover),
    effectiveDaysCover: parseOptionalNonNegativeNumber(value.effectiveDaysCover),
    targetQty: parseOptionalNonNegativeNumber(value.targetQty),
    surplusQty: parseOptionalNonNegativeNumber(value.surplusQty) || 0,
    shortageQty: parseOptionalNonNegativeNumber(value.shortageQty) || 0,
    recommendedAction,
    recommendedTransferQty: parseOptionalNonNegativeNumber(value.recommendedTransferQty) || 0,
    recommendedPurchaseQty: parseOptionalNonNegativeNumber(value.recommendedPurchaseQty) || 0,
    recommendedRequestQty: parseOptionalNonNegativeNumber(value.recommendedRequestQty),
    primarySuggestedDonorBranchCode,
    recommendationReason: normalizeNullableText(value.recommendationReason, 2000),
    recommendationFlags: normalizeJsonArray(value.recommendationFlags, `${path}.recommendationFlags`),
    donorSnapshot: normalizeJsonArray(value.donorSnapshot, `${path}.donorSnapshot`),
    recommendationSnapshot: {
      ...normalizeJsonObject(value.recommendationSnapshot, `${path}.recommendationSnapshot`),
      requestedQty,
    },
  };
}

function formatDateForPublicId(date) {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
}

function formatDraftPublicId(createdAt, branchCode, draftId) {
  const date = createdAt instanceof Date ? createdAt : new Date(String(createdAt || ""));
  const dateStr = Number.isNaN(date.getTime()) ? "00000000" : formatDateForPublicId(date);
  return `SRQD-${dateStr}-${branchCode}-${String(draftId).padStart(6, "0")}`;
}

function validateDraftAccess(auth) {
  if (!auth?.userId || !auth?.role) throw createHttpError("Unauthorized", 401);
  if (!ALLOWED_SUBMITTER_ROLES.has(auth.role)) throw createHttpError("Forbidden", 403);
}

function getOwnerUsername(auth) {
  return String(auth.userId || "");
}

const LOAD_DRAFT_COLUMNS = `draft_id, draft_public_id, owner_user_id, owner_username,
  branch_code, note, status, version, submitted_batch_public_id,
  created_at, updated_at, submitted_at`;

async function loadActiveDraft(dbLike, ownerUsername, branchCode) {
  const result = await dbLike.query(
    `SELECT ${LOAD_DRAFT_COLUMNS}
     FROM ordering.stock_request_drafts
     WHERE owner_username = $1 AND branch_code = $2 AND status = 'ACTIVE'
     LIMIT 1`,
    [ownerUsername, branchCode],
  );
  return result.rows[0] || null;
}

async function loadActiveDraftForUpdate(client, ownerUsername, branchCode) {
  const result = await client.query(
    `SELECT ${LOAD_DRAFT_COLUMNS}
     FROM ordering.stock_request_drafts
     WHERE owner_username = $1 AND branch_code = $2 AND status = 'ACTIVE'
     LIMIT 1
     FOR UPDATE`,
    [ownerUsername, branchCode],
  );
  return result.rows[0] || null;
}

async function loadDraftByPublicIdForUpdate(client, publicId) {
  const result = await client.query(
    `SELECT ${LOAD_DRAFT_COLUMNS}
     FROM ordering.stock_request_drafts
     WHERE draft_public_id = $1
     LIMIT 1
     FOR UPDATE`,
    [publicId],
  );
  return result.rows[0] || null;
}

async function loadDraftById(client, draftId) {
  const result = await client.query(
    `SELECT ${LOAD_DRAFT_COLUMNS}
     FROM ordering.stock_request_drafts
     WHERE draft_id = $1`,
    [draftId],
  );
  return result.rows[0] || null;
}

async function loadDraftLines(dbLike, draftId) {
  const result = await dbLike.query(
    `SELECT dl.draft_line_id, dl.draft_id, dl.line_key, dl.source_branch_code, dl.request_mode,
            dl.product_code, dl.unit, dl.requested_qty, dl.snapshot_qty, dl.snapshot_synced_at,
            dl.line_note, dl.product_name_th, dl.product_name_en, dl.barcode, dl.created_at, dl.updated_at,
            rec.target_days AS recommendation_target_days,
            rec.incoming_allocation_mode AS recommendation_incoming_allocation_mode,
            rec.incoming_source_mode AS recommendation_incoming_source_mode,
            rec.recommendation_generated_at,
            rec.recommendation_basis_date_from,
            rec.recommendation_basis_date_to,
            rec.current_stock AS recommendation_current_stock,
            rec.unit_cost_avg AS recommendation_unit_cost_avg,
            rec.inventory_value AS recommendation_inventory_value,
            rec.sold_qty_30d AS recommendation_sold_qty_30d,
            rec.sold_qty_90d AS recommendation_sold_qty_90d,
            rec.adu_30 AS recommendation_adu_30,
            rec.adu_90 AS recommendation_adu_90,
            rec.adjusted_adu AS recommendation_adjusted_adu,
            rec.incoming_po_qty_total AS recommendation_incoming_po_qty_total,
            rec.incoming_po_allocation_qty AS recommendation_incoming_po_allocation_qty,
            rec.effective_stock AS recommendation_effective_stock,
            rec.current_days_cover AS recommendation_current_days_cover,
            rec.effective_days_cover AS recommendation_effective_days_cover,
            rec.target_qty AS recommendation_target_qty,
            rec.surplus_qty AS recommendation_surplus_qty,
            rec.shortage_qty AS recommendation_shortage_qty,
            rec.recommended_action,
            rec.recommended_transfer_qty,
            rec.recommended_purchase_qty,
            rec.primary_suggested_donor_branch_code,
            rec.recommendation_reason,
            rec.recommendation_flags,
            rec.donor_snapshot,
            rec.recommendation_snapshot
     FROM ordering.stock_request_draft_lines dl
     LEFT JOIN ordering.stock_request_draft_line_recommendations rec
       ON rec.draft_line_id = dl.draft_line_id
     WHERE dl.draft_id = $1
     ORDER BY dl.draft_line_id ASC`,
    [draftId],
  );
  return result.rows;
}

function mapRecommendationRow(row) {
  if (row.recommended_action == null) return null;
  const snapshot = row.recommendation_snapshot && typeof row.recommendation_snapshot === "object"
    ? row.recommendation_snapshot
    : {};
  return {
    targetDays: row.recommendation_target_days == null ? 90 : Number(row.recommendation_target_days),
    incomingAllocationMode: row.recommendation_incoming_allocation_mode || "UNKNOWN",
    incomingSourceMode: row.recommendation_incoming_source_mode || "UNKNOWN",
    recommendationGeneratedAt: row.recommendation_generated_at || null,
    recommendationBasisDateFrom: row.recommendation_basis_date_from || null,
    recommendationBasisDateTo: row.recommendation_basis_date_to || null,
    productCode: row.product_code,
    sourceBranchCode: snapshot.sourceBranchCode || row.source_branch_code || null,
    currentStock: row.recommendation_current_stock == null ? null : Number(row.recommendation_current_stock),
    unitCostAvg: row.recommendation_unit_cost_avg == null ? null : Number(row.recommendation_unit_cost_avg),
    inventoryValue: row.recommendation_inventory_value == null ? null : Number(row.recommendation_inventory_value),
    soldQty30d: row.recommendation_sold_qty_30d == null ? null : Number(row.recommendation_sold_qty_30d),
    soldQty90d: row.recommendation_sold_qty_90d == null ? null : Number(row.recommendation_sold_qty_90d),
    adu30: row.recommendation_adu_30 == null ? null : Number(row.recommendation_adu_30),
    adu90: row.recommendation_adu_90 == null ? null : Number(row.recommendation_adu_90),
    adjustedAdu: row.recommendation_adjusted_adu == null ? null : Number(row.recommendation_adjusted_adu),
    incomingPoQtyTotal: row.recommendation_incoming_po_qty_total == null ? null : Number(row.recommendation_incoming_po_qty_total),
    incomingPoAllocationQty: row.recommendation_incoming_po_allocation_qty == null ? null : Number(row.recommendation_incoming_po_allocation_qty),
    effectiveStock: row.recommendation_effective_stock == null ? null : Number(row.recommendation_effective_stock),
    currentDaysCover: row.recommendation_current_days_cover == null ? null : Number(row.recommendation_current_days_cover),
    effectiveDaysCover: row.recommendation_effective_days_cover == null ? null : Number(row.recommendation_effective_days_cover),
    targetQty: row.recommendation_target_qty == null ? null : Number(row.recommendation_target_qty),
    surplusQty: row.recommendation_surplus_qty == null ? 0 : Number(row.recommendation_surplus_qty),
    shortageQty: row.recommendation_shortage_qty == null ? 0 : Number(row.recommendation_shortage_qty),
    recommendedAction: row.recommended_action || "NO_ACTION",
    recommendedTransferQty: row.recommended_transfer_qty == null ? 0 : Number(row.recommended_transfer_qty),
    recommendedPurchaseQty: row.recommended_purchase_qty == null ? 0 : Number(row.recommended_purchase_qty),
    recommendedRequestQty: snapshot.recommendedRequestQty == null ? null : Number(snapshot.recommendedRequestQty),
    primarySuggestedDonorBranchCode: row.primary_suggested_donor_branch_code || null,
    recommendationReason: row.recommendation_reason || null,
    recommendationFlags: Array.isArray(row.recommendation_flags) ? row.recommendation_flags : [],
    donorSnapshot: Array.isArray(row.donor_snapshot) ? row.donor_snapshot : [],
    recommendationSnapshot: snapshot,
  };
}

function mapDraftLineRow(row) {
  return {
    lineKey: row.line_key,
    sourceBranchCode: row.source_branch_code,
    requestMode: row.request_mode || "STANDARD",
    productCode: row.product_code,
    productNameThai: row.product_name_th || "",
    productNameEng: row.product_name_en || "",
    barcode: row.barcode || "",
    unit: row.unit,
    requestedQty: Number(row.requested_qty),
    snapshotQty: row.snapshot_qty != null ? Number(row.snapshot_qty) : null,
    snapshotSyncedAt: row.snapshot_synced_at || null,
    lineNote: row.line_note || "",
    recommendation: mapRecommendationRow(row),
  };
}

function mapPayloadLineToResponse(line) {
  return {
    lineKey: line.lineKey,
    sourceBranchCode: line.sourceBranchCode,
    requestMode: line.requestMode || "STANDARD",
    productCode: line.productCode,
    productNameThai: line.productNameTh || "",
    productNameEng: line.productNameEn || "",
    barcode: line.barcode || "",
    unit: line.unit,
    requestedQty: Number(line.requestedQty),
    snapshotQty: line.snapshotQty != null ? Number(line.snapshotQty) : null,
    snapshotSyncedAt: line.snapshotSyncedAt || null,
    lineNote: line.lineNote || "",
    recommendation: line.recommendation || null,
  };
}

function mapDraftRow(row, lineRows = []) {
  return {
    draftPublicId: row.draft_public_id,
    branchCode: row.branch_code,
    note: row.note || "",
    version: Number(row.version),
    updatedAt: row.updated_at,
    lines: lineRows.map(mapDraftLineRow),
  };
}

function emptyDraftResponse(branchCode) {
  return {
    draftPublicId: null,
    branchCode: branchCode || "",
    note: "",
    version: 0,
    updatedAt: null,
    lines: [],
  };
}

function normalizePutBody(body) {
  const source = body || {};
  const rawVersion = source.version;
  const version = rawVersion != null ? Number(rawVersion) : -1;
  if (!Number.isFinite(version) || version < 0 || !Number.isInteger(version)) {
    throw createHttpError("version must be a non-negative integer.", 400);
  }

  const note = normalizeNullableText(source.note, DRAFT_NOTE_MAX_CHARS) || "";
  const linesSource = Array.isArray(source.lines) ? source.lines : [];

  const lines = [];
  for (const [i, lineSource] of linesSource.entries()) {
    const lineKey = normalizeNullableText(lineSource?.lineKey, 512);
    const sourceBranchCode = normalizeNullableText(lineSource?.sourceBranchCode, 16);
    const requestMode = normalizeText(lineSource?.requestMode || "STANDARD").toUpperCase();
    const productCode = normalizeNullableText(lineSource?.productCode, 64);
    const unit = normalizeNullableText(lineSource?.unit, 128);
    const requestedQty = parsePositiveNumber(lineSource?.requestedQty);
    const snapshotQty = parseOptionalNonNegativeNumber(lineSource?.snapshotQty);
    const snapshotSyncedAt = parseIsoTimestamp(lineSource?.snapshotSyncedAt);
    const lineNote = normalizeNullableText(lineSource?.lineNote, DRAFT_LINE_NOTE_MAX_CHARS) || "";
    const productNameTh = normalizeNullableText(lineSource?.productNameThai, 512) || "";
    const productNameEn = normalizeNullableText(lineSource?.productNameEng, 512) || "";
    const barcode = normalizeNullableText(lineSource?.barcode, 128) || "";
    const recommendation = normalizeRecommendationPayload(lineSource?.recommendation, {
      path: `lines[${i}].recommendation`,
      productCode,
      sourceBranchCode,
      requestedQty,
    });

    if (!lineKey) throw createHttpError(`lines[${i}].lineKey is required.`, 400);
    if (!sourceBranchCode) throw createHttpError(`lines[${i}].sourceBranchCode is required.`, 400);
    if (!VALID_REQUEST_MODES.has(requestMode)) throw createHttpError(`lines[${i}].requestMode is invalid.`, 400);
    if (!productCode) throw createHttpError(`lines[${i}].productCode is required.`, 400);
    if (!unit) throw createHttpError(`lines[${i}].unit is required.`, 400);
    if (requestedQty == null) throw createHttpError(`lines[${i}].requestedQty must be a positive number.`, 400);

    lines.push({
      lineKey,
      sourceBranchCode,
      requestMode,
      productCode,
      unit,
      requestedQty,
      snapshotQty,
      snapshotSyncedAt,
      lineNote,
      productNameTh,
      productNameEn,
      barcode,
      recommendation,
    });
  }

  return { version, note, lines };
}

async function insertDraftLines(client, draftId, lines) {
  for (const line of lines) {
    const result = await client.query(
      `INSERT INTO ordering.stock_request_draft_lines
         (draft_id, line_key, source_branch_code, request_mode, product_code, unit,
          requested_qty, snapshot_qty, snapshot_synced_at, line_note,
          product_name_th, product_name_en, barcode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING draft_line_id`,
      [
        draftId, line.lineKey, line.sourceBranchCode, line.requestMode,
        line.productCode, line.unit, line.requestedQty, line.snapshotQty,
        line.snapshotSyncedAt, line.lineNote, line.productNameTh, line.productNameEn, line.barcode,
      ],
    );
    const draftLineId = Number(result.rows[0].draft_line_id);
    if (line.recommendation) {
      const rec = line.recommendation;
      await client.query(
        `INSERT INTO ordering.stock_request_draft_line_recommendations
           (draft_line_id, target_days, incoming_allocation_mode, incoming_source_mode,
            recommendation_generated_at, recommendation_basis_date_from, recommendation_basis_date_to,
            product_code, current_stock, unit_cost_avg, inventory_value, sold_qty_30d, sold_qty_90d,
            adu_30, adu_90, adjusted_adu, incoming_po_qty_total, incoming_po_allocation_qty,
            effective_stock, current_days_cover, effective_days_cover, target_qty, surplus_qty,
            shortage_qty, recommended_action, recommended_transfer_qty, recommended_purchase_qty,
            primary_suggested_donor_branch_code, recommendation_reason, recommendation_flags,
            donor_snapshot, recommendation_snapshot)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18,
            $19, $20, $21, $22, $23,
            $24, $25, $26, $27,
            $28, $29, $30::jsonb,
            $31::jsonb, $32::jsonb)`,
        [
          draftLineId,
          rec.targetDays,
          rec.incomingAllocationMode,
          rec.incomingSourceMode,
          rec.recommendationGeneratedAt,
          rec.recommendationBasisDateFrom,
          rec.recommendationBasisDateTo,
          rec.productCode,
          rec.currentStock,
          rec.unitCostAvg,
          rec.inventoryValue,
          rec.soldQty30d,
          rec.soldQty90d,
          rec.adu30,
          rec.adu90,
          rec.adjustedAdu,
          rec.incomingPoQtyTotal,
          rec.incomingPoAllocationQty,
          rec.effectiveStock,
          rec.currentDaysCover,
          rec.effectiveDaysCover,
          rec.targetQty,
          rec.surplusQty,
          rec.shortageQty,
          rec.recommendedAction,
          rec.recommendedTransferQty,
          rec.recommendedPurchaseQty,
          rec.primarySuggestedDonorBranchCode,
          rec.recommendationReason,
          JSON.stringify(rec.recommendationFlags),
          JSON.stringify(rec.donorSnapshot),
          JSON.stringify({
            ...rec.recommendationSnapshot,
            sourceBranchCode: rec.sourceBranchCode,
            recommendedRequestQty: rec.recommendedRequestQty,
          }),
        ],
      );
    }
  }
}

async function getActiveDraft({ db, auth }) {
  validateDraftAccess(auth);
  const branchCode = auth.effectiveBranchCode;
  if (!branchCode) {
    return { draft: emptyDraftResponse("") };
  }
  const ownerUsername = getOwnerUsername(auth);
  const draftRow = await loadActiveDraft(db, ownerUsername, branchCode);
  if (!draftRow) {
    return { draft: emptyDraftResponse(branchCode) };
  }
  const lineRows = await loadDraftLines(db, Number(draftRow.draft_id));
  return { draft: mapDraftRow(draftRow, lineRows) };
}

async function putActiveDraft({ db, auth, body }) {
  validateDraftAccess(auth);
  const branchCode = auth.effectiveBranchCode;
  if (!branchCode) {
    throw createHttpError("Branch identity required.", 400);
  }
  const ownerUsername = getOwnerUsername(auth);
  const payload = normalizePutBody(body);

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const existingDraft = await loadActiveDraftForUpdate(client, ownerUsername, branchCode);

    let responseDraftPublicId;
    let responseVersion;

    if (!existingDraft) {
      if (payload.version !== 0) {
        throw createHttpError("Draft was updated elsewhere.", 409, { code: "DRAFT_VERSION_CONFLICT" });
      }

      // Use a cryptographically random temp ID so concurrent inserts from different users/tabs
      // never collide on the UNIQUE constraint; the UPDATE below replaces it with the real ID.
      const tempPublicId = `SRQD-T-${randomBytes(12).toString("hex")}`;
      // owner_user_id is bigint but our auth.userId is a string username — always NULL here.
      // owner_username (text) already captures the identity uniquely.
      const insertResult = await client.query(
        `INSERT INTO ordering.stock_request_drafts
           (draft_public_id, owner_user_id, owner_username, branch_code, note, status, version)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 1)
         RETURNING draft_id, created_at`,
        [tempPublicId, null, ownerUsername, branchCode, payload.note],
      );
      const savedDraftId = Number(insertResult.rows[0].draft_id);
      const createdAt = insertResult.rows[0].created_at;
      responseDraftPublicId = formatDraftPublicId(createdAt, branchCode, savedDraftId);
      responseVersion = 1;

      await client.query(
        `UPDATE ordering.stock_request_drafts SET draft_public_id = $2 WHERE draft_id = $1`,
        [savedDraftId, responseDraftPublicId],
      );

      await insertDraftLines(client, savedDraftId, payload.lines);
    } else {
      if (Number(existingDraft.version) !== payload.version) {
        throw createHttpError("Draft was updated elsewhere.", 409, { code: "DRAFT_VERSION_CONFLICT" });
      }

      const savedDraftId = Number(existingDraft.draft_id);
      responseDraftPublicId = existingDraft.draft_public_id;
      responseVersion = Number(existingDraft.version) + 1;

      await client.query(
        `UPDATE ordering.stock_request_drafts
         SET note = $2, version = $3, updated_at = now()
         WHERE draft_id = $1`,
        [savedDraftId, payload.note, responseVersion],
      );

      await client.query(
        `DELETE FROM ordering.stock_request_draft_lines WHERE draft_id = $1`,
        [savedDraftId],
      );

      await insertDraftLines(client, savedDraftId, payload.lines);
    }

    await client.query("COMMIT");

    return {
      draft: {
        draftPublicId: responseDraftPublicId,
        branchCode,
        note: payload.note,
        version: responseVersion,
        updatedAt: new Date().toISOString(),
        lines: payload.lines.map(mapPayloadLineToResponse),
      },
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_rollbackError) { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }
}

async function discardActiveDraft({ db, auth }) {
  validateDraftAccess(auth);
  const branchCode = auth.effectiveBranchCode;
  if (!branchCode) return;
  const ownerUsername = getOwnerUsername(auth);
  await db.query(
    `UPDATE ordering.stock_request_drafts
     SET status = 'DISCARDED', updated_at = now()
     WHERE owner_username = $1 AND branch_code = $2 AND status = 'ACTIVE'`,
    [ownerUsername, branchCode],
  );
}

async function markDraftSubmitted(client, { draftPublicId, draftVersion, submittedBatchPublicId, auth }) {
  const draftRow = await loadDraftByPublicIdForUpdate(client, draftPublicId);

  if (!draftRow) {
    throw createHttpError("Draft not found.", 404, { code: "DRAFT_NOT_FOUND" });
  }

  const ownerUsername = getOwnerUsername(auth);
  if (draftRow.owner_username !== ownerUsername) {
    throw createHttpError("Draft does not belong to the current user.", 403);
  }
  if (draftRow.branch_code !== auth.effectiveBranchCode) {
    throw createHttpError("Draft branch does not match request branch.", 403);
  }
  if (draftRow.status !== "ACTIVE") {
    throw createHttpError("Draft has already been submitted or discarded.", 409, { code: "DRAFT_NOT_ACTIVE" });
  }
  if (Number(draftRow.version) !== Number(draftVersion)) {
    throw createHttpError("Draft was updated elsewhere.", 409, { code: "DRAFT_VERSION_CONFLICT" });
  }

  await client.query(
    `UPDATE ordering.stock_request_drafts
     SET status = 'SUBMITTED',
         submitted_batch_public_id = $2,
         submitted_at = now(),
         updated_at = now()
     WHERE draft_id = $1`,
    [Number(draftRow.draft_id), submittedBatchPublicId],
  );
}

module.exports = {
  getActiveDraft,
  putActiveDraft,
  discardActiveDraft,
  markDraftSubmitted,
  formatDraftPublicId,
};
