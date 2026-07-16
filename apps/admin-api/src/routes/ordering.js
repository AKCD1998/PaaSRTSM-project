"use strict";

const express = require("express");

const PRODUCT_MOVEMENT_TYPES = new Set([
  "transfer_in",
  "transfer_out",
  "supplier_receipt",
  "sales_summary",
]);
const PRODUCT_MOVEMENT_TRACE_LIMIT = 200;

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

function normalizeProductCodeList(values) {
  const input = Array.isArray(values) ? values : [];
  const seen = new Set();
  const productCodes = [];
  const duplicateCodes = [];
  const skippedValues = [];

  for (const value of input) {
    const code = String(value || "").trim();
    if (!code || code.toUpperCase() === "#N/A") {
      if (code) skippedValues.push(code);
      continue;
    }

    if (seen.has(code)) {
      duplicateCodes.push(code);
      continue;
    }

    seen.add(code);
    productCodes.push(code);
  }

  return { productCodes, duplicateCodes, skippedValues };
}

function normalizeIdList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function normalizeTextList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeMovementTypes(values) {
  if (!Array.isArray(values) || values.length === 0 || values.includes("all")) {
    return [...PRODUCT_MOVEMENT_TYPES];
  }

  const types = normalizeTextList(values).filter((value) => PRODUCT_MOVEMENT_TYPES.has(value));
  return types.length ? types : [...PRODUCT_MOVEMENT_TYPES];
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function normalizeTraceRequestBody(body) {
  const source = body || {};
  const productCodeNormalization = normalizeProductCodeList(source.product_codes || source.productCodes || []);
  const dateFrom = String(source.date_from || source.dateFrom || "").trim();
  const dateTo = String(source.date_to || source.dateTo || "").trim();

  if (dateFrom && !isIsoDate(dateFrom)) {
    throw Object.assign(new Error("date_from must be YYYY-MM-DD."), { statusCode: 400 });
  }

  if (dateTo && !isIsoDate(dateTo)) {
    throw Object.assign(new Error("date_to must be YYYY-MM-DD."), { statusCode: 400 });
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw Object.assign(new Error("date_from must be before or equal to date_to."), { statusCode: 400 });
  }

  return {
    productCodes: productCodeNormalization.productCodes,
    duplicateCodes: productCodeNormalization.duplicateCodes,
    skippedValues: productCodeNormalization.skippedValues,
    savedGroupIds: normalizeIdList(source.saved_group_ids || source.savedGroupIds || []),
    categoryNames: normalizeTextList(source.category_names || source.categoryNames || source.category_ids || source.categoryIds || []),
    brandNames: normalizeTextList(source.brand_names || source.brandNames || source.brand_ids || source.brandIds || []),
    branchCode: String(source.branch_code || source.branchCode || "").trim() || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    movementTypes: normalizeMovementTypes(source.movement_types || source.movementTypes || []),
  };
}

function buildMovementWarnings({ duplicateCodes = [], skippedValues = [] } = {}) {
  const warnings = ["Sales data is summary only, not bill-level transaction data."];
  if (duplicateCodes.length) {
    warnings.push(`Duplicate product codes were searched once: ${duplicateCodes.join(", ")}`);
  }
  if (skippedValues.length) {
    warnings.push(`Ignored invalid pasted values: ${skippedValues.join(", ")}`);
  }
  return warnings;
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function toDateKey(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

async function loadProductMovementGroups(db) {
  const result = await db.query(
    `
      SELECT
        g.group_id,
        g.group_name,
        g.description,
        g.created_by,
        g.created_at,
        g.updated_at,
        COALESCE(
          json_agg(i.product_code ORDER BY i.product_code) FILTER (WHERE i.product_code IS NOT NULL),
          '[]'::json
        ) AS product_codes
      FROM admin.product_movement_groups g
      LEFT JOIN admin.product_movement_group_items i
        ON i.group_id = g.group_id
      GROUP BY g.group_id
      ORDER BY g.group_name ASC
    `,
  );

  return result.rows.map((row) => ({
    id: Number(row.group_id),
    name: row.group_name,
    description: row.description || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    productCodes: Array.isArray(row.product_codes) ? row.product_codes : [],
  }));
}

async function saveProductMovementGroup(db, { groupId = null, name, description = "", productCodes = [], actor = "" }) {
  const groupName = String(name || "").trim();
  if (!groupName) {
    throw Object.assign(new Error("group name is required."), { statusCode: 400 });
  }

  const normalized = normalizeProductCodeList(productCodes).productCodes;
  if (!normalized.length) {
    throw Object.assign(new Error("at least one product code is required."), { statusCode: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const groupResult = groupId
      ? await client.query(
          `
            UPDATE admin.product_movement_groups
            SET group_name = $2,
                description = $3,
                updated_at = now()
            WHERE group_id = $1
            RETURNING group_id
          `,
          [groupId, groupName, description || null],
        )
      : await client.query(
          `
            INSERT INTO admin.product_movement_groups (group_name, description, created_by)
            VALUES ($1, $2, $3)
            ON CONFLICT (group_name) DO UPDATE
            SET description = EXCLUDED.description,
                updated_at = now()
            RETURNING group_id
          `,
          [groupName, description || null, actor || null],
        );

    if (!groupResult.rowCount) {
      throw Object.assign(new Error("product movement group not found."), { statusCode: 404 });
    }

    const savedGroupId = Number(groupResult.rows[0].group_id);
    await client.query("DELETE FROM admin.product_movement_group_items WHERE group_id = $1", [savedGroupId]);
    await client.query(
      `
        INSERT INTO admin.product_movement_group_items (group_id, product_code)
        SELECT $1::bigint, unnest($2::text[])
        ON CONFLICT DO NOTHING
      `,
      [savedGroupId, normalized],
    );
    await client.query("COMMIT");
    return savedGroupId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function resolveProductMovementScope(db, request) {
  const codeSet = new Set(request.productCodes);

  if (request.savedGroupIds.length) {
    const result = await db.query(
      `
        SELECT DISTINCT product_code
        FROM admin.product_movement_group_items
        WHERE group_id = ANY($1::bigint[])
        ORDER BY product_code
      `,
      [request.savedGroupIds],
    );
    result.rows.forEach((row) => codeSet.add(row.product_code));
  }

  if (request.categoryNames.length || request.brandNames.length) {
    const params = [request.categoryNames, request.brandNames];
    const result = await db.query(
      `
        SELECT DISTINCT s.company_code AS product_code
        FROM public.skus s
        LEFT JOIN public.items i
          ON i.item_id = s.item_id
        LEFT JOIN ada.product_category_states pcs
          ON pcs.product_code = s.company_code
        WHERE s.company_code IS NOT NULL
          AND (
            cardinality($1::text[]) = 0
            OR COALESCE(pcs.category_name, s.category_name, i.category_name, '') = ANY($1::text[])
          )
          AND (
            cardinality($2::text[]) = 0
            OR COALESCE(s.supplier_code, i.supplier_code, '') = ANY($2::text[])
          )
        ORDER BY s.company_code
      `,
      params,
    );
    result.rows.forEach((row) => codeSet.add(row.product_code));
  }

  const productCodes = [...codeSet].slice(0, PRODUCT_MOVEMENT_TRACE_LIMIT);
  return {
    productCodes,
    truncated: codeSet.size > PRODUCT_MOVEMENT_TRACE_LIMIT,
    totalRequestedProducts: codeSet.size,
  };
}

async function loadProductMovementMeta(db, productCodes) {
  if (!productCodes.length) return new Map();
  const result = await db.query(
    `
      SELECT
        codes.product_code,
        COALESCE(s.display_name, i.display_name, i.generic_name, p.product_name, codes.product_code) AS product_name,
        COALESCE(b.barcode, pb.barcode, '') AS barcode,
        COALESCE(s.uom, '') AS unit,
        COALESCE(pcs.category_name, s.category_name, i.category_name, p.category_name, '') AS category_name,
        COALESCE(s.supplier_code, i.supplier_code, p.supplier_code, '') AS supplier_code
      FROM unnest($1::text[]) WITH ORDINALITY AS codes(product_code, ord)
      LEFT JOIN public.skus s
        ON s.company_code = codes.product_code
      LEFT JOIN public.items i
        ON i.item_id = s.item_id
      LEFT JOIN ada.products p
        ON p.product_code = codes.product_code
      LEFT JOIN ada.product_category_states pcs
        ON pcs.product_code = codes.product_code
      LEFT JOIN LATERAL (
        SELECT barcode
        FROM public.barcodes
        WHERE sku_id = s.sku_id
        ORDER BY is_primary DESC, updated_at DESC NULLS LAST, barcode ASC
        LIMIT 1
      ) b ON TRUE
      LEFT JOIN LATERAL (
        SELECT barcode
        FROM ada.product_barcodes
        WHERE product_code = codes.product_code
        ORDER BY source_synced_at DESC NULLS LAST, barcode ASC
        LIMIT 1
      ) pb ON TRUE
      ORDER BY codes.ord
    `,
    [productCodes],
  );

  return new Map(result.rows.map((row) => [row.product_code, row]));
}

async function loadTransferMovements(db, { productCodes, branchCode, dateFrom, dateTo }) {
  if (!productCodes.length) return [];
  const result = await db.query(
    `
      SELECT
        l.product_code,
        h.doc_date,
        h.doc_time,
        h.doc_no,
        h.doc_type,
        h.branch_code AS from_branch,
        h.branch_code_to AS to_branch,
        COALESCE(l.qty_base, l.qty, 0) AS qty
      FROM ada.transfer_lines l
      JOIN ada.transfer_headers h
        ON h.doc_no = l.doc_no
       AND h.doc_type = l.doc_type
       AND h.branch_code = l.branch_code
      WHERE l.product_code = ANY($1::text[])
        AND ($2::text IS NULL OR h.branch_code = $2 OR h.branch_code_to = $2)
        AND ($3::date IS NULL OR h.doc_date >= $3::date)
        AND ($4::date IS NULL OR h.doc_date <= $4::date)
      ORDER BY h.doc_date DESC NULLS LAST, h.doc_time DESC NULLS LAST, h.doc_no DESC, l.line_no ASC
    `,
    [productCodes, branchCode, dateFrom, dateTo],
  );

  return result.rows.map((row) => {
    const isOut = branchCode && row.from_branch === branchCode;
    return {
      product_code: row.product_code,
      date: toDateKey(row.doc_date),
      type: isOut ? "transfer_out" : "transfer_in",
      from_branch: row.from_branch || "",
      to_branch: row.to_branch || "",
      document_no: row.doc_no,
      qty: toNumber(row.qty),
      unit_cost: null,
      source: "ada.transfer",
    };
  });
}

async function loadSupplierReceiptMovements(db, { productCodes, branchCode, dateFrom, dateTo }) {
  if (!productCodes.length) return [];
  const result = await db.query(
    `
      SELECT
        l.product_code,
        h.doc_date,
        h.doc_time,
        h.doc_no,
        h.branch_code,
        h.supplier_code,
        h.supplier_name,
        COALESCE(l.qty_base, l.qty, 0) AS qty,
        l.cost_in
      FROM ada.approved_receipt_lines l
      JOIN ada.approved_receipt_headers h
        ON h.doc_no = l.doc_no
      WHERE l.product_code = ANY($1::text[])
        AND ($2::text IS NULL OR h.branch_code = $2)
        AND ($3::date IS NULL OR h.doc_date >= $3::date)
        AND ($4::date IS NULL OR h.doc_date <= $4::date)
      ORDER BY h.doc_date DESC NULLS LAST, h.doc_time DESC NULLS LAST, h.doc_no DESC, l.seq_no ASC
    `,
    [productCodes, branchCode, dateFrom, dateTo],
  );

  return result.rows.map((row) => ({
    product_code: row.product_code,
    date: toDateKey(row.doc_date),
    type: "supplier_receipt",
    from_branch: row.supplier_name || row.supplier_code || "Supplier",
    to_branch: row.branch_code || "",
    document_no: row.doc_no,
    qty: toNumber(row.qty),
    unit_cost: row.cost_in == null ? null : toNumber(row.cost_in),
    source: "ada.approved_receipt",
  }));
}

async function loadSalesSummaries(db, { productCodes, branchCode, dateFrom, dateTo }) {
  if (!productCodes.length) return [];
  const result = await db.query(
    `
      SELECT
        product_code,
        branch_code,
        period_start,
        period_end,
        SUM(sold_qty_base) AS sold_qty_base,
        CASE
          WHEN SUM(period_days) > 0 THEN SUM(sold_qty_base) / SUM(period_days)
          ELSE 0
        END AS avg_daily_usage
      FROM analytics.product_sales_summary_periods
      WHERE product_code = ANY($1::text[])
        AND ($2::text IS NULL OR branch_code = $2)
        AND ($3::date IS NULL OR period_end >= $3::date)
        AND ($4::date IS NULL OR period_start <= $4::date)
      GROUP BY product_code, branch_code, period_start, period_end
      ORDER BY period_end DESC, period_start DESC, branch_code ASC
    `,
    [productCodes, branchCode, dateFrom, dateTo],
  );

  return result.rows.map((row) => ({
    product_code: row.product_code,
    date_from: toDateKey(row.period_start),
    date_to: toDateKey(row.period_end),
    branch_code: row.branch_code || "",
    sold_qty_base: toNumber(row.sold_qty_base),
    avg_daily_usage: toNumber(row.avg_daily_usage),
  }));
}

function buildProductMovementTraceResponse({ productCodes, metaMap, movements, salesSummaries, movementTypes, warnings }) {
  const movementsByProduct = new Map();
  const salesByProduct = new Map();
  for (const code of productCodes) {
    movementsByProduct.set(code, []);
    salesByProduct.set(code, []);
  }

  movements
    .filter((movement) => movementTypes.includes(movement.type))
    .forEach((movement) => {
      if (!movementsByProduct.has(movement.product_code)) return;
      movementsByProduct.get(movement.product_code).push(movement);
    });

  if (movementTypes.includes("sales_summary")) {
    salesSummaries.forEach((item) => {
      if (!salesByProduct.has(item.product_code)) return;
      salesByProduct.get(item.product_code).push(item);
    });
  }

  const products = productCodes.map((productCode) => {
    const meta = metaMap.get(productCode) || {};
    const productMovements = movementsByProduct.get(productCode) || [];
    const productSales = salesByProduct.get(productCode) || [];
    const summary = {
      transfer_in_qty: 0,
      transfer_out_qty: 0,
      supplier_receipt_qty: 0,
      sold_qty_base: 0,
      net_movement_qty: 0,
    };

    productMovements.forEach((movement) => {
      if (movement.type === "transfer_in") summary.transfer_in_qty += movement.qty;
      if (movement.type === "transfer_out") summary.transfer_out_qty += movement.qty;
      if (movement.type === "supplier_receipt") summary.supplier_receipt_qty += movement.qty;
    });
    productSales.forEach((item) => {
      summary.sold_qty_base += item.sold_qty_base;
    });
    summary.net_movement_qty =
      summary.transfer_in_qty + summary.supplier_receipt_qty - summary.transfer_out_qty - summary.sold_qty_base;

    const lastMovementDate = [
      ...productMovements.map((movement) => movement.date),
      ...productSales.map((item) => item.date_to),
    ].filter(Boolean).sort().pop() || null;

    return {
      product_code: productCode,
      product_name: meta.product_name || productCode,
      barcode: meta.barcode || "",
      unit: meta.unit || "",
      category_name: meta.category_name || "",
      supplier_code: meta.supplier_code || "",
      summary,
      last_movement_date: lastMovementDate,
      movements: productMovements.map(({ product_code: _code, ...movement }) => movement),
      sales_summary: productSales.map(({ product_code: _code, ...item }) => item),
    };
  });

  return { products, warnings };
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

  // latest stock per product now reads analytics.product_current_stock (one
  // row per product, kept in sync by upsertProductBatch in sync.js) instead
  // of computing it from analytics.product_stock_snapshots on every call.
  // That history table caused the 2026-07-15 outage: an unindexed DISTINCT
  // ON had to seq-scan + sort all 5M rows per request (EXPLAIN cost
  // ~938k), and grows without bound. This read no longer depends on its
  // size at all — a follow-up index+LATERAL fix (deployed same day, before
  // this table existed) got cost down to ~12k, but this removes the
  // dependency on that history table entirely for reads.
  const sql = `
    WITH sales AS (
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
    LEFT JOIN analytics.product_current_stock ls
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

async function getPendingReceipts(db, { branchCode = null, search = "", page = 1, pageSize = 10 } = {}) {
  const normalizedSearch = String(search || "").trim().toLowerCase() || null;
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 10));
  const offset = (safePage - 1) * safePageSize;

  const branchWhere = `($1::text IS NULL OR (
    h.branch_code = $1
    OR h.branch_code IN (SELECT branch_code FROM core.branches WHERE is_hq = true)
  ))`;
  const searchWhere = `($2::text IS NULL
    OR LOWER(COALESCE(h.doc_no, '')) LIKE '%' || $2 || '%'
    OR LOWER(COALESCE(h.supplier_name, '')) LIKE '%' || $2 || '%'
    OR LOWER(COALESCE(h.supplier_code, '')) LIKE '%' || $2 || '%'
    OR LOWER(COALESCE(h.ref_ext, '')) LIKE '%' || $2 || '%'
    OR EXISTS (
      SELECT 1 FROM ada.pending_receipt_lines lx
      WHERE lx.doc_no = h.doc_no
        AND (
          LOWER(COALESCE(lx.product_code, '')) LIKE '%' || $2 || '%'
          OR LOWER(COALESCE(lx.product_name, '')) LIKE '%' || $2 || '%'
          OR LOWER(COALESCE(lx.barcode, '')) LIKE '%' || $2 || '%'
        )
    )
  )`;

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total FROM ada.pending_receipt_headers h WHERE ${branchWhere} AND ${searchWhere}`,
    [branchCode, normalizedSearch],
  );
  const total = Number(countResult.rows[0]?.total || 0);

  const result = await db.query(
    `
      WITH paged_docs AS (
        SELECT h.doc_no
        FROM ada.pending_receipt_headers h
        WHERE ${branchWhere} AND ${searchWhere}
        ORDER BY h.doc_date DESC, h.doc_time DESC, h.doc_no DESC
        LIMIT $3 OFFSET $4
      )
      SELECT
        h.doc_no, h.branch_code, h.doc_type, h.doc_date, h.doc_time,
        h.supplier_code, h.supplier_name, h.ref_ext, h.ref_ext_date,
        h.warehouse_code, h.total, h.vat, h.grand,
        h.usr_code, h.created_by, h.created_at_ada, h.sta_doc, h.source_synced_at AS synced_at,
        l.seq_no, l.product_code, l.product_name, l.barcode,
        l.unit_code, l.unit_name, l.factor, l.qty, l.qty_base, l.stock_factor,
        l.set_price, l.net, l.vat AS line_vat, l.cost_in, l.lot_no, l.expired_date,
        l.warehouse_code AS line_warehouse_code
      FROM paged_docs d
      JOIN ada.pending_receipt_headers h ON h.doc_no = d.doc_no
      LEFT JOIN ada.pending_receipt_lines l ON l.doc_no = h.doc_no
      ORDER BY h.doc_date DESC, h.doc_time DESC, h.doc_no DESC, l.seq_no ASC
    `,
    [branchCode, normalizedSearch, safePageSize, offset],
  );

  return {
    records: groupReceiptRows(result.rows, {
      includeStaPrcDoc: false,
      lineWarehouseField: "line_warehouse_code",
      lineVatField: "line_vat",
    }),
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    },
  };
}

async function getApprovedReceipts(db, { branchCode = null, date = null, search = "", sort = "desc", page = 1, pageSize = 10 } = {}) {
  const normalizedSearch = String(search || "").trim().toLowerCase() || null;
  const normalizedSort = String(sort || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 10));
  const offset = (safePage - 1) * safePageSize;

  const branchWhere = `($1::text IS NULL OR (
    h.branch_code = $1
    OR h.branch_code IN (SELECT branch_code FROM core.branches WHERE is_hq = true)
  ))`;
  const dateWhere = `($2::text IS NULL OR CAST(h.doc_date AS DATE) = $2::date)`;
  const searchWhere = `($3::text IS NULL
    OR LOWER(COALESCE(h.doc_no, '')) LIKE '%' || $3 || '%'
    OR LOWER(COALESCE(h.supplier_name, '')) LIKE '%' || $3 || '%'
    OR LOWER(COALESCE(h.supplier_code, '')) LIKE '%' || $3 || '%'
    OR LOWER(COALESCE(h.ref_ext, '')) LIKE '%' || $3 || '%'
    OR EXISTS (
      SELECT 1 FROM ada.approved_receipt_lines lx
      WHERE lx.doc_no = h.doc_no
        AND (
          LOWER(COALESCE(lx.product_code, '')) LIKE '%' || $3 || '%'
          OR LOWER(COALESCE(lx.product_name, '')) LIKE '%' || $3 || '%'
          OR LOWER(COALESCE(lx.barcode, '')) LIKE '%' || $3 || '%'
        )
    )
  )`;

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total FROM ada.approved_receipt_headers h WHERE ${branchWhere} AND ${dateWhere} AND ${searchWhere}`,
    [branchCode, date, normalizedSearch],
  );
  const total = Number(countResult.rows[0]?.total || 0);

  const result = await db.query(
    `
      WITH paged_docs AS (
        SELECT h.doc_no
        FROM ada.approved_receipt_headers h
        WHERE ${branchWhere} AND ${dateWhere} AND ${searchWhere}
        ORDER BY h.doc_date ${normalizedSort}, h.doc_time ${normalizedSort}, h.doc_no ${normalizedSort}
        LIMIT $4 OFFSET $5
      )
      SELECT
        h.doc_no, h.branch_code, h.doc_type, h.doc_date, h.doc_time,
        h.supplier_code, h.supplier_name, h.ref_ext, h.ref_ext_date,
        h.warehouse_code, h.total, h.vat, h.grand,
        h.usr_code, h.created_by, h.created_at_ada, h.sta_doc, h.sta_prc_doc, h.source_synced_at AS synced_at,
        l.seq_no, l.product_code, l.product_name, l.barcode,
        l.unit_code, l.unit_name, l.factor, l.qty, l.qty_base, l.stock_factor,
        l.set_price, l.net, l.vat AS line_vat, l.cost_in, l.lot_no, l.expired_date,
        l.warehouse_code AS line_warehouse_code
      FROM paged_docs d
      JOIN ada.approved_receipt_headers h ON h.doc_no = d.doc_no
      LEFT JOIN ada.approved_receipt_lines l ON l.doc_no = h.doc_no
      ORDER BY h.doc_date ${normalizedSort}, h.doc_time ${normalizedSort}, h.doc_no ${normalizedSort}, l.seq_no ASC
    `,
    [branchCode, date, normalizedSearch, safePageSize, offset],
  );

  return {
    records: groupReceiptRows(result.rows, {
      includeStaPrcDoc: true,
      lineWarehouseField: "line_warehouse_code",
      lineVatField: "line_vat",
    }),
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    },
  };
}

function createOrderingRouter(deps) {
  const { config, db, requireAuthMiddleware, requireCsrfMiddleware = (_req, _res, next) => next() } = deps;
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
          COALESCE(
            unit_meta.unit_name,
            CASE
              WHEN NULLIF(BTRIM(bss.unit), '') IS DISTINCT FROM NULLIF(BTRIM(s.uom), '')
              THEN NULLIF(BTRIM(bss.unit), '')
            END,
            unit_usage.unit_name,
            s.uom,
            ''
          ) AS unit,
          COALESCE(
            unit_meta.unit_name,
            CASE
              WHEN NULLIF(BTRIM(bss.unit), '') IS DISTINCT FROM NULLIF(BTRIM(s.uom), '')
              THEN NULLIF(BTRIM(bss.unit), '')
            END,
            unit_usage.unit_name,
            ''
          ) AS unit_name,
          COALESCE(s.uom, '') AS unit_code,
          COALESCE(s.min_stock, 0) AS min_stock,
          COALESCE(s.max_stock, 0) AS max_stock,
          COALESCE(s.lead_time_days, 0) AS lead_time_days,
          COALESCE(ls.stock_current, 0) AS stock_current,
          COALESCE(ls.stock_retail, 0) AS stock_retail,
          COALESCE(ls.stock_warehouse, 0) AS stock_warehouse
          ,COALESCE(bss.qty_branch_001, 0) AS qty_branch_001
          ,COALESCE(bss.qty_branch_003, 0) AS qty_branch_003
          ,COALESCE(bss.qty_branch_004, 0) AS qty_branch_004
          ,COALESCE(bss.qty_branch_005, 0) AS qty_branch_005
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
          SELECT NULLIF(ep.unit_name, '') AS unit_name
          FROM ada.product_effective_branch_prices ep
          WHERE ep.product_code = s.company_code
            AND ep.unit_size = 'S'
            AND NULLIF(ep.unit_name, '') IS NOT NULL
            AND NULLIF(BTRIM(ep.unit_name), '') IS DISTINCT FROM NULLIF(BTRIM(s.uom), '')
          ORDER BY
            CASE ep.channel WHEN 'retail' THEN 0 ELSE 1 END,
            ep.price_level ASC,
            CASE ep.unit_size WHEN 'S' THEN 0 WHEN 'M' THEN 1 WHEN 'L' THEN 2 ELSE 9 END,
            ep.branch_code ASC
          LIMIT 1
        ) unit_meta ON TRUE
        LEFT JOIN LATERAL (
          SELECT candidate.unit_name
          FROM (
            SELECT
              NULLIF(BTRIM(COALESCE(
                sl.raw_payload->>'unitName',
                sl.raw_payload->>'FTSdtUnitName'
              )), '') AS unit_name,
              NULLIF(BTRIM(COALESCE(
                sl.raw_payload->>'unitCode',
                sl.raw_payload->>'FTPunCode'
              )), '') AS unit_code,
              sl.source_synced_at
            FROM ada.sales_lines sl
            WHERE sl.product_code = s.company_code

            UNION ALL

            SELECT
              NULLIF(BTRIM(tl.unit_name), '') AS unit_name,
              NULLIF(BTRIM(tl.unit_code), '') AS unit_code,
              tl.source_synced_at
            FROM ada.transfer_lines tl
            WHERE tl.product_code = s.company_code
          ) candidate
          WHERE candidate.unit_name IS NOT NULL
            AND candidate.unit_code = NULLIF(BTRIM(s.uom), '')
            AND candidate.unit_name IS DISTINCT FROM NULLIF(BTRIM(s.uom), '')
          ORDER BY candidate.source_synced_at DESC NULLS LAST
          LIMIT 1
        ) unit_usage ON TRUE
        LEFT JOIN analytics.product_current_stock ls
          ON ls.product_code = s.company_code
        LEFT JOIN ada.branch_stock_snapshots bss
          ON bss.product_code = s.company_code
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
          unitCode: row.unit_code || row.unit || "",
          unitName: row.unit_name || "",
          stockCurrent: Number(row.stock_current || 0),
          stockRetail: Number(row.stock_retail || 0),
          stockWarehouse: Number(row.stock_warehouse || 0),
          minStock: Number(row.min_stock || 0),
          maxStock: Number(row.max_stock || 0),
          leadTimeDays: Number(row.lead_time_days || 0),
          stockByBranch: {
            "001": Number(row.qty_branch_001 || 0),
            "003": Number(row.qty_branch_003 || 0),
            "004": Number(row.qty_branch_004 || 0),
            "005": Number(row.qty_branch_005 || 0),
          },
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

  // Stock levels only change when a branch sync lands (twice daily), so a
  // short shared cache is safe. Storing the in-flight promise (not just the
  // resolved rows) coalesces concurrent requests into one DB query — the
  // request-burst pattern is what took the whole API down on 2026-07-15,
  // since every simultaneous page load used to cost its own full-table query.
  const stockDayCache = new Map(); // periodDays -> { promise, expiresAt }
  const STOCK_DAY_CACHE_TTL_MS = 60_000;

  function loadStockDayRows(periodDays) {
    const cached = stockDayCache.get(periodDays);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    const promise = queryStockDayBase(db, periodDays, null);
    stockDayCache.set(periodDays, { promise, expiresAt: Date.now() + STOCK_DAY_CACHE_TTL_MS });
    promise.catch(() => stockDayCache.delete(periodDays));
    return promise;
  }

  router.get("/admin/stock-day", requireAuthMiddleware, async (req, res, next) => {
    const periodDays = parsePositiveInt(req.query.periodDays, config.defaultPeriodDays);
    if (periodDays == null) {
      return res.status(400).json({ message: "periodDays must be a positive number." });
    }
    try {
      const rows = await loadStockDayRows(periodDays);
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
      const result = await getPendingReceipts(db, {
        branchCode: req.query.branchCode || null,
        search: req.query.search || "",
        page: req.query.page,
        pageSize: req.query.pageSize,
      });
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/approved-receipts", requireAuthMiddleware, async (req, res, next) => {
    try {
      const result = await getApprovedReceipts(db, {
        branchCode: req.query.branchCode ? String(req.query.branchCode).trim() : null,
        date: req.query.date ? String(req.query.date) : null,
        search: req.query.search || "",
        sort: req.query.sort || "desc",
        page: req.query.page,
        pageSize: req.query.pageSize,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/product-movement-options", requireAuthMiddleware, async (_req, res, next) => {
    try {
      const [categoryResult, brandResult, branchResult] = await Promise.all([
        db.query(
          `
            SELECT category_name, COUNT(*)::int AS product_count
            FROM (
              SELECT COALESCE(pcs.category_name, s.category_name, i.category_name) AS category_name
              FROM public.skus s
              LEFT JOIN public.items i ON i.item_id = s.item_id
              LEFT JOIN ada.product_category_states pcs ON pcs.product_code = s.company_code
              WHERE s.company_code IS NOT NULL
            ) x
            WHERE category_name IS NOT NULL AND category_name <> ''
            GROUP BY category_name
            ORDER BY category_name ASC
            LIMIT 500
          `,
        ),
        db.query(
          `
            SELECT supplier_code, COUNT(*)::int AS product_count
            FROM (
              SELECT COALESCE(s.supplier_code, i.supplier_code) AS supplier_code
              FROM public.skus s
              LEFT JOIN public.items i ON i.item_id = s.item_id
              WHERE s.company_code IS NOT NULL
            ) x
            WHERE supplier_code IS NOT NULL AND supplier_code <> ''
            GROUP BY supplier_code
            ORDER BY supplier_code ASC
            LIMIT 500
          `,
        ),
        db.query(
          `
            SELECT branch_code, branch_name, is_hq
            FROM core.branches
            WHERE is_active = TRUE
            ORDER BY branch_code ASC
          `,
        ),
      ]);

      return res.json({
        categories: categoryResult.rows.map((row) => ({
          name: row.category_name,
          productCount: Number(row.product_count || 0),
        })),
        brands: brandResult.rows.map((row) => ({
          name: row.supplier_code,
          productCount: Number(row.product_count || 0),
        })),
        branches: branchResult.rows.map((row) => ({
          branchCode: row.branch_code,
          branchName: row.branch_name,
          isHq: row.is_hq,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/product-movement-groups", requireAuthMiddleware, async (_req, res, next) => {
    try {
      return res.json({ groups: await loadProductMovementGroups(db) });
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    "/admin/product-movement-groups",
    requireAuthMiddleware,
    requireCsrfMiddleware,
    async (req, res, next) => {
      try {
        const groupId = await saveProductMovementGroup(db, {
          name: req.body?.name || req.body?.group_name,
          description: req.body?.description || "",
          productCodes: req.body?.product_codes || req.body?.productCodes || [],
          actor: req.auth?.userId || req.auth?.sub || "",
        });
        const groups = await loadProductMovementGroups(db);
        return res.status(201).json({ group: groups.find((group) => group.id === groupId) || null });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.put(
    "/admin/product-movement-groups/:groupId",
    requireAuthMiddleware,
    requireCsrfMiddleware,
    async (req, res, next) => {
      const groupId = parsePositiveInt(req.params.groupId, null);
      if (groupId == null) {
        return res.status(400).json({ error: "group id must be a positive integer." });
      }
      try {
        const savedGroupId = await saveProductMovementGroup(db, {
          groupId,
          name: req.body?.name || req.body?.group_name,
          description: req.body?.description || "",
          productCodes: req.body?.product_codes || req.body?.productCodes || [],
          actor: req.auth?.userId || req.auth?.sub || "",
        });
        const groups = await loadProductMovementGroups(db);
        return res.json({ group: groups.find((group) => group.id === savedGroupId) || null });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.delete(
    "/admin/product-movement-groups/:groupId",
    requireAuthMiddleware,
    requireCsrfMiddleware,
    async (req, res, next) => {
      const groupId = parsePositiveInt(req.params.groupId, null);
      if (groupId == null) {
        return res.status(400).json({ error: "group id must be a positive integer." });
      }
      try {
        const result = await db.query("DELETE FROM admin.product_movement_groups WHERE group_id = $1", [groupId]);
        if (!result.rowCount) {
          return res.status(404).json({ error: "product movement group not found." });
        }
        return res.json({ ok: true });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post("/admin/product-movement-trace", requireAuthMiddleware, async (req, res, next) => {
    try {
      const traceRequest = normalizeTraceRequestBody(req.body || {});
      const scope = await resolveProductMovementScope(db, traceRequest);
      const warnings = buildMovementWarnings(traceRequest);
      if (scope.truncated) {
        warnings.push(`Product scope was limited to ${PRODUCT_MOVEMENT_TRACE_LIMIT} products.`);
      }

      if (!scope.productCodes.length) {
        return res.json({ products: [], warnings });
      }

      const [metaMap, transferMovements, supplierMovements, salesSummaries] = await Promise.all([
        loadProductMovementMeta(db, scope.productCodes),
        traceRequest.movementTypes.includes("transfer_in") || traceRequest.movementTypes.includes("transfer_out")
          ? loadTransferMovements(db, { ...traceRequest, productCodes: scope.productCodes })
          : Promise.resolve([]),
        traceRequest.movementTypes.includes("supplier_receipt")
          ? loadSupplierReceiptMovements(db, { ...traceRequest, productCodes: scope.productCodes })
          : Promise.resolve([]),
        traceRequest.movementTypes.includes("sales_summary")
          ? loadSalesSummaries(db, { ...traceRequest, productCodes: scope.productCodes })
          : Promise.resolve([]),
      ]);

      return res.json(
        buildProductMovementTraceResponse({
          productCodes: scope.productCodes,
          metaMap,
          movements: [...transferMovements, ...supplierMovements],
          salesSummaries,
          movementTypes: traceRequest.movementTypes,
          warnings,
        }),
      );
    } catch (error) {
      return next(error);
    }
  });

  // GET /api/sync/nightly-log?days=14
  // Admin UI's "ประวัติ Sync" calendar grid: per branch, per night, what happened.
  // - "success"  - ingest.sync_runs has a success row for that branch/date
  // - "failed"   - ingest.sync_runs has a failed/running row, OR heartbeat exists but no run
  // - "running"  - ingest.sync_runs has only running rows
  // - "offline"  - no heartbeat AND no sync_run for that branch/date (laptop was off)
  // - "pending"  - the date is today and nothing has happened yet
  //
  // Branch is derived from sync_type pattern 'adapos_branch_XXX'.
  // Lives under /api (not /api/sync) so it can use the admin cookie session
  // instead of the api-key gate that fronts /api/sync/*.
  router.get("/sync/nightly-log", requireAuthMiddleware, async (req, res, next) => {
    try {
      const rawDays = Number(req.query.days);
      const days = Number.isFinite(rawDays) ? Math.min(Math.max(Math.floor(rawDays), 1), 90) : 14;

      const knownBranches = ["000", "001", "003", "004", "005"];

      const sql = `
        WITH date_series AS (
          SELECT (CURRENT_DATE - offs)::date AS d
          FROM generate_series(0, $1::int - 1) AS offs
        ),
        known_branches AS (
          SELECT unnest($2::text[]) AS branch_code
        ),
        runs_agg AS (
          SELECT
            substring(sync_type FROM 'adapos_branch_([0-9]+)') AS branch_code,
            (started_at AT TIME ZONE 'Asia/Bangkok')::date     AS run_date,
            bool_or(status = 'success')                        AS any_success,
            bool_or(status = 'failed')                         AS any_failed,
            bool_or(status = 'running')                        AS any_running,
            COUNT(*)                                           AS total_runs,
            COALESCE(SUM(records_sent), 0)                     AS total_sent
          FROM ingest.sync_runs
          WHERE sync_type LIKE 'adapos_branch_%'
            AND started_at >= (CURRENT_DATE - ($1::int - 1)) - INTERVAL '1 day'
          GROUP BY 1, 2
        ),
        -- CP2: the single most recent run per (branch, date) — its own
        -- fields (message, per-dataset breakdown) are what a clicked cell
        -- drills into, separate from runs_agg's whole-day totals above.
        latest_run AS (
          SELECT DISTINCT ON (branch_code, run_date)
            sync_run_id, branch_code, run_date, sync_type, status,
            started_at, finished_at, records_read, records_sent, message
          FROM (
            SELECT
              sync_run_id, sync_type, status, started_at, finished_at,
              records_read, records_sent, message,
              substring(sync_type FROM 'adapos_branch_([0-9]+)') AS branch_code,
              (started_at AT TIME ZONE 'Asia/Bangkok')::date     AS run_date
            FROM ingest.sync_runs
            WHERE sync_type LIKE 'adapos_branch_%'
              AND started_at >= (CURRENT_DATE - ($1::int - 1)) - INTERVAL '1 day'
          ) x
          ORDER BY branch_code, run_date, started_at DESC
        ),
        latest_run_datasets AS (
          SELECT
            lr.branch_code, lr.run_date,
            json_agg(
              json_build_object(
                'dataset', d.dataset_name, 'status', d.status,
                'recordsSent', d.records_sent, 'error', d.error_message
              ) ORDER BY d.sync_run_dataset_id
            ) AS datasets
          FROM latest_run lr
          JOIN ingest.sync_run_datasets d ON d.sync_run_id = lr.sync_run_id
          GROUP BY lr.branch_code, lr.run_date
        ),
        heartbeats_agg AS (
          SELECT
            branch_code,
            (created_at AT TIME ZONE 'Asia/Bangkok')::date AS hb_date,
            COUNT(*) AS hb_count,
            MAX(created_at) AS latest_heartbeat_at
          FROM ingest.laptop_heartbeats
          WHERE created_at >= (CURRENT_DATE - ($1::int - 1)) - INTERVAL '1 day'
          GROUP BY 1, 2
        )
        SELECT
          b.branch_code,
          to_char(d.d, 'YYYY-MM-DD') AS iso_date,
          CASE
            WHEN d.d = CURRENT_DATE AND COALESCE(r.any_success, false) = false
                                     AND COALESCE(r.any_failed,  false) = false
                                     AND COALESCE(r.any_running, false) = false THEN 'pending'
            WHEN COALESCE(r.any_success, false) THEN 'success'
            WHEN COALESCE(r.any_failed,  false) THEN 'failed'
            WHEN COALESCE(r.any_running, false) THEN 'running'
            WHEN COALESCE(h.hb_count, 0) > 0     THEN 'failed'
            ELSE 'offline'
          END AS status,
          r.total_runs,
          r.total_sent,
          lr.sync_type       AS latest_sync_type,
          lr.status          AS latest_run_status,
          lr.started_at      AS latest_started_at,
          lr.finished_at     AS latest_finished_at,
          lr.records_read    AS latest_records_read,
          lr.records_sent    AS latest_records_sent,
          lr.message         AS latest_message,
          lrd.datasets       AS datasets,
          h.latest_heartbeat_at,
          h.hb_count
        FROM date_series d
        CROSS JOIN known_branches b
        LEFT JOIN runs_agg            r   ON r.branch_code = b.branch_code AND r.run_date = d.d
        LEFT JOIN latest_run          lr  ON lr.branch_code = b.branch_code AND lr.run_date = d.d
        LEFT JOIN latest_run_datasets lrd ON lrd.branch_code = b.branch_code AND lrd.run_date = d.d
        LEFT JOIN heartbeats_agg      h   ON h.branch_code = b.branch_code AND h.hb_date  = d.d
        ORDER BY b.branch_code, d.d DESC
      `;

      const result = await db.query(sql, [days, knownBranches]);

      const dates = [];
      const seen = new Set();
      const rows = {};
      for (const r of result.rows) {
        if (!seen.has(r.iso_date)) {
          seen.add(r.iso_date);
          dates.push(r.iso_date);
        }
        if (!rows[r.branch_code]) rows[r.branch_code] = {};
        rows[r.branch_code][r.iso_date] = {
          status: r.status,
          totalRuns: Number(r.total_runs ?? 0),
          totalSent: Number(r.total_sent ?? 0),
          syncType: r.latest_sync_type || null,
          latestRunStatus: r.latest_run_status || null,
          latestStartedAt: r.latest_started_at || null,
          latestFinishedAt: r.latest_finished_at || null,
          recordsRead: Number(r.latest_records_read ?? 0),
          recordsSent: Number(r.latest_records_sent ?? 0),
          message: r.latest_message || null,
          datasets: r.datasets || null,
          latestHeartbeatAt: r.latest_heartbeat_at || null,
          heartbeatCount: Number(r.hb_count ?? 0),
        };
      }

      return res.json({ dates, branches: knownBranches, rows });
    } catch (error) {
      return next(error);
    }
  });

  // GET /api/sync/hourly-log?hours=24
  // Admin UI's "รายชั่วโมง" tab: per branch, per Bangkok hour slot, what happened.
  // Slots are Bangkok-timezone hour boundaries so the grid aligns with Thai wall-clock.
  // Status values mirror nightly-log: success / failed / running / offline / pending.
  // "pending" = current hour slot with no run yet (Task Scheduler hasn't fired yet).
  router.get("/sync/hourly-log", requireAuthMiddleware, async (req, res, next) => {
    try {
      const rawHours = Number(req.query.hours);
      const hours = Number.isFinite(rawHours) ? Math.min(Math.max(Math.floor(rawHours), 1), 168) : 24;

      const knownBranches = ["000", "001", "003", "004", "005"];

      const sql = `
        WITH hour_series AS (
          SELECT
            date_trunc('hour', NOW() AT TIME ZONE 'Asia/Bangkok')
              - (offs * INTERVAL '1 hour') AS hour_slot
          FROM generate_series(0, $1::int - 1) AS offs
        ),
        known_branches AS (
          SELECT unnest($2::text[]) AS branch_code
        ),
        runs_agg AS (
          SELECT
            substring(sync_type FROM 'adapos_branch_([0-9]+)')    AS branch_code,
            date_trunc('hour', started_at AT TIME ZONE 'Asia/Bangkok') AS hour_slot,
            bool_or(status = 'success')                            AS any_success,
            bool_or(status = 'failed')                             AS any_failed,
            bool_or(status = 'running')                            AS any_running
          FROM ingest.sync_runs
          WHERE sync_type LIKE 'adapos_branch_%'
            AND started_at >= NOW() - $1::int * INTERVAL '1 hour'
          GROUP BY 1, 2
        )
        SELECT
          b.branch_code,
          to_char(h.hour_slot, 'YYYY-MM-DD HH24:00') AS hour_key,
          CASE
            WHEN h.hour_slot = date_trunc('hour', NOW() AT TIME ZONE 'Asia/Bangkok')
                 AND COALESCE(r.any_success, false) = false
                 AND COALESCE(r.any_failed,  false) = false
                 AND COALESCE(r.any_running, false) = false THEN 'pending'
            WHEN COALESCE(r.any_success, false) THEN 'success'
            WHEN COALESCE(r.any_failed,  false) THEN 'failed'
            WHEN COALESCE(r.any_running, false) THEN 'running'
            ELSE 'offline'
          END AS status,
          COALESCE(
            (SELECT SUM(records_sent)::int
             FROM ingest.sync_runs
             WHERE sync_type LIKE 'adapos_branch_%'
               AND substring(sync_type FROM 'adapos_branch_([0-9]+)') = b.branch_code
               AND date_trunc('hour', started_at AT TIME ZONE 'Asia/Bangkok') = h.hour_slot
            ), 0
          ) AS total_sent
        FROM hour_series h
        CROSS JOIN known_branches b
        LEFT JOIN runs_agg r
          ON r.branch_code = b.branch_code AND r.hour_slot = h.hour_slot
        ORDER BY b.branch_code, h.hour_slot ASC
      `;

      const result = await db.query(sql, [hours, knownBranches]);

      const hourKeys = [];
      const seen = new Set();
      const rows = {};
      for (const r of result.rows) {
        if (!seen.has(r.hour_key)) {
          seen.add(r.hour_key);
          hourKeys.push(r.hour_key);
        }
        if (!rows[r.branch_code]) rows[r.branch_code] = {};
        rows[r.branch_code][r.hour_key] = {
          status:    r.status,
          totalSent: Number(r.total_sent ?? 0),
        };
      }

      return res.json({ hours: hourKeys, branches: knownBranches, rows });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createOrderingRouter,
  buildStockDayRow,
  buildProductMovementTraceResponse,
  normalizeProductCodeList,
  normalizeTraceRequestBody,
  getApprovedReceipts,
  getPendingReceipts,
  groupReceiptRows,
  validateOrderRequestBody,
};
