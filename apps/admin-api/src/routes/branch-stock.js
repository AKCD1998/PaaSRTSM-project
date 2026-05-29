"use strict";

const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { auditLog } = require("../audit");
const { auditBase } = require("../utils/audit-payload");

const docsDir = path.resolve(__dirname, "../../../../docs");

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parsePositiveInt(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return null;
  }
  return n;
}

function parseNonNegativeInt(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    return null;
  }
  return n;
}

function parseBooleanFlag(value) {
  const normalized = normalizeText(value).toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function normalizeQuery(value = "") {
  return normalizeText(value).toLowerCase();
}

function normalizeCategoryValue(value) {
  return normalizeText(value).toLowerCase();
}

function parseTimestamp(value, fallback = null) {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return fallback;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function parseRequiredApiKey(config, req) {
  if (!config.posApiKeys || config.posApiKeys.size === 0) {
    return null;
  }
  const incoming = normalizeText(req.headers["x-api-key"]);
  if (!incoming || !config.posApiKeys.has(incoming)) {
    return "Invalid API key.";
  }
  return null;
}

const ALLOWED_BRANCH_CODES = new Set(["000", "001", "002", "003", "004", "005"]);

function parseBranchStockPayload(body) {
  if (!body || !Array.isArray(body.records)) {
    return { error: "Payload must include a records array." };
  }

  const records = [];
  for (const [index, record] of body.records.entries()) {
    const productCode = normalizeText(record.product_code || record.productCode);
    if (!productCode) {
      return { error: `records[${index}].product_code is required.` };
    }

    const syncedAt = parseTimestamp(record.synced_at || record.syncedAt, new Date().toISOString());
    if (!syncedAt) {
      return { error: `records[${index}].synced_at is invalid.` };
    }

    records.push({
      productCode,
      productNameThai: normalizeNullableText(record.product_name_thai || record.productNameThai),
      productNameEng: normalizeNullableText(record.product_name_eng || record.productNameEng),
      barcode: normalizeNullableText(record.barcode),
      unit: normalizeNullableText(record.unit),
      sourceBranchCode: normalizeNullableText(
        record.branch_code || record.branchCode || record.sourceBranchCode,
      ),
      qtyBranch000: toNumber(record.qty_branch_000 ?? record.qtyBranch000, 0),
      qtyBranch001: toNumber(record.qty_branch_001 ?? record.qtyBranch001, 0),
      qtyBranch002: toNumber(record.qty_branch_002 ?? record.qtyBranch002, 0),
      qtyBranch003: toNumber(record.qty_branch_003 ?? record.qtyBranch003, 0),
      qtyBranch004: toNumber(record.qty_branch_004 ?? record.qtyBranch004, 0),
      qtyBranch005: toNumber(record.qty_branch_005 ?? record.qtyBranch005, 0),
      qtyTotalAllBranches: toNumber(
        record.qty_total_all_branches ?? record.qtyTotalAllBranches,
        0,
      ),
      syncedAt,
      rawPayload: record,
    });
  }

  return { records };
}

function applyBranchQty(record, branchCode, qty) {
  if (branchCode === "000") record.qtyBranch000 = qty;
  if (branchCode === "001") record.qtyBranch001 = qty;
  if (branchCode === "002") record.qtyBranch002 = qty;
  if (branchCode === "003") record.qtyBranch003 = qty;
  if (branchCode === "004") record.qtyBranch004 = qty;
  if (branchCode === "005") record.qtyBranch005 = qty;
}

function sumBranchQty(record) {
  return (
    Number(record.qtyBranch000 || 0) +
    Number(record.qtyBranch001 || 0) +
    Number(record.qtyBranch002 || 0) +
    Number(record.qtyBranch003 || 0) +
    Number(record.qtyBranch004 || 0) +
    Number(record.qtyBranch005 || 0)
  );
}

function parseBranchStockUploadPayload(body) {
  const branchCode = normalizeText(body?.branchCode);
  if (!ALLOWED_BRANCH_CODES.has(branchCode)) {
    return { error: "branchCode must be one of 000, 001, 002, 003, 004, 005." };
  }

  const sourceDate = normalizeText(body?.sourceDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) {
    return { error: "sourceDate must be in YYYY-MM-DD format." };
  }

  const generatedAt = parseTimestamp(body?.generatedAt, null);
  if (!generatedAt) {
    return { error: "generatedAt is required and must be a valid timestamp." };
  }

  const idempotencyKey = normalizeText(body?.idempotencyKey);
  if (!idempotencyKey) {
    return { error: "idempotencyKey is required." };
  }

  const payloadHash = normalizeText(body?.payloadHash);
  if (!payloadHash) {
    return { error: "payloadHash is required." };
  }

  if (!Array.isArray(body?.records)) {
    return { error: "records must be an array." };
  }

  const acceptedRecords = [];
  const rejectedRecords = [];
  const warnings = [];

  for (const [index, record] of body.records.entries()) {
    const productCode = normalizeNullableText(record.productCode || record.product_code);
    const qty = record.qty ?? record.quantity;
    const parsedQty = qty == null || qty === "" ? null : toNumber(qty, Number.NaN);

    if (!productCode) {
      rejectedRecords.push({
        rowNumber: record.sourceRowNumber || null,
        code: "missing_product_code",
        message: `records[${index}] is missing productCode.`,
      });
      continue;
    }

    if (!Number.isFinite(parsedQty)) {
      rejectedRecords.push({
        rowNumber: record.sourceRowNumber || null,
        code: "invalid_qty",
        message: `records[${index}] has invalid qty.`,
      });
      continue;
    }

    if (!normalizeNullableText(record.barcode)) {
      warnings.push(`records[${index}] missing barcode for productCode ${productCode}.`);
    }

    acceptedRecords.push({
      productCode,
      productNameThai: normalizeNullableText(record.productNameThai || record.product_name_thai),
      productNameEng: normalizeNullableText(record.productNameEng || record.product_name_eng),
      barcode: normalizeNullableText(record.barcode),
      unit: normalizeNullableText(record.unit),
      qty: parsedQty,
      sourceRowNumber: record.sourceRowNumber || null,
      rawPayload: record.rawRecord || record.raw_payload || record,
    });
  }

  return {
    branchCode,
    sourceDate,
    generatedAt,
    idempotencyKey,
    payloadHash,
    sourceMode: normalizeNullableText(body?.sourceMode) || "unknown",
    sourceReference: normalizeNullableText(body?.sourceReference),
    rawPayload: body?.raw || {},
    diagnostics: Array.isArray(body?.diagnostics) ? body.diagnostics : [],
    acceptedRecords,
    rejectedRecords,
    warnings,
  };
}

async function upsertBranchStockSnapshot(client, record) {
  let recordToWrite = record;
  if (record.sourceBranchCode && ALLOWED_BRANCH_CODES.has(record.sourceBranchCode)) {
    const existingSnapshot = await readExistingBranchStockSnapshot(client, record.productCode);
    recordToWrite = existingSnapshot
      ? mapExistingSnapshotRowToRecord(existingSnapshot)
      : createEmptySnapshotRecord(record.productCode, record.syncedAt);

    recordToWrite.productCode = record.productCode;
    recordToWrite.productNameThai = record.productNameThai || recordToWrite.productNameThai;
    recordToWrite.productNameEng = record.productNameEng || recordToWrite.productNameEng;
    recordToWrite.barcode = record.barcode || recordToWrite.barcode;
    recordToWrite.unit = record.unit || recordToWrite.unit;
    recordToWrite.syncedAt = record.syncedAt;
    recordToWrite.rawPayload = record.rawPayload || {};

    applyBranchQty(
      recordToWrite,
      record.sourceBranchCode,
      toNumber(record[`qtyBranch${record.sourceBranchCode}`], 0),
    );
    recordToWrite.qtyTotalAllBranches = sumBranchQty(recordToWrite);
  }

  await client.query(
    `
      INSERT INTO ada.branch_stock_snapshots
        (
          product_code,
          product_name_thai,
          product_name_eng,
          barcode,
          unit,
          qty_branch_000,
          qty_branch_001,
          qty_branch_002,
          qty_branch_003,
          qty_branch_004,
          qty_branch_005,
          qty_total_all_branches,
          synced_at,
          source_system,
          source_table,
          source_synced_at,
          raw_payload,
          updated_at
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'AdaAcc', 'TCNTPdtInWha', $13, $14::jsonb, now())
      ON CONFLICT (product_code) DO UPDATE SET
        product_name_thai = EXCLUDED.product_name_thai,
        product_name_eng = EXCLUDED.product_name_eng,
        barcode = EXCLUDED.barcode,
        unit = EXCLUDED.unit,
        qty_branch_000 = EXCLUDED.qty_branch_000,
        qty_branch_001 = EXCLUDED.qty_branch_001,
        qty_branch_002 = EXCLUDED.qty_branch_002,
        qty_branch_003 = EXCLUDED.qty_branch_003,
        qty_branch_004 = EXCLUDED.qty_branch_004,
        qty_branch_005 = EXCLUDED.qty_branch_005,
        qty_total_all_branches = EXCLUDED.qty_total_all_branches,
        synced_at = EXCLUDED.synced_at,
        source_synced_at = EXCLUDED.source_synced_at,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
    `,
    [
      recordToWrite.productCode,
      recordToWrite.productNameThai,
      recordToWrite.productNameEng,
      recordToWrite.barcode,
      recordToWrite.unit,
      recordToWrite.qtyBranch000,
      recordToWrite.qtyBranch001,
      recordToWrite.qtyBranch002,
      recordToWrite.qtyBranch003,
      recordToWrite.qtyBranch004,
      recordToWrite.qtyBranch005,
      recordToWrite.qtyTotalAllBranches,
      recordToWrite.syncedAt,
      JSON.stringify(recordToWrite.rawPayload || {}),
    ],
  );
}

function mapBranchStockRow(row) {
  return {
    productCode: row.product_code,
    productNameThai: row.product_name_thai || "",
    productNameEng: row.product_name_eng || "",
    barcode: row.barcode || "",
    unit: row.unit || "",
    category: row.category_name || "",
    categoryStatus: row.category_status || "needs_review",
    categoryRationale: row.category_rationale || "",
    qtyBranch000: Number(row.qty_branch_000 || 0),
    qtyBranch001: Number(row.qty_branch_001 || 0),
    qtyBranch002: Number(row.qty_branch_002 || 0),
    qtyBranch003: Number(row.qty_branch_003 || 0),
    qtyBranch004: Number(row.qty_branch_004 || 0),
    qtyBranch005: Number(row.qty_branch_005 || 0),
    qtyTotalAllBranches: Number(row.qty_total_all_branches || 0),
    syncedAt: row.synced_at,
  };
}

function createEmptySnapshotRecord(productCode, syncedAt) {
  return {
    productCode,
    productNameThai: null,
    productNameEng: null,
    barcode: null,
    unit: null,
    qtyBranch000: 0,
    qtyBranch001: 0,
    qtyBranch002: 0,
    qtyBranch003: 0,
    qtyBranch004: 0,
    qtyBranch005: 0,
    qtyTotalAllBranches: 0,
    syncedAt,
    rawPayload: {},
  };
}

function mapExistingSnapshotRowToRecord(row) {
  return {
    productCode: row.product_code,
    productNameThai: row.product_name_thai || null,
    productNameEng: row.product_name_eng || null,
    barcode: row.barcode || null,
    unit: row.unit || null,
    qtyBranch000: Number(row.qty_branch_000 || 0),
    qtyBranch001: Number(row.qty_branch_001 || 0),
    qtyBranch002: Number(row.qty_branch_002 || 0),
    qtyBranch003: Number(row.qty_branch_003 || 0),
    qtyBranch004: Number(row.qty_branch_004 || 0),
    qtyBranch005: Number(row.qty_branch_005 || 0),
    qtyTotalAllBranches: Number(row.qty_total_all_branches || 0),
    syncedAt: row.synced_at,
    rawPayload: row.raw_payload || {},
  };
}

function mergeBranchUploadRecord(branchCode, existingRecord, uploadedRecord, syncedAt) {
  const merged = {
    ...existingRecord,
    productCode: uploadedRecord.productCode,
    productNameThai: uploadedRecord.productNameThai || existingRecord.productNameThai,
    productNameEng: uploadedRecord.productNameEng || existingRecord.productNameEng,
    barcode: uploadedRecord.barcode || existingRecord.barcode,
    unit: uploadedRecord.unit || existingRecord.unit,
    syncedAt,
    rawPayload: {
      branchCode,
      sourceRowNumber: uploadedRecord.sourceRowNumber || null,
      rawRecord: uploadedRecord.rawPayload || {},
    },
  };

  applyBranchQty(merged, branchCode, uploadedRecord.qty);
  merged.qtyTotalAllBranches = sumBranchQty(merged);

  return merged;
}

async function readExistingBranchStockSnapshot(client, productCode) {
  const result = await client.query(
    `
      SELECT
        product_code,
        product_name_thai,
        product_name_eng,
        barcode,
        unit,
        qty_branch_000,
        qty_branch_001,
        qty_branch_002,
        qty_branch_003,
        qty_branch_004,
        qty_branch_005,
        qty_total_all_branches,
        synced_at,
        raw_payload
      FROM ada.branch_stock_snapshots
      WHERE product_code = $1
    `,
    [productCode],
  );

  return result.rows[0] || null;
}

async function findExistingBranchStockUpload(client, idempotencyKey) {
  const result = await client.query(
    `
      SELECT
        branch_stock_upload_id,
        accepted_rows,
        rejected_rows,
        warnings
      FROM ada.branch_stock_uploads
      WHERE idempotency_key = $1
    `,
    [idempotencyKey],
  );
  return result.rows[0] || null;
}

async function insertBranchStockUpload(client, payload) {
  const result = await client.query(
    `
      INSERT INTO ada.branch_stock_uploads
        (
          branch_code,
          source_mode,
          source_date,
          generated_at,
          source_reference,
          idempotency_key,
          payload_hash,
          raw_payload,
          diagnostics,
          normalized_records,
          status,
          accepted_rows,
          rejected_rows,
          warnings
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, 'pending', 0, 0, '[]'::jsonb)
      RETURNING branch_stock_upload_id
    `,
    [
      payload.branchCode,
      payload.sourceMode,
      payload.sourceDate,
      payload.generatedAt,
      payload.sourceReference,
      payload.idempotencyKey,
      payload.payloadHash,
      JSON.stringify(payload.rawPayload || {}),
      JSON.stringify(payload.diagnostics || []),
      JSON.stringify(payload.acceptedRecords || []),
    ],
  );
  return result.rows[0]?.branch_stock_upload_id || null;
}

async function finalizeBranchStockUpload(client, uploadId, outcome) {
  await client.query(
    `
      UPDATE ada.branch_stock_uploads
      SET
        status = $2,
        accepted_rows = $3,
        rejected_rows = $4,
        warnings = $5::jsonb,
        updated_at = now()
      WHERE branch_stock_upload_id = $1
    `,
    [
      uploadId,
      outcome.status,
      outcome.acceptedRows,
      outcome.rejectedRows,
      JSON.stringify(outcome.warnings || []),
    ],
  );
}

function branchStockSearchCondition() {
  return `
    (
      $1::text = ''
      OR bs.product_code ILIKE '%' || $1 || '%'
      OR COALESCE(bs.product_name_thai, p.product_name_th, '') ILIKE '%' || $1 || '%'
      OR COALESCE(bs.product_name_eng, p.product_name, '') ILIKE '%' || $1 || '%'
      OR COALESCE(bs.barcode, pb.barcode, '') ILIKE '%' || $1 || '%'
    )
  `;
}

function locateLatestTaxonomyReport() {
  if (!fs.existsSync(docsDir)) return null;

  return fs.readdirSync(docsDir)
    .filter((name) => /^taxonomy-match-report-.*\.json$/i.test(name))
    .map((name) => {
      const fullPath = path.join(docsDir, name);
      const stats = fs.statSync(fullPath);
      return {
        name,
        fullPath,
        mtimeMs: stats.mtimeMs,
        generatedAt: stats.mtime.toISOString(),
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0] || null;
}

function readLatestTaxonomyReport() {
  const fileEntry = locateLatestTaxonomyReport();
  if (!fileEntry) return null;

  const payload = JSON.parse(fs.readFileSync(fileEntry.fullPath, "utf8"));
  const results = payload.results || {};

  return {
    fileName: fileEntry.name,
    generatedAt: fileEntry.generatedAt,
    args: payload.args || null,
    liveMeta: payload.liveMeta || null,
    backendEvidence: payload.backendEvidence || null,
    stats: payload.stats || null,
    summary: results.summary || null,
    samples: {
      exactCodeMatches: (results.exactCodeMatches || []).slice(0, 10),
      barcodeMatches: (results.barcodeMatches || []).slice(0, 10),
      unmatchedLiveRows: (results.unmatchedLiveRows || []).slice(0, 10),
      unmatchedWorkbookRows: (results.unmatchedWorkbookRows || []).slice(0, 10),
      conflicts: (results.conflicts || []).slice(0, 10),
    },
  };
}

function readLatestTaxonomyReportPayload() {
  const fileEntry = locateLatestTaxonomyReport();
  if (!fileEntry) return null;

  const payload = JSON.parse(fs.readFileSync(fileEntry.fullPath, "utf8"));
  return {
    fileName: fileEntry.name,
    generatedAt: fileEntry.generatedAt,
    payload,
  };
}

function buildExactCodeMatchIndex(exactCodeMatches) {
  const grouped = new Map();
  for (const row of exactCodeMatches) {
    const productCode = normalizeText(row.liveProductCode || row.workbookProductCode);
    if (!productCode) continue;
    const bucket = grouped.get(productCode) || [];
    bucket.push(row);
    grouped.set(productCode, bucket);
  }
  return grouped;
}

async function loadCategoryStateMap(db, productCodes) {
  if (!productCodes.length) {
    return new Map();
  }

  const sql = `
    SELECT
      codes.product_code,
      COALESCE(pcs.category_name, s.category_name, p.category_name) AS effective_category_name,
      COALESCE(pcs.review_status, 'needs_review') AS review_status,
      pcs.rationale,
      pcs.source_kind,
      pcs.source_reference,
      pcs.source_report_file,
      pcs.imported_at,
      pcs.imported_by,
      s.category_name AS sku_category_name,
      p.category_name AS source_category_name
    FROM UNNEST($1::text[]) AS codes(product_code)
    LEFT JOIN public.skus s
      ON s.company_code = codes.product_code
    LEFT JOIN ada.products p
      ON p.product_code = codes.product_code
    LEFT JOIN ada.product_category_states pcs
      ON pcs.product_code = codes.product_code
  `;

  let rows = [];
  try {
    const result = await db.query(sql, [productCodes]);
    rows = result.rows || [];
  } catch (error) {
    if (error?.code !== "42P01") {
      throw error;
    }
    const fallbackResult = await db.query(
      `
        SELECT
          codes.product_code,
          COALESCE(s.category_name, p.category_name) AS effective_category_name,
          'needs_review'::text AS review_status,
          NULL::text AS rationale,
          NULL::text AS source_kind,
          NULL::text AS source_reference,
          NULL::text AS source_report_file,
          NULL::timestamptz AS imported_at,
          NULL::text AS imported_by,
          s.category_name AS sku_category_name,
          p.category_name AS source_category_name
        FROM UNNEST($1::text[]) AS codes(product_code)
        LEFT JOIN public.skus s
          ON s.company_code = codes.product_code
        LEFT JOIN ada.products p
          ON p.product_code = codes.product_code
      `,
      [productCodes],
    );
    rows = fallbackResult.rows || [];
  }

  const map = new Map();
  for (const row of rows) {
    map.set(row.product_code, row);
  }
  return map;
}

function determinePreviewReason(matchRows, stateRow) {
  const workbookLabel = normalizeNullableText(matchRows[0]?.workbookLabel);
  const currentCategory = normalizeNullableText(stateRow?.effective_category_name);
  const currentStatus = normalizeText(stateRow?.review_status || "needs_review");
  const duplicateMatch = matchRows.length > 1;

  if (duplicateMatch) {
    return { safeToApply: false, reason: "needs_review" };
  }
  if (!workbookLabel) {
    return { safeToApply: false, reason: "missing_category" };
  }
  if (currentStatus === "confirmed" || currentStatus === "imported_exact_match") {
    return { safeToApply: false, reason: "already_confirmed" };
  }
  if (currentCategory && normalizeCategoryValue(currentCategory) !== normalizeCategoryValue(workbookLabel)) {
    return { safeToApply: false, reason: "category_conflict" };
  }
  return { safeToApply: true, reason: "exact_code_match" };
}

function buildPreviewRow(productCode, matchRows, stateRow, reportFileName) {
  const primary = matchRows[0] || {};
  const workbookLabel = normalizeNullableText(primary.workbookLabel);
  const currentCategory = normalizeNullableText(stateRow?.effective_category_name);
  const currentCategoryStatus = normalizeText(stateRow?.review_status || "needs_review") || "needs_review";
  const decision = determinePreviewReason(matchRows, stateRow);

  return {
    productCode,
    productNameThai: primary.liveProductNameThai || primary.workbookProductNameThai || "",
    barcode: primary.liveBarcode || primary.workbookBarcode || "",
    workbookRowNumber: primary.workbookRowNumber || null,
    liveRowNumber: primary.liveRowNumber || null,
    currentCategory: currentCategory || "",
    currentCategoryStatus,
    currentCategoryRationale: stateRow?.rationale || "",
    proposedCategory: workbookLabel || "",
    proposedReviewStatus: "imported_exact_match",
    safeToApply: decision.safeToApply,
    reason: decision.reason,
    matchLevel: "exact_code",
    matchCountForProductCode: matchRows.length,
    reportFileName,
  };
}

async function buildTaxonomyPreview(db, options = {}) {
  const reportEntry = readLatestTaxonomyReportPayload();
  if (!reportEntry) {
    return null;
  }

  const payload = reportEntry.payload || {};
  const results = payload.results || {};
  const exactCodeMatches = Array.isArray(results.exactCodeMatches) ? results.exactCodeMatches : [];
  const grouped = buildExactCodeMatchIndex(exactCodeMatches);
  const productCodes = [...grouped.keys()];
  const categoryStateMap = await loadCategoryStateMap(db, productCodes);

  let rows = productCodes.map((productCode) =>
    buildPreviewRow(productCode, grouped.get(productCode) || [], categoryStateMap.get(productCode) || null, reportEntry.fileName),
  );

  const search = normalizeQuery(options.search || "");
  if (search) {
    rows = rows.filter((row) =>
      [
        row.productCode,
        row.productNameThai,
        row.currentCategory,
        row.proposedCategory,
        row.reason,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(search)),
    );
  }

  if (options.safeOnly) {
    rows = rows.filter((row) => row.safeToApply);
  }

  rows.sort((left, right) => left.productCode.localeCompare(right.productCode));

  const reasonCounts = rows.reduce((acc, row) => {
    acc[row.reason] = (acc[row.reason] || 0) + 1;
    return acc;
  }, {});

  const total = rows.length;
  const limit = options.limit;
  const offset = options.offset;
  const pagedRows = rows.slice(offset, offset + limit);

  return {
    fileName: reportEntry.fileName,
    generatedAt: reportEntry.generatedAt,
    args: payload.args || null,
    summary: {
      totalExactCodeRows: productCodes.length,
      filteredRows: total,
      safeToApply: rows.filter((row) => row.safeToApply).length,
      exact_code_match: reasonCounts.exact_code_match || 0,
      missing_category: reasonCounts.missing_category || 0,
      category_conflict: reasonCounts.category_conflict || 0,
      already_confirmed: reasonCounts.already_confirmed || 0,
      needs_review: reasonCounts.needs_review || 0,
    },
    pagination: {
      limit,
      offset,
      total,
    },
    records: pagedRows,
  };
}

async function upsertProductCategoryState(client, row, req, sourceArgs) {
  await client.query(
    `
      INSERT INTO ada.product_category_states
        (
          product_code,
          category_name,
          review_status,
          rationale,
          source_kind,
          source_reference,
          source_report_file,
          source_workbook_file,
          source_workbook_sheet,
          source_workbook_row,
          source_match_level,
          source_barcode,
          previous_category_name,
          previous_review_status,
          imported_at,
          imported_by,
          updated_at
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(), $15, now())
      ON CONFLICT (product_code) DO UPDATE SET
        category_name = EXCLUDED.category_name,
        review_status = EXCLUDED.review_status,
        rationale = EXCLUDED.rationale,
        source_kind = EXCLUDED.source_kind,
        source_reference = EXCLUDED.source_reference,
        source_report_file = EXCLUDED.source_report_file,
        source_workbook_file = EXCLUDED.source_workbook_file,
        source_workbook_sheet = EXCLUDED.source_workbook_sheet,
        source_workbook_row = EXCLUDED.source_workbook_row,
        source_match_level = EXCLUDED.source_match_level,
        source_barcode = EXCLUDED.source_barcode,
        previous_category_name = EXCLUDED.previous_category_name,
        previous_review_status = EXCLUDED.previous_review_status,
        imported_at = EXCLUDED.imported_at,
        imported_by = EXCLUDED.imported_by,
        updated_at = now()
    `,
    [
      row.productCode,
      row.proposedCategory,
      row.proposedReviewStatus,
      "taxonomy exact-code preview/apply",
      "taxonomy_workbook",
      "workbook/taxonomy import",
      row.reportFileName,
      sourceArgs?.workbookFile || null,
      sourceArgs?.workbookSheet || null,
      row.workbookRowNumber,
      "exact_code",
      row.barcode || null,
      row.currentCategory || null,
      row.currentCategoryStatus || null,
      req.auth?.userId || null,
    ],
  );
}

function createBranchStockRouter(deps) {
  const { config, db, requireAuthMiddleware, requireRoleMiddleware, requireCsrfMiddleware } = deps;
  const router = express.Router();

  router.post("/branch-stock/sync", async (req, res, next) => {
    const apiKeyError = parseRequiredApiKey(config, req);
    if (apiKeyError) {
      return res.status(401).json({ message: apiKeyError });
    }

    const { error, records } = parseBranchStockPayload(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const record of records) {
        // eslint-disable-next-line no-await-in-loop
        await upsertBranchStockSnapshot(client, record);
      }
      await client.query("COMMIT");
      return res.json({ accepted: records.length, insertedOrUpdated: records.length });
    } catch (routeError) {
      await client.query("ROLLBACK");
      return next(routeError);
    } finally {
      client.release();
    }
  });

  router.post("/sync/ada/branch-stock", async (req, res, next) => {
    const apiKeyError = parseRequiredApiKey(config, req);
    if (apiKeyError) {
      return res.status(401).json({ message: apiKeyError });
    }

    const { error, records } = parseBranchStockPayload(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const record of records) {
        // eslint-disable-next-line no-await-in-loop
        await upsertBranchStockSnapshot(client, record);
      }
      await client.query("COMMIT");
      return res.json({ accepted: records.length, insertedOrUpdated: records.length });
    } catch (routeError) {
      await client.query("ROLLBACK");
      return next(routeError);
    } finally {
      client.release();
    }
  });

  router.post("/branch-stock/upload", async (req, res, next) => {
    const apiKeyError = parseRequiredApiKey(config, req);
    if (apiKeyError) {
      return res.status(401).json({ message: apiKeyError });
    }

    const parsed = parseBranchStockUploadPayload(req.body);
    if (parsed.error) {
      return res.status(400).json({ message: parsed.error });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const existingUpload = await findExistingBranchStockUpload(client, parsed.idempotencyKey);
      if (existingUpload) {
        await client.query("COMMIT");
        return res.json({
          success: true,
          duplicate: true,
          syncRunId: String(existingUpload.branch_stock_upload_id),
          acceptedRows: Number(existingUpload.accepted_rows || 0),
          rejectedRows: Number(existingUpload.rejected_rows || 0),
          warnings: Array.isArray(existingUpload.warnings) ? existingUpload.warnings : [],
          message: "Duplicate upload ignored.",
        });
      }

      const uploadId = await insertBranchStockUpload(client, parsed);
      let acceptedRows = 0;

      for (const record of parsed.acceptedRecords) {
        // eslint-disable-next-line no-await-in-loop
        const existingSnapshot = await readExistingBranchStockSnapshot(client, record.productCode);
        const mergedRecord = mergeBranchUploadRecord(
          parsed.branchCode,
          existingSnapshot ? mapExistingSnapshotRowToRecord(existingSnapshot) : createEmptySnapshotRecord(record.productCode, parsed.generatedAt),
          record,
          parsed.generatedAt,
        );
        // eslint-disable-next-line no-await-in-loop
        await upsertBranchStockSnapshot(client, mergedRecord);
        acceptedRows += 1;
      }

      const rejectedRows = parsed.rejectedRecords.length;
      const warnings = [
        ...parsed.warnings,
        ...parsed.rejectedRecords.map((item) => item.message),
      ];

      await finalizeBranchStockUpload(client, uploadId, {
        status: "processed",
        acceptedRows,
        rejectedRows,
        warnings,
      });

      await client.query("COMMIT");
      return res.json({
        success: true,
        duplicate: false,
        syncRunId: String(uploadId),
        acceptedRows,
        rejectedRows,
        warnings,
      });
    } catch (routeError) {
      await client.query("ROLLBACK");
      return next(routeError);
    } finally {
      client.release();
    }
  });

  router.get("/branch-stock", requireAuthMiddleware, async (req, res, next) => {
    const limit = parsePositiveInt(req.query.limit, 25);
    const offset = parseNonNegativeInt(req.query.offset, 0);
    if (limit == null) {
      return res.status(400).json({ message: "limit must be a positive integer." });
    }
    if (offset == null) {
      return res.status(400).json({ message: "offset must be a non-negative integer." });
    }

    const search = normalizeQuery(req.query.search || "");

    try {
      const countResult = await db.query(
        `
          SELECT COUNT(*)::int AS total
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
          WHERE ${branchStockSearchCondition()}
        `,
        [search],
      );

      const rowsResult = await db.query(
        `
          SELECT
            bs.product_code,
            COALESCE(bs.product_name_thai, p.product_name_th) AS product_name_thai,
            COALESCE(bs.product_name_eng, p.product_name) AS product_name_eng,
            COALESCE(bs.barcode, pb.barcode) AS barcode,
            COALESCE(bs.unit, p.unit_small, p.unit_medium, p.unit_large) AS unit,
            COALESCE(pcs.category_name, s.category_name, p.category_name) AS category_name,
            COALESCE(pcs.review_status, 'needs_review') AS category_status,
            pcs.rationale AS category_rationale,
            bs.qty_branch_000,
            bs.qty_branch_001,
            bs.qty_branch_002,
            bs.qty_branch_003,
            bs.qty_branch_004,
            bs.qty_branch_005,
            bs.qty_total_all_branches,
            bs.synced_at
          FROM ada.branch_stock_snapshots bs
          LEFT JOIN ada.products p
            ON p.product_code = bs.product_code
          LEFT JOIN public.skus s
            ON s.company_code = bs.product_code
          LEFT JOIN ada.product_category_states pcs
            ON pcs.product_code = bs.product_code
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
          WHERE ${branchStockSearchCondition()}
          ORDER BY bs.product_code ASC
          LIMIT $2 OFFSET $3
        `,
        [search, limit, offset],
      );

      return res.json({
        records: rowsResult.rows.map(mapBranchStockRow),
        pagination: {
          limit,
          offset,
          total: Number(countResult.rows[0]?.total || 0),
        },
      });
    } catch (routeError) {
      return next(routeError);
    }
  });

  router.get("/admin/taxonomy-match-report", requireAuthMiddleware, async (_req, res) => {
    const report = readLatestTaxonomyReport();
    if (!report) {
      return res.status(404).json({ message: "No taxonomy match report found under docs/." });
    }
    return res.json(report);
  });

  router.get("/admin/taxonomy-match-preview", requireAuthMiddleware, async (req, res, next) => {
    const limit = parsePositiveInt(req.query.limit, 25);
    const offset = parseNonNegativeInt(req.query.offset, 0);
    if (limit == null) {
      return res.status(400).json({ message: "limit must be a positive integer." });
    }
    if (offset == null) {
      return res.status(400).json({ message: "offset must be a non-negative integer." });
    }

    try {
      const preview = await buildTaxonomyPreview(db, {
        limit: Math.min(limit, 200),
        offset,
        search: req.query.search || "",
        safeOnly: parseBooleanFlag(req.query.safe_only),
      });
      if (!preview) {
        return res.status(404).json({ message: "No taxonomy match report found under docs/." });
      }
      return res.json(preview);
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    "/admin/taxonomy-match-apply",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    requireCsrfMiddleware,
    async (req, res, next) => {
      const requestedCodes = Array.isArray(req.body?.productCodes)
        ? req.body.productCodes.map((value) => normalizeText(value)).filter(Boolean)
        : [];
      const requestedCodeSet = requestedCodes.length > 0 ? new Set(requestedCodes) : null;

      try {
        const preview = await buildTaxonomyPreview(db, {
          limit: Number.MAX_SAFE_INTEGER,
          offset: 0,
          search: "",
          safeOnly: false,
        });
        if (!preview) {
          return res.status(404).json({ message: "No taxonomy match report found under docs/." });
        }

        const candidateRows = preview.records.filter((row) =>
          requestedCodeSet ? requestedCodeSet.has(row.productCode) : true,
        );
        const safeRows = candidateRows.filter((row) => row.safeToApply);
        const skippedRows = candidateRows.filter((row) => !row.safeToApply);

        const client = await db.connect();
        try {
          await client.query("BEGIN");
          for (const row of safeRows) {
            // eslint-disable-next-line no-await-in-loop
            await upsertProductCategoryState(client, row, req, preview.args || null);
          }

          await auditLog(
            client,
            auditBase(req, {
              action: "taxonomy_match.apply_exact_code",
              target_type: "taxonomy_category_state",
              target_id: preview.fileName,
              success: true,
              meta: {
                report_file: preview.fileName,
                requested_codes: requestedCodes,
                applied_count: safeRows.length,
                skipped_count: skippedRows.length,
                applied_samples: safeRows.slice(0, 20).map((row) => ({
                  product_code: row.productCode,
                  proposed_category: row.proposedCategory,
                  workbook_row_number: row.workbookRowNumber,
                })),
                skipped_samples: skippedRows.slice(0, 20).map((row) => ({
                  product_code: row.productCode,
                  current_category: row.currentCategory,
                  proposed_category: row.proposedCategory,
                  reason: row.reason,
                })),
              },
            }),
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }

        return res.json({
          ok: true,
          reportFileName: preview.fileName,
          requestedCount: candidateRows.length,
          appliedCount: safeRows.length,
          skippedCount: skippedRows.length,
          applied: safeRows.slice(0, 20),
          skipped: skippedRows.slice(0, 20),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

module.exports = {
  createBranchStockRouter,
};
