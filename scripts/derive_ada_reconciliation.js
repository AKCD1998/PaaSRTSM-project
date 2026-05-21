#!/usr/bin/env node
"use strict";

const { Pool } = require("pg");
const { dbConfigFromUrl } = require("./lib/db_config");

async function run() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool(dbConfigFromUrl(databaseUrl));
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
        SELECT stage, affected_rows
        FROM reconciliation.refresh_transfer_derivations()
      `,
    );
    await client.query("COMMIT");

    console.log("Ada transfer reconciliation derivation completed.");
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
  console.error(`Ada transfer reconciliation derivation failed: ${error.message}`);
  process.exit(1);
});
