"use strict";

const { Pool } = require("pg");
const { loadConfig } = require("../apps/admin-api/src/config");
const { pruneHourlyEvidence } = require("../apps/admin-api/src/services/hourlyEvidenceRetention");

async function main() {
  const config = loadConfig(process.env);
  if (!config.featureHourlyStockEvidenceRetention) return console.log(JSON.stringify({ status: "disabled" }));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  let client;
  try {
    client = await pool.connect();
    console.log(JSON.stringify(await pruneHourlyEvidence(client, {
      enabled: true, retentionDays: config.hourlyStockEvidenceRetentionDays,
      execute: process.argv.includes("--execute"),
    })));
  } finally { client?.release(); await pool.end(); }
}
if (require.main === module) main().catch(() => { console.error("Hourly evidence retention failed; details withheld."); process.exitCode = 1; });
module.exports = { main };
