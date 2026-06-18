"use strict";

const { normalizeBranchCode } = require("../auth/users");

const BATCH_NOTE_MAX_CHARS = 2000;
const EVENT_NOTE_MAX_CHARS = 2000;
const RESPONSE_NOTE_MAX_CHARS = 2000;
const REASON_CODE_MAX_CHARS = 64;
const ALLOWED_SUBMITTER_ROLES = new Set(["admin", "branch"]);
const VALID_RESPONSE_STATUSES = new Set(["APPROVED_FULL", "APPROVED_PARTIAL", "REJECTED"]);

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
  const value = String(isoTimestamp || "");
  return value.slice(0, 10).replace(/-/g, "") || "00000000";
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
    if (!sourceBranchCode) {
      throw createHttpError(`groups[${groupIndex}].sourceBranchCode must be a 3-digit branch code.`, 400);
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
        status,
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
        status,
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
        status,
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
        status,
        responded_by,
        responded_at,
        acknowledged_by,
        acknowledged_at,
        version,
        created_at,
        updated_at
      FROM ordering.stock_requests
      WHERE source_branch_code = $1
        AND (
          $2::text IS NULL
          OR public_id ILIKE ('%' || $2 || '%')
          OR requesting_branch_code ILIKE ('%' || $2 || '%')
        )
      ORDER BY created_at DESC, request_id DESC
    `,
    [sourceBranchCode, searchTerm],
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

async function insertRequest(client, { batch, auth, sourceBranchCode }) {
  const publicId = formatRequestPublicId(batch.publicId, sourceBranchCode);
  const result = await client.query(
    `
      INSERT INTO ordering.stock_requests
        (public_id, batch_id, requesting_branch_code, source_branch_code, status)
      VALUES
        ($1, $2, $3, $4, 'SUBMITTED')
      RETURNING request_id
    `,
    [publicId, batch.batchId, auth.effectiveBranchCode, sourceBranchCode],
  );

  return {
    requestId: Number(result.rows[0].request_id),
    publicId,
    sourceBranchCode,
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
  const allAcknowledged = active.every(
    (row) => row.status === "ACKNOWLEDGED" || row.status === "COMPLETED",
  );
  return allAcknowledged ? "ACKNOWLEDGED" : "RESPONDED";
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
  return {
    requestId: Number(requestRow.request_id),
    publicId: requestRow.public_id,
    batchId: Number(requestRow.batch_id),
    batchPublicId,
    requestingBranchCode: requestRow.requesting_branch_code,
    sourceBranchCode: requestRow.source_branch_code,
    status: requestRow.status,
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
  };
}

function mapIncomingSummary(requestRow, batchMap, lineCountsByRequestId) {
  const batchRow = batchMap.get(Number(requestRow.batch_id)) || null;
  return {
    requestPublicId: requestRow.public_id,
    batchPublicId: batchRow?.public_id || null,
    requestingBranchCode: requestRow.requesting_branch_code,
    sourceBranchCode: requestRow.source_branch_code,
    status: requestRow.status,
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
      });

      createdRequests.push({
        publicId: requestRecord.publicId,
        sourceBranchCode: requestRecord.sourceBranchCode,
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
  validateSubmissionAccess(auth);
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

async function listIncomingStockRequests({ db, auth, search }) {
  validateSubmissionAccess(auth);
  const searchTerm = normalizeSearchTerm(search);
  const requestRows = await loadIncomingRequestRowsBySourceBranch(db, auth.effectiveBranchCode, searchTerm);
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
// business rules: full approval ships the requested qty; partial must be strictly
// between 0 and requested and carry a reason; rejection zeroes qty and needs a reason.
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
  } else if (responseStatus === "APPROVED_PARTIAL") {
    approvedQty = parsePositiveNumber(rawLine?.approvedQty ?? rawLine?.approved_qty);
    if (approvedQty == null || approvedQty >= requestedQty) {
      throw createHttpError(
        `approvedQty for line ${lineId} must be greater than 0 and less than the requested quantity for a partial approval.`,
        422,
      );
    }
    if (!reasonCode && !note) {
      throw createHttpError(`A reason is required for a partial approval on line ${lineId}.`, 422);
    }
  } else {
    approvedQty = 0;
    if (!reasonCode && !note) {
      throw createHttpError(`A reason is required to reject line ${lineId}.`, 422);
    }
  }

  return { lineId, responseStatus, lineStatus: responseStatus, approvedQty, reasonCode, note };
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

    const updatedRequest = await markRequestResponded(client, {
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
      eventType: "RESPONSE_SUBMITTED",
      actorUser: auth.userId,
      actorBranch: auth.effectiveBranchCode,
      metadata: {
        request_public_id: requestRow.public_id,
        line_count: lineRows.length,
      },
      requestCorrelationId: requestId,
    });

    const siblingRequests = await loadRequestRowsByBatchId(client, requestRow.batch_id);
    const batchStatus = computeBatchStatus(siblingRequests);
    await updateBatchStatus(client, requestRow.batch_id, batchStatus);

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
      version: Number(updatedRequest.version),
      batchStatus,
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
  validateSubmissionAccess(auth);
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
  listStockRequestNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  normalizeSubmitPayload,
  formatBatchPublicId,
  formatRequestPublicId,
};
