"use strict";

const fs = require("fs/promises");
const path = require("path");
const { Pool } = require("pg");

function createPool(databaseUrl) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const sslMode = String(process.env.PGSSLMODE || "").toLowerCase();
  const useSsl = databaseUrl.includes("sslmode=require") || sslMode === "require";

  return new Pool(
    useSsl
      ? {
          connectionString: databaseUrl,
          ssl: { rejectUnauthorized: false },
        }
      : {
          connectionString: databaseUrl,
        },
  );
}

async function loadSqlFiles(rootDir) {
  const files = [path.join(rootDir, "001_inventory_schema.sql")];
  const migrationsDir = path.join(rootDir, "migrations");
  const migrationFiles = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => path.join(migrationsDir, file));

  return [...files, ...migrationFiles];
}

async function run() {
  const rootDir = path.resolve(__dirname, "..");
  const databaseUrl = process.env.DATABASE_URL || "";
  const pool = createPool(databaseUrl);

  try {
    const sqlFiles = await loadSqlFiles(rootDir);
    for (const file of sqlFiles) {
      const sql = await fs.readFile(file, "utf8");
      const relativePath = path.relative(rootDir, file);
      console.log(`Applying ${relativePath}`);
      await pool.query(sql);
    }
    console.log("Database migrations completed.");
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(`Database migration failed: ${error.message}`);
  process.exit(1);
});
