#!/usr/bin/env node
"use strict";

const fs = require("fs");
const iconv = require("iconv-lite");
const { parse } = require("csv-parse/sync");
const { Client } = require("pg");

const DEFAULT_BATCH_SIZE = 500;
const PRICE_CURRENCY = "THB";
const THAI_MARKERS = [
  "รหัสสินค้า",
  "ชื่อสินค้า",
  "กลุ่มสินค้า",
  "บาร์โค้ด",
  "ต้นทุนเฉลี่ย",
  "ผู้จำหน่าย",
  "ราคาขายปลีก",
];
const KNOWN_LABELS = new Set([
  "รหัสสินค้า",
  "ชื่อสินค้า",
  "กลุ่มสินค้า",
  "บาร์โค้ด",
  "ต้นทุนเฉลี่ย",
  "ผู้จำหน่าย",
  "ราคาขายปลีก",
  "ราคาขายส่ง",
  "วันที่",
  "เวลา",
  "รายงาน",
  "จากรหัส :    ถึงรหัส :",
  "รายงาน - รายละเอียดสินค้า",
  "page -1 of 1",
]);

const SKU_RE = /^\d{9}$/;
const BARCODE_RE = /^\d{8,14}$/;
const SUPPLIER_RE = /^[A-Za-z]{1,6}\d{3,}$/;
const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;
const PAGE_RE = /^page\b/i;
const PRODUCT_KIND_DEFAULT = "device_or_general_goods";
const IMPORT_MODE_FULL = "full";
const IMPORT_MODE_PRICE_ONLY = "price-only";
const PRICE_HISTORY_OFF = "off";
const PRICE_HISTORY_ON = "on";

function usage() {
  return [
    "Usage:",
    "  node scripts/import_adapos_csv.js --file <csvPath> [--dry-run] [--commit] [--mode full|price-only] [--price-history on|off] [--limit N] [--batch-size N] [--apply-rules] [--db-url <postgresUrl>]",
    "",
    "Options:",
    "  --file <path>       Required input CSV path",
    "  --dry-run           Parse and plan only (default)",
    "  --commit            Write to database",
    "  --mode <mode>       Import mode: full|price-only (default full)",
    "  --price-history     Retail price behavior: on|off (default off)",
    "  --limit <N>         Parse at most N product rows",
    "  --batch-size <N>    Transaction batch size (default 500)",
    "  --apply-rules       After commit, apply enabled enrichment rules to imported SKUs",
    "  --db-url <url>      PostgreSQL URL (or set DATABASE_URL)",
    "  --help              Show help",
  ].join("\n");
}

