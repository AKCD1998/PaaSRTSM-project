#!/usr/bin/env node
"use strict";

/**
 * Ingredient Dictionary Seed — Batch 32 (น้ำมันมะพร้าว / Coconut Oil / Cocos nucifera).
 *
 * Single ingredient entry. Coconut oil in Thai pharmacy appears in three main roles:
 *   1. Supplement (VCO capsules — อาหารเสริม)
 *   2. Cosmetic carrier / emollient (skin/hair — เวชสำอางค์)
 *   3. Traditional medicine base oil
 *
 * preferredCategory is set to 'เวชสำอางค์' (confirmed in DB from prior batches);
 * the category rule will actually be attached on this run.
 *
 * INCI NAME NOTE:
 *   "Cocos Nucifera Oil"           — short INCI form; lowercase = "cocos nucifera oil"
 *   "Cocos Nucifera (Coconut) Oil" — full INCI form with common-name qualifier;
 *                                    lowercase = "cocos nucifera (coconut) oil"
 *   These two are DIFFERENT strings and both are included as synonyms.
 *   The title-case variants from the user's list are handled automatically by
 *   the LOWER(BTRIM()) deduplication — no explicit trimming needed.
 *
 * DEDUPLICATION NOTE:
 *   "Cocos Nucifera Oil" (title-case) from user's list → identical to "cocos nucifera oil"
 *   when lowercased → will be skipped by the WHERE NOT EXISTS dedup guard, not an error.
 *
 * All oil-descriptor compound terms (น้ำมันมะพร้าวสกัดเย็น, virgin coconut oil,
 * cold pressed coconut oil, etc.) are KEPT because they include the base ingredient
 * name — unlike batch 31 where "cold pressed" alone was excluded as too generic.
 *
 * Not included (not pharmacy-relevant label tokens):
 *   - "coconut" alone — too generic; matches food/cosmetic products containing
 *     coconut as a minor ingredient
 *   - "MCT oil" / "fractionated coconut oil" — processed derivative; different
 *     product with different composition (only C8/C10 fatty acids); separate entry
 *     if needed
 *   - "refined coconut oil" — refined has different properties (no smell/flavor);
 *     valid omission for pharmacy context where VCO is primary interest
 *
 * Thai synonyms (5): น้ำมันมะพร้าว, น้ำมันมะพร้าวสกัดเย็น, น้ำมันมะพร้าวบริสุทธิ์,
 *   น้ำมันมะพร้าวหีบเย็น, น้ำมันมะพร้าวคั้นเย็น
 * English/scientific (7): coconut oil, cocos nucifera oil,
 *   cocos nucifera (coconut) oil, virgin coconut oil, extra virgin coconut oil,
 *   cold pressed coconut oil, vco
 *
 * preferredCategory = "เวชสำอางค์" — confirmed in DB; rule will be attached.
 *
 * Default --dry-run; --commit persists.
 *   node scripts/seed_ingredient_dictionary_batch32.js [--dry-run|--commit] [--db-url <url>]
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const SOURCE = "seed_dictionary_batch_32";
const PREFERRED_CATEGORY = "เวชสำอางค์";

const MODELING_NOTES = [
  "Batch 32 = น้ำมันมะพร้าว / Coconut Oil (Cocos nucifera) — emollient, carrier oil, VCO supplement.",
  "Three pharmacy roles: supplement (VCO capsules), cosmetic carrier oil, traditional medicine base.",
  "INCI: 'cocos nucifera oil' (short) ≠ 'cocos nucifera (coconut) oil' (full) — both included as distinct synonyms.",
  "'Cocos Nucifera Oil' (title-case from user list) is a duplicate of 'cocos nucifera oil'; dedup handles it silently.",
  "All compound oil-descriptor terms kept: each contains the specific ingredient name 'coconut oil'.",
  "  (Contrast batch 31 where 'cold pressed' alone was excluded as too generic.)",
  "NOT included: 'coconut' alone (too generic), MCT oil / fractionated coconut oil (different product).",
  "preferredCategory 'เวชสำอางค์' — confirmed in DB (batches 22/26 established this); category rule will attach.",
];

const INGREDIENTS = [
  {
    canonical: "cocos nucifera oil",
    display: "Coconut Oil / VCO (น้ำมันมะพร้าว / Cocos nucifera)",
    drugClass: "Cosmetic emollient / Carrier oil (Cocos nucifera / Coconut)",
    indications: [
      "Skin moisturization",
      "Hair conditioning (cosmetic)",
      "Antimicrobial (lauric acid / herbal)",
    ],
    preferredCategory: PREFERRED_CATEGORY,
    synonyms: [
      // ── Thai names ─────────────────────────────────────────────────────────
      "น้ำมันมะพร้าว",
      "น้ำมันมะพร้าวสกัดเย็น",
      "น้ำมันมะพร้าวบริสุทธิ์",
      "น้ำมันมะพร้าวหีบเย็น",
      "น้ำมันมะพร้าวคั้นเย็น",
      // ── Botanical / INCI names ────────────────────────────────────────────
      "coconut oil",
      "cocos nucifera oil",
      "cocos nucifera (coconut) oil",
      // ── English product / grade forms ─────────────────────────────────────
      "virgin coconut oil",
      "extra virgin coconut oil",
      "cold pressed coconut oil",
      // ── Abbreviation ──────────────────────────────────────────────────────
      "vco",
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
    if (seen.has(def.canonical)) throw new Error(`Duplicate canonical: ${def.canonical}`);
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
        if (inserted) stats.synonyms.inserted += 1;
        else {
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
          note: `Batch 32 rule: ${def.display} -> ${resolvedCategory}`,
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
  lines.push(` INGREDIENT DICTIONARY SEED — BATCH 32 (น้ำมันมะพร้าว / Coconut Oil)  [${stats.mode.toUpperCase()}]`);
  lines.push("==================================================");
  lines.push(`Unique ingredients : ${stats.normalizedUniqueIngredients}`);
  lines.push(`Synonyms in array  : ${stats.totalSynonymsInArray} (of which Thai: ${stats.thaiSynonymsInArray})`);
  lines.push("");
  lines.push(`Ingredients      : inserted ${stats.ingredients.inserted}, skipped ${stats.ingredients.skipped}`);
  lines.push(`Synonyms         : inserted ${stats.synonyms.inserted}, skipped ${stats.synonyms.skipped}`);
  lines.push(`Drug-class maps  : inserted ${stats.drugClassMappings.inserted}, skipped ${stats.drugClassMappings.skipped}`);
  lines.push(`Indication maps  : inserted ${stats.indicationMappings.inserted}, skipped ${stats.indicationMappings.skipped}`);
  lines.push(`Category rules   : inserted ${stats.categoryRules.inserted}, skipped ${stats.categoryRules.skipped}`);
  if (stats.skippedSynonymSamples.length) {
    lines.push("");
    lines.push("Skipped synonyms (already owned / duplicate):");
    for (const s of stats.skippedSynonymSamples) lines.push(`  - ${s}`);
  }
  lines.push("");
  lines.push("Modeling notes:");
  for (const n of stats.modelingNotes) lines.push(`  - ${n}`);
  if (stats.uncertainCategoryMappings.length) {
    lines.push("");
    lines.push(`Uncertain category mappings: ${stats.uncertainCategoryMappings.length}`);
    for (const u of stats.uncertainCategoryMappings) lines.push(`  - ${u.ingredient}: ${u.reason}`);
    lines.push("  → Confirm category via Review Queue, then re-run --commit to attach the rule.");
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
  if (args.help) { console.log("node scripts/seed_ingredient_dictionary_batch32.js [--dry-run|--commit] [--db-url <url>]"); return; }
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
  main().catch((err) => { console.error(`Batch 32 seed failed: ${err.message}`); process.exitCode = 1; });
}

module.exports = { parseCliArgs, seed, INGREDIENTS };
