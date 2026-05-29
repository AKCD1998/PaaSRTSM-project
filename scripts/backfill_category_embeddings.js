#!/usr/bin/env node
"use strict";

/**
 * One-shot backfill: generate name-only embeddings for all products
 * in ada.branch_stock_snapshots and write to ada.product_category_embeddings.
 *
 * Usage:
 *   node scripts/backfill_category_embeddings.js
 *   node scripts/backfill_category_embeddings.js --force      # re-embed even if hash unchanged
 *   node scripts/backfill_category_embeddings.js --dry-run    # count only, no API calls
 *
 * Reads DATABASE_URL and OPENAI_API_KEY from environment / apps/admin-api/.env.
 */

const path = require("node:path");
const fs   = require("node:fs");

// Load .env from apps/admin-api/.env if not already set
const envPath = path.resolve(__dirname, "../apps/admin-api/.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { loadConfig }                = require("../apps/admin-api/src/config");
const { createDbPool }              = require("../apps/admin-api/src/db");
const { upsertCategoryEmbeddings }  = require("../apps/admin-api/src/categorization/embed");

const force  = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const config = loadConfig(process.env);
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error("ERROR: OPENAI_API_KEY is not set.");
    process.exit(1);
  }

  const db = createDbPool(config);

  try {
    // Fetch all products with names from ada.branch_stock_snapshots
    console.log("Fetching product list...");
    const { rows: products } = await db.query(`
      SELECT DISTINCT ON (bs.product_code)
        bs.product_code,
        COALESCE(bs.product_name_thai, s.display_name, p.product_code) AS product_name_thai,
        bs.product_name_eng
      FROM ada.branch_stock_snapshots bs
      LEFT JOIN public.skus s ON s.company_code = bs.product_code
      LEFT JOIN ada.products p ON p.product_code = bs.product_code
      ORDER BY bs.product_code
    `);

    console.log(`Found ${products.length} products.`);

    if (dryRun) {
      console.log("Dry-run mode — no API calls made.");
      process.exit(0);
    }

    console.log(`Embedding with text-embedding-3-small (batches of 20)...`);
    const { embedded, skipped } = await upsertCategoryEmbeddings(db, apiKey, products, { force });

    console.log(`Done. Embedded: ${embedded}, skipped (unchanged): ${skipped}`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
