#!/usr/bin/env node
"use strict";

const { Client } = require("pg");

function usage() {
  return [
    "Usage:",
    "  node scripts/enrichment_report_top_sellers.js [--top N] [--since YYYY-MM-DD] --db-url <postgresUrl>",
    "",
    "Output:",
    "  Top N selling SKUs with enrichment_status != 'verified' and missing drug facts.",
  ].join("\n");
}

function parseCliArgs(argv) {
  const args = {
    top: 200,
    since: "",
    dbUrl: process.env.DATABASE_URL || "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--top") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--top must be a positive integer");
      }
      args.top = value;
    } else if (token === "--since") {
      const value = String(argv[++i] || "").trim();
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error("--since must be in YYYY-MM-DD format");
      }
      args.since = value;
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
  return String(value == null ? "" : value).trim();
}

function missingDrugFacts(row) {
  const missing = [];
  if (!normalizeText(row.generic_name)) {
    missing.push("generic_name");
  }
  if (!normalizeText(row.strength_text)) {
    missing.push("strength_text");
  }
  if (!normalizeText(row.form)) {
    missing.push("form");
  }
  if (!normalizeText(row.route)) {
    missing.push("route");
  }
  return missing;
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

async function fetchTopSellers(client, options) {
  const params = [options.since || null, options.top];
  const query = `
    WITH sales AS (
      SELECT
        company_code,
        SUM(qty) AS total_qty,
        SUM(amount) AS total_amount
      FROM public.sales_daily
      WHERE ($1::date IS NULL OR sale_date >= $1::date)
      GROUP BY company_code
    )
    SELECT
      s.sku_id,
      s.company_code,
      s.display_name,
      s.category_name,
      COALESCE(s.enrichment_status, 'missing') AS enrichment_status,
      s.generic_name,
      s.strength_text,
      s.form,
      s.route,
      sales.total_qty,
      sales.total_amount
    FROM sales
    JOIN public.skus s
      ON s.company_code = sales.company_code
    WHERE COALESCE(s.enrichment_status, 'missing') <> 'verified'
    ORDER BY sales.total_qty DESC, sales.total_amount DESC, s.sku_id ASC
    LIMIT $2
  `;
  const result = await client.query(query, params);
  return result.rows;
}

function printReport(rows, options) {
  console.log("Top Seller Enrichment Report");
  console.log(`Since: ${options.since || "all time"}`);
  console.log(`Rows: ${rows.length}`);
  if (rows.length === 0) {
    console.log("No non-verified SKUs found in sales window.");
    return;
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const missing = missingDrugFacts(row);
    console.log(
      `${i + 1}. sku_id=${row.sku_id} company_code=${row.company_code} qty=${row.total_qty} amount=${row.total_amount} status=${row.enrichment_status}`,
    );
    console.log(
      `   name=${normalizeText(row.display_name)} | category=${normalizeText(row.category_name)} | missing=${missing.join(",") || "-"}`,
    );
  }
}

async function runReport(options) {
  if (!options.dbUrl) {
    throw new Error("Missing database URL. Use --db-url or set DATABASE_URL");
  }

  const client = new Client(dbConfigFromUrl(options.dbUrl));
  await client.connect();
  try {
    const rows = await fetchTopSellers(client, options);
    printReport(rows, options);
    return rows;
  } catch (error) {
    if (error.code === "42P01") {
      throw new Error("sales_daily table not found. Run migrations/005_add_sales_daily.sql first.");
    }
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  await runReport(args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Top seller report failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseCliArgs,
  missingDrugFacts,
  runReport,
};
