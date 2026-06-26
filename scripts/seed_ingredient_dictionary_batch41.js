#!/usr/bin/env node
"use strict";

/**
 * Ingredient Dictionary Seed — Batch 41
 * ไซเลียมฮัสก์ / Psyllium husk (Ispaghula / Plantago ovata husk)
 *
 * Single ingredient, 18 synonyms (Thai: 8 / English+botanical: 10).
 *
 * NOTES:
 *   Psyllium husk and ispaghula husk are the SAME ingredient: both refer to
 *   the seed coat (husk) of Plantago ovata Forssk. "Psyllium" is the common
 *   Western name; "ispaghula" is the name used in British/Indian pharmacopoeia.
 *   All synonyms merged into one entry (canonical "psyllium husk").
 *
 *   Thai spelling variants:
 *     "ไซเลียมฮัสก์" and "ไซเลี่ยมฮัสก์" — both in wide use on Thai product labels.
 *     "อิสพากูลา ฮัสก์" and "อิสปากูลา ฮัสก์" — both Thai transliterations of
 *     "ispaghula" appear on pharmacopoeia-aligned and imported product labels.
 *
 *   "Plantago ovata forssk." — Forsskål author abbreviation, appears on some
 *   pharmacopoeia / regulated product declarations.
 *
 *   "Plantago ovata" alone INCLUDED (no "husk" qualifier): in Thai pharmacy
 *   context, P. ovata on a supplement/fiber product label is overwhelmingly the
 *   husk product, not the seed, seed oil, or leaf. Low false-match risk.
 *
 *   "psyllium" standalone and "ไฟเบอร์ไซเลียม" added beyond user list:
 *   both appear as standalone ingredient declarations on Thai supplement labels.
 *
 * Default --dry-run; --commit persists.
 *   node scripts/seed_ingredient_dictionary_batch41.js [--dry-run|--commit] [--db-url <url>]
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const SOURCE = "seed_dictionary_batch_41";

const INGREDIENTS = [
  {
    canonical: "psyllium husk",
    display: "Psyllium Husk / Ispaghula (ไซเลียมฮัสก์ / Plantago ovata)",
    drugClass: "Dietary fiber supplement / Laxative (Psyllium husk / Ispaghula / Plantago ovata)",
    indications: [
      "Dietary fiber supplement / Constipation (supplement)",
      "Cholesterol management / Cardiovascular (supplement)",
      "Blood sugar regulation (supplement)",
      "Prebiotic / Gut health (supplement)",
    ],
    preferredCategory: "อาหารเสริม",
    synonyms: [
      // ── Thai names (spelling variants + product-form terms) ───────────────
      "ไซเลียมฮัสก์",
      "ไซเลี่ยมฮัสก์",
      "เปลือกไซเลียม",
      "ผงไซเลียมฮัสก์",
      "อิสพากูลา ฮัสก์",
      "อิสปากูลา ฮัสก์",
      "ไซเลียม",
      "ไฟเบอร์ไซเลียม",
      // ── English compound / product-form names ─────────────────────────────
      "psyllium husk",
      "psyllium seed husk",
      "psyllium husk powder",
      "psyllium",
      "ispaghula husk",
      "ispaghula seed husk",
      // ── Botanical (species + part / author notation) ──────────────────────
      "plantago ovata husk",
      "plantago ovata seed coat",
      "plantago ovata forssk.",
      "plantago ovata",
    ],
  },
];

// ── env / db helpers ──────────────────────────────────────────────────────────
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
    totalSynonymsInArray: INGREDIENTS.reduce((n, d) => n + d.synonyms.length, 0),
    thaiSynonymsInArray: INGREDIENTS.reduce((n, d) => n + d.synonyms.filter((s) => !/[a-z]/i.test(s)).length, 0),
    ingredients: { inserted: 0, skipped: 0 },
    synonyms: { inserted: 0, skipped: 0 },
    drugClassMappings: { inserted: 0, skipped: 0 },
    indicationMappings: { inserted: 0, skipped: 0 },
    categoryRules: { inserted: 0, skipped: 0 },
    skippedSynonymSamples: [],
    uncertainCategoryMappings: [],
    perIngredient: [],
  };

  await client.query("BEGIN");
  try {
    const categorySet = await loadCategorySet(client);

    for (const def of INGREDIENTS) {
      const ingStats = { name: def.display, synonymsInserted: 0, synonymsSkipped: 0 };

      const ing = await upsertIngredient(client, def);
      if (ing.inserted) stats.ingredients.inserted += 1; else stats.ingredients.skipped += 1;

      for (const synonymText of def.synonyms) {
        const inserted = await insertSynonymIfMissing(client, { ingredientId: ing.id, synonymText });
        if (inserted) { stats.synonyms.inserted += 1; ingStats.synonymsInserted += 1; }
        else {
          stats.synonyms.skipped += 1; ingStats.synonymsSkipped += 1;
          if (stats.skippedSynonymSamples.length < 20) stats.skippedSynonymSamples.push(`${synonymText} (-> ${def.canonical})`);
        }
      }
      stats.perIngredient.push(ingStats);

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
          note: `Batch 41 rule: ${def.canonical} -> ${resolvedCategory}`,
        });
        if (ruleInserted) stats.categoryRules.inserted += 1; else stats.categoryRules.skipped += 1;
      } else {
        stats.uncertainCategoryMappings.push({
          ingredient: def.display,
          reason: `category "${def.preferredCategory}" not found in confirmed category set`,
        });
      }
    }

    if (commit) await client.query("COMMIT"); else await client.query("ROLLBACK");
    return stats;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

function printSummary(stats) {
  const lines = [];
  lines.push("==================================================");
  lines.push(` INGREDIENT DICTIONARY SEED — BATCH 41 (ไซเลียมฮัสก์ / Psyllium husk)  [${stats.mode.toUpperCase()}]`);
  lines.push("==================================================");
  lines.push(`Synonyms in array  : ${stats.totalSynonymsInArray} (Thai: ${stats.thaiSynonymsInArray})`);
  lines.push(`Ingredients      : inserted ${stats.ingredients.inserted}, skipped ${stats.ingredients.skipped}`);
  lines.push(`Synonyms         : inserted ${stats.synonyms.inserted}, skipped ${stats.synonyms.skipped}`);
  lines.push(`Drug-class maps  : inserted ${stats.drugClassMappings.inserted}, skipped ${stats.drugClassMappings.skipped}`);
  lines.push(`Indication maps  : inserted ${stats.indicationMappings.inserted}, skipped ${stats.indicationMappings.skipped}`);
  lines.push(`Category rules   : inserted ${stats.categoryRules.inserted}, skipped ${stats.categoryRules.skipped}`);
  for (const pi of stats.perIngredient) {
    lines.push(`  ${pi.synonymsInserted > 0 ? "+" : "~"} ${pi.synonymsInserted} new / ${pi.synonymsSkipped} skipped  →  ${pi.name}`);
  }
  if (stats.skippedSynonymSamples.length) {
    lines.push("\nSkipped synonyms (already in DB):");
    for (const s of stats.skippedSynonymSamples) lines.push(`  - ${s}`);
  }
  if (stats.uncertainCategoryMappings.length) {
    lines.push(`\nUncertain category mappings: ${stats.uncertainCategoryMappings.length}`);
    for (const u of stats.uncertainCategoryMappings) lines.push(`  - ${u.ingredient}: ${u.reason}`);
  }
  if (stats.mode === "dry-run") lines.push("\nDRY-RUN: no changes committed. Re-run with --commit to persist.");
  console.log(lines.join("\n"));
}

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  loadEnvFallback(rootDir);
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) { console.log("node scripts/seed_ingredient_dictionary_batch41.js [--dry-run|--commit] [--db-url <url>]"); return; }
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
  main().catch((err) => { console.error(`Batch 41 seed failed: ${err.message}`); process.exitCode = 1; });
}

module.exports = { parseCliArgs, seed, INGREDIENTS };