function parseCliArgs(argv) {
  const args = {
    file: "",
    dryRun: true,
    commit: false,
    limit: null,
    batchSize: DEFAULT_BATCH_SIZE,
    mode: IMPORT_MODE_FULL,
    priceHistory: PRICE_HISTORY_OFF,
    applyRules: false,
    dbUrl: process.env.DATABASE_URL || "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") {
      args.file = argv[++i] || "";
    } else if (token === "--dry-run") {
      args.dryRun = true;
      args.commit = false;
    } else if (token === "--commit") {
      args.commit = true;
      args.dryRun = false;
    } else if (token === "--limit") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      args.limit = value;
    } else if (token === "--batch-size") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--batch-size must be a positive integer");
      }
      args.batchSize = value;
    } else if (token === "--mode") {
      const value = normalizeCell(argv[++i]).toLowerCase();
      if (![IMPORT_MODE_FULL, IMPORT_MODE_PRICE_ONLY].includes(value)) {
        throw new Error("--mode must be full or price-only");
      }
      args.mode = value;
    } else if (token === "--price-history") {
      const value = normalizeCell(argv[++i]).toLowerCase();
      if (![PRICE_HISTORY_ON, PRICE_HISTORY_OFF].includes(value)) {
        throw new Error("--price-history must be on or off");
      }
      args.priceHistory = value;
    } else if (token === "--apply-rules") {
      args.applyRules = true;
    } else if (token === "--db-url") {
      args.dbUrl = argv[++i] || "";
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function normalizeCell(value) {
  return String(value == null ? "" : value)
    .replace(/\uFEFF/g, "")
    .trim();
}

function squashSpaces(value) {
  return normalizeCell(value).replace(/\s+/g, " ");
}

function parseNumber(raw) {
  const compact = normalizeCell(raw).replace(/,/g, "");
  if (!/^[-+]?\d+(\.\d+)?$/.test(compact)) {
    return null;
  }
  const n = Number(compact);
  return Number.isFinite(n) ? n : null;
}

function isLikelyLabel(value) {
  const normalized = squashSpaces(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (KNOWN_LABELS.has(normalized)) {
    return true;
  }
  if (/^[1-5]$/.test(normalized)) {
    return true;
  }
  if (normalized.includes("วันที่พิมพ์")) {
    return true;
  }
  return false;
}

function isLikelyAuditToken(value) {
  const v = squashSpaces(value);
  if (!v) {
    return false;
  }
  if (DATE_RE.test(v) || TIME_RE.test(v) || PAGE_RE.test(v)) {
    return true;
  }
  if (/\.rpt$/i.test(v) || /\\/.test(v)) {
    return true;
  }
  return false;
}

function inferProductKind(name, category) {
  const text = `${normalizeCell(name)} ${normalizeCell(category)}`.toLowerCase();
  if (!text) {
    return PRODUCT_KIND_DEFAULT;
  }

  const has = (patterns) => patterns.some((pattern) => pattern.test(text));

  if (has([
    /\bmedical\s*food\b/,
    /\bors\b/,
    /อาหารทางการแพทย์/,
    /โภชน/,
    /อาหารเฉพาะทาง/,
  ])) {
    return "medical_food";
  }

  if (has([
    /\bsupplement\b/,
    /\bvitamin\b/,
    /อาหารเสริม/,
    /วิตามิน/,
    /โปรไบโอติก/,
    /คอลลาเจน/,
  ])) {
    return "supplement";
  }

  if (has([
    /\bcosmetic\b/,
    /\bcosmeceutical\b/,
    /เครื่องสำอาง/,
    /ครีม/,
    /เซรั่ม/,
    /โฟมล้างหน้า/,
    /ลิป/,
    /lotion/,
    /serum/,
  ])) {
    return "cosmetic";
  }

  if (has([
    /ยา/,
    /\bdrug\b/,
    /\btablet\b/,
    /\bcapsule\b/,
    /\bsyrup\b/,
    /\binjection\b/,
    /\bointment\b/,
    /เภสัช/,
  ])) {
    return "medicine";
  }

  return PRODUCT_KIND_DEFAULT;
}

function extractSkuCandidate(row) {
  const candidates = [];
  for (let i = 0; i < row.length; i += 1) {
    const compact = normalizeCell(row[i]).replace(/\s+/g, "");
    if (SKU_RE.test(compact)) {
      candidates.push({ index: i, sku: compact });
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  const preferred = candidates.find((candidate) => {
    const next = normalizeCell(row[candidate.index + 1] || "");
    return next && !parseNumber(next) && !isLikelyLabel(next);
  });
  return preferred || candidates[0];
}

function findNameIndex(row, skuIndex) {
  const direct = normalizeCell(row[skuIndex + 1] || "");
  if (direct && !parseNumber(direct) && !isLikelyLabel(direct) && !isLikelyAuditToken(direct)) {
    return skuIndex + 1;
  }
  const end = Math.min(row.length, skuIndex + 6);
  for (let i = skuIndex + 1; i < end; i += 1) {
    const value = normalizeCell(row[i]);
    if (!value) {
      continue;
    }
    if (parseNumber(value) !== null) {
      continue;
    }
    if (isLikelyLabel(value) || isLikelyAuditToken(value)) {
      continue;
    }
    return i;
  }
  return -1;
}

function findBarcode(row, startIndex, skuCode) {
  const end = Math.min(row.length, startIndex + 12);
  for (let i = startIndex; i < end; i += 1) {
    const compact = normalizeCell(row[i]).replace(/\s+/g, "");
    if (!compact || compact === skuCode) {
      continue;
    }
    if (BARCODE_RE.test(compact)) {
      return { index: i, barcode: compact };
    }
  }
  return null;
}

function findSupplierIndex(row, skuIndex) {
  const end = Math.min(row.length, skuIndex + 20);
  for (let i = skuIndex + 1; i < end; i += 1) {
    const value = normalizeCell(row[i]).replace(/\s+/g, "");
    if (SUPPLIER_RE.test(value)) {
      return i;
    }
  }
  return -1;
}

function findAvgCost(row, skuIndex, supplierIndex) {
  const start = skuIndex + 1;
  const end = supplierIndex > -1 ? supplierIndex : Math.min(row.length, skuIndex + 12);

  for (let i = end - 1; i >= start; i -= 1) {
    const raw = normalizeCell(row[i]);
    if (!raw) {
      continue;
    }
    const compact = raw.replace(/\s+/g, "");
    if (/^\d{8,}$/.test(compact)) {
      continue;
    }
    const number = parseNumber(raw);
    if (number !== null) {
      return { index: i, value: number };
    }
  }
  return null;
}

function extractPriceBundle(row, startIndex) {
  let retailPrice = null;
  let retailPriceIndex = -1;

  for (let i = startIndex; i < row.length; i += 1) {
    const raw = normalizeCell(row[i]);
    if (!raw) {
      continue;
    }
    if (isLikelyAuditToken(raw)) {
      if (retailPriceIndex >= 0) {
        break;
      }
      continue;
    }
    const number = parseNumber(raw);
    if (number !== null) {
      retailPrice = number;
      retailPriceIndex = i;
      break;
    }
  }

  const wholesaleTiers = [];
  if (retailPriceIndex >= 0) {
    for (let tier = 1; tier <= 5; tier += 1) {
      const cellIndex = retailPriceIndex + tier;
      if (cellIndex >= row.length) {
        break;
      }
      const raw = normalizeCell(row[cellIndex]);
      if (!raw || isLikelyAuditToken(raw)) {
        continue;
      }
      const number = parseNumber(raw);
      if (number === null) {
        continue;
      }
      wholesaleTiers.push({ tier, value: number, index: cellIndex });
    }
  }

  return {
    retailPrice,
    retailPriceIndex,
    wholesaleTiers,
  };
}

function extractAudit(row) {
  let dateIndex = -1;
  let timeIndex = -1;
  for (let i = row.length - 1; i >= 0; i -= 1) {
    const value = normalizeCell(row[i]);
    if (dateIndex === -1 && DATE_RE.test(value)) {
      dateIndex = i;
      continue;
    }
    if (timeIndex === -1 && TIME_RE.test(value)) {
      timeIndex = i;
      continue;
    }
  }

  const updatedByIndex = dateIndex > 0 ? dateIndex - 1 : -1;
  const reportPathIndex = row.findIndex((cell) => /\.rpt$/i.test(normalizeCell(cell)) || /\\/.test(normalizeCell(cell)));

  return {
    updated_by: updatedByIndex >= 0 ? normalizeCell(row[updatedByIndex]) : "",
    report_date: dateIndex >= 0 ? normalizeCell(row[dateIndex]) : "",
    report_time: timeIndex >= 0 ? normalizeCell(row[timeIndex]) : "",
    report_path: reportPathIndex >= 0 ? normalizeCell(row[reportPathIndex]) : "",
  };
}

function parseAuditTimestamp(audit) {
  if (!audit || !audit.report_date) {
    return null;
  }
  const dateParts = audit.report_date.split("/");
  if (dateParts.length !== 3) {
    return null;
  }
  const [ddRaw, mmRaw, yyyyRaw] = dateParts;
  const yyyy = String(yyyyRaw).padStart(4, "0");
  const mm = String(mmRaw).padStart(2, "0");
  const dd = String(ddRaw).padStart(2, "0");

  let hh = "00";
  let mi = "00";
  let ss = "00";
  if (audit.report_time && TIME_RE.test(audit.report_time)) {
    const timeParts = audit.report_time.split(":");
    hh = String(timeParts[0] || "00").padStart(2, "0");
    mi = String(timeParts[1] || "00").padStart(2, "0");
    ss = String(timeParts[2] || "00").padStart(2, "0");
  }

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+07:00`;
}

function parseProductRow(rawRow, rowNumber) {
  const row = rawRow.map(normalizeCell);
  if (row.every((cell) => !cell)) {
    return { skipReason: "empty_row", rowNumber };
  }

  const skuCandidate = extractSkuCandidate(row);
  if (!skuCandidate) {
    return { skipReason: "no_sku_code", rowNumber };
  }

  const skuIndex = skuCandidate.index;
  const skuCode = skuCandidate.sku;
  const nameIndex = findNameIndex(row, skuIndex);
  if (nameIndex === -1) {
    return { skipReason: "missing_name", rowNumber, sku_code: skuCode };
  }
  const name = normalizeCell(row[nameIndex]);
  if (!name) {
    return { skipReason: "missing_name", rowNumber, sku_code: skuCode };
  }

  const categoryIndex = nameIndex + 1;
  const categoryRaw = normalizeCell(row[categoryIndex] || "");
  const category = !categoryRaw || parseNumber(categoryRaw) !== null || isLikelyLabel(categoryRaw) ? "" : categoryRaw;

  const barcodeCandidate = findBarcode(row, categoryIndex + 1, skuCode);
  const supplierIndex = findSupplierIndex(row, skuIndex);
  const avgCostCandidate = findAvgCost(row, skuIndex, supplierIndex);
  const avgCost = avgCostCandidate ? avgCostCandidate.value : null;

  const supplierCode = supplierIndex > -1 ? normalizeCell(row[supplierIndex]).replace(/\s+/g, "") : "";
  const priceStartIndex = supplierIndex > -1 ? supplierIndex + 1 : (avgCostCandidate ? avgCostCandidate.index + 1 : skuIndex + 4);
  const priceBundle = extractPriceBundle(row, priceStartIndex);
  const audit = extractAudit(row);
  const sourceUpdatedAt = parseAuditTimestamp(audit);
  const productKind = inferProductKind(name, category);

  return {
    product: {
      source_row: rowNumber,
      sku_code: skuCode,
      name_th: name,
      category,
      barcode: barcodeCandidate ? barcodeCandidate.barcode : "",
      avg_cost: avgCost,
      supplier_code: supplierCode,
      retail_price: priceBundle.retailPrice,
      wholesale_tiers: priceBundle.wholesaleTiers,
      product_kind: productKind,
      source_updated_at: sourceUpdatedAt,
      audit,
      index_map: {
        sku_index: skuIndex,
        name_index: nameIndex,
        category_index: categoryIndex,
        barcode_index: barcodeCandidate ? barcodeCandidate.index : -1,
        avg_cost_index: avgCostCandidate ? avgCostCandidate.index : -1,
        supplier_index: supplierIndex,
        retail_price_index: priceBundle.retailPriceIndex,
      },
    },
  };
}

function decodeAdaPosBuffer(buffer) {
  const encodings = ["cp874", "tis620", "utf8"];
  let best = null;

  for (const encoding of encodings) {
    let decoded = "";
    try {
      decoded = iconv.decode(buffer, encoding);
    } catch (error) {
      continue;
    }
    const replacements = (decoded.match(/\uFFFD/g) || []).length;
    const markerHits = THAI_MARKERS.filter((marker) => decoded.includes(marker)).length;
    const score = markerHits * 100 - replacements * 1000;
    const candidate = { encoding, text: decoded, replacements, markerHits, score };
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  if (!best) {
    throw new Error("Could not decode file with cp874/tis620/utf8");
  }

  return best;
}

function parseAdaPosRows(csvText, options = {}) {
  const limit = options.limit || null;
  const records = parse(csvText, {
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: false,
    trim: false,
  });

  const products = [];
  const skippedRows = [];
  const parseErrors = [];

  for (let i = 0; i < records.length; i += 1) {
    if (limit && products.length >= limit) {
      break;
    }

    const rowNumber = i + 1;
    try {
      const parsed = parseProductRow(records[i], rowNumber);
      if (parsed.skipReason) {
        skippedRows.push({
          row: rowNumber,
          reason: parsed.skipReason,
          sku_code: parsed.sku_code || "",
        });
        continue;
      }
      products.push(parsed.product);
    } catch (error) {
      parseErrors.push({
        row: rowNumber,
        message: error.message,
      });
    }
  }

  return {
    rowsRead: records.length,
    products,
    skippedRows,
    parseErrors,
  };
}

function buildReasonCounts(skippedRows) {
  const counts = {};
  for (const skipped of skippedRows) {
    counts[skipped.reason] = (counts[skipped.reason] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function buildDryRunPlan(parsed) {
  const itemKeys = new Set();
  const skuKeys = new Set();
  const barcodes = new Set();
  const productKindCounts = {};
  let priceRows = 0;
  let wholesaleTierRows = 0;

  for (const product of parsed.products) {
    itemKeys.add(`${product.name_th}|${product.category || ""}`);
    skuKeys.add(product.sku_code);
    if (product.barcode) {
      barcodes.add(product.barcode);
    }
    if (product.retail_price !== null) {
      priceRows += 1;
    }
    wholesaleTierRows += product.wholesale_tiers.length;
    const kind = product.product_kind || PRODUCT_KIND_DEFAULT;
    productKindCounts[kind] = (productKindCounts[kind] || 0) + 1;
  }

  return {
    rows_read: parsed.rowsRead,
    products_parsed: parsed.products.length,
    skipped_rows: parsed.skippedRows.length,
    parse_errors: parsed.parseErrors.length,
    planned_actions: {
      items_upsert: itemKeys.size,
      skus_upsert: skuKeys.size,
      barcodes_upsert: barcodes.size,
      prices_update_or_insert: priceRows,
      sku_price_tiers_upsert: wholesaleTierRows,
    },
    product_kind_breakdown: Object.fromEntries(
      Object.entries(productKindCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
    skipped_by_reason: buildReasonCounts(parsed.skippedRows),
    top_parse_errors: parsed.parseErrors.slice(0, 20),
  };
}

function initCommitSummary() {
  return {
    tables: {
      items: { inserted: 0, updated: 0, skipped: 0 },
      skus: { inserted: 0, updated: 0, skipped: 0 },
      barcodes: { inserted: 0, updated: 0, skipped: 0, conflicts: 0 },
      prices: { inserted: 0, updated: 0, skipped: 0, unchanged: 0, history_closed: 0 },
      sku_price_tiers: { inserted: 0, updated: 0, skipped: 0 },
    },
    skipped_rows: {},
    parse_errors: [],
  };
}

function addSkipCount(summary, reason) {
  summary.skipped_rows[reason] = (summary.skipped_rows[reason] || 0) + 1;
}

function incrementActionCounter(counter, action) {
  if (!action) {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(counter, action)) {
    counter[action] += 1;
  }
}

async function upsertItem(client, product) {
  const query = `
    INSERT INTO public.items AS tgt (
      generic_name,
      strength,
      form,
      route,
      is_active,
      source_company_code,
      display_name,
      category_name,
      supplier_code,
      product_kind,
      source_updated_at,
      source_updated_by
    )
    VALUES ($1, NULL, NULL, NULL, TRUE, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (source_company_code) WHERE source_company_code IS NOT NULL
    DO UPDATE SET
      generic_name = EXCLUDED.generic_name,
      is_active = TRUE,
      display_name = EXCLUDED.display_name,
      category_name = EXCLUDED.category_name,
      supplier_code = EXCLUDED.supplier_code,
      product_kind = EXCLUDED.product_kind,
      source_updated_at = COALESCE(EXCLUDED.source_updated_at, tgt.source_updated_at),
      source_updated_by = COALESCE(EXCLUDED.source_updated_by, tgt.source_updated_by)
    RETURNING item_id, (xmax = 0) AS inserted
  `;
  const params = [
    product.name_th,
    product.sku_code,
    product.name_th,
    product.category || null,
    product.supplier_code || null,
    product.product_kind || PRODUCT_KIND_DEFAULT,
    product.source_updated_at || null,
    product.audit.updated_by || null,
  ];
  const result = await client.query(query, params);
  return {
    itemId: result.rows[0].item_id,
    inserted: Boolean(result.rows[0].inserted),
  };
}

async function upsertSku(client, product, itemId) {
  const query = `
    INSERT INTO public.skus AS tgt (
      item_id,
      uom,
      qty_in_base,
      pack_level,
      display_name,
      status,
      company_code,
      updated_at,
      uom_th,
      category_name,
      supplier_code,
      avg_cost,
      source_updated_at,
      source_updated_by
    )
    VALUES ($1, 'EA', 1, 'base', $2, 'active', $3, now(), NULL, $4, $5, $6, $7, $8)
    ON CONFLICT (company_code) WHERE company_code IS NOT NULL
    DO UPDATE SET
      item_id = EXCLUDED.item_id,
      display_name = EXCLUDED.display_name,
      status = 'active',
      category_name = EXCLUDED.category_name,
      supplier_code = EXCLUDED.supplier_code,
      avg_cost = EXCLUDED.avg_cost,
      source_updated_at = COALESCE(EXCLUDED.source_updated_at, tgt.source_updated_at),
      source_updated_by = COALESCE(EXCLUDED.source_updated_by, tgt.source_updated_by),
      updated_at = now()
    RETURNING sku_id, (xmax = 0) AS inserted
  `;
  const result = await client.query(query, [
    itemId,
    product.name_th,
    product.sku_code,
    product.category || null,
    product.supplier_code || null,
    product.avg_cost !== null ? product.avg_cost : null,
    product.source_updated_at || null,
    product.audit.updated_by || null,
  ]);
  return {
    skuId: result.rows[0].sku_id,
    inserted: Boolean(result.rows[0].inserted),
  };
}

async function findSkuByCompanyCode(client, companyCode) {
  const query = `
    SELECT sku_id, item_id
    FROM public.skus
    WHERE company_code = $1
    LIMIT 1
  `;
  const result = await client.query(query, [companyCode]);
  if (result.rowCount === 0) {
    return null;
  }
  return result.rows[0];
}

async function ensureSkuForImport(client, product, options = {}) {
  const mode = options.mode || IMPORT_MODE_FULL;

  if (mode === IMPORT_MODE_PRICE_ONLY) {
    const existingSku = await findSkuByCompanyCode(client, product.sku_code);
    if (existingSku) {
      return {
        skuId: existingSku.sku_id,
        itemId: existingSku.item_id,
        existed: true,
        itemAction: "skipped",
        skuAction: "skipped",
      };
    }
  }

  const itemResult = await upsertItem(client, product);
  const skuResult = await upsertSku(client, product, itemResult.itemId);
  return {
    skuId: skuResult.skuId,
    itemId: itemResult.itemId,
    existed: false,
    itemAction: itemResult.inserted ? "inserted" : "updated",
    skuAction: skuResult.inserted ? "inserted" : "updated",
  };
}

async function upsertBarcode(client, barcode, skuId) {
  const query = `
    INSERT INTO public.barcodes (barcode, sku_id, is_primary, updated_at)
    VALUES ($1, $2, TRUE, now())
    ON CONFLICT (barcode)
    DO UPDATE SET
      sku_id = EXCLUDED.sku_id,
      is_primary = TRUE,
      updated_at = now()
    RETURNING (xmax = 0) AS inserted
  `;
  const result = await client.query(query, [barcode, skuId]);
  return Boolean(result.rows[0].inserted);
}

async function ensureBarcodePriceOnly(client, barcode, skuId) {
  const lookupQuery = `
    SELECT sku_id
    FROM public.barcodes
    WHERE barcode = $1
    LIMIT 1
  `;
  const lookupResult = await client.query(lookupQuery, [barcode]);
  if (lookupResult.rowCount === 0) {
    const insertQuery = `
      INSERT INTO public.barcodes (barcode, sku_id, is_primary, updated_at)
      VALUES ($1, $2, TRUE, now())
      ON CONFLICT DO NOTHING
      RETURNING barcode
    `;
    const insertResult = await client.query(insertQuery, [barcode, skuId]);
    if (insertResult.rowCount > 0) {
      return "inserted";
    }
    return "skipped";
  }

  if (lookupResult.rows[0].sku_id === skuId) {
    return "skipped";
  }

  return "conflicts";
}

async function upsertRetailPrice(client, skuId, retailPrice, options = {}) {
  const priceHistory = options.priceHistory || PRICE_HISTORY_OFF;
  if (priceHistory === PRICE_HISTORY_ON) {
    const activeQuery = `
      SELECT price_id, price
      FROM public.prices
      WHERE sku_id = $1
        AND currency = $2
        AND effective_end IS NULL
      ORDER BY effective_start DESC NULLS LAST, price_id DESC
    `;
    const activeResult = await client.query(activeQuery, [skuId, PRICE_CURRENCY]);
    const incomingPrice = Number(retailPrice);
    const hasSameActivePrice = activeResult.rows.some((row) => {
      const currentPrice = Number(row.price);
      return Number.isFinite(currentPrice) && currentPrice === incomingPrice;
    });
    if (hasSameActivePrice) {
      return {
        inserted: 0,
        updated: 0,
        skipped: 0,
        unchanged: 1,
        history_closed: 0,
      };
    }

    let closedRows = 0;
    if (activeResult.rowCount > 0) {
      const closeQuery = `
        UPDATE public.prices
        SET
          effective_end = now(),
          updated_at = now()
        WHERE sku_id = $1
          AND currency = $2
          AND effective_end IS NULL
      `;
      const closeResult = await client.query(closeQuery, [skuId, PRICE_CURRENCY]);
      closedRows = closeResult.rowCount;
    }

    const insertHistoryQuery = `
      INSERT INTO public.prices (sku_id, price, currency, effective_start, effective_end, updated_at)
      VALUES ($1, $2, $3, now(), NULL, now())
    `;
    await client.query(insertHistoryQuery, [skuId, retailPrice, PRICE_CURRENCY]);
    return {
      inserted: 1,
      updated: 0,
      skipped: 0,
      unchanged: 0,
      history_closed: closedRows,
    };
  }

  const updateQuery = `
    UPDATE public.prices
    SET
      price = $1,
      updated_at = now(),
      effective_start = COALESCE(effective_start, now()),
      effective_end = NULL
    WHERE sku_id = $2
      AND currency = $3
      AND effective_end IS NULL
    RETURNING price_id
  `;

  const updateResult = await client.query(updateQuery, [retailPrice, skuId, PRICE_CURRENCY]);
  if (updateResult.rowCount > 0) {
    return {
      inserted: 0,
      updated: updateResult.rowCount,
      skipped: 0,
      unchanged: 0,
      history_closed: 0,
    };
  }

  const insertQuery = `
    INSERT INTO public.prices (sku_id, price, currency, effective_start, effective_end, updated_at)
    VALUES ($1, $2, $3, now(), NULL, now())
  `;
  await client.query(insertQuery, [skuId, retailPrice, PRICE_CURRENCY]);
  return {
    inserted: 1,
    updated: 0,
    skipped: 0,
    unchanged: 0,
    history_closed: 0,
  };
}

async function upsertWholesaleTier(client, skuId, tier, price) {
  const query = `
    INSERT INTO public.sku_price_tiers (
      sku_id, price_kind, tier, price, currency, is_active, updated_at
    )
    VALUES ($1, 'wholesale', $2, $3, $4, TRUE, now())
    ON CONFLICT (sku_id, price_kind, tier)
    DO UPDATE SET
      price = EXCLUDED.price,
      currency = EXCLUDED.currency,
      is_active = TRUE,
      updated_at = now()
    RETURNING (xmax = 0) AS inserted
  `;
  const result = await client.query(query, [skuId, tier, price, PRICE_CURRENCY]);
  return Boolean(result.rows[0].inserted);
}

function dbConfigFromUrl(dbUrl) {
  const sslMode = String(process.env.PGSSLMODE || "").toLowerCase();
  if (dbUrl.includes("sslmode=require") || sslMode === "require") {
    return {
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    };
  }
  return { connectionString: dbUrl };
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

async function importParsedProducts(parsed, options) {
  const summary = initCommitSummary();

  for (const skipped of parsed.skippedRows) {
    addSkipCount(summary, skipped.reason);
  }
  summary.parse_errors = parsed.parseErrors.slice(0, 20);

  const batches = chunk(parsed.products, options.batchSize);
  if (batches.length === 0) {
    return summary;
  }

  const client = new Client(dbConfigFromUrl(options.dbUrl));
  await client.connect();

  try {
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      await client.query("BEGIN");

      try {
        for (const product of batch) {
          if (!product.name_th) {
            addSkipCount(summary, "missing_name");
            continue;
          }

          const skuResolution = await ensureSkuForImport(client, product, {
            mode: options.mode,
          });
          incrementActionCounter(summary.tables.items, skuResolution.itemAction);
          incrementActionCounter(summary.tables.skus, skuResolution.skuAction);
          const skuId = skuResolution.skuId;

          if (product.barcode) {
            if (options.mode === IMPORT_MODE_PRICE_ONLY) {
              const barcodeAction = await ensureBarcodePriceOnly(client, product.barcode, skuId);
              incrementActionCounter(summary.tables.barcodes, barcodeAction);
            } else {
              const barcodeInserted = await upsertBarcode(client, product.barcode, skuId);
              summary.tables.barcodes[barcodeInserted ? "inserted" : "updated"] += 1;
            }
          } else {
            summary.tables.barcodes.skipped += 1;
          }

          if (product.retail_price !== null) {
            const priceResult = await upsertRetailPrice(client, skuId, product.retail_price, {
              priceHistory: options.priceHistory,
            });
            summary.tables.prices.inserted += priceResult.inserted;
            summary.tables.prices.updated += priceResult.updated;
            summary.tables.prices.skipped += priceResult.skipped || 0;
            summary.tables.prices.unchanged += priceResult.unchanged || 0;
            summary.tables.prices.history_closed += priceResult.history_closed || 0;
          } else {
            summary.tables.prices.skipped += 1;
          }

          if (product.wholesale_tiers.length > 0) {
            for (const tierEntry of product.wholesale_tiers) {
              const tierInserted = await upsertWholesaleTier(client, skuId, tierEntry.tier, tierEntry.value);
              summary.tables.sku_price_tiers[tierInserted ? "inserted" : "updated"] += 1;
            }
          } else {
            summary.tables.sku_price_tiers.skipped += 1;
          }
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Batch ${batchIndex + 1} failed: ${error.message}`);
      }
    }
  } finally {
    await client.end();
  }

  return summary;
}

function printDryRunSummary(metadata, plan, options) {
  console.log("Mode: DRY RUN");
  console.log(`Import mode: ${options.mode}`);
  console.log(`Price history: ${options.priceHistory}`);
  console.log(`Detected encoding: ${metadata.encoding} (markerHits=${metadata.markerHits}, replacements=${metadata.replacements})`);
  console.log(JSON.stringify(plan, null, 2));
}

function printCommitSummary(metadata, parsed, summary, options) {
  console.log("Mode: COMMIT");
  console.log(`Import mode: ${options.mode}`);
  console.log(`Price history: ${options.priceHistory}`);
  console.log(`Detected encoding: ${metadata.encoding} (markerHits=${metadata.markerHits}, replacements=${metadata.replacements})`);
  console.log(`Rows read: ${parsed.rowsRead}`);
  console.log(`Products parsed: ${parsed.products.length}`);
  console.log(`Rows skipped during parse: ${parsed.skippedRows.length}`);
  console.log(`Parse errors (top ${summary.parse_errors.length}):`);
  for (const error of summary.parse_errors) {
    console.log(`  - row ${error.row}: ${error.message}`);
  }
  console.log("Table changes:");
  for (const [table, counts] of Object.entries(summary.tables)) {
    console.log(`  - ${table}: ${JSON.stringify(counts)}`);
  }
  if (Object.keys(summary.skipped_rows).length > 0) {
    console.log("Skipped rows by reason:");
    const sorted = Object.entries(summary.skipped_rows).sort(([a], [b]) => a.localeCompare(b));
    for (const [reason, count] of sorted) {
      console.log(`  - ${reason}: ${count}`);
    }
  }
}

async function runImporter(options) {
  if (!options.file) {
    throw new Error("Missing --file");
  }
  if (!fs.existsSync(options.file)) {
    throw new Error(`File not found: ${options.file}`);
  }

  const buffer = fs.readFileSync(options.file);
  const decodeResult = decodeAdaPosBuffer(buffer);
  const parsed = parseAdaPosRows(decodeResult.text, { limit: options.limit });

  if (options.dryRun) {
    const plan = buildDryRunPlan(parsed);
    plan.import_mode = options.mode;
    plan.price_history = options.priceHistory;
    printDryRunSummary(decodeResult, plan, options);
    if (options.applyRules) {
      console.log("Note: --apply-rules only runs with --commit.");
    }
    return { mode: "dry-run", decodeResult, parsed, plan };
  }

  if (!options.dbUrl) {
    throw new Error("Missing database URL. Use --db-url or set DATABASE_URL");
  }

  const summary = await importParsedProducts(parsed, {
    batchSize: options.batchSize,
    dbUrl: options.dbUrl,
    mode: options.mode,
    priceHistory: options.priceHistory,
  });
  printCommitSummary(decodeResult, parsed, summary, options);

  let ruleSummary = null;
  if (options.applyRules) {
    const importedCompanyCodes = [...new Set(parsed.products.map((product) => product.sku_code))];
    const { runRuleApplication, printSummary } = require("./apply_enrichment_rules");
    ruleSummary = await runRuleApplication({
      dbUrl: options.dbUrl,
      commit: true,
      dryRun: false,
      onlyStatus: null,
      force: false,
      limit: null,
      companyCodes: importedCompanyCodes,
    });
    console.log("Post-import enrichment rule run:");
    printSummary(ruleSummary);
  }

  return { mode: "commit", decodeResult, parsed, summary, ruleSummary };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  await runImporter(args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Import failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  decodeAdaPosBuffer,
  parseAdaPosRows,
  parseProductRow,
  buildDryRunPlan,
  ensureSkuForImport,
  upsertRetailPrice,
  IMPORT_MODE_FULL,
  IMPORT_MODE_PRICE_ONLY,
  PRICE_HISTORY_OFF,
  PRICE_HISTORY_ON,
  runImporter,
  parseCliArgs,
};
