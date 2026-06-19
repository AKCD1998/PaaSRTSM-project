"use strict";

const { normalizeBranchCode } = require("../auth/users");

const BATCH_NOTE_MAX_CHARS = 2000;
const EVENT_NOTE_MAX_CHARS = 2000;
const RESPONSE_NOTE_MAX_CHARS = 2000;
const REASON_CODE_MAX_CHARS = 64;
const ALLOWED_SUBMITTER_ROLES = new Set(["admin", "branch", "staff"]);
const VALID_RESPONSE_STATUSES = new Set(["APPROVED_FULL", "CUSTOM", "REJECTED"]);
const VALID_REQUEST_MODES = new Set(["STANDARD", "ADMIN_ALERT"]);
const STOCK_REQUEST_DOCUMENT_TYPES = new Set(["RESPONSE_SUMMARY", "PACKING_SLIP"]);

function createHttpError(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeNullableText(value, maxChars = null) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  if (!maxChars || normalized.length <= maxChars) {
    return normalized;
  }
  return normalized.slice(0, maxChars);
}

function parsePositiveNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return number;
}

function parseOptionalNonNegativeNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }
  return number;
}

function parseIsoTimestamp(value) {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return null;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function formatDateForPublicId(isoTimestamp) {
  const date = isoTimestamp instanceof Date
    ? isoTimestamp
    : new Date(String(isoTimestamp || ""));

  if (Number.isNaN(date.getTime())) {
    return "00000000";
  }

  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
}

function formatBatchPublicId(submittedAt, requestingBranchCode, batchId) {
  return `SRQ-${formatDateForPublicId(submittedAt)}-${requestingBranchCode}-${String(batchId).padStart(6, "0")}`;
}

function formatRequestPublicId(batchPublicId, sourceBranchCode) {
  return `${batchPublicId}-${sourceBranchCode}`;
}

function normalizeSearchTerm(value) {
  return normalizeNullableText(value, 128);
}

function normalizeSubmitPayload(body) {
  const source = body || {};
  const idempotencyKey = normalizeNullableText(source.idempotencyKey, 256);
  const note = normalizeNullableText(source.note, BATCH_NOTE_MAX_CHARS);
  const groupsSource = Array.isArray(source.groups) ? source.groups : null;

  if (!idempotencyKey) {
    throw createHttpError("idempotencyKey is required.", 400);
  }
  if (!groupsSource || groupsSource.length === 0) {
    throw createHttpError("groups must contain at least one source branch.", 400);
  }

  const groups = [];
  const seenSourceBranches = new Set();

  for (const [groupIndex, groupSource] of groupsSource.entries()) {
    const sourceBranchCode = normalizeBranchCode(groupSource?.sourceBranchCode || groupSource?.source_branch_code);
    const requestMode = normalizeText(groupSource?.requestMode ?? groupSource?.request_mode).toUpperCase() || "STANDARD";
    if (!sourceBranchCode) {
      throw createHttpError(`groups[${groupIndex}].sourceBranchCode must be a 3-digit branch code.`, 400);
    }
    if (!VALID_REQUEST_MODES.has(requestMode)) {
      throw createHttpError(`groups[${groupIndex}].requestMode is invalid.`, 400);
    }
    if (seenSourceBranches.has(sourceBranchCode)) {
      throw createHttpError(`Duplicate sourceBranchCode ${sourceBranchCode} in groups.`, 400);
    }
    seenSourceBranches.add(sourceBranchCode);

    const linesSource = Array.isArray(groupSource?.lines) ? groupSource.lines : null;
    if (!linesSource || linesSource.length === 0) {
      throw createHttpError(`groups[${groupIndex}].lines must contain at least one item.`, 400);
    }

    const lines = [];
    const seenLineKeys = new Set();
    for (const [lineIndex, lineSource] of linesSource.entries()) {
      const productCode = normalizeNullableText(lineSource?.productCode || lineSource?.product_code, 64);
      const requestedQty = parsePositiveNumber(lineSource?.requestedQty || lineSource?.requested_qty);
      const unit = normalizeNullableText(lineSource?.unit, 128);
      const snapshotQty = parseOptionalNonNegativeNumber(lineSource?.snapshotQty || lineSource?.snapshot_qty);
      const snapshotSyncedAt = parseIsoTimestamp(lineSource?.snapshotSyncedAt || lineSource?.snapshot_synced_at);

      if (!productCode) {
        throw createHttpError(`groups[${groupIndex}].lines[${lineIndex}].productCode is required.`, 400);
      }
      if (requestedQty == null) {
        throw createHttpError(`groups[${groupIndex}].lines[${lineIndex}].requestedQty must be a positive number.`, 400);
      }
      if (!unit) {
        throw createHttpError(`groups[${groupIndex}].lines[${lineIndex}].unit is required.`, 400);
      }
      if ((lineSource?.snapshotSyncedAt || lineSource?.snapshot_synced_at) != null && !snapshotSyncedAt) {
        throw createHttpError(`groups[${groupIndex}].lines[${lineIndex}].snapshotSyncedAt is invalid.`, 400);
      }
      if (
        (lineSource?.snapshotQty || lineSource?.snapshot_qty) != null &&
        (lineSource?.snapshotQty || lineSource?.snapshot_qty) !== "" &&
        snapshotQty == null
      ) {
        throw createHttpError(`groups[${groupIndex}].lines[${lineIndex}].snapshotQty must be a non-negative number.`, 400);
      }

      const lineKey = `${productCode}|${unit.toLowerCase()}`;
      if (seenLineKeys.has(lineKey)) {
        throw createHttpError(
          `Duplicate product/unit ${productCode}/${unit} within source branch ${sourceBranchCode}.`,
          400,
        );
      }
      seenLineKeys.add(lineKey);

      lines.push({
        productCode,
        requestedQty,
        unit,
        snapshotQty,
        snapshotSyncedAt,
      });
    }

    groups.push({
      sourceBranchCode,
      requestMode,
      lines,
    });
  }

  return {
    idempotencyKey,
    note,
    groups,
  };
}

async function loadExistingBatchByIdempotency(client, idempotencyKey) {
  const result = await client.query(
    `
      SELECT batch_id, public_id, requesting_branch_code, created_by
      FROM ordering.stock_request_batches
      WHERE idempotency_key = $1
      LIMIT 1
    `,
    [idempotencyKey],
  );
  return result.rows[0] || null;
}

async function loadBatchByPublicId(dbLike, publicId) {
  const result = await dbLike.query(
    `
      SELECT
        batch_id,
        public_id,
        requesting_branch_code,
        status,
        created_by,
        note,
        version,
        submitted_at,
        created_at,
        updated_at
      FROM ordering.stock_request_batches
      WHERE public_id = $1
      LIMIT 1
    `,
    [publicId],
  );
  return result.rows[0] || null;
}

async function loadBatchById(dbLike, batchId) {
  const result = await dbLike.query(
    `
      SELECT
        batch_id,
        public_id,
        requesting_branch_code,
        status,
        created_by,
        note,
        version,
        submitted_at,
        created_at,
        updated_at
      FROM ordering.stock_request_batches
      WHERE batch_id = $1
      LIMIT 1
    `,
    [batchId],
  );
  return result.rows[0] || null;
}

async function loadBatchRequests(client, batchId) {
  const result = await client.query(
    `
      SELECT public_id, source_branch_code
      FROM ordering.stock_requests
      WHERE batch_id = $1
      ORDER BY source_branch_code ASC
    `,
    [batchId],
  );

  return result.rows.map((row) => ({
    publicId: row.public_id,
    sourceBranchCode: row.source_branch_code,
  }));
}

async function loadRequestByPublicId(dbLike, publicId) {
  const result = await dbLike.query(
    `
      SELECT
        request_id,
        public_id,
        batch_id,
        requesting_branch_code,
        source_branch_code,
        request_mode,
        status,
        response_result,
        response_note,
        responded_by,
        responded_at,
        acknowledged_by,
        acknowledged_at,
        version,
        created_at,
        updated_at
      FROM ordering.stock_requests
      WHERE public_id = $1
      LIMIT 1
    `,
    [publicId],
  );
  return result.rows[0] || null;
}

async function loadRequestRowsByBatchId(dbLike, batchId) {
  const result = await dbLike.query(
    `
      SELECT
        request_id,
        public_id,
        batch_id,
        requesting_branch_code,
        source_branch_code,
        request_mode,
        status,
        response_result,
        response_note,
        responded_by,
        responded_at,
        acknowledged_by,
        acknowledged_at,
        version,
        created_at,
        updated_at
      FROM ordering.stock_requests
      WHERE batch_id = $1
      ORDER BY source_branch_code ASC, request_id ASC
    `,
    [batchId],
  );
  return result.rows;
}

async function loadRequestRowsByRequestingBranch(dbLike, requestingBranchCode, searchTerm) {
  const result = await dbLike.query(
    `
      SELECT
        request_id,
        public_id,
        batch_id,
        requesting_branch_code,
        source_branch_code,
        request_mode,
        status,
        response_result,
        response_note,
        responded_by,
        responded_at,
        acknowledged_by,
        acknowledged_at,
        version,
        created_at,
        updated_at
      FROM ordering.stock_requests
      WHERE requesting_branch_code = $1
        AND (
          $2::text IS NULL
          OR public_id ILIKE ('%' || $2 || '%')
          OR source_branch_code ILIKE ('%' || $2 || '%')
        )
      ORDER BY created_at DESC, request_id DESC
    `,
    [requestingBranchCode, searchTerm],
  );
  return result.rows;
}

async function loadIncomingRequestRowsBySourceBranch(dbLike, sourceBranchCode, searchTerm) {
  const result = await dbLike.query(
    `
      SELECT
        request_id,
        public_id,
        batch_id,
        requesting_branch_code,
        source_branch_code,
        request_mode,
        status,
        response_result,
        response_note,
        responded_by,
        responded_at,
        acknowledged_by,
        acknowledged_at,
        version,
        created_at,
        updated_at
      FROM ordering.stock_requests
      WHERE ($1::text IS NULL OR source_branch_code = $1)
        AND (
          $2::text IS NULL
          OR public_id ILIKE ('%' || $2 || '%')
          OR requesting_branch_code ILIKE ('%' || $2 || '%')
          OR source_branch_code ILIKE ('%' || $2 || '%')
        )
      ORDER BY
        CASE WHEN request_mode = 'ADMIN_ALERT' AND status = 'SUBMITTED' THEN 0 ELSE 1 END,
        created_at DESC,
        request_id DESC
    `,
    [sourceBranchCode || null, searchTerm],
  );
  return result.rows;
}

async function loadBatchRowsByIds(dbLike, batchIds) {
  const normalizedIds = [...new Set((batchIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  if (!normalizedIds.length) {
    return [];
  }

  const result = await dbLike.query(
    `
      SELECT
        batch_id,
        public_id,
        requesting_branch_code,
        status,
        created_by,
        note,
        version,
        submitted_at,
        created_at,
        updated_at
      FROM ordering.stock_request_batches
      WHERE batch_id = ANY($1::bigint[])
    `,
    [normalizedIds],
  );
  return result.rows;
}

async function loadLineRowsByRequestIds(dbLike, requestIds) {
  const normalizedIds = [...new Set((requestIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  if (!normalizedIds.length) {
    return [];
  }

  const result = await dbLike.query(
    `
      SELECT
        line_id,
        request_id,
        product_code,
        product_name_thai,
        product_name_eng,
        barcode,
        unit,
        requested_qty,
        snapshot_qty,
        snapshot_synced_at,
        status,
        created_at
      FROM ordering.stock_request_lines
      WHERE request_id = ANY($1::bigint[])
      ORDER BY request_id ASC, line_id ASC
    `,
    [normalizedIds],
  );
  return result.rows;
}

async function loadLatestSubmittedResponsesByLineIds(dbLike, lineIds) {
  const normalizedIds = [...new Set((lineIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  if (!normalizedIds.length) {
    return [];
  }

  const result = await dbLike.query(
    `
      SELECT DISTINCT ON (line_id)
        response_id,
        line_id,
        response_status,
        approved_qty,
        reason_code,
        note,
        revalidated_snapshot_qty,
        is_submitted,
        responded_by,
        superseded_by,
        created_at
      FROM ordering.stock_request_line_responses
      WHERE line_id = ANY($1::bigint[])
        AND is_submitted = TRUE
      ORDER BY line_id ASC, created_at DESC, response_id DESC
    `,
    [normalizedIds],
  );
  return result.rows;
}

async function loadEventRowsByBatchId(dbLike, batchId) {
  const result = await dbLike.query(
    `
      SELECT
        event_id,
        batch_id,
        request_id,
        line_id,
        event_type,
        actor_user,
        actor_branch,
        metadata,
        note,
        request_correlation_id,
        created_at
      FROM ordering.stock_request_events
      WHERE batch_id = $1
      ORDER BY created_at ASC, event_id ASC
    `,
    [batchId],
  );
  return result.rows;
}

async function loadBranchesByCodes(client, branchCodes) {
  const normalizedCodes = [...new Set(branchCodes.map((value) => normalizeBranchCode(value)).filter(Boolean))];
  if (!normalizedCodes.length) {
    return new Map();
  }

  const result = await client.query(
    `
      SELECT branch_code, branch_name, is_active, is_hq
      FROM core.branches
      WHERE branch_code = ANY($1::text[])
    `,
    [normalizedCodes],
  );

  return new Map(
    result.rows.map((row) => [
      row.branch_code,
      {
        branchCode: row.branch_code,
        branchName: row.branch_name || null,
        isActive: Boolean(row.is_active),
        isHq: Boolean(row.is_hq),
      },
    ]),
  );
}

async function loadProductSnapshots(client, productCodes) {
  const normalizedCodes = [...new Set(productCodes.map((value) => normalizeNullableText(value, 64)).filter(Boolean))];
  if (!normalizedCodes.length) {
    return new Map();
  }

  const result = await client.query(
    `
      SELECT
        codes.product_code,
        COALESCE(p.product_name_th, s.display_name, i.display_name, i.generic_name, codes.product_code) AS product_name_thai,
        COALESCE(p.product_name, s.display_name, i.display_name, i.generic_name, codes.product_code) AS product_name_eng,
        COALESCE(pb.barcode, ab.barcode) AS barcode,
        COALESCE(s.uom, p.unit_small, p.unit_medium, p.unit_large) AS default_unit
      FROM unnest($1::text[]) WITH ORDINALITY AS codes(product_code, ord)
      LEFT JOIN public.skus s
        ON s.company_code = codes.product_code
      LEFT JOIN public.items i
        ON i.item_id = s.item_id
      LEFT JOIN ada.products p
        ON p.product_code = codes.product_code
      LEFT JOIN LATERAL (
        SELECT barcode
        FROM public.barcodes
        WHERE sku_id = s.sku_id
        ORDER BY is_primary DESC, updated_at DESC NULLS LAST, barcode ASC
        LIMIT 1
      ) pb ON TRUE
      LEFT JOIN LATERAL (
        SELECT barcode
        FROM ada.product_barcodes
        WHERE product_code = codes.product_code
        ORDER BY source_synced_at DESC NULLS LAST, barcode ASC
        LIMIT 1
      ) ab ON TRUE
      WHERE s.company_code IS NOT NULL
      ORDER BY codes.ord
    `,
    [normalizedCodes],
  );

  return new Map(
    result.rows.map((row) => [
      row.product_code,
      {
        productCode: row.product_code,
        productNameThai: row.product_name_thai || null,
        productNameEng: row.product_name_eng || null,
        barcode: row.barcode || null,
        defaultUnit: row.default_unit || null,
      },
    ]),
  );
}

async function insertBatch(client, payload, auth) {
  const result = await client.query(
    `
      INSERT INTO ordering.stock_request_batches
        (public_id, requesting_branch_code, status, created_by, note, idempotency_key, submitted_at)
      VALUES
        ($1, $2, 'SUBMITTED', $3, $4, $5, now())
      RETURNING batch_id, submitted_at
    `,
    [
      `TMP-BATCH-${auth.userId}-${payload.idempotencyKey}`,
      auth.effectiveBranchCode,
      auth.userId,
      payload.note,
      payload.idempotencyKey,
    ],
  );

  const row = result.rows[0];
  const publicId = formatBatchPublicId(row.submitted_at, auth.effectiveBranchCode, row.batch_id);
  await client.query(
    `
      UPDATE ordering.stock_request_batches
      SET public_id = $2, updated_at = now()
      WHERE batch_id = $1
    `,
    [row.batch_id, publicId],
  );

  return {
    batchId: Number(row.batch_id),
    publicId,
    submittedAt: row.submitted_at,
  };
}

async function insertRequest(client, { batch, auth, sourceBranchCode, requestMode }) {
  const publicId = formatRequestPublicId(batch.publicId, sourceBranchCode);
  const result = await client.query(
    `
      INSERT INTO ordering.stock_requests
        (public_id, batch_id, requesting_branch_code, source_branch_code, request_mode, status)
      VALUES
        ($1, $2, $3, $4, $5, 'SUBMITTED')
      RETURNING request_id
    `,
    [publicId, batch.batchId, auth.effectiveBranchCode, sourceBranchCode, requestMode || "STANDARD"],
  );

  return {
    requestId: Number(result.rows[0].request_id),
    publicId,
    sourceBranchCode,
    requestMode: requestMode || "STANDARD",
  };
}

async function insertLine(client, { requestId, line, product }) {
  const result = await client.query(
    `
      INSERT INTO ordering.stock_request_lines
        (
          request_id,
          product_code,
          product_name_thai,
          product_name_eng,
          barcode,
          unit,
          requested_qty,
          snapshot_qty,
          snapshot_synced_at,
          status
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')
      RETURNING line_id
    `,
    [
      requestId,
      line.productCode,
      product.productNameThai,
      product.productNameEng,
      product.barcode,
      line.unit,
      line.requestedQty,
      line.snapshotQty,
      line.snapshotSyncedAt,
    ],
  );

  return Number(result.rows[0].line_id);
}

async function insertEvent(client, event) {
  await client.query(
    `
      INSERT INTO ordering.stock_request_events
        (batch_id, request_id, line_id, event_type, actor_user, actor_branch, metadata, note, request_correlation_id)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
    `,
    [
      event.batchId || null,
      event.requestId || null,
      event.lineId || null,
      event.eventType,
      event.actorUser || null,
      event.actorBranch || null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      normalizeNullableText(event.note, EVENT_NOTE_MAX_CHARS),
      event.requestCorrelationId || null,
    ],
  );
}

function canAdminReadAll(auth) {
  return auth?.role === "admin";
}

// Aggregate batch status from its child request statuses (plan §7.1).
function computeBatchStatus(requestRows) {
  const active = requestRows.filter((row) => row.status !== "CANCELLED");
  if (!active.length) {
    return "CANCELLED";
  }
  const anySubmitted = active.some((row) => row.status === "SUBMITTED");
  const anyResponded = active.some((row) => row.status !== "SUBMITTED");
  if (anySubmitted) {
    return anyResponded ? "PARTIALLY_RESPONDED" : "SUBMITTED";
  }
  // Past the response stage. RECEIVED/COMPLETED close the batch; the dispatch
  // states (ACKNOWLEDGED/DISPATCHED) keep it at the ACKNOWLEDGED aggregate since
  // there is no batch-level DISPATCHED status.
  const fulfilled = new Set(["RECEIVED", "COMPLETED"]);
  if (active.every((row) => fulfilled.has(row.status))) {
    return "COMPLETED";
  }
  const acknowledgedOrBeyond = new Set(["ACKNOWLEDGED", "DISPATCHED", "RECEIVED", "COMPLETED"]);
  if (active.every((row) => acknowledgedOrBeyond.has(row.status))) {
    return "ACKNOWLEDGED";
  }
  return "RESPONDED";
}

function computeResponseResult(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return null;
  }
  if (inputs.every((input) => input.lineStatus === "REJECTED")) {
    return "FULLY_REJECTED";
  }
  if (inputs.every((input) => input.lineStatus === "APPROVED_FULL")) {
    return "FULLY_APPROVED";
  }
  return "PARTIALLY_APPROVED";
}

function getDocumentsToGenerate(responseResult) {
  if (responseResult === "FULLY_REJECTED") {
    return ["RESPONSE_SUMMARY"];
  }
  return ["RESPONSE_SUMMARY", "PACKING_SLIP"];
}

function ensureCanReadBatch(auth, batchRow) {
  if (canAdminReadAll(auth)) {
    return;
  }
  if (!auth?.effectiveBranchCode || batchRow.requesting_branch_code !== auth.effectiveBranchCode) {
    throw createHttpError("Forbidden", 403);
  }
}

function ensureCanReadIncomingRequest(auth, requestRow) {
  if (canAdminReadAll(auth)) {
    return;
  }
  if (!auth?.effectiveBranchCode || requestRow.source_branch_code !== auth.effectiveBranchCode) {
    throw createHttpError("Forbidden", 403);
  }
}

function mapResponseRow(row) {
  if (!row) {
    return null;
  }
  return {
    responseId: Number(row.response_id),
    status: row.response_status,
    responseStatus: row.response_status,
    approvedQty: Number(row.approved_qty || 0),
    reasonCode: row.reason_code || null,
    note: row.note || null,
    revalidatedSnapshotQty: row.revalidated_snapshot_qty == null ? null : Number(row.revalidated_snapshot_qty),
    respondedBy: row.responded_by || null,
    supersededBy: row.superseded_by == null ? null : Number(row.superseded_by),
    createdAt: row.created_at,
  };
}

function mapLineRow(row, responseRow) {
  return {
    lineId: Number(row.line_id),
    productCode: row.product_code,
    productNameThai: row.product_name_thai || null,
    productNameEng: row.product_name_eng || null,
    barcode: row.barcode || null,
    unit: row.unit,
    requestedQty: Number(row.requested_qty || 0),
    snapshotQty: row.snapshot_qty == null ? null : Number(row.snapshot_qty),
    snapshotSyncedAt: row.snapshot_synced_at || null,
    status: row.status,
    createdAt: row.created_at,
    response: mapResponseRow(responseRow),
  };
}

function mapRequestDetailRow(requestRow, lineRows, responseMap, batchPublicId) {
  const requestMode = requestRow.request_mode || "STANDARD";
  return {
    requestId: Number(requestRow.request_id),
    publicId: requestRow.public_id,
    batchId: Number(requestRow.batch_id),
    batchPublicId,
    requestingBranchCode: requestRow.requesting_branch_code,
    sourceBranchCode: requestRow.source_branch_code,
    requestMode,
    isAdminAlert: requestMode === "ADMIN_ALERT",
    status: requestRow.status,
    responseResult: requestRow.response_result || null,
    responseNote: requestRow.response_note || null,
    respondedBy: requestRow.responded_by || null,
    respondedAt: requestRow.responded_at || null,
    acknowledgedBy: requestRow.acknowledged_by || null,
    acknowledgedAt: requestRow.acknowledged_at || null,
    version: Number(requestRow.version || 1),
    createdAt: requestRow.created_at,
    updatedAt: requestRow.updated_at,
    lines: lineRows.map((lineRow) => mapLineRow(lineRow, responseMap.get(Number(lineRow.line_id)) || null)),
  };
}

function mapBatchDetail(batchRow, requestRows, lineRows, responseRows) {
  const lineRowsByRequestId = new Map();
  for (const lineRow of lineRows) {
    const requestId = Number(lineRow.request_id);
    if (!lineRowsByRequestId.has(requestId)) {
      lineRowsByRequestId.set(requestId, []);
    }
    lineRowsByRequestId.get(requestId).push(lineRow);
  }

  const responseMap = new Map(responseRows.map((row) => [Number(row.line_id), row]));
  const requests = requestRows.map((requestRow) =>
    mapRequestDetailRow(
      requestRow,
      lineRowsByRequestId.get(Number(requestRow.request_id)) || [],
      responseMap,
      batchRow.public_id,
    ),
  );

  return {
    batchId: Number(batchRow.batch_id),
    publicId: batchRow.public_id,
    requestingBranchCode: batchRow.requesting_branch_code,
    status: batchRow.status,
    createdBy: batchRow.created_by || null,
    note: batchRow.note || null,
    version: Number(batchRow.version || 1),
    submittedAt: batchRow.submitted_at || null,
    createdAt: batchRow.created_at,
    updatedAt: batchRow.updated_at,
    requests,
  };
}

function mapBatchSummary(batchRow, requestRowsByBatchId, lineCountsByRequestId) {
  const childRequests = requestRowsByBatchId.get(Number(batchRow.batch_id)) || [];
  const sourceBranchCodes = childRequests.map((row) => row.source_branch_code).sort((left, right) => left.localeCompare(right));
  const lineCount = childRequests.reduce(
    (sum, row) => sum + Number(lineCountsByRequestId.get(Number(row.request_id)) || 0),
    0,
  );
  const isAdminAlert = childRequests.some((row) => row.request_mode === "ADMIN_ALERT");

  return {
    batchPublicId: batchRow.public_id,
    requestingBranchCode: batchRow.requesting_branch_code,
    status: batchRow.status,
    note: batchRow.note || null,
    submittedAt: batchRow.submitted_at || null,
    createdAt: batchRow.created_at,
    updatedAt: batchRow.updated_at,
    requestCount: childRequests.length,
    lineCount,
    sourceBranchCodes,
    isAdminAlert,
  };
}

function mapIncomingSummary(requestRow, batchMap, lineCountsByRequestId) {
  const batchRow = batchMap.get(Number(requestRow.batch_id)) || null;
  const requestMode = requestRow.request_mode || "STANDARD";
  return {
    requestPublicId: requestRow.public_id,
    batchPublicId: batchRow?.public_id || null,
    requestingBranchCode: requestRow.requesting_branch_code,
    sourceBranchCode: requestRow.source_branch_code,
    requestMode,
    isAdminAlert: requestMode === "ADMIN_ALERT",
    status: requestRow.status,
    responseResult: requestRow.response_result || null,
    responseNote: requestRow.response_note || null,
    submittedAt: batchRow?.submitted_at || null,
    createdAt: requestRow.created_at,
    updatedAt: requestRow.updated_at,
    lineCount: Number(lineCountsByRequestId.get(Number(requestRow.request_id)) || 0),
  };
}

function mapEventRow(row) {
  return {
    eventId: Number(row.event_id),
    batchId: row.batch_id == null ? null : Number(row.batch_id),
    requestId: row.request_id == null ? null : Number(row.request_id),
    lineId: row.line_id == null ? null : Number(row.line_id),
    eventType: row.event_type,
    actorUser: row.actor_user || null,
    actorBranch: row.actor_branch || null,
    metadata: row.metadata || null,
    note: row.note || null,
    requestCorrelationId: row.request_correlation_id || null,
    createdAt: row.created_at,
  };
}

function validateSubmissionAccess(auth) {
  if (!auth?.userId || !auth?.role) {
    throw createHttpError("Unauthorized", 401);
  }
  if (!ALLOWED_SUBMITTER_ROLES.has(auth.role)) {
    throw createHttpError("Forbidden", 403);
  }
  if (!auth.effectiveBranchCode) {
    throw createHttpError("Branch identity required", 403);
  }
}

function validateBranches({ requestingBranchCode, sourceBranches }) {
  for (const branch of sourceBranches.values()) {
    if (!branch) {
      throw createHttpError("Invalid branch code", 400);
    }
    if (!branch.isActive) {
      throw createHttpError(`Branch inactive: ${branch.branchCode}`, 403);
    }
    if (branch.branchCode === requestingBranchCode) {
      throw createHttpError("Source branch cannot match requesting branch.", 400);
    }
  }
}

function validateProducts(productSnapshots, productCodes) {
  const missingCodes = productCodes.filter((productCode) => !productSnapshots.has(productCode));
  if (missingCodes.length) {
    throw createHttpError(`Unknown productCode: ${missingCodes[0]}`, 400);
  }
}

async function submitStockRequestBatch({ db, auth, body, requestId }) {
  validateSubmissionAccess(auth);
  const payload = normalizeSubmitPayload(body);
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const existingBatch = await loadExistingBatchByIdempotency(client, payload.idempotencyKey);
    if (existingBatch) {
      if (
        existingBatch.requesting_branch_code !== auth.effectiveBranchCode ||
        String(existingBatch.created_by || "") !== String(auth.userId || "")
      ) {
        throw createHttpError("Idempotency key already used for a different request.", 409);
      }

      const existingRequests = await loadBatchRequests(client, existingBatch.batch_id);
      await client.query("COMMIT");
      return {
        duplicate: true,
        batchPublicId: existingBatch.public_id,
        requests: existingRequests,
      };
    }

    const sourceBranchCodes = payload.groups.map((group) => group.sourceBranchCode);
    const productCodes = payload.groups.flatMap((group) => group.lines.map((line) => line.productCode));
    const [sourceBranches, productSnapshots] = await Promise.all([
      loadBranchesByCodes(client, sourceBranchCodes),
      loadProductSnapshots(client, productCodes),
    ]);

    validateBranches({
      requestingBranchCode: auth.effectiveBranchCode,
      sourceBranches,
    });
    validateProducts(productSnapshots, productCodes);

    const batch = await insertBatch(client, payload, auth);
    const createdRequests = [];

    await insertEvent(client, {
      batchId: batch.batchId,
      eventType: "REQUEST_BATCH_CREATED",
      actorUser: auth.userId,
      actorBranch: auth.effectiveBranchCode,
      metadata: {
        batch_public_id: batch.publicId,
        requesting_branch_code: auth.effectiveBranchCode,
        source_branch_codes: sourceBranchCodes,
        request_count: payload.groups.length,
      },
      note: payload.note,
      requestCorrelationId: requestId,
    });

    for (const group of payload.groups) {
      const requestRecord = await insertRequest(client, {
        batch,
        auth,
        sourceBranchCode: group.sourceBranchCode,
        requestMode: group.requestMode,
      });

      createdRequests.push({
        publicId: requestRecord.publicId,
        sourceBranchCode: requestRecord.sourceBranchCode,
        requestMode: requestRecord.requestMode,
      });

      await insertEvent(client, {
        batchId: batch.batchId,
        requestId: requestRecord.requestId,
        eventType: "REQUEST_SUBMITTED",
        actorUser: auth.userId,
        actorBranch: auth.effectiveBranchCode,
        metadata: {
          request_public_id: requestRecord.publicId,
          source_branch_code: group.sourceBranchCode,
          request_mode: group.requestMode,
          line_count: group.lines.length,
        },
        requestCorrelationId: requestId,
      });

      for (const line of group.lines) {
        const lineId = await insertLine(client, {
          requestId: requestRecord.requestId,
          line,
          product: productSnapshots.get(line.productCode),
        });

        await insertEvent(client, {
          batchId: batch.batchId,
          requestId: requestRecord.requestId,
          lineId,
          eventType: "REQUEST_LINE_ADDED",
          actorUser: auth.userId,
          actorBranch: auth.effectiveBranchCode,
          metadata: {
            request_public_id: requestRecord.publicId,
            product_code: line.productCode,
            requested_qty: line.requestedQty,
            unit: line.unit,
            snapshot_qty: line.snapshotQty,
            snapshot_synced_at: line.snapshotSyncedAt,
          },
          requestCorrelationId: requestId,
        });
      }

      await insertNotification(client, {
        recipientBranchCode: group.sourceBranchCode,
        type: "REQUEST_SUBMITTED",
        batchId: batch.batchId,
        requestId: requestRecord.requestId,
        message: `สาขา ${auth.effectiveBranchCode} ส่งคำขอ ${requestRecord.publicId}`,
        linkTarget: `/incoming/${encodeURIComponent(requestRecord.publicId)}`,
        dedupKey: `request-submitted:${requestRecord.publicId}`,
      });
    }

    await client.query("COMMIT");
    return {
      duplicate: false,
      batchPublicId: batch.publicId,
      requests: createdRequests.sort((left, right) => left.sourceBranchCode.localeCompare(right.sourceBranchCode)),
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackError) {
      // ignore rollback shadow errors
    }
    if (error && error.code === "23505") {
      throw createHttpError("Idempotency key already used for a different request.", 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function listOutgoingStockRequestBatches({ db, auth, search }) {
  if (!auth?.userId || !auth?.role) throw createHttpError("Unauthorized", 401);
  if (!ALLOWED_SUBMITTER_ROLES.has(auth.role)) throw createHttpError("Forbidden", 403);
  if (!auth.effectiveBranchCode) return [];
  const searchTerm = normalizeSearchTerm(search);
  const requestRows = await loadRequestRowsByRequestingBranch(db, auth.effectiveBranchCode, searchTerm);
  const batchRows = await loadBatchRowsByIds(
    db,
    requestRows.map((row) => row.batch_id),
  );
  const requestRowsByBatchId = new Map();
  for (const requestRow of requestRows) {
    const batchId = Number(requestRow.batch_id);
    if (!requestRowsByBatchId.has(batchId)) {
      requestRowsByBatchId.set(batchId, []);
    }
    requestRowsByBatchId.get(batchId).push(requestRow);
  }

  const lineRows = await loadLineRowsByRequestIds(
    db,
    requestRows.map((row) => row.request_id),
  );
  const lineCountsByRequestId = new Map();
  for (const lineRow of lineRows) {
    const requestId = Number(lineRow.request_id);
    lineCountsByRequestId.set(requestId, Number(lineCountsByRequestId.get(requestId) || 0) + 1);
  }

  return batchRows
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")) || Number(right.batch_id) - Number(left.batch_id))
    .map((batchRow) => mapBatchSummary(batchRow, requestRowsByBatchId, lineCountsByRequestId));
}

async function getStockRequestBatchDetail({ db, auth, publicId }) {
  if (!auth?.userId) {
    throw createHttpError("Unauthorized", 401);
  }

  const batchRow = await loadBatchByPublicId(db, publicId);
  if (!batchRow) {
    throw createHttpError("Not found", 404);
  }
  ensureCanReadBatch(auth, batchRow);

  const requestRows = await loadRequestRowsByBatchId(db, batchRow.batch_id);
  const lineRows = await loadLineRowsByRequestIds(
    db,
    requestRows.map((row) => row.request_id),
  );
  const responseRows = await loadLatestSubmittedResponsesByLineIds(
    db,
    lineRows.map((row) => row.line_id),
  );

  return mapBatchDetail(batchRow, requestRows, lineRows, responseRows);
}

async function listIncomingStockRequests({ db, auth, search, filterBranchCode }) {
  if (!auth?.userId || !auth?.role) throw createHttpError("Unauthorized", 401);
  if (!ALLOWED_SUBMITTER_ROLES.has(auth.role)) throw createHttpError("Forbidden", 403);
  const isAdmin = auth.role === "admin";
  if (!isAdmin && !auth.effectiveBranchCode) return [];
  const sourceBranch = isAdmin ? (filterBranchCode || null) : auth.effectiveBranchCode;
  const searchTerm = normalizeSearchTerm(search);
  const requestRows = await loadIncomingRequestRowsBySourceBranch(db, sourceBranch, searchTerm);
  const batchRows = await loadBatchRowsByIds(
    db,
    requestRows.map((row) => row.batch_id),
  );
  const batchMap = new Map(batchRows.map((row) => [Number(row.batch_id), row]));
  const lineRows = await loadLineRowsByRequestIds(
    db,
    requestRows.map((row) => row.request_id),
  );
  const lineCountsByRequestId = new Map();
  for (const lineRow of lineRows) {
    const requestId = Number(lineRow.request_id);
    lineCountsByRequestId.set(requestId, Number(lineCountsByRequestId.get(requestId) || 0) + 1);
  }

  return requestRows.map((requestRow) => mapIncomingSummary(requestRow, batchMap, lineCountsByRequestId));
}

async function getIncomingStockRequestDetail({ db, auth, publicId }) {
  if (!auth?.userId) {
    throw createHttpError("Unauthorized", 401);
  }

  const requestRow = await loadRequestByPublicId(db, publicId);
  if (!requestRow) {
    throw createHttpError("Not found", 404);
  }
  ensureCanReadIncomingRequest(auth, requestRow);

  const batchRow = await loadBatchById(db, requestRow.batch_id);
  const lineRows = await loadLineRowsByRequestIds(db, [requestRow.request_id]);
  const responseRows = await loadLatestSubmittedResponsesByLineIds(
    db,
    lineRows.map((row) => row.line_id),
  );
  const responseMap = new Map(responseRows.map((row) => [Number(row.line_id), row]));

  return mapRequestDetailRow(
    requestRow,
    lineRows,
    responseMap,
    batchRow?.public_id || null,
  );
}

async function getStockRequestEvents({ db, auth, publicId }) {
  if (!auth?.userId) {
    throw createHttpError("Unauthorized", 401);
  }

  const batchRow = await loadBatchByPublicId(db, publicId);
  if (!batchRow) {
    throw createHttpError("Not found", 404);
  }
  ensureCanReadBatch(auth, batchRow);

  const eventRows = await loadEventRowsByBatchId(db, batchRow.batch_id);
  return {
    batchPublicId: batchRow.public_id,
    events: eventRows.map(mapEventRow),
  };
}

// Validate a single line response and resolve approved_qty + line status per the
// business rules: full approval ships the requested qty; custom lets the source
// branch set any non-negative quantity (including more than requested); zero maps
// to reject; rejection always needs a reason.
function normalizeLineResponseInput(rawLine, lineRow) {
  const lineId = Number(rawLine?.lineId ?? rawLine?.line_id);
  const responseStatus = normalizeText(rawLine?.responseStatus ?? rawLine?.response_status).toUpperCase();
  const reasonCode = normalizeNullableText(rawLine?.reasonCode ?? rawLine?.reason_code, REASON_CODE_MAX_CHARS);
  const note = normalizeNullableText(rawLine?.note, RESPONSE_NOTE_MAX_CHARS);
  const requestedQty = Number(lineRow.requested_qty || 0);

  if (!VALID_RESPONSE_STATUSES.has(responseStatus)) {
    throw createHttpError(`Invalid responseStatus for line ${lineId}.`, 422);
  }

  let approvedQty;
  if (responseStatus === "APPROVED_FULL") {
    approvedQty = requestedQty;
    return { lineId, responseStatus, lineStatus: "APPROVED_FULL", approvedQty, reasonCode, note };
  }

  if (responseStatus === "REJECTED") {
    approvedQty = 0;
    if (!reasonCode && !note) {
      throw createHttpError(`A reason is required to reject line ${lineId}.`, 422);
    }
    return { lineId, responseStatus, lineStatus: "REJECTED", approvedQty, reasonCode, note };
  }

  approvedQty = parseOptionalNonNegativeNumber(rawLine?.approvedQty ?? rawLine?.approved_qty);
  if (approvedQty == null) {
    throw createHttpError(`approvedQty for line ${lineId} must be a non-negative number.`, 422);
  }
  if (approvedQty === 0) {
    if (!reasonCode && !note) {
      throw createHttpError(`A reason is required when approvedQty is 0 for line ${lineId}.`, 422);
    }
    return { lineId, responseStatus, lineStatus: "REJECTED", approvedQty: 0, reasonCode, note };
  }
  if (approvedQty === requestedQty) {
    return { lineId, responseStatus, lineStatus: "APPROVED_FULL", approvedQty, reasonCode, note };
  }
  return { lineId, responseStatus, lineStatus: "CUSTOM", approvedQty, reasonCode, note };
}

async function insertLineResponse(client, { lineId, input, auth, isSubmitted }) {
  const result = await client.query(
    `
      INSERT INTO ordering.stock_request_line_responses
        (line_id, response_status, approved_qty, reason_code, note, revalidated_snapshot_qty, is_submitted, responded_by)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING response_id
    `,
    [
      lineId,
      input.responseStatus,
      input.approvedQty,
      input.reasonCode,
      input.note,
      input.revalidatedSnapshotQty == null ? null : input.revalidatedSnapshotQty,
      isSubmitted,
      auth.userId,
    ],
  );
  return Number(result.rows[0].response_id);
}

async function updateLineStatus(client, lineId, status) {
  await client.query(
    `UPDATE ordering.stock_request_lines SET status = $2 WHERE line_id = $1`,
    [lineId, status],
  );
}

async function markRequestResponded(client, { requestId, auth, expectedVersion }) {
  const result = await client.query(
    `
      UPDATE ordering.stock_requests
      SET status = 'RESPONDED', responded_by = $2, responded_at = now(), version = version + 1, updated_at = now()
      WHERE request_id = $1
        AND status = 'SUBMITTED'
        AND ($3::int IS NULL OR version = $3)
      RETURNING request_id, version
    `,
    [requestId, auth.userId, expectedVersion],
  );
  return result.rows[0] || null;
}

async function updateRequestResponseSummary(client, { requestId, responseResult, responseNote }) {
  await client.query(
    `
      UPDATE ordering.stock_requests
      SET response_result = $2, response_note = $3, updated_at = now()
      WHERE request_id = $1
    `,
    [requestId, responseResult, normalizeNullableText(responseNote, RESPONSE_NOTE_MAX_CHARS)],
  );
}

async function updateBatchStatus(client, batchId, status) {
  await client.query(
    `UPDATE ordering.stock_request_batches SET status = $2, updated_at = now() WHERE batch_id = $1`,
    [batchId, status],
  );
}

async function insertNotification(client, notification) {
  await client.query(
    `
      INSERT INTO ordering.stock_request_notifications
        (recipient_branch_code, recipient_user, type, batch_id, request_id, message, link_target, dedup_key)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (dedup_key) DO NOTHING
    `,
    [
      notification.recipientBranchCode,
      notification.recipientUser || null,
      notification.type,
      notification.batchId || null,
      notification.requestId || null,
      notification.message || null,
      notification.linkTarget || null,
      notification.dedupKey || null,
    ],
  );
}

async function markRequestNotificationsResponded(client, { requestId, recipientBranchCode }) {
  await client.query(
    `
      UPDATE ordering.stock_request_notifications
      SET read_at = COALESCE(read_at, now())
      WHERE request_id = $1
        AND recipient_branch_code = $2
        AND type = 'REQUEST_SUBMITTED'
        AND read_at IS NULL
    `,
    [requestId, recipientBranchCode],
  );
}

async function loadRequestForResponse(client, publicId, auth) {
  const requestRow = await loadRequestByPublicId(client, publicId);
  if (!requestRow) {
    throw createHttpError("Not found", 404);
  }
  ensureCanReadIncomingRequest(auth, requestRow);
  if (requestRow.status !== "SUBMITTED") {
    throw createHttpError("This request has already been responded to.", 409);
  }
  return requestRow;
}

// WP-08: save a single non-final draft line response (is_submitted = false).
async function saveLineResponseDraft({ db, auth, requestPublicId, lineId, body }) {
  validateSubmissionAccess(auth);
  const numericLineId = Number(lineId);
  if (!Number.isInteger(numericLineId) || numericLineId <= 0) {
    throw createHttpError("Invalid lineId.", 400);
  }

  const requestRow = await loadRequestForResponse(db, requestPublicId, auth);
  const lineRows = await loadLineRowsByRequestIds(db, [requestRow.request_id]);
  const lineRow = lineRows.find((row) => Number(row.line_id) === numericLineId);
  if (!lineRow) {
    throw createHttpError("Line not found for this request.", 404);
  }

  const input = normalizeLineResponseInput({ ...body, lineId: numericLineId }, lineRow);
  const responseId = await insertLineResponse(db, { lineId: numericLineId, input, auth, isSubmitted: false });

  return {
    responseId,
    lineId: numericLineId,
    status: input.responseStatus,
    approvedQty: input.approvedQty,
    isSubmitted: false,
  };
}

// WP-08: submit final responses for every line in one transaction. Sets line and
// request statuses, writes domain events, recomputes the batch aggregate status,
// and notifies the requesting branch. Optimistic-locked on the request version.
async function submitStockRequestResponse({ db, auth, requestPublicId, body, requestId }) {
  validateSubmissionAccess(auth);

  const responsesInput = Array.isArray(body?.responses) ? body.responses : null;
  const decisionNote = normalizeNullableText(body?.decisionNote ?? body?.decision_note, RESPONSE_NOTE_MAX_CHARS);
  if (!responsesInput || !responsesInput.length) {
    throw createHttpError("responses must contain at least one line response.", 400);
  }
  const expectedVersion = body?.version == null ? null : Number(body.version);
  if (expectedVersion != null && !Number.isInteger(expectedVersion)) {
    throw createHttpError("version must be an integer.", 400);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const requestRow = await loadRequestForResponse(client, requestPublicId, auth);
    if (expectedVersion != null && Number(requestRow.version) !== expectedVersion) {
      throw createHttpError("Request was modified by someone else. Please reload.", 409);
    }

    const lineRows = await loadLineRowsByRequestIds(client, [requestRow.request_id]);
    const lineRowById = new Map(lineRows.map((row) => [Number(row.line_id), row]));

    const seen = new Set();
    const normalizedInputs = [];
    for (const rawLine of responsesInput) {
      const candidateId = Number(rawLine?.lineId ?? rawLine?.line_id);
      const lineRow = lineRowById.get(candidateId);
      if (!lineRow) {
        throw createHttpError(`Line ${candidateId} does not belong to this request.`, 422);
      }
      if (seen.has(candidateId)) {
        throw createHttpError(`Duplicate response for line ${candidateId}.`, 422);
      }
      seen.add(candidateId);
      normalizedInputs.push(normalizeLineResponseInput(rawLine, lineRow));
    }
    if (seen.size !== lineRows.length) {
      throw createHttpError("Every line must be answered before submitting.", 422);
    }

    for (const input of normalizedInputs) {
      const responseId = await insertLineResponse(client, { lineId: input.lineId, input, auth, isSubmitted: true });
      await updateLineStatus(client, input.lineId, input.lineStatus);
      await insertEvent(client, {
        batchId: requestRow.batch_id,
        requestId: requestRow.request_id,
        lineId: input.lineId,
        eventType: `LINE_${input.responseStatus}`,
        actorUser: auth.userId,
        actorBranch: auth.effectiveBranchCode,
        metadata: {
          response_id: responseId,
          approved_qty: input.approvedQty,
          reason_code: input.reasonCode,
        },
        note: input.note,
        requestCorrelationId: requestId,
      });
    }

    const responseResult = computeResponseResult(normalizedInputs);
    const updatedRequest = await markRequestResponded(client, {
      requestId: requestRow.request_id,
      auth,
      expectedVersion,
    });
    if (!updatedRequest) {
      throw createHttpError("Request was modified by someone else. Please reload.", 409);
    }
    await updateRequestResponseSummary(client, {
      requestId: requestRow.request_id,
      responseResult,
      responseNote: decisionNote,
    });

    await insertEvent(client, {
      batchId: requestRow.batch_id,
      requestId: requestRow.request_id,
      eventType: "RESPONSE_SUBMITTED",
      actorUser: auth.userId,
      actorBranch: auth.effectiveBranchCode,
      metadata: {
        request_public_id: requestRow.public_id,
        line_count: lineRows.length,
        response_result: responseResult,
      },
      note: decisionNote,
      requestCorrelationId: requestId,
    });

    const siblingRequests = await loadRequestRowsByBatchId(client, requestRow.batch_id);
    const batchStatus = computeBatchStatus(siblingRequests);
    await updateBatchStatus(client, requestRow.batch_id, batchStatus);
    await markRequestNotificationsResponded(client, {
      requestId: requestRow.request_id,
      recipientBranchCode: requestRow.source_branch_code,
    });

    await insertNotification(client, {
      recipientBranchCode: requestRow.requesting_branch_code,
      type: "RESPONSE_SUBMITTED",
      batchId: requestRow.batch_id,
      requestId: requestRow.request_id,
      message: `สาขา ${requestRow.source_branch_code} ตอบกลับคำขอ ${requestRow.public_id}`,
      linkTarget: "/requests",
      dedupKey: `response-submitted:${requestRow.public_id}`,
    });

    await client.query("COMMIT");
    return {
      requestPublicId: requestRow.public_id,
      status: "RESPONDED",
      responseResult,
      version: Number(updatedRequest.version),
      batchStatus,
      documentsToGenerate: getDocumentsToGenerate(responseResult),
      lines: normalizedInputs.map((input) => ({
        lineId: input.lineId,
        status: input.lineStatus,
        approvedQty: input.approvedQty,
      })),
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackError) {
      // ignore rollback shadow errors
    }
    throw error;
  } finally {
    client.release();
  }
}

function ensureCanAcknowledge(auth, requestRow) {
  if (canAdminReadAll(auth)) {
    return;
  }
  if (!auth?.effectiveBranchCode || requestRow.requesting_branch_code !== auth.effectiveBranchCode) {
    throw createHttpError("Forbidden", 403);
  }
}

async function markRequestAcknowledged(client, { requestId, auth, expectedVersion }) {
  const result = await client.query(
    `
      UPDATE ordering.stock_requests
      SET status = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = now(), version = version + 1, updated_at = now()
      WHERE request_id = $1
        AND status = 'RESPONDED'
        AND ($3::int IS NULL OR version = $3)
      RETURNING request_id, version
    `,
    [requestId, auth.userId, expectedVersion],
  );
  return result.rows[0] || null;
}

// WP-11: the requesting branch acknowledges a source branch's response.
async function acknowledgeStockRequest({ db, auth, requestPublicId, body, requestId }) {
  validateSubmissionAccess(auth);
  const expectedVersion = body?.version == null ? null : Number(body.version);
  if (expectedVersion != null && !Number.isInteger(expectedVersion)) {
    throw createHttpError("version must be an integer.", 400);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const requestRow = await loadRequestByPublicId(client, requestPublicId);
    if (!requestRow) {
      throw createHttpError("Not found", 404);
    }
    ensureCanAcknowledge(auth, requestRow);
    if (requestRow.status !== "RESPONDED") {
      throw createHttpError("Only a responded request can be acknowledged.", 409);
    }
    if (expectedVersion != null && Number(requestRow.version) !== expectedVersion) {
      throw createHttpError("Request was modified by someone else. Please reload.", 409);
    }

    const updatedRequest = await markRequestAcknowledged(client, {
      requestId: requestRow.request_id,
      auth,
      expectedVersion,
    });
    if (!updatedRequest) {
      throw createHttpError("Request was modified by someone else. Please reload.", 409);
    }

    await insertEvent(client, {
      batchId: requestRow.batch_id,
      requestId: requestRow.request_id,
      eventType: "RESPONSE_ACKNOWLEDGED",
      actorUser: auth.userId,
      actorBranch: auth.effectiveBranchCode,
      metadata: { request_public_id: requestRow.public_id },
      requestCorrelationId: requestId,
    });

    const siblingRequests = await loadRequestRowsByBatchId(client, requestRow.batch_id);
    const batchStatus = computeBatchStatus(siblingRequests);
    await updateBatchStatus(client, requestRow.batch_id, batchStatus);

    await insertNotification(client, {
      recipientBranchCode: requestRow.source_branch_code,
      type: "RESPONSE_ACKNOWLEDGED",
      batchId: requestRow.batch_id,
      requestId: requestRow.request_id,
      message: `สาขา ${requestRow.requesting_branch_code} รับทราบการตอบกลับคำขอ ${requestRow.public_id}`,
      linkTarget: "/incoming",
      dedupKey: `acknowledged:${requestRow.public_id}`,
    });

    await client.query("COMMIT");
    return {
      requestPublicId: requestRow.public_id,
      status: "ACKNOWLEDGED",
      version: Number(updatedRequest.version),
      batchStatus,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackError) {
      // ignore rollback shadow errors
    }
    throw error;
  } finally {
    client.release();
  }
}

// ---- WP-12: printable packing document (immutable versioned snapshot) ----

function ensureCanAccessDocument(auth, requestRow) {
  if (canAdminReadAll(auth)) {
    return;
  }
  const branch = auth?.effectiveBranchCode;
  if (!branch || (requestRow.source_branch_code !== branch && requestRow.requesting_branch_code !== branch)) {
    throw createHttpError("Forbidden", 403);
  }
}

async function loadMaxDocumentForRequest(client, requestId, documentType) {
  const result = await client.query(
    `
      SELECT document_id, version
      FROM ordering.stock_request_documents
      WHERE request_id = $1
        AND document_type = $2
      ORDER BY version DESC
      LIMIT 1
    `,
    [requestId, documentType],
  );
  return result.rows[0] || null;
}

async function loadLatestDocumentPayload(dbLike, requestId, documentType = null) {
  const result = await dbLike.query(
    `
      SELECT document_id, request_id, document_type, version, document_payload, generated_by, generated_at, reprint_of
      FROM ordering.stock_request_documents
      WHERE request_id = $1
        AND ($2::text IS NULL OR document_type = $2)
      ORDER BY version DESC
      LIMIT 1
    `,
    [requestId, documentType],
  );
  return result.rows[0] || null;
}

async function insertDocument(client, { requestId, documentType, version, payload, generatedBy, reprintOf }) {
  const result = await client.query(
    `
      INSERT INTO ordering.stock_request_documents
        (request_id, document_type, version, document_payload, generated_by, reprint_of)
      VALUES
        ($1, $2, $3, $4::jsonb, $5, $6)
      RETURNING document_id, generated_at
    `,
    [requestId, documentType, version, JSON.stringify(payload), generatedBy, reprintOf],
  );
  return result.rows[0];
}

function buildDocumentLineItems(lineRows, responseMap) {
  return lineRows.map((lineRow) => {
    const response = responseMap.get(Number(lineRow.line_id)) || null;
    return {
      lineId: Number(lineRow.line_id),
      productCode: lineRow.product_code,
      productNameThai: lineRow.product_name_thai || null,
      productNameEng: lineRow.product_name_eng || null,
      barcode: lineRow.barcode || null,
      unit: lineRow.unit,
      requestedQty: Number(lineRow.requested_qty || 0),
      approvedQty: response ? Number(response.approved_qty || 0) : 0,
      responseStatus: response ? response.response_status : "PENDING",
      reasonCode: response ? response.reason_code || null : null,
      note: response ? response.note || null : null,
    };
  });
}

function buildDocumentBasePayload({ requestRow, batchRow, version }) {
  return {
    requestPublicId: requestRow.public_id,
    batchPublicId: batchRow?.public_id || null,
    sourceBranchCode: requestRow.source_branch_code,
    requestingBranchCode: requestRow.requesting_branch_code,
    requestedAt: batchRow?.submitted_at || null,
    respondedAt: requestRow.responded_at || null,
    responseResult: requestRow.response_result || null,
    responseNote: requestRow.response_note || null,
    version,
  };
}

function buildResponseSummaryPayload({ requestRow, batchRow, lineRows, responseMap, version }) {
  return {
    documentType: "RESPONSE_SUMMARY",
    ...buildDocumentBasePayload({ requestRow, batchRow, version }),
    lines: buildDocumentLineItems(lineRows, responseMap),
  };
}

function buildPackingSlipPayload({ requestRow, batchRow, lineRows, responseMap, version }) {
  return {
    documentType: "PACKING_SLIP",
    ...buildDocumentBasePayload({ requestRow, batchRow, version }),
    lines: buildDocumentLineItems(lineRows, responseMap).filter((line) => Number(line.approvedQty || 0) > 0),
  };
}

function buildDocumentPayloadByType({ documentType, requestRow, batchRow, lineRows, responseMap, version }) {
  if (documentType === "RESPONSE_SUMMARY") {
    return buildResponseSummaryPayload({ requestRow, batchRow, lineRows, responseMap, version });
  }
  if (documentType === "PACKING_SLIP") {
    return buildPackingSlipPayload({ requestRow, batchRow, lineRows, responseMap, version });
  }
  throw createHttpError(`Unsupported document type: ${documentType}`, 400);
}

function normalizeRequestedDocumentTypes(rawTypes, requestRow) {
  if (Array.isArray(rawTypes) && rawTypes.length > 0) {
    const uniqueTypes = [...new Set(rawTypes.map((value) => normalizeText(value).toUpperCase()).filter(Boolean))];
    const invalidType = uniqueTypes.find((type) => !STOCK_REQUEST_DOCUMENT_TYPES.has(type));
    if (invalidType) {
      throw createHttpError(`Unsupported document type: ${invalidType}`, 400);
    }
    return uniqueTypes;
  }
  return getDocumentsToGenerate(requestRow.response_result);
}

// WP-12: source branch generates (or reprints) immutable request documents.
async function generateStockRequestDocuments({ db, auth, requestPublicId, body, requestId }) {
  validateSubmissionAccess(auth);
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const requestRow = await loadRequestByPublicId(client, requestPublicId);
    if (!requestRow) {
      throw createHttpError("Not found", 404);
    }
    ensureCanReadIncomingRequest(auth, requestRow); // source branch (or admin) only
    if (requestRow.status === "SUBMITTED" || requestRow.status === "CANCELLED") {
      throw createHttpError("A document can only be generated after the request has been responded to.", 409);
    }
    if (!requestRow.response_result) {
      throw createHttpError("Request response summary is missing. Please resubmit the response.", 409);
    }

    const lineRows = await loadLineRowsByRequestIds(client, [requestRow.request_id]);
    const responseRows = await loadLatestSubmittedResponsesByLineIds(
      client,
      lineRows.map((row) => row.line_id),
    );
    const responseMap = new Map(responseRows.map((row) => [Number(row.line_id), row]));
    const batchRow = await loadBatchById(client, requestRow.batch_id);
    const requestedTypes = normalizeRequestedDocumentTypes(body?.types, requestRow);
    const documents = [];

    for (const documentType of requestedTypes) {
      const previous = await loadMaxDocumentForRequest(client, requestRow.request_id, documentType);
      const version = previous ? Number(previous.version) + 1 : 1;
      const payload = buildDocumentPayloadByType({
        documentType,
        requestRow,
        batchRow,
        lineRows,
        responseMap,
        version,
      });

      const inserted = await insertDocument(client, {
        requestId: requestRow.request_id,
        documentType,
        version,
        payload,
        generatedBy: auth.userId,
        reprintOf: previous ? previous.document_id : null,
      });

      await insertEvent(client, {
        batchId: requestRow.batch_id,
        requestId: requestRow.request_id,
        eventType: version > 1 ? "DOCUMENT_REPRINTED" : "DOCUMENT_GENERATED",
        actorUser: auth.userId,
        actorBranch: auth.effectiveBranchCode,
        metadata: { document_id: Number(inserted.document_id), document_type: documentType, version },
        requestCorrelationId: requestId,
      });

      documents.push({
        documentId: Number(inserted.document_id),
        documentType,
        version,
        reprint: version > 1,
        document: { ...payload, generatedAt: inserted.generated_at, generatedBy: auth.userId },
      });
    }

    await client.query("COMMIT");
    return {
      requestPublicId: requestRow.public_id,
      documents,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackError) {
      // ignore rollback shadow errors
    }
    throw error;
  } finally {
    client.release();
  }
}

async function generateStockRequestDocument({ db, auth, requestPublicId, requestId }) {
  const result = await generateStockRequestDocuments({
    db,
    auth,
    requestPublicId,
    body: { types: ["PACKING_SLIP"] },
    requestId,
  });
  const firstDocument = result.documents[0] || null;
  if (!firstDocument) {
    throw createHttpError("No document was generated.", 500);
  }
  return firstDocument;
}

async function getStockRequestDocument({ db, auth, requestPublicId, documentType = null }) {
  validateSubmissionAccess(auth);

  const requestRow = await loadRequestByPublicId(db, requestPublicId);
  if (!requestRow) {
    throw createHttpError("Not found", 404);
  }
  ensureCanAccessDocument(auth, requestRow);

  const normalizedDocumentType = normalizeNullableText(documentType)?.toUpperCase() || null;
  const row = await loadLatestDocumentPayload(db, requestRow.request_id, normalizedDocumentType);
  if (!row) {
    throw createHttpError("No document has been generated for this request.", 404);
  }

  const payload =
    typeof row.document_payload === "string" ? JSON.parse(row.document_payload) : row.document_payload;
  return {
    documentId: Number(row.document_id),
    documentType: row.document_type,
    version: Number(row.version),
    reprint: Number(row.version) > 1,
    document: { ...payload, generatedAt: row.generated_at, generatedBy: row.generated_by || null },
  };
}

// ---- WP-13: dispatch & receipt fulfillment (Phase 5) ----

function sumByLine(rows, field) {
  const map = new Map();
  for (const row of rows) {
    const lineId = Number(row.line_id);
    map.set(lineId, (map.get(lineId) || 0) + Number(row[field] || 0));
  }
  return map;
}

// Parse a set of per-line fulfillment quantities, requiring every request line to
// be present exactly once with a non-negative quantity.
function normalizeFulfillmentLines(rawLines, lineRows, qtyField) {
  if (!Array.isArray(rawLines) || !rawLines.length) {
    throw createHttpError(`${qtyField} lines are required.`, 400);
  }
  const validLineIds = new Set(lineRows.map((row) => Number(row.line_id)));
  const seen = new Set();
  const result = [];
  for (const raw of rawLines) {
    const lineId = Number(raw?.lineId ?? raw?.line_id);
    if (!validLineIds.has(lineId)) {
      throw createHttpError(`Line ${lineId} does not belong to this request.`, 422);
    }
    if (seen.has(lineId)) {
      throw createHttpError(`Duplicate line ${lineId}.`, 422);
    }
    seen.add(lineId);
    const qty = parseOptionalNonNegativeNumber(raw?.[qtyField] ?? raw?.qty);
    if (qty == null) {
      throw createHttpError(`${qtyField} for line ${lineId} must be a non-negative number.`, 422);
    }
    result.push({ lineId, qty });
  }
  if (seen.size !== lineRows.length) {
    throw createHttpError("Every line must be included.", 422);
  }
  return result;
}

async function transitionRequestStatus(client, { requestId, fromStatus, toStatus, expectedVersion }) {
  const result = await client.query(
    `
      UPDATE ordering.stock_requests
      SET status = $2, version = version + 1, updated_at = now()
      WHERE request_id = $1
        AND status = $3
        AND ($4::int IS NULL OR version = $4)
      RETURNING request_id, version
    `,
    [requestId, toStatus, fromStatus, expectedVersion],
  );
  return result.rows[0] || null;
}

async function insertShipment(client, { requestId, dispatchedBy, note }) {
  const result = await client.query(
    `
      INSERT INTO ordering.stock_request_shipments (request_id, dispatched_by, note)
      VALUES ($1, $2, $3)
      RETURNING shipment_id, dispatched_at
    `,
    [requestId, dispatchedBy, note],
  );
  return result.rows[0];
}

async function insertShipmentLine(client, { shipmentId, lineId, dispatchedQty }) {
  await client.query(
    `
      INSERT INTO ordering.stock_request_shipment_lines (shipment_id, line_id, dispatched_qty)
      VALUES ($1, $2, $3)
    `,
    [shipmentId, lineId, dispatchedQty],
  );
}

async function insertReceipt(client, { requestId, receivedBy, note }) {
  const result = await client.query(
    `
      INSERT INTO ordering.stock_request_receipts (request_id, received_by, note)
      VALUES ($1, $2, $3)
      RETURNING receipt_id, received_at
    `,
    [requestId, receivedBy, note],
  );
  return result.rows[0];
}

async function insertReceiptLine(client, { receiptId, lineId, receivedQty }) {
  await client.query(
    `
      INSERT INTO ordering.stock_request_receipt_lines (receipt_id, line_id, received_qty)
      VALUES ($1, $2, $3)
    `,
    [receiptId, lineId, receivedQty],
  );
}

async function loadShipmentsByRequest(dbLike, requestId) {
  const result = await dbLike.query(
    `
      SELECT shipment_id, dispatched_by, note, dispatched_at
      FROM ordering.stock_request_shipments
      WHERE request_id = $1
      ORDER BY shipment_id DESC
    `,
    [requestId],
  );
  return result.rows;
}

async function loadReceiptsByRequest(dbLike, requestId) {
  const result = await dbLike.query(
    `
      SELECT receipt_id, received_by, note, received_at
      FROM ordering.stock_request_receipts
      WHERE request_id = $1
      ORDER BY receipt_id DESC
    `,
    [requestId],
  );
  return result.rows;
}

async function loadShipmentLinesByShipmentIds(dbLike, shipmentIds) {
  const ids = [...new Set((shipmentIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  if (!ids.length) {
    return [];
  }
  const result = await dbLike.query(
    `
      SELECT shipment_id, line_id, dispatched_qty
      FROM ordering.stock_request_shipment_lines
      WHERE shipment_id = ANY($1::bigint[])
    `,
    [ids],
  );
  return result.rows;
}

async function loadReceiptLinesByReceiptIds(dbLike, receiptIds) {
  const ids = [...new Set((receiptIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  if (!ids.length) {
    return [];
  }
  const result = await dbLike.query(
    `
      SELECT receipt_id, line_id, received_qty
      FROM ordering.stock_request_receipt_lines
      WHERE receipt_id = ANY($1::bigint[])
    `,
    [ids],
  );
  return result.rows;
}

// WP-13: source branch dispatches an acknowledged request (records ship quantities).
async function dispatchStockRequest({ db, auth, requestPublicId, body, requestId }) {
  validateSubmissionAccess(auth);
  const expectedVersion = body?.version == null ? null : Number(body.version);
  if (expectedVersion != null && !Number.isInteger(expectedVersion)) {
    throw createHttpError("version must be an integer.", 400);
  }
  const note = normalizeNullableText(body?.note, EVENT_NOTE_MAX_CHARS);

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const requestRow = await loadRequestByPublicId(client, requestPublicId);
    if (!requestRow) {
      throw createHttpError("Not found", 404);
    }
    ensureCanReadIncomingRequest(auth, requestRow); // source branch (or admin)
    if (requestRow.status !== "ACKNOWLEDGED") {
      throw createHttpError("Only an acknowledged request can be dispatched.", 409);
    }
    if (expectedVersion != null && Number(requestRow.version) !== expectedVersion) {
      throw createHttpError("Request was modified by someone else. Please reload.", 409);
    }

    const lineRows = await loadLineRowsByRequestIds(client, [requestRow.request_id]);
    const fulfillmentLines = normalizeFulfillmentLines(body?.lines, lineRows, "dispatchedQty");

    const shipment = await insertShipment(client, {
      requestId: requestRow.request_id,
      dispatchedBy: auth.userId,
      note,
    });
    for (const line of fulfillmentLines) {
      await insertShipmentLine(client, {
        shipmentId: shipment.shipment_id,
        lineId: line.lineId,
        dispatchedQty: line.qty,
      });
    }

    const updated = await transitionRequestStatus(client, {
      requestId: requestRow.request_id,
      fromStatus: "ACKNOWLEDGED",
      toStatus: "DISPATCHED",
      expectedVersion,
    });
    if (!updated) {
      throw createHttpError("Request was modified by someone else. Please reload.", 409);
    }

    await insertEvent(client, {
      batchId: requestRow.batch_id,
      requestId: requestRow.request_id,
      eventType: "REQUEST_DISPATCHED",
      actorUser: auth.userId,
      actorBranch: auth.effectiveBranchCode,
      metadata: { shipment_id: Number(shipment.shipment_id) },
      note,
      requestCorrelationId: requestId,
    });

    const siblings = await loadRequestRowsByBatchId(client, requestRow.batch_id);
    const batchStatus = computeBatchStatus(siblings);
    await updateBatchStatus(client, requestRow.batch_id, batchStatus);

    await insertNotification(client, {
      recipientBranchCode: requestRow.requesting_branch_code,
      type: "REQUEST_DISPATCHED",
      batchId: requestRow.batch_id,
      requestId: requestRow.request_id,
      message: `สาขา ${requestRow.source_branch_code} จัดส่งคำขอ ${requestRow.public_id}`,
      linkTarget: "/requests",
      dedupKey: `dispatched:${requestRow.public_id}`,
    });

    await client.query("COMMIT");
    return {
      requestPublicId: requestRow.public_id,
      status: "DISPATCHED",
      version: Number(updated.version),
      shipmentId: Number(shipment.shipment_id),
      batchStatus,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackError) {
      // ignore rollback shadow errors
    }
    throw error;
  } finally {
    client.release();
  }
}

// WP-13: requesting branch records receipt of a dispatched request.
async function receiveStockRequest({ db, auth, requestPublicId, body, requestId }) {
  validateSubmissionAccess(auth);
  const expectedVersion = body?.version == null ? null : Number(body.version);
  if (expectedVersion != null && !Number.isInteger(expectedVersion)) {
    throw createHttpError("version must be an integer.", 400);
  }
  const note = normalizeNullableText(body?.note, EVENT_NOTE_MAX_CHARS);

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const requestRow = await loadRequestByPublicId(client, requestPublicId);
    if (!requestRow) {
      throw createHttpError("Not found", 404);
    }
    ensureCanAcknowledge(auth, requestRow); // requesting branch (or admin)
    if (requestRow.status !== "DISPATCHED") {
      throw createHttpError("Only a dispatched request can be received.", 409);
    }
    if (expectedVersion != null && Number(requestRow.version) !== expectedVersion) {
      throw createHttpError("Request was modified by someone else. Please reload.", 409);
    }

    const lineRows = await loadLineRowsByRequestIds(client, [requestRow.request_id]);
    const fulfillmentLines = normalizeFulfillmentLines(body?.lines, lineRows, "receivedQty");

    const receipt = await insertReceipt(client, {
      requestId: requestRow.request_id,
      receivedBy: auth.userId,
      note,
    });
    for (const line of fulfillmentLines) {
      await insertReceiptLine(client, {
        receiptId: receipt.receipt_id,
        lineId: line.lineId,
        receivedQty: line.qty,
      });
    }

    const updated = await transitionRequestStatus(client, {
      requestId: requestRow.request_id,
      fromStatus: "DISPATCHED",
      toStatus: "RECEIVED",
      expectedVersion,
    });
    if (!updated) {
      throw createHttpError("Request was modified by someone else. Please reload.", 409);
    }

    await insertEvent(client, {
      batchId: requestRow.batch_id,
      requestId: requestRow.request_id,
      eventType: "REQUEST_RECEIVED",
      actorUser: auth.userId,
      actorBranch: auth.effectiveBranchCode,
      metadata: { receipt_id: Number(receipt.receipt_id) },
      note,
      requestCorrelationId: requestId,
    });

    const siblings = await loadRequestRowsByBatchId(client, requestRow.batch_id);
    const batchStatus = computeBatchStatus(siblings);
    await updateBatchStatus(client, requestRow.batch_id, batchStatus);

    await insertNotification(client, {
      recipientBranchCode: requestRow.source_branch_code,
      type: "REQUEST_RECEIVED",
      batchId: requestRow.batch_id,
      requestId: requestRow.request_id,
      message: `สาขา ${requestRow.requesting_branch_code} รับสินค้าตามคำขอ ${requestRow.public_id}`,
      linkTarget: "/incoming",
      dedupKey: `received:${requestRow.public_id}`,
    });

    await client.query("COMMIT");
    return {
      requestPublicId: requestRow.public_id,
      status: "RECEIVED",
      version: Number(updated.version),
      receiptId: Number(receipt.receipt_id),
      batchStatus,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackError) {
      // ignore rollback shadow errors
    }
    throw error;
  } finally {
    client.release();
  }
}

// WP-13: difference report across approved / dispatched / received quantities.
async function getStockRequestFulfillment({ db, auth, requestPublicId }) {
  validateSubmissionAccess(auth);

  const requestRow = await loadRequestByPublicId(db, requestPublicId);
  if (!requestRow) {
    throw createHttpError("Not found", 404);
  }
  ensureCanAccessDocument(auth, requestRow); // source or requesting branch

  const lineRows = await loadLineRowsByRequestIds(db, [requestRow.request_id]);
  const responseRows = await loadLatestSubmittedResponsesByLineIds(
    db,
    lineRows.map((row) => row.line_id),
  );
  const responseMap = new Map(responseRows.map((row) => [Number(row.line_id), row]));

  const shipments = await loadShipmentsByRequest(db, requestRow.request_id);
  const receipts = await loadReceiptsByRequest(db, requestRow.request_id);
  const shipmentLines = await loadShipmentLinesByShipmentIds(db, shipments.map((row) => row.shipment_id));
  const receiptLines = await loadReceiptLinesByReceiptIds(db, receipts.map((row) => row.receipt_id));
  const dispatchedByLine = sumByLine(shipmentLines, "dispatched_qty");
  const receivedByLine = sumByLine(receiptLines, "received_qty");

  const lines = lineRows.map((lineRow) => {
    const lineId = Number(lineRow.line_id);
    const response = responseMap.get(lineId) || null;
    const approvedQty = response ? Number(response.approved_qty || 0) : 0;
    const dispatchedQty = dispatchedByLine.get(lineId) || 0;
    const receivedQty = receivedByLine.get(lineId) || 0;
    return {
      lineId,
      productCode: lineRow.product_code,
      productNameThai: lineRow.product_name_thai || null,
      productNameEng: lineRow.product_name_eng || null,
      unit: lineRow.unit,
      requestedQty: Number(lineRow.requested_qty || 0),
      approvedQty,
      dispatchedQty,
      receivedQty,
      dispatchVariance: dispatchedQty - approvedQty,
      receiveVariance: receivedQty - dispatchedQty,
      hasDifference: dispatchedQty !== approvedQty || receivedQty !== dispatchedQty,
    };
  });

  return {
    requestPublicId: requestRow.public_id,
    status: requestRow.status,
    sourceBranchCode: requestRow.source_branch_code,
    requestingBranchCode: requestRow.requesting_branch_code,
    dispatchedAt: shipments[0]?.dispatched_at || null,
    dispatchedBy: shipments[0]?.dispatched_by || null,
    receivedAt: receipts[0]?.received_at || null,
    receivedBy: receipts[0]?.received_by || null,
    lines,
  };
}

// ---- WP-09: DB-backed notifications (read side; writes happen in WP-08) ----

const NOTIFICATION_LIST_LIMIT = 50;

function mapNotificationRow(row) {
  return {
    notificationId: Number(row.notification_id),
    type: row.type,
    message: row.message || null,
    linkTarget: row.link_target || null,
    batchId: row.batch_id == null ? null : Number(row.batch_id),
    requestId: row.request_id == null ? null : Number(row.request_id),
    readAt: row.read_at || null,
    createdAt: row.created_at,
  };
}

async function loadNotificationsByBranch(dbLike, branchCode, limit) {
  const result = await dbLike.query(
    `
      SELECT
        notification_id,
        recipient_branch_code,
        recipient_user,
        type,
        batch_id,
        request_id,
        message,
        link_target,
        dedup_key,
        read_at,
        created_at
      FROM ordering.stock_request_notifications
      WHERE recipient_branch_code = $1
      ORDER BY created_at DESC, notification_id DESC
      LIMIT $2
    `,
    [branchCode, limit],
  );
  return result.rows;
}

async function listStockRequestNotifications({ db, auth }) {
  validateSubmissionAccess(auth);
  const rows = await loadNotificationsByBranch(db, auth.effectiveBranchCode, NOTIFICATION_LIST_LIMIT);
  return rows.map(mapNotificationRow);
}

async function getUnreadNotificationCount({ db, auth }) {
  if (!auth?.userId || !auth?.role) {
    throw createHttpError("Unauthorized", 401);
  }
  if (!auth.effectiveBranchCode) {
    return 0;
  }
  const result = await db.query(
    `
      SELECT COUNT(*)::int AS unread_count
      FROM ordering.stock_request_notifications
      WHERE recipient_branch_code = $1
        AND read_at IS NULL
    `,
    [auth.effectiveBranchCode],
  );
  return Number(result.rows[0]?.unread_count || 0);
}

async function markNotificationRead({ db, auth, notificationId }) {
  validateSubmissionAccess(auth);
  const numericId = Number(notificationId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw createHttpError("Invalid notification id.", 400);
  }

  const result = await db.query(
    `
      UPDATE ordering.stock_request_notifications
      SET read_at = COALESCE(read_at, now())
      WHERE notification_id = $1
        AND recipient_branch_code = $2
      RETURNING notification_id, read_at
    `,
    [numericId, auth.effectiveBranchCode],
  );

  if (!result.rows.length) {
    throw createHttpError("Not found", 404);
  }

  return {
    notificationId: Number(result.rows[0].notification_id),
    readAt: result.rows[0].read_at,
  };
}

module.exports = {
  submitStockRequestBatch,
  listOutgoingStockRequestBatches,
  getStockRequestBatchDetail,
  listIncomingStockRequests,
  getIncomingStockRequestDetail,
  getStockRequestEvents,
  saveLineResponseDraft,
  submitStockRequestResponse,
  acknowledgeStockRequest,
  generateStockRequestDocument,
  generateStockRequestDocuments,
  getStockRequestDocument,
  dispatchStockRequest,
  receiveStockRequest,
  getStockRequestFulfillment,
  listStockRequestNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  normalizeSubmitPayload,
  formatBatchPublicId,
  formatRequestPublicId,
};
