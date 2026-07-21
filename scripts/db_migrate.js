"use strict";

const fs = require("fs/promises");
const path = require("path");
const { Pool } = require("pg");

function parseEnvFile(contents) {
  const env = {};
  const lines = String(contents || "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (
      value.length >= 2
      && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

async function loadEnvFallback(rootDir) {
  const shellDatabaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (shellDatabaseUrl) {
    return;
  }

  const envPath = path.join(rootDir, "apps", "admin-api", ".env");
  let contents = "";
  try {
    contents = await fs.readFile(envPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  const envVars = parseEnvFile(contents);
  for (const [key, value] of Object.entries(envVars)) {
    if (!process.env[key] || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

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

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarQuoteTag = null;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      current += char;
      if (char === "\n") {
        lineComment = false;
      }
      i += 1;
      continue;
    }

    if (blockCommentDepth > 0) {
      if (char === "*" && next === "/") {
        current += char + next;
        i += 2;
        blockCommentDepth -= 1;
        continue;
      }
      if (char === "/" && next === "*") {
        current += char + next;
        i += 2;
        blockCommentDepth += 1;
        continue;
      }
      current += char;
      i += 1;
      continue;
    }

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, i)) {
        current += dollarQuoteTag;
        i += dollarQuoteTag.length;
        dollarQuoteTag = null;
        continue;
      }
      current += char;
      i += 1;
      continue;
    }

    if (inSingleQuote) {
      current += char;
      if (char === "'" && next === "'") {
        current += next;
        i += 2;
        continue;
      }
      if (char === "'") {
        inSingleQuote = false;
      }
      i += 1;
      continue;
    }

    if (inDoubleQuote) {
      current += char;
      if (char === "\"") {
        inDoubleQuote = false;
      }
      i += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      current += char + next;
      i += 2;
      lineComment = true;
      continue;
    }

    if (char === "/" && next === "*") {
      current += char + next;
      i += 2;
      blockCommentDepth = 1;
      continue;
    }

    if (char === "'") {
      current += char;
      inSingleQuote = true;
      i += 1;
      continue;
    }

    if (char === "\"") {
      current += char;
      inDoubleQuote = true;
      i += 1;
      continue;
    }

    if (char === "$") {
      const rest = sql.slice(i);
      const match = rest.match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarQuoteTag = match[0];
        current += dollarQuoteTag;
        i += dollarQuoteTag.length;
        continue;
      }
    }

    if (char === ";") {
      const statement = current.trim();
      if (statement) {
        statements.push(statement);
      }
      current = "";
      i += 1;
      continue;
    }

    current += char;
    i += 1;
  }

  const finalStatement = current.trim();
  if (finalStatement) {
    statements.push(finalStatement);
  }

  return statements;
}

