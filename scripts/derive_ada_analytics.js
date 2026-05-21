#!/usr/bin/env node
"use strict";

const { Pool } = require("pg");
const { dbConfigFromUrl } = require("./lib/db_config");

function parsePeriodDays(argv) {
  const arg = argv.find((value) => value.startsWith("--period-days="));
  if (!arg) {
    return 30;
  }

  const value = Number(arg.slice("--period-days=".length));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("--period-days must be a positive integer");
  }
  return value;
}

async function run() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const periodDays = parsePeriodDays(process.argv.slice(2));
  const pool = new Pool(dbConfigFromUrl(databaseUrl));
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
        SELECT stage, affected_rows
        FROM ada.refresh_analytics($1)
      `,
      [periodDays],
    );
    await client.query("COMMIT");

    console.log(`Ada analytics derivation completed for periodDays=${periodDays}.`);
    for (const row of result.rows) {
      console.log(`${row.stage}: ${row.affected_rows}`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(`Ada analytics derivation failed: ${error.message}`);
  process.exit(1);
});
