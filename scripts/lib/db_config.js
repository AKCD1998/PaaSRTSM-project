"use strict";

function dbConfigFromUrl(dbUrl) {
  const sslMode = String(process.env.PGSSLMODE || "").toLowerCase();
  if (String(dbUrl || "").includes("sslmode=require") || sslMode === "require") {
    return {
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    };
  }
  return {
    connectionString: dbUrl,
  };
}

module.exports = {
  dbConfigFromUrl,
};
