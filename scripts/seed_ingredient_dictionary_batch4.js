#!/usr/bin/env node
"use strict";

/**
 * Ingredient Dictionary Seed — Batch 4 (FADAsoft SET 4: vitamins & minerals).
 *
 * The deliberately-deferred "vitamins/minerals layer". Models a small number of
 * broad supplement ingredients (B1-B12, B-complex, Calcium, Iron) each with a
 * large curated synonym list.
 *
 * Decisions baked in (per pharmacist):
 *   - Short biochem ABBREVIATIONS are excluded (NAD/FAD/FMN/NR/NMN/TPP/THF/DHF/
 *     CoA/PLP/P5P/AKG/MCHA/5-MTHF/NADPH...) — they are 2-4 char tokens that would
 *     cause false product matches. Full chemical names are kept.
 *   - Calcium / Iron / all B vitamins -> category "วิตามิน". Salts already seeded
 *     in earlier batches under a numbered drug shelf (calcium carbonate=antacid,
 *     ferrous sulfate/fumarate/gluconate=blood) are LEFT AS-IS — their synonyms
 *     simply skip here (global-unique), preserving the numbered category.
 *   - Vitamin B12 EXTENDS the existing 'mecobalamin' ingredient (no duplicate).
 *
 * Same safe/idempotent pattern as batches 1-3. Default --dry-run; --commit persists.
 *   node scripts/seed_ingredient_dictionary_batch4.js [--dry-run|--commit] [--db-url <url>]
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const SOURCE = "seed_dictionary_batch_4";
const VITAMIN = "วิตามิน";

// Abbreviations intentionally dropped (reported, not seeded).
const DROPPED_ABBREVIATIONS = [
  "TPP", "FMN", "FAD", "NR", "NMN", "NAD", "NAD+", "NADH", "NADP", "NADP+", "NADPH",
  "CoA", "PLP", "P5P", "5-MTHF", "THF", "DHF", "MCHA", "Calcium AKG", "Vitamin H (kept)",
];

const MODELING_NOTES = [
  "11 broad supplement ingredients; many synonyms each (vitamin/mineral forms).",
  "Vitamin B12 extends the existing 'mecobalamin' ingredient (adds cobalamin/hydroxocobalamin/adenosylcobalamin/dibencozide/cobamamide/coenzyme b12).",
  "calcium carbonate (antacid) and ferrous sulfate/fumarate/gluconate (blood) keep their earlier numbered categories — their synonyms skip here as globally-unique.",
  "ferric ammonium citrate already belongs to 'ammonium citrate' (batch 3) — skipped here.",
  "Short biochem abbreviations excluded to avoid false whole-token product matches.",
];

// canonical 'mecobalamin' is reused on purpose to extend the existing B12 ingredient.
const INGREDIENTS = [
  {
    canonical: "thiamine", display: "Vitamin B1 (Thiamine)", drugClass: "Vitamin (B-group)", indications: ["Vitamin"], preferredCategory: VITAMIN,
    synonyms: ["vitamin b1", "thiamine", "thiamine hydrochloride", "thiamine mononitrate", "benfotiamine", "fursultiamine", "sulbutiamine", "thiamine pyrophosphate", "cocarboxylase"],
  },
  {
    canonical: "riboflavin", display: "Vitamin B2 (Riboflavin)", drugClass: "Vitamin (B-group)", indications: ["Vitamin"], preferredCategory: VITAMIN,
    synonyms: ["vitamin b2", "riboflavin", "riboflavin 5 phosphate", "riboflavin-5-phosphate", "riboflavin sodium phosphate", "flavin mononucleotide", "flavin adenine dinucleotide"],
  },
  {
    canonical: "niacin", display: "Vitamin B3 (Niacin)", drugClass: "Vitamin (B-group)", indications: ["Vitamin"], preferredCategory: VITAMIN,
    synonyms: ["vitamin b3", "niacin", "nicotinic acid", "nicotinamide", "niacinamide", "inositol hexanicotinate", "nicotinamide riboside", "nicotinamide mononucleotide"],
  },
  {
    canonical: "pantothenic acid", display: "Vitamin B5 (Pantothenic Acid)", drugClass: "Vitamin (B-group)", indications: ["Vitamin"], preferredCategory: VITAMIN,
    synonyms: ["vitamin b5", "pantothenic acid", "calcium pantothenate", "dexpanthenol", "panthenol", "pantethine", "coenzyme a"],
  },
  {
    canonical: "pyridoxine", display: "Vitamin B6 (Pyridoxine)", drugClass: "Vitamin (B-group)", indications: ["Vitamin"], preferredCategory: VITAMIN,
    synonyms: ["vitamin b6", "pyridoxine", "pyridoxine hydrochloride", "pyridoxal", "pyridoxamine", "pyridoxal 5 phosphate", "pyridoxal-5-phosphate", "pyridoxamine phosphate"],
  },
  {
    canonical: "biotin", display: "Vitamin B7 (Biotin)", drugClass: "Vitamin (B-group)", indications: ["Vitamin"], preferredCategory: VITAMIN,
    synonyms: ["vitamin b7", "biotin", "d-biotin", "vitamin h"],
  },
  {
    canonical: "folic acid", display: "Vitamin B9 (Folic Acid)", drugClass: "Vitamin (B-group)", indications: ["Vitamin"], preferredCategory: VITAMIN,
    synonyms: ["vitamin b9", "folic acid", "folate", "l-methylfolate", "methylfolate", "5 methyltetrahydrofolate", "5-methyltetrahydrofolate", "levomefolate calcium", "calcium l-methylfolate", "quatrefolic", "metafolin", "folinic acid", "calcium folinate", "leucovorin", "tetrahydrofolate", "dihydrofolate"],
  },
  {
    // EXTENDS existing batch-3 'mecobalamin' ingredient.
    canonical: "mecobalamin", display: "Vitamin B12", drugClass: "Vitamin B12", indications: ["Vitamin"], preferredCategory: VITAMIN,
    synonyms: ["vitamin b12", "cobalamin", "cyanocobalamin", "methylcobalamin", "mecobalamin", "hydroxocobalamin", "adenosylcobalamin", "dibencozide", "cobamamide", "coenzyme b12"],
  },
  {
    canonical: "vitamin b complex", display: "Vitamin B Complex", drugClass: "Vitamin (B-complex)", indications: ["Vitamin"], preferredCategory: VITAMIN,
    synonyms: ["vitamin b complex", "vitamin b-complex", "vitamin b combination", "vitamin b group", "vitamin b blend", "b complex", "b-complex", "b complex vitamins", "vitamin b family"],
  },
  {
    canonical: "calcium", display: "Calcium", drugClass: "Mineral (Calcium)", indications: ["Supplement"], preferredCategory: VITAMIN,
    synonyms: [
      "calcium", "calcium citrate", "calcium citrate malate", "calcium lactate", "calcium lactate gluconate",
      "calcium gluconate", "calcium phosphate", "tricalcium phosphate", "dicalcium phosphate", "monocalcium phosphate",
      "calcium hydroxyapatite", "microcrystalline hydroxyapatite", "calcium aspartate", "calcium orotate", "calcium malate",
      "calcium chelate", "calcium amino acid chelate", "calcium bisglycinate", "calcium glycinate", "calcium l-threonate",
      "calcium threonate", "calcium pyruvate", "calcium alpha ketoglutarate", "calcium chloride", "calcium acetate",
      "coral calcium", "marine calcium", "oyster shell calcium", "eggshell calcium", "aquamin", "calcium magnesium", "cal-mag",
    ],
  },
  {
    canonical: "iron", display: "Iron", drugClass: "Mineral (Iron)", indications: ["Supplement", "Anemia"], preferredCategory: VITAMIN,
    synonyms: [
      "iron", "ferrous", "dried ferrous sulfate", "ferrous lactate", "ferrous succinate", "ferrous ascorbate",
      "ferrous glycine sulfate", "ferrous bisglycinate", "ferrous glycinate", "ferrous amino acid chelate", "ferrous carbonate",
      "ferrous citrate", "ferrous aspartate", "ferrous orotate", "ferrous tartrate", "ferrous chloride", "ferrous oxalate",
      "ferrous phosphate", "ferric citrate", "ferric pyrophosphate", "ferric orthophosphate", "ferric edta", "sodium ferric edta",
      "iron polymaltose", "ferric hydroxide polymaltose", "iron protein succinylate", "ferric protein succinylate",
      "carbonyl iron", "heme iron", "heme iron polypeptide", "iron bisglycinate", "iron glycinate", "iron amino acid chelate",
      "iron peptonate", "iron saccharate", "iron sucrose", "ferric saccharate", "ferric carboxymaltose", "iron dextran",
      "iron isomaltoside", "ferric derisomaltose",
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
     SELECT $1, $2, 'en', $3, 'active', now()
     WHERE NOT EXISTS (SELECT 1 FROM knowledge.ingredient_synonyms WHERE LOWER(BTRIM(synonym_text)) = LOWER(BTRIM($2)))
     RETURNING synonym_id`,
    [ingredientId, synonymText, SOURCE],
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
    droppedAbbreviations: DROPPED_ABBREVIATIONS,
    modelingNotes: MODELING_NOTES,
    normalizedUniqueIngredients: INGREDIENTS.length,
    totalSynonymsInArray: INGREDIENTS.reduce((n, d) => n + d.synonyms.length, 0),
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
          note: `Batch 4 supplement rule: ${def.display} -> ${resolvedCategory}`,
        });
        if (ruleInserted) stats.categoryRules.inserted += 1; else stats.categoryRules.skipped += 1;
      } else {
        stats.uncertainCategoryMappings.push({ ingredient: def.display, reason: `category "${def.preferredCategory}" not found` });
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
  lines.push(` INGREDIENT DICTIONARY SEED — BATCH 4 (vitamins/minerals)  [${stats.mode.toUpperCase()}]`);
  lines.push("==================================================");
  lines.push(`Unique ingredients : ${stats.normalizedUniqueIngredients}`);
  lines.push(`Synonyms in array  : ${stats.totalSynonymsInArray}`);
  lines.push("");
  lines.push(`Ingredients      : inserted ${stats.ingredients.inserted}, skipped ${stats.ingredients.skipped}`);
  lines.push(`Synonyms         : inserted ${stats.synonyms.inserted}, skipped ${stats.synonyms.skipped}`);
  lines.push(`Drug-class maps  : inserted ${stats.drugClassMappings.inserted}, skipped ${stats.drugClassMappings.skipped}`);
  lines.push(`Indication maps  : inserted ${stats.indicationMappings.inserted}, skipped ${stats.indicationMappings.skipped}`);
  lines.push(`Category rules   : inserted ${stats.categoryRules.inserted}, skipped ${stats.categoryRules.skipped}`);
  lines.push("");
  lines.push(`Dropped abbreviations (not seeded): ${stats.droppedAbbreviations.join(", ")}`);
  lines.push("");
  lines.push("Skipped synonyms (already owned by an earlier ingredient — expected):");
  for (const s of stats.skippedSynonymSamples) lines.push(`  - ${s}`);
  lines.push("");
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
    console.log("node scripts/seed_ingredient_dictionary_batch4.js [--dry-run|--commit] [--db-url <url>]");
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
    console.error(`Batch 4 seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseCliArgs, seed, INGREDIENTS };
