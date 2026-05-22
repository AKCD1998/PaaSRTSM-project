"use strict";

const express = require("express");

function parsePositiveNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
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

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function safeDivide(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

function buildStockDayRow(product, periodDays) {
  const avgDailyUsage = safeDivide(product.soldQtyPeriod, periodDays);
  const stockDay = avgDailyUsage > 0 ? safeDivide(product.currentStock, avgDailyUsage) : null;
  const startingStock = product.currentStock - product.purchasedQtyPeriod + product.soldQtyPeriod;
  const endingStock = startingStock + product.purchasedQtyPeriod - product.soldQtyPeriod;
  const averageInventory = (startingStock + endingStock) / 2;
  const turnoverRate = averageInventory > 0 ? safeDivide(product.soldQtyPeriod, averageInventory) : 0;

  let status = "Normal";
  if (!product.soldQtyPeriod || avgDailyUsage === 0) {
    status = "No sales";
  } else if (product.currentStock <= product.minStock || stockDay <= Math.max(product.leadTimeDays, 7)) {
    status = "Reorder soon";
  } else if (product.currentStock >= product.maxStock || stockDay > 45) {
    status = "Overstock / slow moving";
  }

  return {
    productCode: product.productCode,
    productName: product.productName,
    barcode: product.barcode,
    unit: product.unit,
    currentStock: round2(product.currentStock),
    soldQtyPeriod: round2(product.soldQtyPeriod),
    averageDailyUsage: round2(avgDailyUsage),
    stockDay: stockDay == null ? null : round2(stockDay),
    purchasedQtyPeriod: round2(product.purchasedQtyPeriod),
    minStock: round2(product.minStock),
    maxStock: round2(product.maxStock),
    leadTimeDays: round2(product.leadTimeDays),
    supplier: product.supplier,
    endingStock: round2(endingStock),
    averageInventory: round2(averageInventory),
    turnoverRate: round2(turnoverRate),
    status,
  };
}

function groupReceiptRows(rows, options = {}) {
  const {
    includeStaPrcDoc = false,
    lineWarehouseField = "warehouse_code",
    lineVatField = "line_vat",
  } = options;

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.doc_no)) {
      grouped.set(row.doc_no, {
        docNo: row.doc_no,
        branchCode: row.branch_code,
        docType: row.doc_type,
        docDate: row.doc_date,
        docTime: row.doc_time,
        supplierCode: row.supplier_code,
        supplierName: row.supplier_name,
        refExt: row.ref_ext,
        refExtDate: row.ref_ext_date,
        warehouseCode: row.warehouse_code,
        total: Number(row.total || 0),
        vat: Number(row.vat || 0),
        grand: Number(row.grand || 0),
        usrCode: row.usr_code,
        createdBy: row.created_by,
        createdAtAda: row.created_at_ada,
        syncedAt: row.synced_at,
        lines: [],
      });

      if (includeStaPrcDoc) {
        grouped.get(row.doc_no).staPrcDoc = row.sta_prc_doc;
      }
    }

    if (row.seq_no != null) {
      grouped.get(row.doc_no).lines.push({
        seqNo: row.seq_no,
        productCode: row.product_code,
        productName: row.product_name,
        barcode: row.barcode,
        unitCode: row.unit_code,
        unitName: row.unit_name,
        factor: Number(row.factor || 1),
        qty: Number(row.qty || 0),
        qtyBase: Number(row.qty_base || 0),
        stockFactor: Number(row.stock_factor || 1),
        setPrice: Number(row.set_price || 0),
        net: Number(row.net || 0),
        vat: Number(row[lineVatField] || 0),
        costIn: Number(row.cost_in || 0),
        lotNo: row.lot_no,
        expiredDate: row.expired_date,
        warehouseCode: row[lineWarehouseField],
      });
    }
  }

  return [...grouped.values()];
}

function validateOrderRequestBody(body) {
  const { branchCode, items } = body || {};
  if (!branchCode || !Array.isArray(items) || items.length === 0) {
    return "branchCode and at least one item are required.";
  }

  for (const item of items) {
    if (!item.productCode || !item.requestedUnit) {
      return "Each item requires productCode, requestedQty, and requestedUnit.";
    }
    const qty = parsePositiveNumber(item.requestedQty);
    if (!qty) {
      return "Each item requestedQty must be a positive number.";
    }
  }

  return null;
}

