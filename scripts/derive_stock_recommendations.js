"use strict";

const fs = require("fs");
const path = require("path");

const { loadConfig } = require("../apps/admin-api/src/config");
const { createDbPool } = require("../apps/admin-api/src/db");
const { refreshStockRecommendationSnapshots } = require("../apps/admin-api/src/services/stockRecommendations");

function loadLocalEnv() {
  const envPath = path.resolve(__dirname, "../apps/admin-api/.env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadLocalEnv();
  const config = loadConfig(process.env);
  const db = createDbPool(config);

  const targetDays = process.argv[2] ? Number(process.argv[2]) : 90;
  const branchCodes = process.argv[3]
    ? String(process.argv[3]).split(",").map((value) => value.trim()).filter(Boolean)
    : null;

  try {
    const result = await refreshStockRecommendationSnapshots(db, {
      targetDays,
      branchCodes,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          ...result,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("[derive_stock_recommendations] failed:", error.message);
  console.error(error.stack);
  process.exitCode = 1;
});