// schema_migrations is shared across machines: Render applies migrations on
// Linux, developers apply them from Windows. `path.relative` returns the host
// separator, so keying on it directly means a Windows run never matches the
// rows Render wrote — and every migration gets re-applied. Observed 2026-07-21,
// when 051-060 silently re-ran against production. Always key on '/'.
function migrationKey(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

// Repairs rows written by an earlier Windows run. Backslash duplicates of an
// already-canonical row are dropped first, otherwise rewriting them would
// collide with the primary key.
async function normalizeMigrationKeys(client) {
  await client.query(`
    DELETE FROM public.schema_migrations bad
    WHERE strpos(bad.filename, '\\') > 0
      AND EXISTS (
        SELECT 1 FROM public.schema_migrations good
        WHERE good.filename = replace(bad.filename, '\\', '/')
      )
  `);
  const result = await client.query(`
    UPDATE public.schema_migrations
    SET filename = replace(filename, '\\', '/')
    WHERE strpos(filename, '\\') > 0
  `);
  if (result.rowCount > 0) {
    console.log(`Normalised ${result.rowCount} migration key(s) to forward slashes.`);
  }
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query("SELECT filename FROM public.schema_migrations");
  return new Set(result.rows.map((row) => row.filename));
}

async function recordMigration(client, filename) {
  await client.query(
    "INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
    [filename],
  );
}

// Migrations that existed before schema_migrations tracking was introduced.
// Seeding them prevents re-running ALTER TABLE / CREATE INDEX on a live database.
const LEGACY_MIGRATIONS = [
  "001_inventory_schema.sql",
  "migrations/002_add_sku_price_tiers.sql",
  "migrations/003_add_product_fields.sql",
  "migrations/004_add_enrichment_workflow.sql",
  "migrations/005_add_sales_daily.sql",
  "migrations/010_add_audit_logs.sql",
  "migrations/011_add_sku_unit_prices.sql",
  "migrations/012_add_sku_embeddings.sql",
  "migrations/013_add_embedding_sync_jobs.sql",
  "migrations/014_add_shared_ordering_and_sync.sql",
  "migrations/015_add_ada_raw_ingestion.sql",
  "migrations/016_add_ada_foundation_derivations.sql",
  "migrations/017_add_ada_analytics_derivations.sql",
  "migrations/018_add_ada_standard_analytics_windows.sql",
  "migrations/019_add_transfer_reconciliation_foundation.sql",
  "migrations/020_add_admin_receipt_staging.sql",
  "migrations/020_add_product_category_states.sql",
  "migrations/021_seed_core_branches_from_ada.sql",
  "migrations/022_add_ada_branch_stock_snapshots.sql",
  "migrations/023_add_ada_branch_stock_uploads.sql",
  "migrations/024_add_branch_sync_log.sql",
  "migrations/025_add_product_category_embeddings.sql",
  "migrations/026_finalize_knee_joint_category_normalization.sql",
  "migrations/027_rename_shelf6_to_shelf9_categories.sql",
  "migrations/028_add_member_profile_fields.sql",
  "migrations/029_add_product_movement_groups.sql",
  "migrations/030_add_supplier_logos.sql",
  "migrations/031_add_ingredient_knowledge_layer.sql",
  "migrations/032_add_branch_stock_cost_columns.sql",
  "migrations/033_add_stock_request_workflow.sql",
  "migrations/034_add_stock_request_fulfillment.sql",
  "migrations/035_allow_branch_audit_role.sql",
  "migrations/036_expand_stock_request_response_documents.sql",
  "migrations/037_add_stock_request_mode.sql",
];

async function seedLegacyMigrations(client) {
  if (LEGACY_MIGRATIONS.length === 0) return;
  const values = LEGACY_MIGRATIONS.map((_, i) => `($${i + 1})`).join(", ");
  await client.query(
    `INSERT INTO public.schema_migrations (filename) VALUES ${values} ON CONFLICT DO NOTHING`,
    LEGACY_MIGRATIONS,
  );
  console.log(`Seeded ${LEGACY_MIGRATIONS.length} legacy migration(s) into schema_migrations.`);
}

async function applySqlFile(client, filePath, rootDir) {
  const sql = await fs.readFile(filePath, "utf8");
  const relativePath = migrationKey(rootDir, filePath);
  const statements = splitSqlStatements(sql).filter((statement) => {
    const normalized = statement.replace(/\s+/g, " ").trim().toUpperCase();
    return normalized !== "BEGIN" && normalized !== "COMMIT";
  });

  console.log(`Applying ${relativePath}`);

  await client.query("BEGIN");
  try {
    for (const statement of statements) {
      await client.query(statement);
    }
    await recordMigration(client, relativePath);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`${relativePath}: ${error.message}`);
  }
}

async function run() {
  const rootDir = path.resolve(__dirname, "..");
  await loadEnvFallback(rootDir);
  const databaseUrl = process.env.DATABASE_URL || "";
  const pool = createPool(databaseUrl);
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    await normalizeMigrationKeys(client);
    await seedLegacyMigrations(client);
    const applied = await getAppliedMigrations(client);
    const sqlFiles = await loadSqlFiles(rootDir);

    let skipped = 0;
    for (const file of sqlFiles) {
      const relativePath = migrationKey(rootDir, file);
      if (applied.has(relativePath)) {
        skipped += 1;
        continue;
      }
      await applySqlFile(client, file, rootDir);
    }

    if (skipped > 0) {
      console.log(`Skipped ${skipped} already-applied migration(s).`);
    }
    console.log("Database migrations completed.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(`Database migration failed: ${error.message}`);
  process.exit(1);
});
