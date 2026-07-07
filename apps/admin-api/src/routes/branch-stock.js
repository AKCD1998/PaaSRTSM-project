"use strict";

const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");
const { auditLog } = require("../audit");
const { auditBase } = require("../utils/audit-payload");

const docsDir = path.resolve(__dirname, "../../../../docs");
const BRANCH_EXPORT_CONFIG = {
  "000": { label: "สาขา 000 (HQ)", qtyKey: "qtyBranch000", title: "บริษัท เอสซีกรุ๊ป (1989) จำกัด สาขา 000" },
  "001": { label: "สาขา 001", qtyKey: "qtyBranch001", title: "บริษัท เอสซีกรุ๊ป (1989) จำกัด สาขา 001" },
  "003": { label: "สาขา 003", qtyKey: "qtyBranch003", title: "บริษัท เอสซีกรุ๊ป (1989) จำกัด สาขา 003" },
  "004": { label: "สาขา 004", qtyKey: "qtyBranch004", title: "บริษัท เอสซีกรุ๊ป (1989) จำกัด สาขา 004" },
  "005": { label: "สาขา 005", qtyKey: "qtyBranch005", title: "บริษัท เอสซีกรุ๊ป (1989) จำกัด สาขา 005" },
};
const INVENTORY_VALUE_BRANCH_ORDER = ["000", "001", "003", "004", "005"];

const { runCategorizationBatch } = require("../categorization");

