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

// Set-based replacement for the old per-record upsertProductRecord() loop.
// The old version ran 5-8 sequential queries PER product inside one
// transaction (confirmed via pg_stat_statements: 1.8M UPDATE public.items
// calls / 1.8M INSERT product_stock_snapshots calls over ~25 days, one per
// product per sync, every branch). A branch with 6000+ products could spend
// longer building the transaction than the client's request timeout.
//
// This version does the whole batch in 4 queries total (items, skus,
// barcodes, stock snapshots), each a single INSERT ... SELECT unnest(...)
// ON CONFLICT DO UPDATE. Linking between steps (item_id -> sku, sku_id ->
// barcode) happens in JS via Maps built from each step's RETURNING rows,
// rather than one giant multi-CTE statement — easier to verify correct and
// just as effective at cutting round-trips.
//
// NOT YET DEPLOYED. See docs/sync-program/STATE.md in SC-StockDay-Ordering
// for the deploy gate (waiting on 001/003/004 mitigation rollout to be
// confirmed stable first, so this change's effect can be measured alone).
async function upsertProductBatch(client, records) {
  const normalized = records
    .map((record) => {
      const productCode = normalizeText(record.productCode);
      if (!productCode) {
        throw new Error("Each product record requires productCode.");
      }
      return {
        productCode,
        productName: normalizeText(record.productName) || productCode,
        supplierCode: normalizeText(record.supplierCode) || null,
        productKind: normalizeText(record.productKind) || null,
        unit: normalizeText(record.unitSmall || record.unit) || null,
        categoryName: normalizeText(record.categoryName) || null,
        minStock: toNumber(record.minStock, 0),
        maxStock: toNumber(record.maxStock, 0),
        leadTimeDays: toNumber(record.leadTimeDays, 0),
        stockCurrent: toNumber(record.stockCurrent, 0),
        stockRetail: toNumber(record.stockRetail, 0),
        stockWarehouse: toNumber(record.stockWarehouse, 0),
        barcodes: [record.barcode1, record.barcode2, record.barcode3]
          .map((value) => normalizeText(value))
          .filter(Boolean),
      };
    })
    // Same stable-order rationale as the old per-record loop (commit
    // c6caf4e): concurrent requests touching overlapping products should
    // lock rows in the same order to avoid deadlocking against each other.
    .sort((a, b) => a.productCode.localeCompare(b.productCode));

  if (normalized.length === 0) {
    return { itemsUpserted: 0, skusUpserted: 0, barcodesUpserted: 0, snapshotsInserted: 0 };
  }

  // ── 1. Bulk upsert items, keyed on source_company_code ──────────────────
  const itemsResult = await client.query(
    `
      INSERT INTO public.items
        (generic_name, display_name, supplier_code, product_kind, source_company_code)
      SELECT * FROM unnest($1::text[], $1::text[], $2::text[], $3::text[], $4::text[])
      ON CONFLICT (source_company_code) WHERE source_company_code IS NOT NULL
      DO UPDATE SET
        generic_name = EXCLUDED.generic_name,
        display_name = EXCLUDED.display_name,
        supplier_code = EXCLUDED.supplier_code,
        product_kind = COALESCE(EXCLUDED.product_kind, public.items.product_kind)
      RETURNING item_id, source_company_code
    `,
    [
      normalized.map((r) => r.productName),
      normalized.map((r) => r.supplierCode),
      normalized.map((r) => r.productKind ?? "device_or_general_goods"),
      normalized.map((r) => r.productCode),
    ],
  );
  const itemIdByProductCode = new Map(
    itemsResult.rows.map((row) => [row.source_company_code, row.item_id]),
  );

  // ── 2. Bulk upsert skus, keyed on company_code, item_id resolved above ──
  const skusResult = await client.query(
    `
      INSERT INTO public.skus
        (item_id, uom, qty_in_base, pack_level, display_name, company_code, category_name, supplier_code, min_stock, max_stock, lead_time_days)
      SELECT * FROM unnest($1::int[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::numeric[], $10::numeric[], $11::numeric[])
      ON CONFLICT (company_code) DO UPDATE SET
        item_id = EXCLUDED.item_id,
        uom = COALESCE(EXCLUDED.uom, public.skus.uom),
        display_name = EXCLUDED.display_name,
        category_name = EXCLUDED.category_name,
        supplier_code = EXCLUDED.supplier_code,
        min_stock = EXCLUDED.min_stock,
        max_stock = EXCLUDED.max_stock,
        lead_time_days = EXCLUDED.lead_time_days,
        updated_at = now()
      RETURNING sku_id, company_code
    `,
    [
      normalized.map((r) => itemIdByProductCode.get(r.productCode)),
      normalized.map((r) => r.unit),
      normalized.map(() => 1),
      normalized.map(() => "base"),
      normalized.map((r) => r.productName),
      normalized.map((r) => r.productCode),
      normalized.map((r) => r.categoryName),
      normalized.map((r) => r.supplierCode),
      normalized.map((r) => r.minStock),
      normalized.map((r) => r.maxStock),
      normalized.map((r) => r.leadTimeDays),
    ],
  );
  const skuIdByProductCode = new Map(
    skusResult.rows.map((row) => [row.company_code, row.sku_id]),
  );

  // ── 3. Bulk upsert barcodes, keyed on barcode (PK), sku_id resolved above ──
  const barcodeRows = [];
  for (const r of normalized) {
    r.barcodes.forEach((barcode, index) => {
      barcodeRows.push({ barcode, skuId: skuIdByProductCode.get(r.productCode), isPrimary: index === 0 });
    });
  }
  let barcodesUpserted = 0;
  if (barcodeRows.length > 0) {
    const barcodesResult = await client.query(
      `
        INSERT INTO public.barcodes (barcode, sku_id, is_primary, updated_at)
        SELECT b.barcode, b.sku_id, b.is_primary, now()
        FROM unnest($1::text[], $2::int[], $3::boolean[]) AS b(barcode, sku_id, is_primary)
        ON CONFLICT (barcode) DO UPDATE SET
          sku_id = EXCLUDED.sku_id,
          is_primary = EXCLUDED.is_primary,
          updated_at = now()
        RETURNING barcode
      `,
      [
        barcodeRows.map((b) => b.barcode),
        barcodeRows.map((b) => b.skuId),
        barcodeRows.map((b) => b.isPrimary),
      ],
    );
    barcodesUpserted = barcodesResult.rowCount;
  }

  // ── 4. Bulk insert stock snapshots (append-only, one row per product per sync) ──
  await client.query(
    `
      INSERT INTO analytics.product_stock_snapshots
        (product_code, snapshot_at, stock_current, stock_retail, stock_warehouse, source_name)
      SELECT t.product_code, now(), t.stock_current, t.stock_retail, t.stock_warehouse, 'adapos_sync'
      FROM unnest($1::text[], $2::numeric[], $3::numeric[], $4::numeric[])
        AS t(product_code, stock_current, stock_retail, stock_warehouse)
    `,
    [
      normalized.map((r) => r.productCode),
      normalized.map((r) => r.stockCurrent),
      normalized.map((r) => r.stockRetail),
      normalized.map((r) => r.stockWarehouse),
    ],
  );

  // ── 5. Upsert the "latest stock" read model (CP3.2) ──────────────────────
  // Reads (queryStockDayBase, product search) hit this table instead of the
  // ever-growing history above, so their cost never depends on how much
  // history has piled up. The WHERE guard drops the write if a newer
  // snapshot already landed (a batch from an earlier sync arriving late
  // after a more recent one) — snapshot_at is set to the same `now()` as
  // the history INSERT above, both within this transaction.
  await client.query(
    `
      INSERT INTO analytics.product_current_stock
        (product_code, stock_current, stock_retail, stock_warehouse, snapshot_at, source_name, updated_at)
      SELECT t.product_code, t.stock_current, t.stock_retail, t.stock_warehouse, now(), 'adapos_sync', now()
      FROM unnest($1::text[], $2::numeric[], $3::numeric[], $4::numeric[])
        AS t(product_code, stock_current, stock_retail, stock_warehouse)
      ON CONFLICT (product_code) DO UPDATE SET
        stock_current = EXCLUDED.stock_current,
        stock_retail = EXCLUDED.stock_retail,
        stock_warehouse = EXCLUDED.stock_warehouse,
        snapshot_at = EXCLUDED.snapshot_at,
        source_name = EXCLUDED.source_name,
        updated_at = EXCLUDED.updated_at
      WHERE analytics.product_current_stock.snapshot_at <= EXCLUDED.snapshot_at
    `,
    [
      normalized.map((r) => r.productCode),
      normalized.map((r) => r.stockCurrent),
      normalized.map((r) => r.stockRetail),
      normalized.map((r) => r.stockWarehouse),
    ],
  );

  return {
    itemsUpserted: itemsResult.rowCount,
    skusUpserted: skusResult.rowCount,
    barcodesUpserted,
    snapshotsInserted: normalized.length,
  };
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
      // upsertProductBatch() sorts internally (stable order, same rationale
      // as before — see its own comment) and does the whole batch in 4
      // set-based queries instead of one query loop per record.
      await upsertProductBatch(client, records);
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
  upsertProductBatch,
};
