#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const PRODUCT_CODE = "IC-005863";
const SOURCE = "seed_manual_test";

function usage() {
  return [
    "Usage:",
    "  node scripts/seed_ingredient_knowledge_test_data.js [--dry-run] [--commit] [--db-url <postgresUrl>]",
    "",
    "Seeds development/test Ingredient Knowledge Layer data for LODOS-like verification.",
    "Default mode is --dry-run. Use --commit to write.",
  ].join("\n");
}

function parseCliArgs(argv) {
  const args = {
    dryRun: true,
    commit: false,
    dbUrl: process.env.DATABASE_URL || "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      args.dryRun = true;
      args.commit = false;
    } else if (token === "--commit") {
      args.commit = true;
      args.dryRun = false;
    } else if (token === "--db-url") {
      args.dbUrl = argv[++i] || "";
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function parseEnvFile(contents) {
  const env = {};
  for (const rawLine of String(contents || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadEnvFallback(rootDir) {
  if (process.env.DATABASE_URL) return;
  const envPath = path.join(rootDir, "apps", "admin-api", ".env");
  if (!fs.existsSync(envPath)) return;
  const env = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(env)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

function dbConfigFromUrl(dbUrl) {
  const sslMode = String(process.env.PGSSLMODE || "").toLowerCase();
  if (dbUrl.includes("sslmode=require") || sslMode === "require") {
    return {
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    };
  }
  return { connectionString: dbUrl };
}

function normalizeCategory(value) {
  return String(value || "").trim().toLowerCase();
}

function scoreCategory(categoryName, keywords) {
  const normalized = normalizeCategory(categoryName);
  let score = 0;
  for (const keyword of keywords) {
    if (normalized.includes(keyword.toLowerCase())) score += 1;
  }
  return score;
}

function pickBestCategory(categories, keywords) {
  return categories
    .map((categoryName) => ({ categoryName, score: scoreCategory(categoryName, keywords) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.categoryName.localeCompare(b.categoryName, "th"))[0]?.categoryName || null;
}

async function loadConfirmedCategories(client) {
  const result = await client.query(
    `
      SELECT DISTINCT category_name
      FROM ada.product_category_states
      WHERE review_status IN ('confirmed', 'imported_exact_match')
        AND category_name IS NOT NULL
        AND BTRIM(category_name) <> ''
      ORDER BY category_name
    `,
  );
  return result.rows.map((row) => row.category_name);
}

async function upsertIngredient(client, { canonicalName, displayName }) {
  const result = await client.query(
    `
      INSERT INTO knowledge.ingredients (canonical_name, display_name, status, updated_at)
      VALUES ($1, $2, 'active', now())
      ON CONFLICT (canonical_name) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        status = 'active',
        updated_at = now()
      RETURNING ingredient_id
    `,
    [canonicalName, displayName],
  );
  return Number(result.rows[0].ingredient_id);
}

async function insertSynonymIfMissing(client, { ingredientId, synonymText, language = "en", source = SOURCE }) {
  const result = await client.query(
    `
      INSERT INTO knowledge.ingredient_synonyms
        (ingredient_id, synonym_text, language, source, status, updated_at)
      SELECT $1, $2, $3, $4, 'active', now()
      WHERE NOT EXISTS (
        SELECT 1
        FROM knowledge.ingredient_synonyms
        WHERE LOWER(BTRIM(synonym_text)) = LOWER(BTRIM($2))
      )
      RETURNING synonym_id
    `,
    [ingredientId, synonymText, language, source],
  );
  return result.rowCount > 0;
}

async function upsertDrugClass(client, name) {
  const result = await client.query(
    `
      INSERT INTO knowledge.drug_classes (name, status, updated_at)
      VALUES ($1, 'active', now())
      ON CONFLICT (name) DO UPDATE SET
        status = 'active',
        updated_at = now()
      RETURNING drug_class_id
    `,
    [name],
  );
  return Number(result.rows[0].drug_class_id);
}

async function upsertIndication(client, name) {
  const result = await client.query(
    `
      INSERT INTO knowledge.indications (name, status, updated_at)
      VALUES ($1, 'active', now())
      ON CONFLICT (name) DO UPDATE SET
        status = 'active',
        updated_at = now()
      RETURNING indication_id
    `,
    [name],
  );
  return Number(result.rows[0].indication_id);
}

async function upsertIngredientDrugClass(client, { ingredientId, drugClassId }) {
  await client.query(
    `
      INSERT INTO knowledge.ingredient_drug_classes
        (ingredient_id, drug_class_id, confidence, source, status, confirmed_by, confirmed_at, updated_at)
      VALUES ($1, $2, 1, $3, 'confirmed', $3, now(), now())
      ON CONFLICT (ingredient_id, drug_class_id) DO UPDATE SET
        confidence = EXCLUDED.confidence,
        source = EXCLUDED.source,
        status = 'confirmed',
        confirmed_by = EXCLUDED.confirmed_by,
        confirmed_at = COALESCE(knowledge.ingredient_drug_classes.confirmed_at, EXCLUDED.confirmed_at),
        updated_at = now()
    `,
    [ingredientId, drugClassId, SOURCE],
  );
}

async function upsertIngredientIndication(client, { ingredientId, indicationId }) {
  await client.query(
    `
      INSERT INTO knowledge.ingredient_indications
        (ingredient_id, indication_id, source, status, confirmed_by, confirmed_at, updated_at)
      VALUES ($1, $2, $3, 'confirmed', $3, now(), now())
      ON CONFLICT (ingredient_id, indication_id) DO UPDATE SET
        source = EXCLUDED.source,
        status = 'confirmed',
        confirmed_by = EXCLUDED.confirmed_by,
        confirmed_at = COALESCE(knowledge.ingredient_indications.confirmed_at, EXCLUDED.confirmed_at),
        updated_at = now()
    `,
    [ingredientId, indicationId, SOURCE],
  );
}

async function upsertProductIngredient(client, { ingredientId, strengthValue, strengthUnit, rawText }) {
  await client.query(
    `
      INSERT INTO knowledge.product_ingredients
        (product_code, ingredient_id, strength_value, strength_unit, raw_text, source, status, confidence, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'proposed', 1, now())
      ON CONFLICT (product_code, ingredient_id) DO UPDATE SET
        strength_value = EXCLUDED.strength_value,
        strength_unit = EXCLUDED.strength_unit,
        raw_text = EXCLUDED.raw_text,
        source = EXCLUDED.source,
        status = CASE
          WHEN knowledge.product_ingredients.status = 'confirmed' THEN knowledge.product_ingredients.status
          ELSE 'proposed'
        END,
        confidence = EXCLUDED.confidence,
        updated_at = now()
    `,
    [PRODUCT_CODE, ingredientId, strengthValue, strengthUnit, rawText, SOURCE],
  );
}

async function insertCategoryRuleIfMissing(client, { ingredientId = null, drugClassId = null, categoryName, priority, note }) {
  if (!categoryName) return false;
  const result = await client.query(
    `
      INSERT INTO knowledge.ingredient_category_rules
        (ingredient_id, drug_class_id, indication_id, category_name, priority, rule_status, note, created_by, updated_at)
      SELECT $1, $2, NULL, $3, $4, 'active', $5, $6, now()
      WHERE NOT EXISTS (
        SELECT 1
        FROM knowledge.ingredient_category_rules
        WHERE COALESCE(ingredient_id, -1) = COALESCE($1::bigint, -1)
          AND COALESCE(drug_class_id, -1) = COALESCE($2::bigint, -1)
          AND indication_id IS NULL
          AND category_name = $3
          AND created_by = $6
      )
      RETURNING rule_id
    `,
    [ingredientId, drugClassId, categoryName, priority, note, SOURCE],
  );
  return result.rowCount > 0;
}

async function seed(client, options = {}) {
  const categories = await loadConfirmedCategories(client);
  const cardiovascularCategory = pickBestCategory(categories, [
    "ความดัน",
    "หัวใจ",
    "หลอดเลือด",
    "cardio",
    "hypertension",
    "antihypertensive",
  ]);
  const diureticCategory = pickBestCategory(categories, [
    "ขับปัสสาวะ",
    "บวมน้ำ",
    "diuretic",
    "edema",
  ]);

  const plan = {
    mode: options.commit ? "commit" : "dry-run",
    productCode: PRODUCT_CODE,
    confirmedCategoriesScanned: categories.length,
    selectedCategories: {
      cardiovascularCategory,
      diureticCategory,
    },
    categoryRulesSkipped: [],
    normalizedDuplicateSynonymsSkipped: [],
  };

  if (!options.commit) {
    if (!cardiovascularCategory) {
      plan.categoryRulesSkipped.push("No confirmed/imported cardiovascular or antihypertensive category found.");
    }
    if (!diureticCategory && !cardiovascularCategory) {
      plan.categoryRulesSkipped.push("No confirmed/imported diuretic or fallback cardiovascular category found.");
    }
    return plan;
  }

  await client.query("BEGIN");
  try {
    const bisoprololId = await upsertIngredient(client, {
      canonicalName: "bisoprolol",
      displayName: "Bisoprolol",
    });
    const hydrochlorothiazideId = await upsertIngredient(client, {
      canonicalName: "hydrochlorothiazide",
      displayName: "Hydrochlorothiazide",
    });

    for (const synonymText of ["bisoprolol", "bisoprolol fumarate", "BISOPROLOL FUMARATE"]) {
      const inserted = await insertSynonymIfMissing(client, { ingredientId: bisoprololId, synonymText });
      if (!inserted) plan.normalizedDuplicateSynonymsSkipped.push(synonymText);
    }
    for (const synonymText of ["hydrochlorothiazide", "HCTZ", "HYDROCHLOROTHIAZIDE", "HYDROCHLOROTHAIAZIDE"]) {
      const inserted = await insertSynonymIfMissing(client, { ingredientId: hydrochlorothiazideId, synonymText });
      if (!inserted) plan.normalizedDuplicateSynonymsSkipped.push(synonymText);
    }

    const betaBlockerId = await upsertDrugClass(client, "Beta blocker");
    const thiazideDiureticId = await upsertDrugClass(client, "Thiazide diuretic");
    const hypertensionId = await upsertIndication(client, "Hypertension");
    const cardiovascularId = await upsertIndication(client, "Cardiovascular");
    const edemaId = await upsertIndication(client, "Edema");

    await upsertIngredientDrugClass(client, { ingredientId: bisoprololId, drugClassId: betaBlockerId });
    await upsertIngredientDrugClass(client, { ingredientId: hydrochlorothiazideId, drugClassId: thiazideDiureticId });

    await upsertIngredientIndication(client, { ingredientId: bisoprololId, indicationId: hypertensionId });
    await upsertIngredientIndication(client, { ingredientId: bisoprololId, indicationId: cardiovascularId });
    await upsertIngredientIndication(client, { ingredientId: hydrochlorothiazideId, indicationId: hypertensionId });
    await upsertIngredientIndication(client, { ingredientId: hydrochlorothiazideId, indicationId: edemaId });

    await upsertProductIngredient(client, {
      ingredientId: bisoprololId,
      strengthValue: 2.5,
      strengthUnit: "mg",
      rawText: "BISOPROLOL FUMARATE 2.5 MG",
    });
    await upsertProductIngredient(client, {
      ingredientId: hydrochlorothiazideId,
      strengthValue: 6.25,
      strengthUnit: "mg",
      rawText: "HYDROCHLOROTHIAZIDE 6.25 MG",
    });

    if (cardiovascularCategory) {
      await insertCategoryRuleIfMissing(client, {
        ingredientId: bisoprololId,
        categoryName: cardiovascularCategory,
        priority: 10,
        note: "Seed test suggestion: Bisoprolol cardiovascular/antihypertensive category.",
      });
      await insertCategoryRuleIfMissing(client, {
        drugClassId: betaBlockerId,
        categoryName: cardiovascularCategory,
        priority: 20,
        note: "Seed test suggestion: Beta blocker cardiovascular/antihypertensive category.",
      });
    } else {
      plan.categoryRulesSkipped.push("Skipped Bisoprolol/Beta blocker category rules: no suitable existing category found.");
    }

    const hctzCategory = diureticCategory || cardiovascularCategory;
    if (hctzCategory) {
      await insertCategoryRuleIfMissing(client, {
        ingredientId: hydrochlorothiazideId,
        categoryName: hctzCategory,
        priority: 30,
        note: "Seed test suggestion: Hydrochlorothiazide category.",
      });
      await insertCategoryRuleIfMissing(client, {
        drugClassId: thiazideDiureticId,
        categoryName: hctzCategory,
        priority: 40,
        note: "Seed test suggestion: Thiazide diuretic category.",
      });
    } else {
      plan.categoryRulesSkipped.push("Skipped Hydrochlorothiazide/Thiazide diuretic category rules: no suitable existing category found.");
    }

    await client.query("COMMIT");
    return plan;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  loadEnvFallback(rootDir);
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.dbUrl) {
    throw new Error("Missing database URL. Use --db-url or set DATABASE_URL");
  }

  const client = new Client(dbConfigFromUrl(args.dbUrl));
  await client.connect();
  try {
    const result = await seed(client, args);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Ingredient knowledge seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseCliArgs,
  pickBestCategory,
  seed,
};
