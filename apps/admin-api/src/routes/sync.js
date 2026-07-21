"use strict";

const express = require("express");
const crypto = require("node:crypto");
const { branchStockValueKeys, firstDefined } = require("../sync-v2-contract");

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

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashCanonical(value) {
  return crypto.createHash("sha256").update(canonicalize(value)).digest("hex");
}

function getSyncV2Config(config) {
  return {
    datasets: config.syncV2AllowedDatasets || new Set(),
    branches: config.syncV2AllowedBranches || new Set(),
    maxBatchRecords: config.syncV2MaxBatchRecords || 100,
  };
}

function validateBranchStockRecords(records, branchCode) {
  const keys = branchStockValueKeys(branchCode);
  const productCodes = new Set();
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return `records[${index}] must be an object.`;
    const productCode = normalizeText(record.productCode ?? record.product_code);
    if (!productCode) return `records[${index}].productCode is required.`;
    if (productCodes.has(productCode)) return `records[${index}].productCode duplicates ${productCode}.`;
    productCodes.add(productCode);
    const recordBranch = normalizeText(record.branchCode ?? record.branch_code);
    if (!recordBranch) return `records[${index}].branchCode is required.`;
    if (recordBranch !== branchCode) return `records[${index}].branchCode must match run branch ${branchCode}.`;
    const qty = firstDefined(record, keys.qty);
    if (qty === undefined || !Number.isFinite(Number(qty))) return `records[${index}].qty is invalid.`;
    const cost = firstDefined(record, keys.cost);
    if (cost !== undefined && cost !== null && cost !== "" && !Number.isFinite(Number(cost))) return `records[${index}].costAvg is invalid.`;
    const timestamp = record.syncedAt ?? record.synced_at ?? record.sourceSyncedAt ?? record.source_synced_at;
    if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) return `records[${index}].syncedAt is invalid.`;
  }
  return null;
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

const SNAPSHOT_RETENTION_DAYS = 365;
const PRUNE_THROTTLE_HOURS = 24;
const PRUNE_BATCH_SIZE = 20_000;
const PRUNE_TASK_NAME = "prune_product_stock_snapshots";

