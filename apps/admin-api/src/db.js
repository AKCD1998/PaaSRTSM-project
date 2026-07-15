"use strict";

const { Pool } = require("pg");

function createDbPool(config) {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const sslMode = String(process.env.PGSSLMODE || "").toLowerCase();
  const useSsl = config.databaseUrl.includes("sslmode=require") || sslMode === "require";

  // statement_timeout/idle_in_transaction_session_timeout exist because a
  // client giving up (browser 499) does not stop Postgres from finishing
  // the query — abandoned queries piled up for 25-45min each during the
  // 2026-07-15 outage and starved the whole pool. 300s clears zombies
  // without killing real work: the slowest legitimate query observed in
  // pg_stat_statements maxes at ~298s.
  return new Pool({
    connectionString: config.databaseUrl,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    max: 10,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 300_000,
    idle_in_transaction_session_timeout: 60_000,
  });
}

module.exports = {
  createDbPool,
};