async function queryStockDayBase(db, periodDays, productCode) {
  const params = [periodDays];
  let productClause = "";
  if (productCode) {
    params.push(productCode);
    productClause = "AND s.company_code = $2";
  }

  const sql = `
    WITH latest_stock AS (
      SELECT DISTINCT ON (ps.product_code)
        ps.product_code,
        ps.stock_current,
        ps.stock_retail,
        ps.stock_warehouse,
        ps.snapshot_at
      FROM analytics.product_stock_snapshots ps
      ORDER BY ps.product_code, ps.snapshot_at DESC, ps.stock_snapshot_id DESC
    ),
    sales AS (
      SELECT
        ss.product_code,
        SUM(ss.sold_qty_base) AS sold_qty_period
      FROM analytics.product_sales_summary_periods ss
      WHERE ss.period_days = $1
      GROUP BY ss.product_code
    ),
    purchases AS (
      SELECT
        ps.product_code,
        SUM(ps.purchased_qty_base) AS purchased_qty_period
      FROM analytics.product_purchase_summary_periods ps
      WHERE ps.period_days = $1
      GROUP BY ps.product_code
    )
    SELECT
      s.company_code AS product_code,
      COALESCE(s.display_name, i.display_name, i.generic_name, s.company_code) AS product_name,
      COALESCE(b.barcode, '') AS barcode,
      COALESCE(s.uom, '') AS unit,
      COALESCE(ls.stock_current, 0) AS stock_current,
      COALESCE(sa.sold_qty_period, 0) AS sold_qty_period,
      COALESCE(pu.purchased_qty_period, 0) AS purchased_qty_period,
      COALESCE(s.min_stock, 0) AS min_stock,
      COALESCE(s.max_stock, 0) AS max_stock,
      COALESCE(s.lead_time_days, 0) AS lead_time_days,
      COALESCE(s.supplier_code, i.supplier_code, '') AS supplier
    FROM public.skus s
    LEFT JOIN public.items i
      ON i.item_id = s.item_id
    LEFT JOIN LATERAL (
      SELECT barcode
      FROM public.barcodes
      WHERE sku_id = s.sku_id
      ORDER BY is_primary DESC, updated_at DESC NULLS LAST, barcode ASC
      LIMIT 1
    ) b ON TRUE
    LEFT JOIN latest_stock ls
      ON ls.product_code = s.company_code
    LEFT JOIN sales sa
      ON sa.product_code = s.company_code
    LEFT JOIN purchases pu
      ON pu.product_code = s.company_code
    WHERE s.company_code IS NOT NULL
      ${productClause}
    ORDER BY s.company_code ASC
  `;

  const result = await db.query(sql, params);
  return result.rows.map((row) => ({
    productCode: row.product_code,
    productName: row.product_name,
    barcode: row.barcode,
    unit: row.unit,
    currentStock: Number(row.stock_current || 0),
    soldQtyPeriod: Number(row.sold_qty_period || 0),
    purchasedQtyPeriod: Number(row.purchased_qty_period || 0),
    minStock: Number(row.min_stock || 0),
    maxStock: Number(row.max_stock || 0),
    leadTimeDays: Number(row.lead_time_days || 0),
    supplier: row.supplier || "",
  }));
}

async function getOrderRequestById(db, orderRequestId) {
  const result = await db.query(
    `
      SELECT
        r.order_request_id,
        r.branch_code,
        b.branch_name,
        r.requested_by,
        r.requested_at,
        r.status,
        r.note,
        i.order_request_item_id,
        i.product_code,
        i.requested_qty,
        i.requested_unit,
        i.line_note,
        COALESCE(s.display_name, it.display_name, it.generic_name, i.product_code) AS product_name
      FROM ordering.branch_order_requests r
      JOIN core.branches b
        ON b.branch_code = r.branch_code
      LEFT JOIN ordering.branch_order_request_items i
        ON i.order_request_id = r.order_request_id
      LEFT JOIN public.skus s
        ON s.company_code = i.product_code
      LEFT JOIN public.items it
        ON it.item_id = s.item_id
      WHERE r.order_request_id = $1
      ORDER BY i.created_at ASC, i.order_request_item_id ASC
    `,
    [orderRequestId],
  );

  if (!result.rowCount) {
    return null;
  }

  const first = result.rows[0];
  return {
    id: String(first.order_request_id),
    branchCode: first.branch_code,
    branchName: first.branch_name,
    requestedBy: first.requested_by,
    requestedAt: first.requested_at,
    status: first.status,
    note: first.note || "",
    items: result.rows
      .filter((row) => row.order_request_item_id != null)
      .map((row) => ({
        id: String(row.order_request_item_id),
        productCode: row.product_code,
        productName: row.product_name,
        requestedQty: Number(row.requested_qty),
        requestedUnit: row.requested_unit,
        lineNote: row.line_note || "",
      })),
  };
}

