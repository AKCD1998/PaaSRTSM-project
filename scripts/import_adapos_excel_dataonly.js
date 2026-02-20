#!/usr/bin/env node
"use strict";

const fs = require("fs");
const XLSX = require("xlsx");

const PRODUCT_CODE_RE = /^(?:\d{9}|IC-\d{6,}|IS-\d{6,})$/i;
const BARCODE_RE = /^\d{12,13}$/;
const SUPPLIER_RE = /^[A-Z]{2}\d{5}$/;
const TIME_RE = /^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function usage() {
  return [
    "Usage:",
    "  node scripts/import_adapos_excel_dataonly.js --file <xlsPath> [--dry-run] [--json-out <path>] [--limit N] [--no-strict]",
    "",
    "Notes:",
    "  - Parses Crystal Report export: Excel (Data Only) repeating blocks",
    "  - State machine: PRODUCT HEADER -> DETAIL ROWS -> META ROW",
    "  - This script does not write to database",
  ].join("\n");
}

function parseCliArgs(argv) {
  const args = {
    file: "",
    dryRun: true,
    jsonOut: "",
    limit: null,
    strict: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") {
      args.file = argv[++i] || "";
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--json-out") {
      args.jsonOut = argv[++i] || "";
    } else if (token === "--limit") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      args.limit = value;
    } else if (token === "--no-strict") {
      args.strict = false;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function normalizeText(value) {
  return String(value == null ? "" : value)
    .replace(/\uFEFF/g, "")
    .trim();
}

function valueToString(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return normalizeText(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "";
    }
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value.toFixed(10).replace(/0+$/g, "").replace(/\.$/g, "");
  }
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString();
  }
  return normalizeText(value);
}

