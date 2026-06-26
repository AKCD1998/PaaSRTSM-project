#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const {
  commitBackfill,
  parsePositiveInt,
  previewBackfill,
} = require("../apps/admin-api/src/taxonomy/backfill");

function parseEnvFile(contents) {
  const env = {};
  for (const rawLine of String(contents || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadEnvFallback(rootDir) {
  if (process.env.DATABASE_URL) {
    return;
  }

  const envPath = path.join(rootDir, "apps", "admin-api", ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const env = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(env)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function dbConfigFromUrl(dbUrl) {
  const sslMode = String(process.env.PGSSLMODE || "").toLowerCase();
  if (dbUrl.includes("sslmode=require") || sslMode === "require" || dbUrl.includes("render.com")) {
    return {
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    };
  }
  return { connectionString: dbUrl };
}

function parseCliArgs(argv) {
  const args = {
    commit: false,
    limit: null,
    dbUrl: process.env.DATABASE_URL || "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--commit") {
      args.commit = true;
    } else if (token === "--limit") {
      args.limit = parsePositiveInt(argv[i + 1], null, 100000);
      i += 1;
      if (args.limit == null) {
        throw new Error("limit must be a positive integer");
      }
    } else if (token === "--db-url") {
      args.dbUrl = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function printLines(lines) {
  console.log(lines.join("\n"));
}

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  loadEnvFallback(rootDir);

  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log("node scripts/backfill_sku_product_type.js [--commit] [--limit N] [--db-url URL]");
    return;
  }
  if (!args.dbUrl) {
    throw new Error("Missing database URL. Use --db-url or set DATABASE_URL");
  }

  const client = new Client(dbConfigFromUrl(args.dbUrl));
  await client.connect();

  try {
    if (!args.commit) {
      const preview = await previewBackfill(client, { limit: args.limit });
      printLines(preview.lines);
      return;
    }

    await client.query("BEGIN");
    try {
      const result = await commitBackfill(client, { limit: args.limit });
      await client.query("COMMIT");
      printLines(result.lines.concat([`Applied updates: ${result.updated}`]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Product type backfill failed: ${error.message}`);
    process.exitCode = 1;
  });
}