async function getPendingReceipts(db, branchCode = null) {
  const params = [branchCode];
  const result = await db.query(
    `
      SELECT
        h.doc_no, h.branch_code, h.doc_type, h.doc_date, h.doc_time,
        h.supplier_code, h.supplier_name, h.ref_ext, h.ref_ext_date,
        h.warehouse_code, h.total, h.vat, h.grand,
        h.usr_code, h.created_by, h.created_at_ada, h.sta_doc, h.source_synced_at AS synced_at,
        l.seq_no, l.product_code, l.product_name, l.barcode,
        l.unit_code, l.unit_name, l.factor, l.qty, l.qty_base, l.stock_factor,
        l.set_price, l.net, l.vat AS line_vat, l.cost_in, l.lot_no, l.expired_date,
        l.warehouse_code AS line_warehouse_code
      FROM ada.pending_receipt_headers h
      LEFT JOIN ada.pending_receipt_lines l
        ON l.doc_no = h.doc_no
      WHERE ($1::text IS NULL OR h.branch_code = $1)
      ORDER BY h.doc_date DESC, h.doc_time DESC, l.seq_no ASC
    `,
    params,
  );

  return groupReceiptRows(result.rows, {
    includeStaPrcDoc: false,
    lineWarehouseField: "line_warehouse_code",
    lineVatField: "line_vat",
  });
}

async function getApprovedReceipts(db, branchCode, date = null) {
  const result = await db.query(
    `
      SELECT
        h.doc_no, h.branch_code, h.doc_type, h.doc_date, h.doc_time,
        h.supplier_code, h.supplier_name, h.ref_ext, h.ref_ext_date,
        h.warehouse_code, h.total, h.vat, h.grand,
        h.usr_code, h.created_by, h.created_at_ada, h.sta_doc, h.sta_prc_doc, h.source_synced_at AS synced_at,
        l.seq_no, l.product_code, l.product_name, l.barcode,
        l.unit_code, l.unit_name, l.factor, l.qty, l.qty_base, l.stock_factor,
        l.set_price, l.net, l.vat AS line_vat, l.cost_in, l.lot_no, l.expired_date,
        l.warehouse_code AS line_warehouse_code
      FROM ada.approved_receipt_headers h
      LEFT JOIN ada.approved_receipt_lines l
        ON l.doc_no = h.doc_no
      WHERE h.branch_code = $1
        AND ($2::text IS NULL OR CAST(h.doc_date AS DATE) = $2::date)
      ORDER BY h.doc_date DESC, h.doc_time DESC, l.seq_no ASC
    `,
    [branchCode, date],
  );

  return groupReceiptRows(result.rows, {
    includeStaPrcDoc: true,
    lineWarehouseField: "line_warehouse_code",
    lineVatField: "line_vat",
  });
}