function fireCategorizationBatch(db, productCodes) {
  setImmediate(() => {
    runCategorizationBatch(db, { productCodes: productCodes || null, triggeredBy: "sync_hook" }).catch(
      (err) => {
        console.error("[categorization] post-sync batch failed:", err.message);
      },
    );
  });
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

function getBranchRecordKeys(branchCode) {
  return {
    qtySnakeKey: `qty_branch_${branchCode}`,
    qtyCamelKey: `qtyBranch${branchCode}`,
    costSnakeKey: `cost_avg_branch_${branchCode}`,
    costCamelKey: `costAvgBranch${branchCode}`,
  };
}

function getFirstDefinedValue(values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseRequiredNumber(value) {
  if (value === undefined || value === null || value === "") {
    return { ok: false, missing: true, value: null };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { ok: false, missing: false, value: null };
  }
  return { ok: true, missing: false, value: parsed };
}

function parseOptionalNumber(value) {
  if (value === undefined || value === "") {
    return { ok: true, present: false, value: null };
  }
  if (value === null) {
    return { ok: true, present: true, value: null };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { ok: false, present: true, value: null };
  }
  return { ok: true, present: true, value: parsed };
}

function parseBranchStockPayload(body) {
  if (!body || !Array.isArray(body.records)) {
    return { error: "Payload must include a records array." };
  }

  const branchCode = normalizeText(body.branchCode || body.branch_code);
  if (!ALLOWED_BRANCH_CODES.has(branchCode)) {
    return { error: "branchCode must be one of 000, 001, 002, 003, 004, 005." };
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

    const branchKeys = getBranchRecordKeys(branchCode);
    const qtyResult = parseRequiredNumber(
      getFirstDefinedValue([
        record.qty,
        record.quantity,
        record[branchKeys.qtySnakeKey],
        record[branchKeys.qtyCamelKey],
      ]),
    );
    if (!qtyResult.ok) {
      return {
        error: qtyResult.missing
          ? `records[${index}].qty is required for branchCode ${branchCode}.`
          : `records[${index}].qty is invalid for branchCode ${branchCode}.`,
      };
    }

    const costAvgResult = parseOptionalNumber(
      getFirstDefinedValue([
        record.cost_avg,
        record.costAvg,
        record[branchKeys.costSnakeKey],
        record[branchKeys.costCamelKey],
      ]),
    );
    if (!costAvgResult.ok) {
      return { error: `records[${index}].costAvg is invalid for branchCode ${branchCode}.` };
    }

    records.push({
      productCode,
      productNameThai: normalizeNullableText(record.product_name_thai || record.productNameThai),
      productNameEng: normalizeNullableText(record.product_name_eng || record.productNameEng),
      barcode: normalizeNullableText(record.barcode),
      unit: normalizeNullableText(record.unit),
      branchCode,
      qty: qtyResult.value,
      costAvg: costAvgResult.value,
      hasCostAvg: costAvgResult.present,
      syncedAt,
      rawPayload: record,
    });
  }

  return { branchCode, records };
}

function applyBranchQty(record, branchCode, qty) {
  if (branchCode === "000") record.qtyBranch000 = qty;
  if (branchCode === "001") record.qtyBranch001 = qty;
  if (branchCode === "002") record.qtyBranch002 = qty;
  if (branchCode === "003") record.qtyBranch003 = qty;
  if (branchCode === "004") record.qtyBranch004 = qty;
  if (branchCode === "005") record.qtyBranch005 = qty;
}

function applyBranchCostAvg(record, branchCode, costAvg) {
  if (branchCode === "000") record.costAvgBranch000 = costAvg;
  if (branchCode === "001") record.costAvgBranch001 = costAvg;
  if (branchCode === "002") record.costAvgBranch002 = costAvg;
  if (branchCode === "003") record.costAvgBranch003 = costAvg;
  if (branchCode === "004") record.costAvgBranch004 = costAvg;
  if (branchCode === "005") record.costAvgBranch005 = costAvg;
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
          cost_avg_branch_000,
          cost_avg_branch_001,
          cost_avg_branch_002,
          cost_avg_branch_003,
          cost_avg_branch_004,
          cost_avg_branch_005,
          synced_at,
          source_system,
          source_table,
          source_synced_at,
          raw_payload,
          updated_at
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 'AdaAcc', 'TCNTPdtInWha', $19, $20::jsonb, now())
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
        cost_avg_branch_000 = EXCLUDED.cost_avg_branch_000,
        cost_avg_branch_001 = EXCLUDED.cost_avg_branch_001,
        cost_avg_branch_002 = EXCLUDED.cost_avg_branch_002,
        cost_avg_branch_003 = EXCLUDED.cost_avg_branch_003,
        cost_avg_branch_004 = EXCLUDED.cost_avg_branch_004,
        cost_avg_branch_005 = EXCLUDED.cost_avg_branch_005,
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
      record.costAvgBranch000,
      record.costAvgBranch001,
      record.costAvgBranch002,
      record.costAvgBranch003,
      record.costAvgBranch004,
      record.costAvgBranch005,
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

function getBranchSnapshotColumnNames(branchCode) {
  if (!ALLOWED_BRANCH_CODES.has(branchCode)) {
    throw new Error(`Unsupported branchCode: ${branchCode}`);
  }

  return {
    qtyColumn: `qty_branch_${branchCode}`,
    costColumn: `cost_avg_branch_${branchCode}`,
  };
}

function mapInventoryValueRow(row) {
  return {
    productCode: row.product_code,
    productNameThai: row.product_name_thai || "",
    productNameEng: row.product_name_eng || "",
    barcode: row.barcode || "",
    unit: row.unit || "",
    category: row.category_name || "",
    qty: Number(row.qty || 0),
    unitCostAvg: row.unit_cost_avg == null ? null : Number(row.unit_cost_avg),
    inventoryValue: row.inventory_value == null ? 0 : Number(row.inventory_value),
    syncedAt: row.synced_at || null,
  };
}

function buildInventoryValueBranchConfig(branchCodes) {
  return branchCodes.map((branchCode) => ({
    branchCode,
    label: BRANCH_EXPORT_CONFIG[branchCode]?.label || `สาขา ${branchCode}`,
    qtyColumn: `qty_branch_${branchCode}`,
    costColumn: `cost_avg_branch_${branchCode}`,
  }));
}

function buildInventoryValueSummaryQueryParts(branchConfig) {
  const qtyTerms = branchConfig.map(({ qtyColumn }) => `COALESCE(bs.${qtyColumn}, 0)`);
  const valueTerms = branchConfig.map(
    ({ qtyColumn, costColumn }) => `(COALESCE(bs.${qtyColumn}, 0) * COALESCE(bs.${costColumn}, 0))`,
  );
  const missingCostTerms = branchConfig.map(
    ({ qtyColumn, costColumn }) => `(COALESCE(bs.${qtyColumn}, 0) > 0 AND bs.${costColumn} IS NULL)`,
  );
  const qtyTotalExpression = qtyTerms.join(" + ");
  const totalInventoryValueExpression = valueTerms.join(" + ");
  const missingCostExpression = missingCostTerms.join(" OR ");
  const perBranchSummaryColumns = branchConfig
    .flatMap(({ branchCode, qtyColumn, costColumn }) => ([
      `COUNT(*) FILTER (WHERE COALESCE(bs.${qtyColumn}, 0) > 0)::int AS products_with_stock_${branchCode}`,
      `COUNT(*) FILTER (WHERE COALESCE(bs.${qtyColumn}, 0) > 0 AND bs.${costColumn} IS NOT NULL)::int AS products_with_cost_${branchCode}`,
      `ROUND(SUM((COALESCE(bs.${qtyColumn}, 0) * COALESCE(bs.${costColumn}, 0)))::numeric, 2) AS total_inventory_value_${branchCode}`,
    ]))
    .join(",\n              ");

  return {
    qtyTotalExpression,
    totalInventoryValueExpression,
    hasAnyStockExpression: `(${qtyTotalExpression}) > 0`,
    missingCostExpression: `(${missingCostExpression})`,
    perBranchSummaryColumns,
  };
}

function buildInventoryValueAllBranchSelectColumns(branchConfig) {
  return branchConfig
    .flatMap(({ branchCode, qtyColumn, costColumn }) => ([
      `bs.${qtyColumn} AS qty_branch_${branchCode}`,
      `bs.${costColumn} AS unit_cost_avg_branch_${branchCode}`,
      `ROUND((COALESCE(bs.${qtyColumn}, 0) * COALESCE(bs.${costColumn}, 0))::numeric, 2) AS inventory_value_branch_${branchCode}`,
    ]))
    .join(",\n              ");
}

function mapInventoryValueAllBranchesSummary(row, branchConfig) {
  return branchConfig.map(({ branchCode, label }) => ({
    branchCode,
    label,
    productsWithStock: Number(row[`products_with_stock_${branchCode}`] || 0),
    productsWithCost: Number(row[`products_with_cost_${branchCode}`] || 0),
    totalInventoryValue: Number(row[`total_inventory_value_${branchCode}`] || 0),
  }));
}

function mapInventoryValueAllBranchesRow(row, branchConfig) {
  const branches = {};
  for (const { branchCode } of branchConfig) {
    branches[branchCode] = {
      qty: Number(row[`qty_branch_${branchCode}`] || 0),
      unitCostAvg: row[`unit_cost_avg_branch_${branchCode}`] == null
        ? null
        : Number(row[`unit_cost_avg_branch_${branchCode}`]),
      inventoryValue: Number(row[`inventory_value_branch_${branchCode}`] || 0),
    };
  }

  return {
    productCode: row.product_code,
    productNameThai: row.product_name_thai || "",
    productNameEng: row.product_name_eng || "",
    barcode: row.barcode || "",
    unit: row.unit || "",
    category: row.category_name || "",
    branches,
    qtyTotalAllBranches: Number(row.qty_total_all_branches || 0),
    totalInventoryValue: Number(row.total_inventory_value || 0),
    syncedAt: row.synced_at || null,
  };
}

function buildBranchStockExportWorkbook(rows, branchCode) {
  const branchConfig = BRANCH_EXPORT_CONFIG[branchCode];
  const sheetRows = [
    [branchConfig.title],
    ["ลำดับ", "รหัส", "ชื่อสินค้า", "BARCODE", "หน่วย", "จำนวน", "ประเภท", "รวมเงินช่องนี้", "นับ1", "นับ2", "นับ3"],
    ...rows.map((row, index) => ([
      index + 1,
      row.productCode || "",
      row.productNameThai || "",
      row.barcode || "",
      row.unit || "",
      Number(row[branchConfig.qtyKey] || 0),
      row.category || "",
      "",
      "",
      "",
      "",
    ])),
  ];

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  worksheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } }];
  worksheet["!cols"] = [
    { wch: 8 },
    { wch: 14 },
    { wch: 72 },
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 18 },
    { wch: 20 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, `Stock ${branchCode}`);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function buildBranchSheet(rows, branchCode) {
  const branchConfig = BRANCH_EXPORT_CONFIG[branchCode];
  const sheetRows = [
    [branchConfig.title],
    ["ลำดับ", "รหัส", "ชื่อสินค้า", "BARCODE", "หน่วย", "จำนวน", "ประเภท", "รวมเงินช่องนี้", "นับ1", "นับ2", "นับ3"],
    ...rows.map((row, index) => ([
      index + 1,
      row.productCode || "",
      row.productNameThai || "",
      row.barcode || "",
      row.unit || "",
      Number(row[branchConfig.qtyKey] || 0),
      row.category || "",
      "",
      "",
      "",
      "",
    ])),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  worksheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } }];
  worksheet["!cols"] = [
    { wch: 8 }, { wch: 14 }, { wch: 72 }, { wch: 18 }, { wch: 12 },
    { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
  ];
  return worksheet;
}

