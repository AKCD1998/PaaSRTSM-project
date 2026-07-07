"use strict";

const express = require("express");

// Legacy-compatible simplified sync endpoints.
// Keep these working during the transition to /api/sync/ada/*.

function parseApiRecords(body) {
  if (!body || !Array.isArray(body.records)) {
    return { error: "Payload must include a records array." };
  }
  return { records: body.records };
}

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

function parseTimestamp(value, fallback = null) {
  const normalized = normalizeNullableText(value);
  return normalized || fallback;
}

function shouldMirrorAdaRunLog(body) {
  const sourceName = normalizeText(body?.sourceName).toLowerCase();
  const sourceSystem = normalizeText(body?.sourceSystem).toLowerCase();
  return sourceName === "adapos_sync" || sourceSystem === "adaacc";
}

async function insertAdaRunLog(db, body) {
  const result = await db.query(
    `
      INSERT INTO ada.sync_runs
        (
          source_system,
          source_location,
          agent_name,
          agent_version,
          sync_type,
          started_at,
          finished_at,
          status,
          records_read,
          records_sent,
          watermark_from,
          watermark_to,
          message,
          meta
        )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
      RETURNING sync_run_id
    `,
    [
      normalizeText(body?.sourceSystem) || "AdaAcc",
      normalizeNullableText(body?.sourceLocation),
      normalizeNullableText(body?.agentName),
      normalizeNullableText(body?.agentVersion),
      normalizeText(body?.syncType) || "manual",
      parseTimestamp(body?.startedAt, new Date().toISOString()),
      parseTimestamp(body?.finishedAt),
      normalizeText(body?.status) || "success",
      Math.max(0, Math.floor(toNumber(body?.recordsRead, 0))),
      Math.max(0, Math.floor(toNumber(body?.recordsSent, 0))),
      normalizeNullableText(body?.watermarkFrom),
      normalizeNullableText(body?.watermarkTo),
      normalizeNullableText(body?.message),
      JSON.stringify({
        legacyRoute: true,
        sourceName: normalizeText(body?.sourceName) || "adapos_sync",
      }),
    ],
  );

  if (String(body?.status || "").toLowerCase() === "failed") {
    await db.query(
      `
        INSERT INTO ada.sync_errors
          (sync_run_id, source_system, source_table, error_code, error_message, error_details)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        result.rows[0].sync_run_id,
        normalizeText(body?.sourceSystem) || "AdaAcc",
        normalizeNullableText(body?.sourceTable),
        normalizeNullableText(body?.errorCode),
        normalizeText(body?.message) || "Sync failed.",
        JSON.stringify(body?.errorDetails || {}),
      ],
    );
  }

  return result.rows[0].sync_run_id;
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

async function upsertProductRecord(client, record) {
  const productCode = normalizeText(record.productCode);
  if (!productCode) {
    throw new Error("Each product record requires productCode.");
  }

  const productName = normalizeText(record.productName) || productCode;
  const skuLookup = await client.query(
    `
      SELECT sku_id, item_id
      FROM public.skus
      WHERE company_code = $1
      LIMIT 1
    `,
    [productCode],
  );

  let itemId = null;
  let skuId = null;
  if (skuLookup.rowCount > 0) {
    skuId = skuLookup.rows[0].sku_id;
    itemId = skuLookup.rows[0].item_id;
  } else {
    const itemLookup = await client.query(
      `
        SELECT item_id
        FROM public.items
        WHERE source_company_code = $1
        LIMIT 1
      `,
      [productCode],
    );
    if (itemLookup.rowCount > 0) {
      itemId = itemLookup.rows[0].item_id;
    }
  }

  if (itemId == null) {
    const insertedItem = await client.query(
      `
        INSERT INTO public.items
          (generic_name, display_name, supplier_code, product_kind, source_company_code)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING item_id
      `,
      [
        productName,
        productName,
        normalizeText(record.supplierCode) || null,
        normalizeText(record.productKind) || "device_or_general_goods",
        productCode,
      ],
    );
    itemId = insertedItem.rows[0].item_id;
  } else {
    await client.query(
      `
        UPDATE public.items
        SET
          generic_name = $2,
          display_name = $2,
          supplier_code = $3,
          product_kind = COALESCE($4, product_kind),
          source_company_code = $1
        WHERE item_id = $5
      `,
      [
        productCode,
        productName,
        normalizeText(record.supplierCode) || null,
        normalizeText(record.productKind) || null,
        itemId,
      ],
    );
  }

  if (skuId == null) {
    const insertedSku = await client.query(
      `
        INSERT INTO public.skus
          (item_id, uom, qty_in_base, pack_level, display_name, company_code, category_name, supplier_code, min_stock, max_stock, lead_time_days)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING sku_id
      `,
      [
        itemId,
        normalizeText(record.unitSmall || record.unit) || null,
        1,
        "base",
        productName,
        productCode,
        normalizeText(record.categoryName) || null,
        normalizeText(record.supplierCode) || null,
        toNumber(record.minStock, 0),
        toNumber(record.maxStock, 0),
        toNumber(record.leadTimeDays, 0),
      ],
    );
    skuId = insertedSku.rows[0].sku_id;
  } else {
    await client.query(
      `
        UPDATE public.skus
        SET
          item_id = $2,
          uom = COALESCE($3, uom),
          display_name = $4,
          category_name = $5,
          supplier_code = $6,
          min_stock = $7,
          max_stock = $8,
          lead_time_days = $9,
          updated_at = now()
        WHERE company_code = $1
      `,
      [
        productCode,
        itemId,
        normalizeText(record.unitSmall || record.unit) || null,
        productName,
        normalizeText(record.categoryName) || null,
        normalizeText(record.supplierCode) || null,
        toNumber(record.minStock, 0),
        toNumber(record.maxStock, 0),
        toNumber(record.leadTimeDays, 0),
      ],
    );
  }

  const barcodes = [record.barcode1, record.barcode2, record.barcode3].map((value) => normalizeText(value)).filter(Boolean);
  for (let index = 0; index < barcodes.length; index += 1) {
    await client.query(
      `
        INSERT INTO public.barcodes
          (barcode, sku_id, is_primary, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (barcode) DO UPDATE SET
          sku_id = EXCLUDED.sku_id,
          is_primary = EXCLUDED.is_primary,
          updated_at = now()
      `,
      [barcodes[index], skuId, index === 0],
    );
  }

  await client.query(
    `
      INSERT INTO analytics.product_stock_snapshots
        (product_code, snapshot_at, stock_current, stock_retail, stock_warehouse, source_name)
      VALUES ($1, now(), $2, $3, $4, 'adapos_sync')
    `,
    [productCode, toNumber(record.stockCurrent, 0), toNumber(record.stockRetail, 0), toNumber(record.stockWarehouse, 0)],
  );
}

function createSyncRouter(deps) {
  const { config, db } = deps;
  const router = express.Router();

  router.use((req, res, next) => {
    const apiKeyError = parseRequiredApiKey(config, req);
    if (apiKeyError) {
      return res.status(401).json({ message: apiKeyError });
    }
    return next();
  });

  router.post("/products", async (req, res, next) => {
    const { error, records } = parseApiRecords(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const record of records) {
        // eslint-disable-next-line no-await-in-loop
        await upsertProductRecord(client, record);
      }
      await client.query("COMMIT");
      return res.json({ accepted: records.length });
    } catch (e) {
      await client.query("ROLLBACK");
      return next(e);
    } finally {
      client.release();
    }
  });

  router.post("/sales-summary", async (req, res, next) => {
    const { error, records } = parseApiRecords(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const record of records) {
        const productCode = normalizeText(record.productCode);
        if (!productCode) {
          throw new Error("Each sales summary record requires productCode.");
        }
        const periodDays = Math.max(1, Math.floor(toNumber(record.periodDays, 30)));
        const periodEnd = normalizeText(record.periodEnd) || new Date().toISOString().slice(0, 10);
        const periodStart =
          normalizeText(record.periodStart) ||
          new Date(Date.now() - (periodDays - 1) * 86400000).toISOString().slice(0, 10);

        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `
            INSERT INTO analytics.product_sales_summary_periods
              (product_code, branch_code, period_start, period_end, period_days, sold_qty_base, avg_daily_usage, source_name)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'adapos_sync')
            ON CONFLICT (product_code, branch_code, period_start, period_end, source_name)
            DO UPDATE SET
              period_days = EXCLUDED.period_days,
              sold_qty_base = EXCLUDED.sold_qty_base,
              avg_daily_usage = EXCLUDED.avg_daily_usage
          `,
          [
            productCode,
            normalizeText(record.branchCode) || null,
            periodStart,
            periodEnd,
            periodDays,
            toNumber(record.soldQtyBase, 0),
            toNumber(record.avgDailyUsage, 0),
          ],
        );
      }
      await client.query("COMMIT");
      return res.json({ accepted: records.length });
    } catch (e) {
      await client.query("ROLLBACK");
      return next(e);
    } finally {
      client.release();
    }
  });

  router.post("/purchase-summary", async (req, res, next) => {
    const { error, records } = parseApiRecords(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const record of records) {
        const productCode = normalizeText(record.productCode);
        if (!productCode) {
          throw new Error("Each purchase summary record requires productCode.");
        }
        const periodDays = Math.max(1, Math.floor(toNumber(record.periodDays, 30)));
        const periodEnd = normalizeText(record.periodEnd) || new Date().toISOString().slice(0, 10);
        const periodStart =
          normalizeText(record.periodStart) ||
          new Date(Date.now() - (periodDays - 1) * 86400000).toISOString().slice(0, 10);

        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `
            INSERT INTO analytics.product_purchase_summary_periods
              (product_code, period_start, period_end, period_days, purchased_qty_base, source_name)
            VALUES ($1, $2, $3, $4, $5, 'adapos_sync')
            ON CONFLICT (product_code, period_start, period_end, source_name)
            DO UPDATE SET
              period_days = EXCLUDED.period_days,
              purchased_qty_base = EXCLUDED.purchased_qty_base
          `,
          [productCode, periodStart, periodEnd, periodDays, toNumber(record.purchasedQtyBase, 0)],
        );
      }
      await client.query("COMMIT");
      return res.json({ accepted: records.length });
    } catch (e) {
      await client.query("ROLLBACK");
      return next(e);
    } finally {
      client.release();
    }
  });

  router.post("/run-log", async (req, res, next) => {
    try {
      const result = await db.query(
        `
          INSERT INTO ingest.sync_runs
            (sync_type, source_name, started_at, finished_at, status, records_read, records_sent, message)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING sync_run_id
        `,
        [
          normalizeText(req.body?.syncType) || "manual",
          normalizeText(req.body?.sourceName) || "adapos_sync",
          req.body?.startedAt || new Date().toISOString(),
          req.body?.finishedAt || null,
          normalizeText(req.body?.status) || "success",
          Math.max(0, Math.floor(toNumber(req.body?.recordsRead, 0))),
          Math.max(0, Math.floor(toNumber(req.body?.recordsSent, 0))),
          normalizeText(req.body?.message) || "",
        ],
      );

      let adaSyncRunId = null;
      if (shouldMirrorAdaRunLog(req.body)) {
        adaSyncRunId = await insertAdaRunLog(db, req.body);
      }

      if (String(req.body?.status || "").toLowerCase() === "failed") {
        await db.query(
          `
            INSERT INTO ingest.sync_errors
              (sync_run_id, sync_type, source_name, error_message, error_details)
            VALUES ($1, $2, $3, $4, $5::jsonb)
          `,
          [
            result.rows[0].sync_run_id,
            normalizeText(req.body?.syncType) || "manual",
            normalizeText(req.body?.sourceName) || "adapos_sync",
            normalizeText(req.body?.message) || "Sync failed.",
            JSON.stringify(req.body?.errorDetails || {}),
          ],
        );
      }

      return res.json({
        accepted: 1,
        id: String(result.rows[0].sync_run_id),
        adaSyncRunId: adaSyncRunId == null ? null : String(adaSyncRunId),
      });
    } catch (e) {
      return next(e);
    }
  });

  // GET /api/sync/today-status?branchCode=005&datasetTag=branch_stock_history
  // Lets the sync agent self-check before an evening (e.g. 19:20) run: "did a
  // run for this branch already succeed today that included this dataset?"
  // datasetTag matches against run-log message text (see runOnce() in
  // adapos-sync/src/index.js, which includes the dataset list it ran in the
  // message) since ingest.sync_runs has no structured per-dataset column.
  // Used to skip a redundant full stock resync when the morning run already
  // landed today's data — not to skip datasets that change throughout the day
  // (e.g. sales_detail), which should always run regardless of this check.
  router.get("/today-status", async (req, res, next) => {
    try {
      const branchCode = normalizeText(req.query?.branchCode);
      const datasetTag = normalizeText(req.query?.datasetTag);
      if (!branchCode || !datasetTag) {
        return res.status(400).json({ message: "branchCode and datasetTag are required." });
      }
      const result = await db.query(
        `
          SELECT 1
          FROM ingest.sync_runs
          WHERE sync_type = $1
            AND status = 'success'
            AND (started_at AT TIME ZONE 'Asia/Bangkok')::date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date
            AND message LIKE '%' || $2 || '%'
          LIMIT 1
        `,
        [`adapos_branch_${branchCode}`, datasetTag],
      );
      return res.json({ branchCode, datasetTag, hasSuccessToday: result.rows.length > 0 });
    } catch (e) {
      return next(e);
    }
  });

  // POST /api/sync/heartbeat
  // Branch laptop's PS1 wrapper calls this when it wakes up at 22:00.
  // Records a row in ingest.laptop_heartbeats so the dashboard can tell
  // "sync failed" apart from "laptop was off".
  router.post("/heartbeat", async (req, res, next) => {
    try {
      const branchCode = normalizeText(req.body?.branchCode);
      if (!branchCode) {
        return res.status(400).json({ message: "branchCode is required." });
      }
      const result = await db.query(
        `
          INSERT INTO ingest.laptop_heartbeats (branch_code, laptop_name, event)
          VALUES ($1, $2, $3)
          RETURNING heartbeat_id
        `,
        [
          branchCode,
          normalizeNullableText(req.body?.laptopName),
          normalizeText(req.body?.event) || "startup",
        ],
      );
      return res.json({ ok: true, heartbeatId: String(result.rows[0].heartbeat_id) });
    } catch (e) {
      return next(e);
    }
  });

  return router;
}

module.exports = {
  createSyncRouter,
};