function parseNumber(raw) {
  if (raw == null || raw === "") {
    return null;
  }
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  const text = normalizeText(raw).replace(/,/g, "");
  if (!text) {
    return null;
  }
  if (!/^[-+]?\d+(\.\d+)?$/.test(text)) {
    return null;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function toCodeToken(value) {
  return normalizeText(value).replace(/\s+/g, "").toUpperCase();
}

function isProductHeaderCode(value) {
  return PRODUCT_CODE_RE.test(toCodeToken(value));
}

function isBarcodeCode(value) {
  return BARCODE_RE.test(normalizeText(value).replace(/\s+/g, ""));
}

function isSupplierCode(value) {
  return SUPPLIER_RE.test(toCodeToken(value));
}

function parseTimeToken(raw) {
  if (raw == null || raw === "") {
    return "";
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const seconds = Math.round(raw * 86400);
    const hh = String(Math.floor(seconds / 3600) % 24).padStart(2, "0");
    const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  const text = normalizeText(raw);
  if (!text) {
    return "";
  }
  if (!TIME_RE.test(text)) {
    return "";
  }
  const parts = text.split(":");
  const hh = String(Number(parts[0])).padStart(2, "0");
  const mm = String(Number(parts[1])).padStart(2, "0");
  const ss = String(Number(parts[2] || "0")).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function excelSerialToYmd(serialRaw) {
  const serial = parseNumber(serialRaw);
  if (serial === null) {
    return "";
  }
  const wholeDays = Math.floor(serial);
  const excelEpochUtc = Date.UTC(1899, 11, 30);
  const date = new Date(excelEpochUtc + wholeDays * 86400000);
  if (Number.isNaN(date.valueOf())) {
    return "";
  }
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildUpdatedAt(dateSerialRaw, timeRaw) {
  const ymd = excelSerialToYmd(dateSerialRaw);
  if (!ymd) {
    return null;
  }
  const time = parseTimeToken(timeRaw) || "00:00:00";
  return `${ymd}T${time}+07:00`;
}

function classifyRow(row) {
  const colA = row[0];
  const colB = row[1];
  const colC = row[2];
  const colD = row[3];
  const colE = row[4];
  const colF = row[5];

  const codeToken = toCodeToken(colA);
  const unit = normalizeText(colB);
  const productName = normalizeText(colB);
  const category = normalizeText(row[2]);
  const retailTier1 = parseNumber(colC);

  if (PRODUCT_CODE_RE.test(codeToken)) {
    return {
      kind: "header",
      product_code: codeToken,
      product_name: productName,
      category: category || "",
    };
  }

  if (BARCODE_RE.test(normalizeText(colA).replace(/\s+/g, "")) && unit && retailTier1 !== null) {
    const tierValues = [];
    for (let col = 2; col <= 9; col += 1) {
      tierValues.push(parseNumber(row[col]));
    }
    return {
      kind: "detail",
      barcode: normalizeText(colA).replace(/\s+/g, ""),
      unit,
      retail_tier_1: tierValues[0],
      retail_tiers_optional: tierValues.slice(1),
    };
  }

  const avgCost = parseNumber(colA);
  const supplierToken = toCodeToken(colB);
  const hasMetaSignal = normalizeText(colD) !== "" || parseNumber(colE) !== null;
  if (avgCost !== null && SUPPLIER_RE.test(supplierToken) && hasMetaSignal) {
    return {
      kind: "meta",
      avg_cost: avgCost,
      supplier_code: supplierToken,
      updated_by: normalizeText(colD) || null,
      updated_at: buildUpdatedAt(colE, colF),
      excel_date_serial: parseNumber(colE),
      raw_time: normalizeText(colF),
    };
  }

  return { kind: "ignore" };
}

function makeProduct(headerData) {
  return {
    product_code: headerData.product_code,
    product_name: headerData.product_name,
    category: headerData.category || "",
    avg_cost: null,
    supplier_code: "",
    updated_by: null,
    updated_at: null,
    units: [],
    _unitIndex: new Map(),
  };
}

function mergeDetail(product, detail) {
  let unitEntry = product._unitIndex.get(detail.unit);
  if (!unitEntry) {
    unitEntry = {
      unit: detail.unit,
      retail_tier_1: detail.retail_tier_1,
      retail_tiers_optional: [...detail.retail_tiers_optional],
      barcodes: [],
    };
    product.units.push(unitEntry);
    product._unitIndex.set(detail.unit, unitEntry);
  } else {
    if (unitEntry.retail_tier_1 === null && detail.retail_tier_1 !== null) {
      unitEntry.retail_tier_1 = detail.retail_tier_1;
    }
    for (let i = 0; i < detail.retail_tiers_optional.length; i += 1) {
      if (unitEntry.retail_tiers_optional[i] === null && detail.retail_tiers_optional[i] !== null) {
        unitEntry.retail_tiers_optional[i] = detail.retail_tiers_optional[i];
      }
    }
  }

  const alreadyExists = unitEntry.barcodes.some((entry) => entry.barcode === detail.barcode);
  if (!alreadyExists) {
    unitEntry.barcodes.push({
      barcode: detail.barcode,
      primary: unitEntry.barcodes.length === 0,
    });
  }
}

function applyMeta(product, meta) {
  product.avg_cost = meta.avg_cost;
  product.supplier_code = meta.supplier_code;
  product.updated_by = meta.updated_by;
  product.updated_at = meta.updated_at;
}

function finalizeProduct(product) {
  if (!product) {
    return null;
  }
  const clean = { ...product };
  delete clean._unitIndex;
  return clean;
}

function columnLetter(index) {
  let col = index + 1;
  let out = "";
  while (col > 0) {
    const rem = (col - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    col = Math.floor((col - 1) / 26);
  }
  return out;
}

function formatRowWithLetters(row) {
  const parts = [];
  for (let i = 0; i < row.length; i += 1) {
    const value = valueToString(row[i]);
    if (!value) {
      continue;
    }
    parts.push(`${columnLetter(i)}=${value}`);
  }
  return parts.join(" | ") || "(blank)";
}

function computePatternStats(rows) {
  const stats = {
    product_code_pattern_rows: 0,
    barcode_pattern_rows: 0,
    supplier_pattern_in_b_rows: 0,
    numeric_a_rows: 0,
  };

  for (const row of rows) {
    const a = row[0];
    const b = row[1];
    const aText = valueToString(a).replace(/\s+/g, "");
    if (isProductHeaderCode(aText)) {
      stats.product_code_pattern_rows += 1;
    }
    if (isBarcodeCode(aText)) {
      stats.barcode_pattern_rows += 1;
    }
    if (isSupplierCode(b)) {
      stats.supplier_pattern_in_b_rows += 1;
    }
    if (parseNumber(a) !== null) {
      stats.numeric_a_rows += 1;
    }
  }
  return stats;
}

function printMismatchDiagnostics(rows, classifyStats) {
  const previewRows = rows.slice(0, 20);
  const patternStats = computePatternStats(rows);

  console.error("Structure mismatch detected for Excel (Data Only).");
  console.error("First 20 rows (non-empty cells with column letters):");
  for (let i = 0; i < previewRows.length; i += 1) {
    console.error(`  Row ${i + 1}: ${formatRowWithLetters(previewRows[i])}`);
  }
  console.error("Detected patterns:");
  console.error(`  product_code_pattern_rows: ${patternStats.product_code_pattern_rows}`);
  console.error(`  barcode_pattern_rows: ${patternStats.barcode_pattern_rows}`);
  console.error(`  supplier_pattern_in_b_rows: ${patternStats.supplier_pattern_in_b_rows}`);
  console.error(`  numeric_a_rows: ${patternStats.numeric_a_rows}`);
  console.error("Classifier counters:");
  console.error(`  header_rows: ${classifyStats.header_rows}`);
  console.error(`  detail_rows: ${classifyStats.detail_rows}`);
  console.error(`  meta_rows: ${classifyStats.meta_rows}`);
  console.error(`  ignored_rows: ${classifyStats.ignored_rows}`);
  console.error(`  orphan_detail_rows: ${classifyStats.orphan_detail_rows}`);
  console.error(`  orphan_meta_rows: ${classifyStats.orphan_meta_rows}`);
}

function hasStructureMismatch(stats, productCount) {
  if (productCount === 0) {
    return "No product header rows detected.";
  }
  if (stats.detail_rows === 0) {
    return "No detail rows detected.";
  }
  if (stats.meta_rows === 0) {
    return "No meta rows detected.";
  }
  if (productCount >= 100 && stats.detail_rows < Math.floor(productCount * 0.2)) {
    return "Detail row count is too low compared to product header rows.";
  }
  if (productCount >= 100 && stats.meta_rows < Math.floor(productCount * 0.1)) {
    return "Meta row count is too low compared to product header rows.";
  }
  return "";
}

function parseExcelDataOnlyRows(rows, options = {}) {
  const strict = options.strict !== false;
  const limit = options.limit || null;
  const products = [];
  const stats = {
    header_rows: 0,
    detail_rows: 0,
    meta_rows: 0,
    ignored_rows: 0,
    orphan_detail_rows: 0,
    orphan_meta_rows: 0,
  };

  let current = null;
  for (let i = 0; i < rows.length; i += 1) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const parsed = classifyRow(row);

    if (parsed.kind === "header") {
      stats.header_rows += 1;
      const finalized = finalizeProduct(current);
      if (finalized) {
        products.push(finalized);
      }
      if (limit && products.length >= limit) {
        current = null;
        break;
      }
      current = makeProduct(parsed);
      continue;
    }

    if (parsed.kind === "detail") {
      stats.detail_rows += 1;
      if (!current) {
        stats.orphan_detail_rows += 1;
        continue;
      }
      mergeDetail(current, parsed);
      continue;
    }

    if (parsed.kind === "meta") {
      stats.meta_rows += 1;
      if (!current) {
        stats.orphan_meta_rows += 1;
        continue;
      }
      applyMeta(current, parsed);
      continue;
    }

    stats.ignored_rows += 1;
  }

  const finalized = finalizeProduct(current);
  if (finalized && (!limit || products.length < limit)) {
    products.push(finalized);
  }

  const mismatchReason = hasStructureMismatch(stats, products.length);
  if (strict && mismatchReason) {
    printMismatchDiagnostics(rows, stats);
    throw new Error(`Structure mismatch: ${mismatchReason}`);
  }

  return {
    rows_read: rows.length,
    products,
    stats,
    mismatch_reason: mismatchReason || "",
  };
}

function readFirstSheetAsRows(filePath) {
  const workbook = XLSX.readFile(filePath, {
    cellDates: false,
    dense: true,
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("Workbook has no sheets");
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: true,
  });
  return {
    sheet_name: firstSheetName,
    rows,
  };
}

function buildSummary(parsed, sheetName) {
  let unitCount = 0;
  let barcodeCount = 0;
  let withMetaCount = 0;
  for (const product of parsed.products) {
    unitCount += product.units.length;
    for (const unit of product.units) {
      barcodeCount += unit.barcodes.length;
    }
    if (product.avg_cost !== null || product.supplier_code || product.updated_at) {
      withMetaCount += 1;
    }
  }

  return {
    sheet_name: sheetName,
    rows_read: parsed.rows_read,
    products_parsed: parsed.products.length,
    units_parsed: unitCount,
    barcodes_parsed: barcodeCount,
    products_with_meta: withMetaCount,
    row_type_counts: parsed.stats,
    mismatch_reason: parsed.mismatch_reason,
  };
}

async function runParser(options) {
  if (!options.file) {
    throw new Error("Missing --file");
  }
  if (!fs.existsSync(options.file)) {
    throw new Error(`File not found: ${options.file}`);
  }

  const workbook = readFirstSheetAsRows(options.file);
  const parsed = parseExcelDataOnlyRows(workbook.rows, {
    strict: options.strict,
    limit: options.limit,
  });
  const summary = buildSummary(parsed, workbook.sheet_name);

  if (options.jsonOut) {
    const payload = {
      summary,
      products: parsed.products,
    };
    fs.writeFileSync(options.jsonOut, JSON.stringify(payload, null, 2));
  }

  return {
    sheet_name: workbook.sheet_name,
    parsed,
    summary,
  };
}

async function parseAdaPosExcelDataOnly(options) {
  const result = await runParser(options || {});
  return {
    sheet_name: result.sheet_name,
    summary: result.summary,
    products: result.parsed.products,
    row_type_counts: result.parsed.stats,
    mismatch_reason: result.parsed.mismatch_reason,
  };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const result = await runParser(args);
  console.log("Mode: DRY RUN");
  console.log(JSON.stringify(result.summary, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Parse failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  PRODUCT_CODE_RE,
  BARCODE_RE,
  SUPPLIER_RE,
  parseCliArgs,
  parseExcelDataOnlyRows,
  classifyRow,
  buildUpdatedAt,
  readFirstSheetAsRows,
  runParser,
  parseAdaPosExcelDataOnly,
};