const COMPARISON_HEADERS = [
  "รหัสสินค้า", "ชื่อสินค้าไทย", "ชื่ออังกฤษ", "Barcode", "หน่วย",
  "หมวดหมู่", "สถานะหมวดหมู่",
  "สาขา 000", "สาขา 001", "สาขา 003", "สาขา 004", "สาขา 005",
  "รวมทุกสาขา", "synced_at",
];

function buildAllBranchesExportWorkbook(rows) {
  const workbook = XLSX.utils.book_new();

  // ── Sheet 1: Comparison — mirrors BranchStockPanel table ─────────────────
  const comparisonSheetRows = [
    COMPARISON_HEADERS,
    ...rows.map((row) => [
      row.productCode || "",
      row.productNameThai || "",
      row.productNameEng || "",
      row.barcode || "",
      row.unit || "",
      row.category || "",
      row.categoryStatus || "",
      Number(row.qtyBranch000 || 0),
      Number(row.qtyBranch001 || 0),
      Number(row.qtyBranch003 || 0),
      Number(row.qtyBranch004 || 0),
      Number(row.qtyBranch005 || 0),
      Number(row.qtyTotalAllBranches || 0),
      row.syncedAt || "",
    ]),
  ];
  const comparisonSheet = XLSX.utils.aoa_to_sheet(comparisonSheetRows);
  comparisonSheet["!cols"] = [
    { wch: 14 }, { wch: 50 }, { wch: 40 }, { wch: 18 }, { wch: 10 },
    { wch: 20 }, { wch: 18 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 24 },
  ];
  comparisonSheet["!autofilter"] = { ref: `A1:N1` };
  comparisonSheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2" };
  XLSX.utils.book_append_sheet(workbook, comparisonSheet, "ทุกสาขา");

  // ── Sheets 2–6: Individual branch sheets (same layout as single export) ───
  for (const branchCode of INVENTORY_VALUE_BRANCH_ORDER) {
    XLSX.utils.book_append_sheet(workbook, buildBranchSheet(rows, branchCode), branchCode);
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
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
    costAvgBranch000: null,
    costAvgBranch001: null,
    costAvgBranch002: null,
    costAvgBranch003: null,
    costAvgBranch004: null,
    costAvgBranch005: null,
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
    costAvgBranch000: row.cost_avg_branch_000 == null ? null : Number(row.cost_avg_branch_000),
    costAvgBranch001: row.cost_avg_branch_001 == null ? null : Number(row.cost_avg_branch_001),
    costAvgBranch002: row.cost_avg_branch_002 == null ? null : Number(row.cost_avg_branch_002),
    costAvgBranch003: row.cost_avg_branch_003 == null ? null : Number(row.cost_avg_branch_003),
    costAvgBranch004: row.cost_avg_branch_004 == null ? null : Number(row.cost_avg_branch_004),
    costAvgBranch005: row.cost_avg_branch_005 == null ? null : Number(row.cost_avg_branch_005),
    syncedAt: row.synced_at,
    rawPayload: row.raw_payload || {},
  };
}

