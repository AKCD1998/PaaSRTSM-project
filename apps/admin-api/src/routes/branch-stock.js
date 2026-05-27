"use strict";

const express = require("express");

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

function normalizeQuery(value = "") {
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
      record.productCode,
      record.productNameThai,
      record.productNameEng,
      record.barcode,
      record.unit,
      record.qtyBranch000,
      record.qtyBranch001,
      record.qtyBranch002,
      record.qtyBranch003,
      record.qtyBranch004,
      record.qtyBranch005,
      record.qtyTotalAllBranches,
      record.syncedAt,
      JSON.stringify(record.rawPayload || {}),
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

  if (branchCode === "000") merged.qtyBranch000 = uploadedRecord.qty;
  if (branchCode === "001") merged.qtyBranch001 = uploadedRecord.qty;
  if (branchCode === "002") merged.qtyBranch002 = uploadedRecord.qty;
  if (branchCode === "003") merged.qtyBranch003 = uploadedRecord.qty;
  if (branchCode === "004") merged.qtyBranch004 = uploadedRecord.qty;
  if (branchCode === "005") merged.qtyBranch005 = uploadedRecord.qty;

  merged.qtyTotalAllBranches =
    Number(merged.qtyBranch000 || 0) +
    Number(merged.qtyBranch001 || 0) +
    Number(merged.qtyBranch002 || 0) +
    Number(merged.qtyBranch003 || 0) +
    Number(merged.qtyBranch004 || 0) +
    Number(merged.qtyBranch005 || 0);

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

function createBranchStockRouter(deps) {
  const { config, db, requireAuthMiddleware } = deps;
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

  return router;
}

module.exports = {
  createBranchStockRouter,
};
