"use strict";

const { Pool } = require("pg");

function createDbPool(config) {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const sslMode = String(process.env.PGSSLMODE || "").toLowerCase();
  const useSsl = config.databaseUrl.includes("sslmode=require") || sslMode === "require";

  return new Pool(
    useSsl
      ? {
          connectionString: config.databaseUrl,
          ssl: { rejectUnauthorized: false },
        }
      : {
          connectionString: config.databaseUrl,
        },
  );
}

module.exports = {
  createDbPool,
};
