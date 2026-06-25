#!/usr/bin/env node
"use strict";

/**
 * Ingredient Dictionary Seed — Batch 26 (บัวบก / Centella asiatica / Gotu Kola).
 *
 * Single ingredient family spanning two major use contexts:
 *   Supplement: บัวบก capsules / extract for venous insufficiency, cognition
 *   Cosmeceutical: wound healing, skin repair, anti-inflammatory (topical)
 * The CICA trend in Korean beauty has made "CICA" a common label token in Thai
 * pharmacies and beauty retail — included for backfill coverage.
 *
 * Active compound synonyms included (standalone label claims):
 *   "asiaticoside"  — primary triterpenoid saponin; appears on supplement labels
 *                     as "asiaticoside Xmg" (same rule as charantin/gingerol).
 *   "madecassoside" — cosmetic-grade active; appears on product labels for
 *                     skin-repair creams (La Roche-Posay Cicaplast, etc.).
 *
 * Trimmed from user's list:
 *   "Centella asiatica (L.) Urb."     — full botanical author notation; not a label token.
 *   "Centella Asiatica Extract"        — title-case duplicate of "centella asiatica extract".
 *   "Centella Asiatica Leaf Extract"   — title-case; replaced by lowercase equivalent.
 *
 * Added vs user's list:
 *   "สมุนไพรบัวบก"             — herbal-prefix form used on Thai supplement labels
 *   "centella asiatica leaf extract" — lowercase form of user's title-case entry
 *   "pennywort"                — shortened form on some imported labels
 *   "tiger grass"              — marketing/beauty-brand name for Centella
 *   "CICA"                     — very common K-beauty abbreviation on cosmetics sold in Thai pharmacies
 *   "asiaticoside"             — primary active triterpenoid; standalone label claim
 *   "madecassoside"            — cosmetic-grade active; standalone label claim
 *
 * Thai synonyms (6): บัวบก, ใบบัวบก, สารสกัดบัวบก, สารสกัดใบบัวบก,
 *                    บัวบกสกัด, สมุนไพรบัวบก
 * English/scientific (13): centella asiatica, centella asiatica extract,
 *   centella asiatica leaf extract, gotu kola, gotu kola extract,
 *   asiatic pennywort, pennywort, tiger grass, hydrocotyle asiatica,
 *   CICA, asiaticoside, madecassoside
 *
 * preferredCategory = "เวชสำอางค์" (confirmed) — attaches immediately.
 * Note: ยาสมุนไพร category rule can be added after that category is confirmed.
 *
 * Default --dry-run; --commit persists.
 *   node scripts/seed_ingredient_dictionary_batch26.js [--dry-run|--commit] [--db-url <url>]
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const SOURCE = "seed_dictionary_batch_26";
const PREFERRED_CATEGORY = "เวชสำอางค์";

const MODELING_NOTES = [
  "Batch 26 = บัวบก / Centella asiatica — dual use: herbal supplement + cosmeceutical skin repair.",
  "'Centella asiatica (L.) Urb.' excluded: full botanical author notation, not a product label token.",
  "'Centella Asiatica Extract' / 'Centella Asiatica Leaf Extract' (title-case) excluded: duplicate of lowercase forms.",
  "'CICA' added: very common K-beauty abbreviation on cosmetics sold in Thai pharmacies — high recall value.",
  "'tiger grass' added: marketing name used by skincare brands on labels sold in Thai pharmacies.",
  "'pennywort' added: shortened form on some imported labels (virtually always means บัวบก in Thai pharmacy context).",
  "'asiaticoside' added: primary triterpenoid saponin; standalone label claim (same rule as charantin/gingerol).",
  "'madecassoside' added: cosmetic-grade active; appears on skin-repair product labels as standalone claim.",
  "preferredCategory 'เวชสำอางค์' — confirmed category, rule attaches immediately.",
  "Supplement use (ยาสมุนไพร) not yet confirmed in category set — add category rule when confirmed.",
];

const INGREDIENTS = [
  {
    canonical: "centella asiatica",
    display: "Centella asiatica / Gotu Kola (บัวบก)",
    drugClass: "Herbal wound healing / Skin repair (Centella asiatica)",
    indications: [
      "Wound healing / Skin repair (topical)",
      "Skin soothing / Anti-inflammatory (topical)",
      "Venous insufficiency / Circulation (herbal)",
    ],
    preferredCategory: PREFERRED_CATEGORY,
    synonyms: [
      // ── Thai names ─────────────────────────────────────────────────────────
      "บัวบก",
      "ใบบัวบก",
      "สารสกัดบัวบก",
      "สารสกัดใบบัวบก",
      "บัวบกสกัด",
      "สมุนไพรบัวบก",
      // ── English common / extract forms ────────────────────────────────────
      "centella asiatica",
      "centella asiatica extract",
      "centella asiatica leaf extract",
      "gotu kola",
      "gotu kola extract",
      "asiatic pennywort",
      "pennywort",
      "tiger grass",
      // ── Old botanical synonym ─────────────────────────────────────────────
      "hydrocotyle asiatica",
      // ── Beauty / cosmetic shorthand ───────────────────────────────────────
      "cica",
      // ── Primary bioactive compounds (standalone label claims) ─────────────
      "asiaticoside",
      "madecassoside",
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
          note: `Batch 26 rule: ${def.display} -> ${resolvedCategory}`,
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
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function printSummary(stats) {
  const lines = [];
  lines.push("==================================================");
  lines.push(` INGREDIENT DICTIONARY SEED — BATCH 26 (บัวบก / Centella asiatica)  [${stats.mode.toUpperCase()}]`);
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
    lines.push(`Uncertain category mappings: ${stats.uncertainCategoryMappings.length}`);
    for (const u of stats.uncertainCategoryMappings) lines.push(`  - ${u.ingredient}: ${u.reason}`);
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
    console.log("node scripts/seed_ingredient_dictionary_batch26.js [--dry-run|--commit] [--db-url <url>]");
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
    console.error(`Batch 26 seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseCliArgs, seed, INGREDIENTS };
