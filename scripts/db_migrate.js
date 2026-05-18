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

async function applySqlFile(client, filePath, rootDir) {
  const sql = await fs.readFile(filePath, "utf8");
  const relativePath = path.relative(rootDir, filePath);
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
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`${relativePath}: ${error.message}`);
  }
}

async function run() {
  const rootDir = path.resolve(__dirname, "..");
  const databaseUrl = process.env.DATABASE_URL || "";
  const pool = createPool(databaseUrl);
  const client = await pool.connect();

  try {
    const sqlFiles = await loadSqlFiles(rootDir);
    for (const file of sqlFiles) {
      await applySqlFile(client, file, rootDir);
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
