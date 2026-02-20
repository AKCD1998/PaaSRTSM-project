#!/usr/bin/env node
"use strict";

const fs = require("fs");
const iconv = require("iconv-lite");
const { parse } = require("csv-parse/sync");
const { Client } = require("pg");

const DEFAULT_BATCH_SIZE = 500;
const ENCODINGS = ["utf8", "cp874", "tis620"];

function usage() {
  return [
    "Usage:",
    "  node scripts/import_sales_daily_csv.js --file <csvPath> [--dry-run] [--commit] [--limit N] [--batch-size N] [--db-url <postgresUrl>]",
    "",
    "Expected CSV columns (aliases accepted):",
    "  sale_date/date, company_code/sku_code, qty/quantity, amount/sales_amount, optional sku_id, optional source",
  ].join("\n");
}

function parseCliArgs(argv) {
  const args = {
    file: "",
    dryRun: true,
    commit: false,
    limit: null,
    batchSize: DEFAULT_BATCH_SIZE,
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

function normalizeText(value) {
  return String(value == null ? "" : value)
    .replace(/\uFEFF/g, "")
    .trim();
}

function decodeBest(buffer) {
  let best = null;
  for (const encoding of ENCODINGS) {
    let text = "";
    try {
      text = iconv.decode(buffer, encoding);
    } catch (error) {
      continue;
    }
    const replacements = (text.match(/\uFFFD/g) || []).length;
    const score = -replacements;
    const candidate = { encoding, text, replacements, score };
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }
  if (!best) {
    throw new Error("Could not decode sales CSV");
  }
  return best;
}

function normalizeHeaderKey(value) {
  return normalizeText(value).toLowerCase().replace(/[\s_\-]/g, "");
}

const HEADER_ALIASES = {
  sale_date: new Set(["saledate", "date", "day", "วันที่"]),
  company_code: new Set(["companycode", "skucode", "productcode", "รหัสสินค้า"]),
  sku_id: new Set(["skuid"]),
  qty: new Set(["qty", "quantity", "จำนวน"]),
  amount: new Set(["amount", "salesamount", "ยอดขาย", "มูลค่า", "total"]),
  source: new Set(["source", "channel"]),
};

function getByAlias(row, aliasKey) {
  const aliases = HEADER_ALIASES[aliasKey];
  const entries = Object.entries(row);
  for (const [rawKey, rawValue] of entries) {
    const key = normalizeHeaderKey(rawKey);
    if (aliases.has(key)) {
      return rawValue;
    }
  }
  return "";
}

function parseNumber(raw) {
  const compact = normalizeText(raw).replace(/,/g, "");
  if (!compact) {
    return null;
  }
  if (!/^[-+]?\d+(\.\d+)?$/.test(compact)) {
    return null;
  }
  const value = Number(compact);
  return Number.isFinite(value) ? value : null;
}

function parseDate(raw) {
  const text = normalizeText(raw);
  if (!text) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  const parts = text.split("/");
  if (parts.length === 3) {
    const dd = Number(parts[0]);
    const mm = Number(parts[1]);
    const yyyy = Number(parts[2]);
    if (Number.isInteger(dd) && Number.isInteger(mm) && Number.isInteger(yyyy)) {
      return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }
  return "";
}

function parseSalesRows(csvText, options = {}) {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });

  const rows = [];
  const skipped = [];
  const limit = options.limit || null;

  for (let i = 0; i < records.length; i += 1) {
    if (limit && rows.length >= limit) {
      break;
    }

    const row = records[i];
    const rowNo = i + 2;

    const saleDate = parseDate(getByAlias(row, "sale_date"));
    const companyCode = normalizeText(getByAlias(row, "company_code"));
    const qty = parseNumber(getByAlias(row, "qty"));
    const amount = parseNumber(getByAlias(row, "amount"));
    const skuIdRaw = normalizeText(getByAlias(row, "sku_id"));
    const source = normalizeText(getByAlias(row, "source")) || "csv_import";
    const skuId = skuIdRaw && /^\d+$/.test(skuIdRaw) ? Number(skuIdRaw) : null;

    if (!saleDate) {
      skipped.push({ row: rowNo, reason: "invalid_sale_date" });
      continue;
    }
    if (!companyCode) {
      skipped.push({ row: rowNo, reason: "missing_company_code" });
      continue;
    }
    if (qty === null || qty < 0) {
      skipped.push({ row: rowNo, reason: "invalid_qty" });
      continue;
    }
    if (amount === null || amount < 0) {
      skipped.push({ row: rowNo, reason: "invalid_amount" });
      continue;
    }

    rows.push({
      sale_date: saleDate,
      company_code: companyCode,
      sku_id: skuId,
      qty,
      amount,
      source,
    });
  }

  return {
    totalRecords: records.length,
    rows,
    skipped,
  };
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

function buildSkipCounts(skipped) {
  const counts = {};
  for (const entry of skipped) {
    counts[entry.reason] = (counts[entry.reason] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

async function importSalesRows(parsed, options) {
  const summary = {
    inserted: 0,
    updated: 0,
    rows: parsed.rows.length,
    skipped: parsed.skipped.length,
    skipped_by_reason: buildSkipCounts(parsed.skipped),
    unresolved_company_code: 0,
  };

  if (parsed.rows.length === 0) {
    return summary;
  }

  const client = new Client(dbConfigFromUrl(options.dbUrl));
  await client.connect();

  try {
    const companyCodes = [...new Set(parsed.rows.map((row) => row.company_code))];
    const skuLookupResult = await client.query(
      "SELECT sku_id, company_code FROM public.skus WHERE company_code = ANY($1::text[])",
      [companyCodes],
    );
    const skuLookup = new Map(skuLookupResult.rows.map((row) => [row.company_code, row.sku_id]));

    const batches = chunk(parsed.rows, options.batchSize);
    for (const batch of batches) {
      await client.query("BEGIN");
      try {
        for (const row of batch) {
          const resolvedSkuId = row.sku_id || skuLookup.get(row.company_code) || null;
          if (!resolvedSkuId) {
            summary.unresolved_company_code += 1;
          }

          const query = `
            INSERT INTO public.sales_daily (
              sale_date,
              company_code,
              sku_id,
              qty,
              amount,
              source,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, now())
            ON CONFLICT (sale_date, company_code)
            DO UPDATE SET
              sku_id = COALESCE(EXCLUDED.sku_id, public.sales_daily.sku_id),
              qty = EXCLUDED.qty,
              amount = EXCLUDED.amount,
              source = EXCLUDED.source,
              updated_at = now()
            RETURNING (xmax = 0) AS inserted
          `;
          const result = await client.query(query, [
            row.sale_date,
            row.company_code,
            resolvedSkuId,
            row.qty,
            row.amount,
            row.source,
          ]);

          if (result.rows[0].inserted) {
            summary.inserted += 1;
          } else {
            summary.updated += 1;
          }
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }

  return summary;
}

function printDryRunSummary(metadata, parsed) {
  console.log("Mode: DRY RUN");
  console.log(`Detected encoding: ${metadata.encoding} (replacements=${metadata.replacements})`);
  console.log(
    JSON.stringify(
      {
        rows_read: parsed.totalRecords,
        rows_parsed: parsed.rows.length,
        rows_skipped: parsed.skipped.length,
        skipped_by_reason: buildSkipCounts(parsed.skipped),
      },
      null,
      2,
    ),
  );
}

function printCommitSummary(metadata, summary) {
  console.log("Mode: COMMIT");
  console.log(`Detected encoding: ${metadata.encoding} (replacements=${metadata.replacements})`);
  console.log(JSON.stringify(summary, null, 2));
}

async function runImport(options) {
  if (!options.file) {
    throw new Error("Missing --file");
  }
  if (!fs.existsSync(options.file)) {
    throw new Error(`File not found: ${options.file}`);
  }

  const buffer = fs.readFileSync(options.file);
  const decoded = decodeBest(buffer);
  const parsed = parseSalesRows(decoded.text, { limit: options.limit });

  if (options.dryRun) {
    printDryRunSummary(decoded, parsed);
    return { mode: "dry-run", parsed };
  }

  if (!options.dbUrl) {
    throw new Error("Missing database URL. Use --db-url or set DATABASE_URL");
  }

  const summary = await importSalesRows(parsed, options);
  printCommitSummary(decoded, summary);
  return { mode: "commit", summary };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  await runImport(args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Sales import failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseCliArgs,
  parseSalesRows,
  runImport,
};
