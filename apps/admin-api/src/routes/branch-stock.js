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
          FROM ada.branch_stock_snapshots
          WHERE (
            $1::text = ''
            OR product_code ILIKE '%' || $1 || '%'
            OR COALESCE(product_name_thai, '') ILIKE '%' || $1 || '%'
            OR COALESCE(product_name_eng, '') ILIKE '%' || $1 || '%'
            OR COALESCE(barcode, '') ILIKE '%' || $1 || '%'
          )
        `,
        [search],
      );

      const rowsResult = await db.query(
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
            synced_at
          FROM ada.branch_stock_snapshots
          WHERE (
            $1::text = ''
            OR product_code ILIKE '%' || $1 || '%'
            OR COALESCE(product_name_thai, '') ILIKE '%' || $1 || '%'
            OR COALESCE(product_name_eng, '') ILIKE '%' || $1 || '%'
            OR COALESCE(barcode, '') ILIKE '%' || $1 || '%'
          )
          ORDER BY product_code ASC
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