function createOrderingRouter(deps) {
  const { config, db, requireAuthMiddleware } = deps;
  const router = express.Router();

  router.get("/branches", async (req, res, next) => {
    try {
      const result = await db.query(
        `
          SELECT branch_code, branch_name, is_hq
          FROM core.branches
          WHERE is_active = TRUE
          ORDER BY branch_code ASC
        `,
      );
      return res.json(
        result.rows.map((row) => ({
          branchCode: row.branch_code,
          branchName: row.branch_name,
          isHq: row.is_hq,
        })),
      );
    } catch (error) {
      return next(error);
    }
  });

  router.get("/products/search", async (req, res, next) => {
    const q = String(req.query.q || "").trim();
    try {
      const params = [];
      let whereClause = "WHERE s.company_code IS NOT NULL";
      if (q) {
        params.push(`%${q}%`);
        whereClause += `
          AND (
            s.company_code ILIKE $1
            OR COALESCE(s.display_name, i.display_name, i.generic_name, '') ILIKE $1
            OR EXISTS (
              SELECT 1
              FROM public.barcodes b
              WHERE b.sku_id = s.sku_id
                AND b.barcode ILIKE $1
            )
          )
        `;
      }

      const sql = `
        SELECT
          s.company_code AS product_code,
          COALESCE(s.display_name, i.display_name, i.generic_name, s.company_code) AS product_name,
          COALESCE(b.barcode, '') AS barcode,
          COALESCE(s.supplier_code, i.supplier_code, '') AS supplier,
          COALESCE(s.uom, '') AS unit,
          COALESCE(s.min_stock, 0) AS min_stock,
          COALESCE(s.max_stock, 0) AS max_stock,
          COALESCE(s.lead_time_days, 0) AS lead_time_days,
          COALESCE(ls.stock_current, 0) AS stock_current,
          COALESCE(ls.stock_retail, 0) AS stock_retail,
          COALESCE(ls.stock_warehouse, 0) AS stock_warehouse
        FROM public.skus s
        LEFT JOIN public.items i
          ON i.item_id = s.item_id
        LEFT JOIN LATERAL (
          SELECT barcode
          FROM public.barcodes
          WHERE sku_id = s.sku_id
          ORDER BY is_primary DESC, updated_at DESC NULLS LAST, barcode ASC
          LIMIT 1
        ) b ON TRUE
        LEFT JOIN LATERAL (
          SELECT stock_current, stock_retail, stock_warehouse
          FROM analytics.product_stock_snapshots ps
          WHERE ps.product_code = s.company_code
          ORDER BY ps.snapshot_at DESC, ps.stock_snapshot_id DESC
          LIMIT 1
        ) ls ON TRUE
        ${whereClause}
        ORDER BY s.company_code ASC
        LIMIT 20
      `;

      const result = await db.query(sql, params);
      return res.json(
        result.rows.map((row) => ({
          productCode: row.product_code,
          productName: row.product_name,
          barcode: row.barcode,
          supplier: row.supplier,
          unit: row.unit,
          stockCurrent: Number(row.stock_current || 0),
          stockRetail: Number(row.stock_retail || 0),
          stockWarehouse: Number(row.stock_warehouse || 0),
          minStock: Number(row.min_stock || 0),
          maxStock: Number(row.max_stock || 0),
          leadTimeDays: Number(row.lead_time_days || 0),
        })),
      );
    } catch (error) {
      return next(error);
    }
  });

  router.post("/order-requests", async (req, res, next) => {
    const validationError = validateOrderRequestBody(req.body);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const branchResult = await client.query(
        "SELECT branch_code, branch_name FROM core.branches WHERE branch_code = $1 AND is_active = TRUE",
        [req.body.branchCode],
      );
      if (!branchResult.rowCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: `Unknown branchCode: ${req.body.branchCode}` });
      }

      const normalizedItems = [];
      for (const item of req.body.items) {
        const skuResult = await client.query(
          `
            SELECT
              s.company_code,
              COALESCE(s.display_name, i.display_name, i.generic_name, s.company_code) AS product_name
            FROM public.skus s
            LEFT JOIN public.items i
              ON i.item_id = s.item_id
            WHERE s.company_code = $1
            LIMIT 1
          `,
          [item.productCode],
        );
        if (!skuResult.rowCount) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: `Unknown productCode: ${item.productCode}` });
        }
        normalizedItems.push({
          productCode: item.productCode,
          productName: skuResult.rows[0].product_name,
          requestedQty: Number(item.requestedQty),
          requestedUnit: String(item.requestedUnit),
          lineNote: item.lineNote ? String(item.lineNote) : "",
        });
      }

      const insertRequest = await client.query(
        `
          INSERT INTO ordering.branch_order_requests
            (branch_code, requested_by, requested_at, status, note)
          VALUES ($1, $2, now(), 'submitted', $3)
          RETURNING order_request_id, requested_at, status
        `,
        [req.body.branchCode, req.body.requestedBy || "Branch Staff", req.body.note || ""],
      );

      const orderRequestId = insertRequest.rows[0].order_request_id;
      const insertedItems = [];
      for (const item of normalizedItems) {
        const inserted = await client.query(
          `
            INSERT INTO ordering.branch_order_request_items
              (order_request_id, product_code, requested_qty, requested_unit, line_note)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING order_request_item_id
          `,
          [orderRequestId, item.productCode, item.requestedQty, item.requestedUnit, item.lineNote],
        );
        insertedItems.push({
          id: String(inserted.rows[0].order_request_item_id),
          productCode: item.productCode,
          productName: item.productName,
          requestedQty: item.requestedQty,
          requestedUnit: item.requestedUnit,
          lineNote: item.lineNote,
        });
      }

      await client.query("COMMIT");
      return res.status(201).json({
        id: String(orderRequestId),
        branchCode: req.body.branchCode,
        branchName: branchResult.rows[0].branch_name,
        requestedBy: req.body.requestedBy || "Branch Staff",
        requestedAt: insertRequest.rows[0].requested_at,
        status: insertRequest.rows[0].status,
        note: req.body.note || "",
        items: insertedItems,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      return next(error);
    } finally {
      client.release();
    }
  });

  router.get("/order-requests/:id", async (req, res, next) => {
    const orderRequestId = parsePositiveInt(req.params.id, null);
    if (orderRequestId == null) {
      return res.status(400).json({ message: "Order request id must be a positive integer." });
    }
    try {
      const orderRequest = await getOrderRequestById(db, orderRequestId);
      if (!orderRequest) {
        return res.status(404).json({ message: "Order request not found." });
      }
      return res.json(orderRequest);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/order-requests", requireAuthMiddleware, async (req, res, next) => {
    try {
      const result = await db.query(
        `
          SELECT order_request_id
          FROM ordering.branch_order_requests
          ORDER BY requested_at DESC, order_request_id DESC
        `,
      );
      const requests = [];
      for (const row of result.rows) {
        // Keep response shape stable with the existing ordering app.
        // Request count is expected to be small in early rollout.
        // This avoids a second grouping implementation.
        // eslint-disable-next-line no-await-in-loop
        requests.push(await getOrderRequestById(db, row.order_request_id));
      }
      return res.json(requests);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/stock-day", requireAuthMiddleware, async (req, res, next) => {
    const periodDays = parsePositiveInt(req.query.periodDays, config.defaultPeriodDays);
    if (periodDays == null) {
      return res.status(400).json({ message: "periodDays must be a positive number." });
    }
    try {
      const rows = await queryStockDayBase(db, periodDays, null);
      return res.json(rows.map((row) => buildStockDayRow(row, periodDays)));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/products/:productCode/summary", requireAuthMiddleware, async (req, res, next) => {
    const periodDays = parsePositiveInt(req.query.periodDays, config.defaultPeriodDays);
    if (periodDays == null) {
      return res.status(400).json({ message: "periodDays must be a positive number." });
    }
    try {
      const rows = await queryStockDayBase(db, periodDays, req.params.productCode);
      if (!rows[0]) {
        return res.status(404).json({ message: "Product summary not found." });
      }
      return res.json(buildStockDayRow(rows[0], periodDays));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/sync-status", requireAuthMiddleware, async (req, res, next) => {
    try {
      const latestRunResult = await db.query(
        `
          SELECT
            sync_run_id,
            sync_type,
            source_name,
            started_at,
            finished_at,
            status,
            records_read,
            records_sent,
            message
          FROM ingest.sync_runs
          ORDER BY started_at DESC, sync_run_id DESC
          LIMIT 1
        `,
      );
      const recentErrorsResult = await db.query(
        `
          SELECT
            sync_error_id,
            sync_run_id,
            sync_type,
            source_name,
            error_message,
            error_details,
            created_at
          FROM ingest.sync_errors
          ORDER BY created_at DESC, sync_error_id DESC
          LIMIT 10
        `,
      );

      const latestRun = latestRunResult.rows[0]
        ? {
            id: String(latestRunResult.rows[0].sync_run_id),
            syncType: latestRunResult.rows[0].sync_type,
            sourceName: latestRunResult.rows[0].source_name,
            startedAt: latestRunResult.rows[0].started_at,
            finishedAt: latestRunResult.rows[0].finished_at,
            status: latestRunResult.rows[0].status,
            recordsRead: latestRunResult.rows[0].records_read,
            recordsSent: latestRunResult.rows[0].records_sent,
            message: latestRunResult.rows[0].message,
          }
        : null;

      return res.json({
        latestRun,
        recentErrors: recentErrorsResult.rows.map((row) => ({
          id: String(row.sync_error_id),
          syncRunId: row.sync_run_id == null ? null : String(row.sync_run_id),
          syncType: row.sync_type,
          sourceName: row.source_name,
          errorMessage: row.error_message,
          errorDetails: row.error_details,
          createdAt: row.created_at,
        })),
        mode: "postgres",
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/pending-receipts", requireAuthMiddleware, async (req, res, next) => {
    try {
      return res.json({ records: await getPendingReceipts(db, req.query.branchCode || null) });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/approved-receipts", requireAuthMiddleware, async (req, res, next) => {
    const branchCode = String(req.query.branchCode || "").trim();
    if (!branchCode) {
      return res.status(400).json({ error: "branchCode required" });
    }

    try {
      return res.json({
        ok: true,
        records: await getApprovedReceipts(db, branchCode, req.query.date ? String(req.query.date) : null),
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createOrderingRouter,
  buildStockDayRow,
  getApprovedReceipts,
  getPendingReceipts,
  groupReceiptRows,
  validateOrderRequestBody,
};
