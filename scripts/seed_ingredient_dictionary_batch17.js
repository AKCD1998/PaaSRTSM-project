#!/usr/bin/env node
"use strict";

/**
 * Ingredient Dictionary Seed — Batch 17 (ฟ้าทะลายโจร / Andrographis paniculata).
 *
 * Single ingredient family covering all Thai names, regional names, English
 * common names, scientific names, the active marker compound (andrographolide),
 * transliterations, and standardised-extract label forms that appear on
 * Thai pharmacy product labels.
 *
 * Canonical: "andrographis"
 * Drug class: "Herbal extract (Andrographis / Antiviral)"
 * Preferred shelf category: "ยาสมุนไพร"
 *
 * Thai synonyms (17):
 *   ฟ้าทะลายโจร, ฟ้าทะลาย, สมุนไพรฟ้าทะลายโจร, ยาฟ้าทะลายโจร,
 *   ฟ้าทะลายโจรสกัด, สารสกัดฟ้าทะลายโจร, สารสกัดใบฟ้าทะลายโจร,
 *   ฟ้าทะลายโจรผง, ฟ้าทะลายโจรเข้มข้น, ฟ้าทะลายโจรชนิดเข้มข้น,
 *   แอนโดรกราฟิส, แอนโดรกราฟิสแพนนิคูลาต้า, แอนโดรกราโฟไลด์,
 *   หญ้าเกียงกอง, น้ำลายพระอินทร์, ผักน้ำเมา,
 *   กัลปังหาเขียว
 *
 * English / scientific synonyms (22):
 *   andrographis, andrographis paniculata, andrographolide,
 *   andrographolide extract, andrographis extract,
 *   andrographis leaf extract, andrographis paniculata extract,
 *   andrographis paniculata leaf extract, andrographis herb extract,
 *   standardized andrographis extract, andrographis whole herb,
 *   king of bitters, green chiretta, creat, kalmegh,
 *   indian echinacea, hempedu bumi, bhui neem,
 *   andrographis 10% andrographolide, andrographis 30% andrographolide,
 *   andrographis paniculata wall nees, bitter herb
 *
 * Abbreviation/exclusion decisions:
 *   "ap"  — 2-char — EXCLUDED
 *   "andro" — 5-char but ambiguous — EXCLUDED (too generic)
 *
 * preferredCategory = "ยาสมุนไพร" — if not yet confirmed in product_category_states
 * the rule is skipped gracefully and logged as uncertainCategoryMappings.
 *
 * Default --dry-run; --commit persists.
 *   node scripts/seed_ingredient_dictionary_batch17.js [--dry-run|--commit] [--db-url <url>]
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const SOURCE = "seed_dictionary_batch_17";
const HERB_CATEGORY = "ยาสมุนไพร";

const MODELING_NOTES = [
  "Batch 17 = ฟ้าทะลายโจร (Andrographis paniculata) — single ingredient family, all Thai/English name variants.",
  "andrographolide seeded as synonym (not a separate ingredient) — it is the active marker compound of andrographis, always from the same plant.",
  "Thai regional names included: หญ้าเกียงกอง (northern), น้ำลายพระอินทร์, ผักน้ำเมา (Isan).",
  "Transliterations: แอนโดรกราฟิส / แอนโดรกราโฟไลด์ appear on bilingual supplement labels.",
  "Standardised-extract forms (10%/30% andrographolide) included as synonyms — the matcher strips dosage suffixes.",
  "Abbrev exclusions: 'ap' (2-char), 'andro' (5-char but too generic/ambiguous).",
  "preferredCategory 'ยาสมุนไพร' — gracefully skipped if not yet confirmed in product_category_states.",
];

const INGREDIENTS = [
  {
    canonical: "andrographis",
    display: "Andrographis (ฟ้าทะลายโจร)",
    drugClass: "Herbal extract (Andrographis / Antiviral)",
    indications: [
      "Common cold / upper respiratory tract infection",
      "Immunomodulation",
      "Anti-inflammatory (herbal)",
    ],
    preferredCategory: HERB_CATEGORY,
    synonyms: [
      // ── Thai main names ────────────────────────────────────────────────────
      "ฟ้าทะลายโจร",
      "ฟ้าทะลาย",
      "สมุนไพรฟ้าทะลายโจร",
      "ยาฟ้าทะลายโจร",
      // ── Thai extract / form descriptors ───────────────────────────────────
      "ฟ้าทะลายโจรสกัด",
      "สารสกัดฟ้าทะลายโจร",
      "สารสกัดใบฟ้าทะลายโจร",
      "ฟ้าทะลายโจรผง",
      "ฟ้าทะลายโจรเข้มข้น",
      "ฟ้าทะลายโจรชนิดเข้มข้น",
      // ── Thai transliterations ──────────────────────────────────────────────
      "แอนโดรกราฟิส",
      "แอนโดรกราฟิส แพนนิคูลาต้า",
      "แอนโดรกราฟิสแพนนิคูลาต้า",
      "แอนโดรกราโฟไลด์",
      // ── Thai regional names ────────────────────────────────────────────────
      "หญ้าเกียงกอง",
      "น้ำลายพระอินทร์",
      "ผักน้ำเมา",
      "กัลปังหาเขียว",
      // ── English canonical / scientific ────────────────────────────────────
      "andrographis",
      "andrographis paniculata",
      "andrographis paniculata wall nees",
      // ── Active compound (marker for standardised extracts) ─────────────────
      "andrographolide",
      "andrographolide extract",
      // ── English extract forms ─────────────────────────────────────────────
      "andrographis extract",
      "andrographis leaf extract",
      "andrographis paniculata extract",
      "andrographis paniculata leaf extract",
      "andrographis herb extract",
      "standardized andrographis extract",
      "standardised andrographis extract",
      "andrographis whole herb",
      // ── Standardised-potency label forms ─────────────────────────────────
      "andrographis 10% andrographolide",
      "andrographis 30% andrographolide",
      // ── English common names ──────────────────────────────────────────────
      "king of bitters",
      "green chiretta",
      "creat",
      "bitter herb",
      // ── Regional / international common names ─────────────────────────────
      "kalmegh",
      "indian echinacea",
      "hempedu bumi",
      "bhui neem",
    ],
  },
];

// ── env / db ──────────────────────────────────────────────────────────────────
function parseEnvFile(contents) {
  const env = {};
  for (const rawLine of String(contents || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
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
  if (dbUrl.includes("sslmode=require") || sslMode === "require" || dbUrl.includes("render.com")) {
    return { connectionString: dbUrl, ssl: { rejectUnauthorized: false } };
  }
  return { connectionString: dbUrl };
}

function parseCliArgs(argv) {
  const args = { dryRun: true, commit: false, dbUrl: process.env.DATABASE_URL || "" };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--dry-run") { args.dryRun = true; args.commit = false; }
    else if (t === "--commit") { args.commit = true; args.dryRun = false; }
    else if (t === "--db-url") args.dbUrl = argv[++i] || "";
    else if (t === "--help" || t === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${t}`);
  }
  return args;
}

// ── upsert helpers ────────────────────────────────────────────────────────────
async function loadCategorySet(client) {
  const result = await client.query(`
    SELECT DISTINCT category_name FROM ada.product_category_states
    WHERE review_status IN ('confirmed', 'imported_exact_match')
      AND category_name IS NOT NULL AND BTRIM(category_name) <> ''
  `);
  return new Set(result.rows.map((r) => r.category_name));
}

async function upsertIngredient(client, { canonical, display }) {
  const r = await client.query(
    `INSERT INTO knowledge.ingredients (canonical_name, display_name, status, updated_at)
     VALUES ($1, $2, 'active', now())
     ON CONFLICT (canonical_name) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'active', updated_at = now()
     RETURNING ingredient_id, (xmax = 0) AS inserted`,
    [canonical, display],
  );
  return { id: Number(r.rows[0].ingredient_id), inserted: r.rows[0].inserted };
}

async function insertSynonymIfMissing(client, { ingredientId, synonymText }) {
  const r = await client.query(
    `INSERT INTO knowledge.ingredient_synonyms (ingredient_id, synonym_text, language, source, status, updated_at)
     SELECT $1, $2, $3, $4, 'active', now()
     WHERE NOT EXISTS (SELECT 1 FROM knowledge.ingredient_synonyms WHERE LOWER(BTRIM(synonym_text)) = LOWER(BTRIM($2)))
     RETURNING synonym_id`,
    [ingredientId, synonymText, /[a-z]/i.test(synonymText) ? "en" : "th", SOURCE],
  );
  return r.rowCount > 0;
}

async function upsertDrugClass(client, name) {
  const r = await client.query(
    `INSERT INTO knowledge.drug_classes (name, status, updated_at) VALUES ($1, 'active', now())
     ON CONFLICT (name) DO UPDATE SET status = 'active', updated_at = now()
     RETURNING drug_class_id, (xmax = 0) AS inserted`,
    [name],
  );
  return { id: Number(r.rows[0].drug_class_id), inserted: r.rows[0].inserted };
}

async function upsertIndication(client, name) {
  const r = await client.query(
    `INSERT INTO knowledge.indications (name, status, updated_at) VALUES ($1, 'active', now())
     ON CONFLICT (name) DO UPDATE SET status = 'active', updated_at = now()
     RETURNING indication_id, (xmax = 0) AS inserted`,
    [name],
  );
  return { id: Number(r.rows[0].indication_id), inserted: r.rows[0].inserted };
}

async function upsertIngredientDrugClass(client, { ingredientId, drugClassId }) {
  const r = await client.query(
    `INSERT INTO knowledge.ingredient_drug_classes (ingredient_id, drug_class_id, confidence, source, status, confirmed_by, confirmed_at, updated_at)
     VALUES ($1, $2, 1, $3, 'confirmed', $3, now(), now())
     ON CONFLICT (ingredient_id, drug_class_id) DO UPDATE SET source = EXCLUDED.source, status = 'confirmed', updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [ingredientId, drugClassId, SOURCE],
  );
  return r.rows[0].inserted;
}

async function upsertIngredientIndication(client, { ingredientId, indicationId }) {
  const r = await client.query(
    `INSERT INTO knowledge.ingredient_indications (ingredient_id, indication_id, source, status, confirmed_by, confirmed_at, updated_at)
     VALUES ($1, $2, $3, 'confirmed', $3, now(), now())
     ON CONFLICT (ingredient_id, indication_id) DO UPDATE SET source = EXCLUDED.source, status = 'confirmed', updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [ingredientId, indicationId, SOURCE],
  );
  return r.rows[0].inserted;
}

async function insertCategoryRuleIfMissing(client, { ingredientId, categoryName, priority, note }) {
  const r = await client.query(
    `INSERT INTO knowledge.ingredient_category_rules (ingredient_id, drug_class_id, indication_id, category_name, priority, rule_status, note, created_by, updated_at)
     SELECT $1, NULL, NULL, $2, $3, 'active', $4, $5, now()
     WHERE NOT EXISTS (
       SELECT 1 FROM knowledge.ingredient_category_rules
       WHERE ingredient_id = $1 AND drug_class_id IS NULL AND indication_id IS NULL AND category_name = $2 AND created_by = $5
     )
     RETURNING rule_id`,
    [ingredientId, categoryName, priority, note, SOURCE],
  );
  return r.rowCount > 0;
}

async function seed(client, { commit }) {
  const stats = {
    mode: commit ? "commit" : "dry-run",
    modelingNotes: MODELING_NOTES,
    normalizedUniqueIngredients: INGREDIENTS.length,
    totalSynonymsInArray: INGREDIENTS.reduce((n, d) => n + d.synonyms.length, 0),
    thaiSynonymsInArray: INGREDIENTS.reduce((n, d) => n + d.synonyms.filter((s) => !/[a-z]/i.test(s)).length, 0),
    ingredients: { inserted: 0, skipped: 0 },
    synonyms: { inserted: 0, skipped: 0 },
    drugClassMappings: { inserted: 0, skipped: 0 },
    indicationMappings: { inserted: 0, skipped: 0 },
    categoryRules: { inserted: 0, skipped: 0 },
    skippedSynonymSamples: [],
    uncertainCategoryMappings: [],
  };

  const seen = new Set();
  for (const def of INGREDIENTS) {
    if (seen.has(def.canonical)) throw new Error(`Duplicate canonical in batch array: ${def.canonical}`);
    seen.add(def.canonical);
  }

  await client.query("BEGIN");
  try {
    const categorySet = await loadCategorySet(client);

    for (const def of INGREDIENTS) {
      const ing = await upsertIngredient(client, def);
      if (ing.inserted) stats.ingredients.inserted += 1; else stats.ingredients.skipped += 1;

      for (const synonymText of def.synonyms) {
        const inserted = await insertSynonymIfMissing(client, { ingredientId: ing.id, synonymText });
        if (inserted) {
          stats.synonyms.inserted += 1;
        } else {
          stats.synonyms.skipped += 1;
          if (stats.skippedSynonymSamples.length < 20) stats.skippedSynonymSamples.push(`${synonymText} (-> ${def.display})`);
        }
      }

      const dc = await upsertDrugClass(client, def.drugClass);
      const dcMap = await upsertIngredientDrugClass(client, { ingredientId: ing.id, drugClassId: dc.id });
      if (dcMap) stats.drugClassMappings.inserted += 1; else stats.drugClassMappings.skipped += 1;

      for (const indicationName of def.indications) {
        const ind = await upsertIndication(client, indicationName);
        const indMap = await upsertIngredientIndication(client, { ingredientId: ing.id, indicationId: ind.id });
        if (indMap) stats.indicationMappings.inserted += 1; else stats.indicationMappings.skipped += 1;
      }

      const resolvedCategory = def.preferredCategory && categorySet.has(def.preferredCategory) ? def.preferredCategory : null;
      if (resolvedCategory) {
        const ruleInserted = await insertCategoryRuleIfMissing(client, {
          ingredientId: ing.id, categoryName: resolvedCategory, priority: 30,
          note: `Batch 17 rule: ${def.display} -> ${resolvedCategory}`,
        });
        if (ruleInserted) stats.categoryRules.inserted += 1; else stats.categoryRules.skipped += 1;
      } else {
        stats.uncertainCategoryMappings.push({
          ingredient: def.display,
          reason: def.uncertainReason || `category "${def.preferredCategory}" not found in confirmed category set`,
        });
      }
    }

    if (commit) await client.query("COMMIT"); else await client.query("ROLLBACK");
    return stats;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function printSummary(stats) {
  const lines = [];
  lines.push("==================================================");
  lines.push(` INGREDIENT DICTIONARY SEED — BATCH 17 (ฟ้าทะลายโจร / Andrographis)  [${stats.mode.toUpperCase()}]`);
  lines.push("==================================================");
  lines.push(`Unique ingredients : ${stats.normalizedUniqueIngredients}`);
  lines.push(`Synonyms in array  : ${stats.totalSynonymsInArray} (of which Thai: ${stats.thaiSynonymsInArray})`);
  lines.push("");
  lines.push(`Ingredients      : inserted ${stats.ingredients.inserted}, skipped ${stats.ingredients.skipped}`);
  lines.push(`Synonyms         : inserted ${stats.synonyms.inserted}, skipped ${stats.synonyms.skipped}`);
  lines.push(`Drug-class maps  : inserted ${stats.drugClassMappings.inserted}, skipped ${stats.drugClassMappings.skipped}`);
  lines.push(`Indication maps  : inserted ${stats.indicationMappings.inserted}, skipped ${stats.indicationMappings.skipped}`);
  lines.push(`Category rules   : inserted ${stats.categoryRules.inserted}, skipped ${stats.categoryRules.skipped}`);
  lines.push("");
  if (stats.skippedSynonymSamples.length) {
    lines.push("Skipped synonyms (already owned / duplicate):");
    for (const s of stats.skippedSynonymSamples) lines.push(`  - ${s}`);
    lines.push("");
  }
  lines.push("Modeling notes:");
  for (const n of stats.modelingNotes) lines.push(`  - ${n}`);
  if (stats.uncertainCategoryMappings.length) {
    lines.push("");
    lines.push(`Uncertain category mappings (category not yet confirmed in DB): ${stats.uncertainCategoryMappings.length}`);
    for (const u of stats.uncertainCategoryMappings) lines.push(`  - ${u.ingredient}: ${u.reason}`);
    lines.push('  → Add the category via the Review Queue first, then re-run with --commit to attach the rule.');
  }
  if (stats.mode === "dry-run") {
    lines.push("");
    lines.push("DRY-RUN: no changes were committed. Re-run with --commit to persist.");
  }
  console.log(lines.join("\n"));
}

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  loadEnvFallback(rootDir);
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log("node scripts/seed_ingredient_dictionary_batch17.js [--dry-run|--commit] [--db-url <url>]");
    return;
  }
  if (!args.dbUrl) throw new Error("Missing database URL. Use --db-url or set DATABASE_URL");

  const client = new Client(dbConfigFromUrl(args.dbUrl));
  await client.connect();
  try {
    const stats = await seed(client, args);
    printSummary(stats);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Batch 17 seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseCliArgs, seed, INGREDIENTS };