function mergeBranchStockRecord(branchCode, existingRecord, incomingRecord, syncedAt) {
  const merged = {
    ...existingRecord,
    productCode: incomingRecord.productCode,
    productNameThai: incomingRecord.productNameThai || existingRecord.productNameThai,
    productNameEng: incomingRecord.productNameEng || existingRecord.productNameEng,
    barcode: incomingRecord.barcode || existingRecord.barcode,
    unit: incomingRecord.unit || existingRecord.unit,
    syncedAt,
    rawPayload: incomingRecord.rawPayload || {},
  };

  applyBranchQty(merged, branchCode, toNumber(incomingRecord.qty, 0));
  if (incomingRecord.hasCostAvg) {
    applyBranchCostAvg(merged, branchCode, incomingRecord.costAvg);
  }
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
        cost_avg_branch_000,
        cost_avg_branch_001,
        cost_avg_branch_002,
        cost_avg_branch_003,
        cost_avg_branch_004,
        cost_avg_branch_005,
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

    const { error, branchCode, records } = parseBranchStockPayload(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const record of records) {
        const existingSnapshot = await readExistingBranchStockSnapshot(client, record.productCode);
        const mergedRecord = mergeBranchStockRecord(
          branchCode,
          existingSnapshot ? mapExistingSnapshotRowToRecord(existingSnapshot) : createEmptySnapshotRecord(record.productCode, record.syncedAt),
          record,
          record.syncedAt,
        );
        // eslint-disable-next-line no-await-in-loop
        await upsertBranchStockSnapshot(client, mergedRecord);
      }
      await client.query("COMMIT");
      if (records.length > 0) {
        fireCategorizationBatch(db, records.map((r) => r.productCode));
      }
      return res.json({ accepted: records.length, insertedOrUpdated: records.length, branchCode });
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

    const { error, branchCode, records } = parseBranchStockPayload(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const record of records) {
        const existingSnapshot = await readExistingBranchStockSnapshot(client, record.productCode);
        const mergedRecord = mergeBranchStockRecord(
          branchCode,
          existingSnapshot ? mapExistingSnapshotRowToRecord(existingSnapshot) : createEmptySnapshotRecord(record.productCode, record.syncedAt),
          record,
          record.syncedAt,
        );
        // eslint-disable-next-line no-await-in-loop
        await upsertBranchStockSnapshot(client, mergedRecord);
      }
      await client.query("COMMIT");
      if (records.length > 0) {
        fireCategorizationBatch(db, records.map((r) => r.productCode));
      }
      return res.json({ accepted: records.length, insertedOrUpdated: records.length, branchCode });
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
        const mergedRecord = mergeBranchStockRecord(
          parsed.branchCode,
          existingSnapshot ? mapExistingSnapshotRowToRecord(existingSnapshot) : createEmptySnapshotRecord(record.productCode, parsed.generatedAt),
          {
            ...record,
            hasCostAvg: false,
            rawPayload: {
              branchCode: parsed.branchCode,
              sourceRowNumber: record.sourceRowNumber || null,
              rawRecord: record.rawPayload || {},
            },
          },
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

  // Accumulate-mode history: reads ada.stock_snapshots, an insert-only ledger
  // (unique key includes snapshot_at) populated by the branch_stock_history sync
  // dataset. Distinct from the overwrite-mode ada.branch_stock_snapshots table
  // above, which stays the "current" view and is untouched by this route.
  //
  // Returns one row per product, wide across all branches (qty_branch_000..005
  // + total) — same shape as the current-stock table above — rather than a
  // per-branch list over a date range, so the two pages are directly
  // comparable at a glance.
  //
  // Point-in-time semantics (not a literal date-range listing):
  //   - at_from given: nearest snapshot AT OR AFTER at_from, capped at at_to
  //     if also given (i.e. "closest to what I asked for, but not past my
  //     upper bound").
  //   - at_from omitted, at_to given: latest snapshot AT OR BEFORE at_to.
  //   - neither given (cleared/cancelled): latest snapshot overall, per branch.
  router.get("/branch-stock/history", requireAuthMiddleware, async (req, res, next) => {
    const productCode = normalizeNullableText(req.query.product_code);
    const atFrom = parseTimestamp(req.query.at_from);
    const atTo = parseTimestamp(req.query.at_to);

    const params = [];
    let productFilter = "";
    if (productCode) {
      params.push(productCode);
      productFilter = `AND ss.product_code = $${params.length}`;
    }
    let atFromFilter = "";
    if (atFrom) {
      params.push(atFrom);
      atFromFilter = `AND ss.snapshot_at >= $${params.length}`;
    }
    let atToFilter = "";
    if (atTo) {
      params.push(atTo);
      atToFilter = `AND ss.snapshot_at <= $${params.length}`;
    }
    // "Nearest after" wants the earliest qualifying snapshot; without a lower
    // bound there's no "after" to be nearest to, so fall back to "latest
    // qualifying snapshot" instead. Fixed literal, not user input.
    const sortDirection = atFrom ? "ASC" : "DESC";

    try {
      const result = await db.query(
        `
          SELECT DISTINCT ON (ss.product_code, ss.branch_code)
            ss.product_code,
            ss.branch_code,
            ss.qty_on_hand,
            ss.unit_code,
            ss.snapshot_at,
            COALESCE(p.product_name_th, ss.raw_payload->>'productNameThai') AS product_name_thai,
            COALESCE(pb.barcode, ss.raw_payload->>'barcode') AS barcode
          FROM ada.stock_snapshots ss
          LEFT JOIN ada.products p ON p.product_code = ss.product_code
          LEFT JOIN LATERAL (
            SELECT barcode FROM ada.product_barcodes pb
            WHERE pb.product_code = ss.product_code
            ORDER BY CASE pb.barcode_role WHEN 'primary' THEN 0 ELSE 1 END, pb.updated_at DESC
            LIMIT 1
          ) pb ON TRUE
          WHERE 1=1
            ${productFilter}
            ${atFromFilter}
            ${atToFilter}
          ORDER BY ss.product_code, ss.branch_code, ss.snapshot_at ${sortDirection}
        `,
        params,
      );

      const byProduct = new Map();
      for (const row of result.rows) {
        const code = row.product_code;
        if (!byProduct.has(code)) {
          byProduct.set(code, {
            productCode: code,
            productNameThai: row.product_name_thai || null,
            barcode: row.barcode || null,
            unit: null,
            branches: {},
            total: 0,
          });
        }
        const entry = byProduct.get(code);
        const qty = Number(row.qty_on_hand || 0);
        entry.branches[row.branch_code] = { qty, snapshotAt: row.snapshot_at };
        entry.total += qty;
        if (!entry.unit && row.unit_code) {
          entry.unit = row.unit_code;
        }
      }

      const records = [...byProduct.values()]
        .map((entry) => ({
          productCode: entry.productCode,
          productNameThai: entry.productNameThai,
          barcode: entry.barcode,
          unit: entry.unit,
          qtyBranch000: entry.branches["000"]?.qty ?? null,
          qtyBranch001: entry.branches["001"]?.qty ?? null,
          qtyBranch003: entry.branches["003"]?.qty ?? null,
          qtyBranch004: entry.branches["004"]?.qty ?? null,
          qtyBranch005: entry.branches["005"]?.qty ?? null,
          qtyTotalAllBranches: entry.total,
        }))
        .sort((a, b) => a.productCode.localeCompare(b.productCode));

      return res.json({
        productCode: productCode || null,
        atFrom: atFrom || null,
        atTo: atTo || null,
        records,
      });
    } catch (routeError) {
      return next(routeError);
    }
  });

  router.get(
    "/branch-stock/inventory-value",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    async (req, res, next) => {
      const branchCode = normalizeText(req.query.branchCode);
      const isAllBranches = branchCode === "all";
      if (!isAllBranches && !ALLOWED_BRANCH_CODES.has(branchCode)) {
        return res.status(400).json({ message: "branchCode must be one of 000, 001, 002, 003, 004, 005, or all." });
      }

      const detail = parseBooleanFlag(req.query.detail);
      const limit = parsePositiveInt(req.query.limit, 25);
      const offset = parseNonNegativeInt(req.query.offset, 0);
      if (limit == null) {
        return res.status(400).json({ message: "limit must be a positive integer." });
      }
      if (offset == null) {
        return res.status(400).json({ message: "offset must be a non-negative integer." });
      }

      const search = normalizeQuery(req.query.search || "");
      const branchConfig = isAllBranches
        ? buildInventoryValueBranchConfig(INVENTORY_VALUE_BRANCH_ORDER)
        : [getBranchSnapshotColumnNames(branchCode)];

      try {
        if (isAllBranches) {
          const {
            qtyTotalExpression,
            totalInventoryValueExpression,
            hasAnyStockExpression,
            missingCostExpression,
            perBranchSummaryColumns,
          } = buildInventoryValueSummaryQueryParts(branchConfig);

          const summaryResult = await db.query(
            `
              SELECT
                COUNT(*)::int AS product_count,
                COUNT(*) FILTER (WHERE ${hasAnyStockExpression})::int AS products_with_stock,
                COUNT(*) FILTER (WHERE ${hasAnyStockExpression} AND NOT ${missingCostExpression})::int AS products_with_cost,
                ROUND(SUM((${totalInventoryValueExpression}))::numeric, 2) AS total_inventory_value,
                ${perBranchSummaryColumns}
              FROM ada.branch_stock_snapshots bs
            `,
          );

          const summaryRow = summaryResult.rows[0] || {};
          const summary = {
            branchCode,
            productCount: Number(summaryRow.product_count || 0),
            productsWithStock: Number(summaryRow.products_with_stock || 0),
            productsWithCost: Number(summaryRow.products_with_cost || 0),
            totalInventoryValue: Number(summaryRow.total_inventory_value || 0),
            branchSummaries: mapInventoryValueAllBranchesSummary(summaryRow, branchConfig),
          };

          if (!detail) {
            return res.json(summary);
          }

          const countResult = await db.query(
            `
              SELECT COUNT(*)::int AS total
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
              WHERE ${hasAnyStockExpression}
                AND ${branchStockSearchCondition()}
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
                ${buildInventoryValueAllBranchSelectColumns(branchConfig)},
                (${qtyTotalExpression}) AS qty_total_all_branches,
                ROUND((${totalInventoryValueExpression})::numeric, 2) AS total_inventory_value,
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
              WHERE ${hasAnyStockExpression}
                AND ${branchStockSearchCondition()}
              ORDER BY total_inventory_value DESC, bs.product_code ASC
              LIMIT $2 OFFSET $3
            `,
            [search, limit, offset],
          );

          return res.json({
            ...summary,
            products: rowsResult.rows.map((row) => mapInventoryValueAllBranchesRow(row, branchConfig)),
            pagination: {
              limit,
              offset,
              total: Number(countResult.rows[0]?.total || 0),
            },
          });
        }

        const { qtyColumn, costColumn } = branchConfig[0];
        const summaryResult = await db.query(
          `
            SELECT
              COUNT(*)::int AS product_count,
              COUNT(*) FILTER (WHERE bs.${qtyColumn} > 0)::int AS products_with_stock,
              COUNT(*) FILTER (WHERE bs.${qtyColumn} > 0 AND bs.${costColumn} IS NOT NULL)::int AS products_with_cost,
              ROUND(SUM((bs.${qtyColumn} * COALESCE(bs.${costColumn}, 0)))::numeric, 2) AS total_inventory_value
            FROM ada.branch_stock_snapshots bs
          `,
        );

        const summary = {
          branchCode,
          productCount: Number(summaryResult.rows[0]?.product_count || 0),
          productsWithStock: Number(summaryResult.rows[0]?.products_with_stock || 0),
          productsWithCost: Number(summaryResult.rows[0]?.products_with_cost || 0),
          totalInventoryValue: Number(summaryResult.rows[0]?.total_inventory_value || 0),
        };

        if (!detail) {
          return res.json(summary);
        }

        const countResult = await db.query(
          `
            SELECT COUNT(*)::int AS total
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
            WHERE bs.${qtyColumn} > 0
              AND ${branchStockSearchCondition()}
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
              bs.${qtyColumn} AS qty,
              bs.${costColumn} AS unit_cost_avg,
              ROUND((bs.${qtyColumn} * COALESCE(bs.${costColumn}, 0))::numeric, 2) AS inventory_value,
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
            WHERE bs.${qtyColumn} > 0
              AND ${branchStockSearchCondition()}
            ORDER BY inventory_value DESC, bs.product_code ASC
            LIMIT $2 OFFSET $3
          `,
          [search, limit, offset],
        );

        return res.json({
          ...summary,
          products: rowsResult.rows.map(mapInventoryValueRow),
          pagination: {
            limit,
            offset,
            total: Number(countResult.rows[0]?.total || 0),
          },
        });
      } catch (routeError) {
        return next(routeError);
      }
    },
  );

  router.get("/branch-stock/export.xlsx", requireAuthMiddleware, async (req, res, next) => {
    const branchCode = normalizeText(req.query.branchCode);
    const isAllBranches = branchCode === "all";
    if (!isAllBranches && !BRANCH_EXPORT_CONFIG[branchCode]) {
      return res.status(400).json({ message: "branchCode must be one of 000, 001, 003, 004, 005, or all." });
    }

    const search = normalizeQuery(req.query.search || "");

    try {
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
        `,
        [search],
      );

      const rows = rowsResult.rows.map(mapBranchStockRow);
      const dateStamp = new Date().toISOString().slice(0, 10);
      let buffer, fileName;
      if (isAllBranches) {
        buffer = buildAllBranchesExportWorkbook(rows);
        fileName = `branch-stock-all-${dateStamp}.xlsx`;
      } else {
        buffer = buildBranchStockExportWorkbook(rows, branchCode);
        fileName = `branch-stock-${branchCode}-${dateStamp}.xlsx`;
      }
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.send(buffer);
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

  // ── Manual categorization trigger ───────────────────────────────────────
  router.post(
    "/admin/categorization/run",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    async (req, res, next) => {
      try {
        const productCodes =
          Array.isArray(req.body?.productCodes) && req.body.productCodes.length > 0
            ? req.body.productCodes
            : null;
        const dryRun = req.body?.dryRun === true;
        const metrics = await runCategorizationBatch(db, {
          productCodes,
          dryRun,
          triggeredBy: req.auth?.userId || "manual",
        });
        return res.json({ ok: true, metrics });
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}

module.exports = {
  createBranchStockRouter,
};