// CP3.2 retention, piggybacked onto normal sync traffic rather than a
// separate scheduled job (deliberately no new Render Cron service — avoids
// growing billed infrastructure). The claim UPSERT is atomic, so concurrent
// /products calls from multiple branches can't double-run this; almost
// every call will just no-op past the throttle check. Batch-bounded delete
// (not a single unbounded DELETE) keeps any one run's lock/duration small —
// worth revisiting the batch size if daily insert volume ever outpaces it,
// see docs/sync-program/STATE.md.
async function pruneOldSnapshotsIfDue(db) {
  const claim = await db.query(
    `
      INSERT INTO analytics.maintenance_runs (task_name, last_run_at)
      VALUES ($1, now())
      ON CONFLICT (task_name) DO UPDATE SET last_run_at = now()
      WHERE analytics.maintenance_runs.last_run_at IS NULL
         OR analytics.maintenance_runs.last_run_at < now() - ($2 || ' hours')::interval
      RETURNING task_name
    `,
    [PRUNE_TASK_NAME, PRUNE_THROTTLE_HOURS],
  );
  if (claim.rowCount === 0) return { ran: false };

  const deleted = await db.query(
    `
      DELETE FROM analytics.product_stock_snapshots
      WHERE stock_snapshot_id IN (
        SELECT stock_snapshot_id
        FROM analytics.product_stock_snapshots
        WHERE snapshot_at < now() - ($1 || ' days')::interval
        ORDER BY snapshot_at ASC
        LIMIT $2
      )
    `,
    [SNAPSHOT_RETENTION_DAYS, PRUNE_BATCH_SIZE],
  );

  await db.query(
    `UPDATE analytics.maintenance_runs SET last_run_deleted_count = $1 WHERE task_name = $2`,
    [deleted.rowCount, PRUNE_TASK_NAME],
  );

  return { ran: true, deletedCount: deleted.rowCount };
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

  // CP2 (observability): if the agent sent a run correlation ID (see
  // /run-start below), record this dataset's outcome under that run —
  // fire-and-forget, must never affect the real response either way.
  // Also logs to stdout (captured by Render) tagged with the run ID, so
  // Render logs become filterable by run instead of eyeballed by timestamp.
  router.use((req, res, next) => {
    const runId = normalizeText(req.headers["x-sync-run-id"]);
    if (!runId || req.path === "/run-start" || req.path.startsWith("/v2/")) return next();

    const startedAt = new Date();
    let recordsSent = null;
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (body && typeof body === "object") {
        recordsSent = Number(body.accepted ?? body.headersAccepted ?? body.sent ?? NaN);
        if (!Number.isFinite(recordsSent)) recordsSent = null;
      }
      return originalJson(body);
    };

    res.on("finish", () => {
      const success = res.statusCode >= 200 && res.statusCode < 300;
      const datasetName = req.path.replace(/^\//, "") || "unknown";
      console.log(`[sync run ${runId}] ${datasetName}: ${success ? "success" : "failed"} (HTTP ${res.statusCode})`);
      db.query(
        `
          INSERT INTO ingest.sync_run_datasets
            (sync_run_id, dataset_name, status, records_sent, error_message, started_at, finished_at)
          VALUES ($1, $2, $3, $4, $5, $6, now())
        `,
        [runId, datasetName, success ? "success" : "failed", recordsSent, success ? null : `HTTP ${res.statusCode}`, startedAt],
      ).catch((e) => console.error(`[sync run ${runId}] failed to log ${datasetName}:`, e.message));
    });

    next();
  });

  // POST /api/sync/run-start — call this FIRST, before any dataset POSTs.
  // Creates the ingest.sync_runs row immediately (status='running') instead
  // of only ever recording a run after it finished — a run that crashes
  // mid-way now leaves a row stuck 'running' past its expected finish time,
  // which is visible, instead of leaving no trace anywhere.
  router.post("/run-start", async (req, res, next) => {
    try {
      const syncType = normalizeText(req.body?.syncType) || "manual";
      const branchCode = normalizeNullableText(req.body?.branchCode);
      const ingestionMode = normalizeText(req.body?.ingestionMode) || "v1";
      if (!["v1", "hybrid_v2"].includes(ingestionMode)) {
        return res.status(400).json({ message: "ingestionMode must be v1 or hybrid_v2." });
      }
      if (ingestionMode === "hybrid_v2") {
        const v2Datasets = req.body?.v2Datasets;
        const flags = getSyncV2Config(config);
        if (!branchCode || !/^00[0-5]$/.test(branchCode)) {
          return res.status(400).json({ message: "branchCode must be one of 000-005 for hybrid_v2." });
        }
        if (!Array.isArray(v2Datasets) || v2Datasets.length !== 1 || v2Datasets[0] !== "branch_stock") {
          return res.status(400).json({ message: "v2Datasets must be exactly [\"branch_stock\"] for this release." });
        }
        if (!flags.datasets.has("branch_stock")) {
          return res.status(403).json({ message: "Dataset is disabled for sync v2." });
        }
        if (!flags.branches.has(branchCode)) {
          return res.status(403).json({ message: "Branch is disabled for sync v2." });
        }
      }
      const result = await db.query(
        `
          INSERT INTO ingest.sync_runs
            (sync_type, source_name, branch_code, ingestion_mode, handoff_status,
             apply_status, started_at, status, records_read, records_sent)
          VALUES ($1, $2, $3, $4,
                  CASE WHEN $4 = 'hybrid_v2' THEN 'running' ELSE 'not_applicable' END,
                  CASE WHEN $4 = 'hybrid_v2' THEN 'waiting' ELSE 'not_applicable' END,
                  now(), 'running', 0, 0)
          RETURNING sync_run_id
        `,
        [syncType, normalizeText(req.body?.sourceName) || "adapos_sync", branchCode, ingestionMode],
      );
      return res.json({ runId: String(result.rows[0].sync_run_id) });
    } catch (e) {
      return next(e);
    }
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
      // Best-effort, throttled retention pruning — must never affect this
      // response either way, so it runs after commit, on the pool (not the
      // just-released client), fire-and-forget with its own error handling.
      pruneOldSnapshotsIfDue(db).catch((pruneError) => {
        console.error("pruneOldSnapshotsIfDue failed:", pruneError.message);
      });
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
      // runId present (agent called /run-start first, current agent
      // version) -> finish that same row instead of creating a new one, so
      // the run's whole lifecycle (running -> success/failed) lives on one
      // row. runId absent -> old agent still mid-self-update, fall back to
      // the pre-CP2 insert-once-at-the-end behavior so it keeps working
      // exactly as before until it picks up the newer code.
      const runId = normalizeText(req.body?.runId);
      const status = normalizeText(req.body?.status) || "success";
      const finishedAt = req.body?.finishedAt || new Date().toISOString();
      const recordsRead = Math.max(0, Math.floor(toNumber(req.body?.recordsRead, 0)));
      const recordsSent = Math.max(0, Math.floor(toNumber(req.body?.recordsSent, 0)));
      const message = normalizeText(req.body?.message) || "";

      const result = runId
        ? await db.query(
            `
              UPDATE ingest.sync_runs
              SET finished_at = CASE
                    WHEN ingestion_mode = 'v1' THEN $2
                    WHEN ingestion_mode = 'hybrid_v2' AND $3 = 'failed' AND finalized_at IS NULL THEN $2
                    ELSE finished_at
                  END,
                  status = CASE
                    WHEN ingestion_mode = 'v1' THEN $3
                    WHEN $3 = 'failed' AND finalized_at IS NULL THEN 'failed'
                    ELSE status
                  END,
                  handoff_status = CASE
                    WHEN ingestion_mode = 'hybrid_v2' AND $3 = 'failed' AND finalized_at IS NULL THEN 'failed'
                    ELSE handoff_status
                  END,
                  apply_status = CASE
                    WHEN ingestion_mode = 'hybrid_v2' AND $3 = 'failed' AND finalized_at IS NULL THEN 'failed'
                    ELSE apply_status
                  END,
                  handoff_finished_at = CASE
                    WHEN ingestion_mode = 'hybrid_v2' AND $3 = 'failed' AND finalized_at IS NULL THEN $2
                    ELSE handoff_finished_at
                  END,
                  failure_stage = CASE
                    WHEN ingestion_mode = 'hybrid_v2' AND $3 = 'failed' AND finalized_at IS NULL THEN 'handoff'
                    ELSE failure_stage
                  END,
                  records_read = $4, records_sent = $5, message = $6
              WHERE sync_run_id = $1::bigint
              RETURNING sync_run_id, ingestion_mode, status, apply_status
            `,
            [runId, finishedAt, status, recordsRead, recordsSent, message],
          )
        : await db.query(
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
              finishedAt,
              status,
              recordsRead,
              recordsSent,
              message,
            ],
          );

      if (runId && result.rowCount === 0) {
        return res.status(404).json({ message: `No sync run found for runId ${runId}.` });
      }

      let adaSyncRunId = null;
      const updatedRun = result.rows[0];
      const isHybrid = updatedRun.ingestion_mode === "hybrid_v2";
      const isActualHybridSuccess = updatedRun.status === "success" && updatedRun.apply_status === "applied";
      const isActualHybridFailure = updatedRun.status === "failed";
      const mayMirror = !isHybrid ||
        (status === "success" && isActualHybridSuccess) ||
        (status === "failed" && isActualHybridFailure);
      if (shouldMirrorAdaRunLog(req.body) && mayMirror) {
        adaSyncRunId = await insertAdaRunLog(db, req.body);
      }

      if (status.toLowerCase() === "failed" && (!isHybrid || isActualHybridFailure)) {
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

  // ── CP4: async ingestion v2 ──────────────────────────────────────────────
  // Design: docs/sync-program/CP4_ASYNC_INGESTION_DESIGN.md (SC-StockDay-Ordering).
  // v1 endpoints above are untouched — this is additive. An agent opts in by
  // calling /run-start as usual, then posting batches here instead of the
  // per-dataset v1 endpoints; a worker (worker.js) applies them separately.

  // POST /api/sync/v2/batches. Batches remain staged until an exact manifest
  // is finalized; workers can never observe a partial handoff.
  router.post("/v2/batches", async (req, res, next) => {
    const client = await db.connect();
    try {
      const syncRunId = normalizeText(req.body?.syncRunId);
      const dataset = normalizeText(req.body?.dataset).toLowerCase();
      const batchSeq = Number(req.body?.batchSeq);
      const records = Array.isArray(req.body?.records) ? req.body.records : null;
      const flags = getSyncV2Config(config);

      if (!/^\d+$/.test(syncRunId) || !dataset || !Number.isInteger(batchSeq) || !records) {
        return res.status(400).json({
          message: "syncRunId, dataset, batchSeq, and records[] are required.",
        });
      }
      if (dataset !== "branch_stock") return res.status(400).json({ message: "Unknown or unavailable dataset." });
      if (!flags.datasets.has(dataset)) return res.status(403).json({ message: "Dataset is disabled for sync v2." });
      if (batchSeq < 1) return res.status(400).json({ message: "batchSeq must be a positive integer." });
      if (records.length < 1 || records.length > flags.maxBatchRecords) {
        return res.status(400).json({ message: `records must contain 1-${flags.maxBatchRecords} items.` });
      }
      const payloadHash = hashCanonical(records);
      await client.query("BEGIN");
      const runResult = await client.query(
        `SELECT sync_run_id, ingestion_mode, branch_code, finalized_at, status
         FROM ingest.sync_runs WHERE sync_run_id = $1::bigint FOR UPDATE`,
        [syncRunId],
      );
      const run = runResult.rows[0];
      if (!run) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Sync run not found." }); }
      if (run.ingestion_mode !== "hybrid_v2" || run.status !== "running" || run.finalized_at) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "Sync run is not accepting staged batches." });
      }
      if (!flags.branches.has(run.branch_code)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "Branch is disabled for sync v2." });
      }
      const recordError = validateBranchStockRecords(records, run.branch_code);
      if (recordError) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: recordError });
      }
      const inserted = await client.query(
        `
          INSERT INTO ingest.sync_batches
            (sync_run_id, dataset, batch_seq, payload_hash, payload, record_count, status)
          VALUES ($1::bigint, $2, $3, $4, $5::jsonb, $6, 'staged')
          ON CONFLICT (sync_run_id, dataset, batch_seq) DO NOTHING
          RETURNING batch_id, payload_hash
        `,
        [syncRunId, dataset, batchSeq, payloadHash, JSON.stringify(records), records.length],
      );
      let batch = inserted.rows[0];
      if (!batch) {
        batch = (await client.query(
          `SELECT batch_id, payload_hash FROM ingest.sync_batches
           WHERE sync_run_id = $1::bigint AND dataset = $2 AND batch_seq = $3`,
          [syncRunId, dataset, batchSeq],
        )).rows[0];
        if (batch.payload_hash !== payloadHash) {
          await client.query("ROLLBACK");
          return res.status(409).json({ message: "Batch sequence already exists with a different payload." });
        }
      }
      await client.query("COMMIT");
      return res.status(202).json({ batchId: String(batch.batch_id), status: "staged", payloadHash });
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_) { /* no-op */ }
      return next(e);
    } finally {
      client.release();
    }
  });

  router.post("/v2/runs/:syncRunId/finalize", async (req, res, next) => {
    const client = await db.connect();
    try {
      const syncRunId = normalizeText(req.params.syncRunId);
      const dataset = normalizeText(req.body?.dataset).toLowerCase();
      const batchCount = Number(req.body?.batchCount);
      const recordCount = Number(req.body?.recordCount);
      if (!/^\d+$/.test(syncRunId)) {
        return res.status(400).json({ message: "syncRunId must be numeric." });
      }
      if (dataset !== "branch_stock" || !Number.isInteger(batchCount) || batchCount < 1 ||
          !Number.isInteger(recordCount) || recordCount < 1) {
        return res.status(400).json({ message: "A valid branch_stock manifest is required." });
      }
      const manifest = { dataset, batchCount, recordCount };
      const manifestHash = hashCanonical(manifest);
      await client.query("BEGIN");
      const run = (await client.query(
        `SELECT * FROM ingest.sync_runs WHERE sync_run_id = $1::bigint FOR UPDATE`, [syncRunId],
      )).rows[0];
      if (!run) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Sync run not found." }); }
      if (run.ingestion_mode !== "hybrid_v2") { await client.query("ROLLBACK"); return res.status(409).json({ message: "Run is not hybrid_v2." }); }
      const flags = getSyncV2Config(config);
      if (!flags.datasets.has(dataset)) { await client.query("ROLLBACK"); return res.status(403).json({ message: "Dataset is disabled for sync v2." }); }
      if (!flags.branches.has(run.branch_code)) { await client.query("ROLLBACK"); return res.status(403).json({ message: "Branch is disabled for sync v2." }); }
      if (run.finalized_at) {
        await client.query("ROLLBACK");
        if (run.manifest_hash !== manifestHash) return res.status(409).json({ message: "Run was finalized with a different manifest." });
        return res.json({ syncRunId, status: "finalized", idempotent: true, manifestHash });
      }
      if (run.status !== "running" || run.handoff_status !== "running") {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "Run is not in a finalizable handoff state." });
      }
      const summary = (await client.query(
        `SELECT COUNT(*)::int AS batch_count, COALESCE(SUM(record_count), 0)::int AS record_count,
                MIN(batch_seq)::int AS min_seq, MAX(batch_seq)::int AS max_seq,
                COUNT(DISTINCT batch_seq)::int AS distinct_seq
         FROM ingest.sync_batches WHERE sync_run_id = $1::bigint AND dataset = $2 AND status = 'staged'`,
        [syncRunId, dataset],
      )).rows[0];
      const exact = summary.batch_count === batchCount && summary.record_count === recordCount &&
        summary.min_seq === 1 && summary.max_seq === batchCount && summary.distinct_seq === batchCount;
      if (!exact) { await client.query("ROLLBACK"); return res.status(409).json({ message: "Staged batches do not match the manifest." }); }
      await client.query(
        `UPDATE ingest.sync_batches SET status = 'queued', queued_at = now(), next_attempt_at = now()
         WHERE sync_run_id = $1::bigint AND dataset = $2 AND status = 'staged'`, [syncRunId, dataset],
      );
      await client.query(
        `UPDATE ingest.sync_runs
         SET handoff_status = 'success', apply_status = 'pending', total_batches = $2,
             applied_batches = 0, failed_batches = 0, handoff_finished_at = now(),
             finalized_at = now(), manifest_hash = $3
         WHERE sync_run_id = $1::bigint`, [syncRunId, batchCount, manifestHash],
      );
      await client.query("COMMIT");
      return res.json({ syncRunId, status: "finalized", idempotent: false, manifestHash });
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_) { /* no-op */ }
      return next(e);
    } finally { client.release(); }
  });

  // GET /api/sync/v2/runs/:syncRunId
  // apply_status is the field a caller should actually trust for "is the
  // data live yet" — see the design doc's status-model section. Also
  // surfaces how stale the oldest still-pending batch is, which is the
  // direct answer to "how do we detect the queue got stuck".
  router.get("/v2/runs/:syncRunId", async (req, res, next) => {
    try {
      const syncRunId = normalizeText(req.params.syncRunId);
      const runResult = await db.query(
        `
          SELECT sync_run_id, sync_type, branch_code, status, ingestion_mode,
                 handoff_status, apply_status,
                 total_batches, applied_batches, failed_batches,
                 started_at, handoff_finished_at, finalized_at, applied_at,
                 finished_at, failure_stage, message
          FROM ingest.sync_runs
          WHERE sync_run_id = $1::bigint
        `,
        [syncRunId],
      );
      if (runResult.rows.length === 0) {
        return res.status(404).json({ message: `No sync run found for ${syncRunId}.` });
      }

      const staleResult = await db.query(
        `
          SELECT MIN(queued_at) FILTER (WHERE status IN ('queued', 'processing', 'retry_wait')) AS oldest_pending_queued_at,
                 (ARRAY_AGG(last_error ORDER BY batch_id DESC)
                    FILTER (WHERE status = 'dead_letter' AND last_error IS NOT NULL))[1] AS terminal_batch_error
          FROM ingest.sync_batches
          WHERE sync_run_id = $1::bigint
        `,
        [syncRunId],
      );

      const run = runResult.rows[0];
      return res.json({
        syncRunId: String(run.sync_run_id),
        syncType: run.sync_type,
        branchCode: run.branch_code,
        overallStatus: run.status,
        ingestionMode: run.ingestion_mode,
        handoffStatus: run.handoff_status,
        applyStatus: run.apply_status,
        totalBatches: run.total_batches,
        appliedBatches: run.applied_batches,
        failedBatches: run.failed_batches,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        handoffFinishedAt: run.handoff_finished_at,
        finalizedAt: run.finalized_at,
        appliedAt: run.applied_at,
        terminalFailure: run.status === "failed"
          ? { stage: run.failure_stage, message: staleResult.rows[0].terminal_batch_error || run.message }
          : null,
        message: run.message,
        oldestPendingQueuedAt: staleResult.rows[0].oldest_pending_queued_at,
      });
    } catch (e) {
      return next(e);
    }
  });

  // GET /api/sync/v2/runs/:syncRunId/batches — per-batch drill-down, the
  // thing a human debugging "why isn't this branch done yet" actually needs.
  router.get("/v2/runs/:syncRunId/batches", async (req, res, next) => {
    try {
      const syncRunId = normalizeText(req.params.syncRunId);
      const result = await db.query(
        `
          SELECT batch_id, dataset, batch_seq, record_count, status, attempts,
                 max_attempts, last_error, queued_at, claimed_at, applied_at
          FROM ingest.sync_batches
          WHERE sync_run_id = $1::bigint
          ORDER BY batch_seq ASC
        `,
        [syncRunId],
      );
      return res.json({
        syncRunId,
        batches: result.rows.map((row) => ({
          batchId: String(row.batch_id),
          dataset: row.dataset,
          batchSeq: row.batch_seq,
          recordCount: row.record_count,
          status: row.status,
          attempts: row.attempts,
          maxAttempts: row.max_attempts,
          lastError: row.last_error,
          queuedAt: row.queued_at,
          claimedAt: row.claimed_at,
          appliedAt: row.applied_at,
        })),
      });
    } catch (e) {
      return next(e);
    }
  });

  return router;
}

module.exports = {
  createSyncRouter,
  upsertProductBatch,
  pruneOldSnapshotsIfDue,
};
