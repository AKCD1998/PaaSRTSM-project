"use strict";

const { randomBytes } = require("node:crypto");

const DRAFT_NOTE_MAX_CHARS = 2000;
const DRAFT_LINE_NOTE_MAX_CHARS = 500;
const ALLOWED_SUBMITTER_ROLES = new Set(["admin", "branch", "staff"]);
const VALID_REQUEST_MODES = new Set(["STANDARD", "ADMIN_ALERT"]);

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
    `SELECT draft_line_id, draft_id, line_key, source_branch_code, request_mode,
            product_code, unit, requested_qty, snapshot_qty, snapshot_synced_at,
            line_note, product_name_th, product_name_en, barcode, created_at, updated_at
     FROM ordering.stock_request_draft_lines
     WHERE draft_id = $1
     ORDER BY draft_line_id ASC`,
    [draftId],
  );
  return result.rows;
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
    });
  }

  return { version, note, lines };
}

async function insertDraftLines(client, draftId, lines) {
  for (const line of lines) {
    await client.query(
      `INSERT INTO ordering.stock_request_draft_lines
         (draft_id, line_key, source_branch_code, request_mode, product_code, unit,
          requested_qty, snapshot_qty, snapshot_synced_at, line_note,
          product_name_th, product_name_en, barcode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        draftId, line.lineKey, line.sourceBranchCode, line.requestMode,
        line.productCode, line.unit, line.requestedQty, line.snapshotQty,
        line.snapshotSyncedAt, line.lineNote, line.productNameTh, line.productNameEn, line.barcode,
      ],
    );
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
