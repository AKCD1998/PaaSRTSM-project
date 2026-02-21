#!/usr/bin/env node
"use strict";

const { Client } = require("pg");
const { dbConfigFromUrl } = require("./lib/db_config");
const {
  resolveEmbeddingSettings,
  createEmbeddingProvider,
} = require("../apps/admin-api/src/embeddings/provider");
const { indexSkuEmbeddings } = require("../apps/admin-api/src/services/sku-embedding-indexer");

function usage() {
  return [
    "Usage:",
    "  node scripts/backfill_sku_embeddings.js [--dry-run] [--execute] [--limit N] [--batch-size N] [--rate-limit-ms N] [--provider openai|local|mock] [--model <name>] [--dim N] [--db-url <postgresUrl>]",
    "",
    "Safety defaults:",
    "  - Dry-run is default (no writes).",
    "  - Use --execute to write/upsert embeddings.",
    "",
    "Options:",
    "  --dry-run                 Plan only (default)",
    "  --execute                 Write embeddings via UPSERT",
    "  --limit <N>               Max SKUs to process",
    "  --batch-size <N>          Batch size (default 100, max 500)",
    "  --rate-limit-ms <N>       Delay between requests to embedding provider",
    "  --provider <name>         EMBEDDING_PROVIDER override (openai|local|mock)",
    "  --model <name>            EMBEDDING_MODEL override",
    "  --dim <N>                 EMBEDDING_DIM override",
    "  --db-url <url>            PostgreSQL URL (or set DATABASE_URL)",
    "  --help                    Show help",
  ].join("\n");
}

function parsePositiveInt(value, fieldName) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return n;
}

function parseCliArgs(argv) {
  const args = {
    execute: false,
    dryRun: true,
    limit: null,
    batchSize: 100,
    rateLimitMs: 0,
    provider: "",
    model: "",
    dim: null,
    dbUrl: process.env.DATABASE_URL || "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      args.dryRun = true;
      args.execute = false;
    } else if (token === "--execute") {
      args.execute = true;
      args.dryRun = false;
    } else if (token === "--limit") {
      args.limit = parsePositiveInt(argv[++i], "--limit");
    } else if (token === "--batch-size") {
      args.batchSize = parsePositiveInt(argv[++i], "--batch-size");
    } else if (token === "--rate-limit-ms") {
      args.rateLimitMs = parsePositiveInt(argv[++i], "--rate-limit-ms");
    } else if (token === "--provider") {
      args.provider = String(argv[++i] || "").trim();
    } else if (token === "--model") {
      args.model = String(argv[++i] || "").trim();
    } else if (token === "--dim") {
      args.dim = parsePositiveInt(argv[++i], "--dim");
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

function printSummary(summary, provider) {
  console.log(`Mode: ${summary.mode.toUpperCase()}`);
  console.log(`Provider: ${provider.name}`);
  console.log(`Model: ${provider.model}`);
  console.log(`Dimension: ${provider.dimension}`);
  console.log(`Processed: ${summary.processed}`);
  console.log(`Planned: ${summary.planned}`);
  console.log(`Inserted: ${summary.inserted}`);
  console.log(`Updated: ${summary.updated}`);
  console.log(`Unchanged: ${summary.unchanged}`);
  console.log(`Skipped: ${summary.skipped}`);
  console.log(`Errors: ${summary.errors}`);
  console.log(`Batches: ${summary.batches}`);
  if (summary.last_sku_id != null) {
    console.log(`Last SKU ID: ${summary.last_sku_id}`);
  }
}

async function runBackfill(options) {
  if (!options.dbUrl) {
    throw new Error("Missing database URL. Use --db-url or set DATABASE_URL");
  }

  const settings = resolveEmbeddingSettings({
    embeddingProvider: options.provider || process.env.EMBEDDING_PROVIDER,
    embeddingModel: options.model || process.env.EMBEDDING_MODEL,
    embeddingDimension: options.dim != null ? options.dim : process.env.EMBEDDING_DIM,
    embeddingTimeoutMs: process.env.EMBEDDING_TIMEOUT_MS,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    localEmbeddingUrl: process.env.EMBEDDING_LOCAL_URL,
  });
  const provider = createEmbeddingProvider(settings);

  const client = new Client(dbConfigFromUrl(options.dbUrl));
  await client.connect();
  try {
    const summary = await indexSkuEmbeddings(client, provider, {
      execute: options.execute,
      onlyStale: false,
      limit: options.limit,
      batchSize: options.batchSize,
      rateLimitMs: options.rateLimitMs,
      logger: (message) => console.log(message),
    });
    printSummary(summary, provider);
    return summary;
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
  await runBackfill(args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Backfill failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseCliArgs,
  runBackfill,
};
