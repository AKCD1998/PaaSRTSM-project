#!/usr/bin/env node
"use strict";

/**
 * Ingredient Dictionary Seed — Batch 24 (Thai Herbal Cough / GI Bundle).
 *
 * 8 ingredients in one batch: 6 single herbs + 2 traditional compound formulas.
 *
 * ENTITY CLASSIFICATION — why these items are in different categories:
 *   Single herbs (entries 1–6): one botanical species = one ingredient entry.
 *   Compound formulas (entries 7–8): each is a standard formula with a fixed
 *     canonical name; they must NOT be merged with their component herbs.
 *
 * EXCLUDED from this batch:
 *   "ยาแก้ไอผสมมะขามป้อม" — product-type description, not an ingredient.
 *     The word "มะขามป้อม" in the product name is already caught by the
 *     backfill matcher via entry 3 synonyms.
 *   "ยาแก้ไอตราเสือดาว" / "Leopard Cough Mixture" — BRAND NAMES.
 *     "เสือดาว" / "Leopard" contain no ingredient tokens; the ingredient
 *     matcher cannot handle these. A future "product alias table" mapping
 *     brand → ingredients is required.
 *
 * Trimmed botanical-author abbreviations (consistent rule):
 *   "Solanum trilobatum L.", "Solanum indicum L.", "Phyllanthus emblica L."
 *   → "L." is an author abbreviation, not a product label token.
 *
 * IMPORTANT compound-formula guard notes (encoded in MODELING_NOTES):
 *   ตรีผลา / Triphala ≠ มะขามป้อม. Triphala = มะขามป้อม + Terminalia chebula
 *     (สมอไทย) + Terminalia bellirica (สมอพิเภก). Do NOT merge.
 *   ยาประสะมะแว้ง ≠ มะแว้งเครือ or มะแว้งต้น. It is a ยาสามัญประจำบ้าน
 *     formula containing both species plus other herbs. Do NOT merge.
 *   ชะเอมเทศ (Glycyrrhiza glabra) ≠ ชะเอมไทย (Albizia myriophylla).
 *     "ชะเอม" is used as a synonym here only because in practice Thai pharmacy
 *     products labeled "ชะเอม" almost always mean ชะเอมเทศ; verify if ambiguous.
 *   eugenol is included as a synonym of กานพลู because it appears as a
 *     standalone ingredient claim on dental products ("eugenol X%") — same
 *     rationale as "charantin" in batch 23 and "gingerol" for ขิง.
 *
 * Default --dry-run; --commit persists.
 *   node scripts/seed_ingredient_dictionary_batch24.js [--dry-run|--commit] [--db-url <url>]
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const SOURCE = "seed_dictionary_batch_24";

const MODELING_NOTES = [
  "Batch 24 = Thai Herbal Cough/GI Bundle: 6 single herbs + 2 traditional compound formulas.",
  "EXCLUDED: 'ยาแก้ไอผสมมะขามป้อม' = product description; backfill catches 'มะขามป้อม' in product name already.",
  "EXCLUDED: 'ยาแก้ไอตราเสือดาว' / 'Leopard Cough Mixture' = brand names; need future product-alias table.",
  "Trimmed: 'Solanum trilobatum L.', 'Solanum indicum L.', 'Phyllanthus emblica L.' — 'L.' is botanical author abbreviation.",
  "มะแว้งเครือ (Solanum trilobatum) and มะแว้งต้น (Solanum indicum) are SEPARATE species — separate entries.",
  "ตรีผลา/Triphala ≠ มะขามป้อม: Triphala = 3 fruits (มะขามป้อม + สมอไทย + สมอพิเภก). Do NOT merge.",
  "ยาประสะมะแว้ง ≠ มะแว้งเครือ or มะแว้งต้น: Thai ยาสามัญประจำบ้าน formula containing both + other herbs.",
  "'ชะเอม' added as synonym of ชะเอมเทศ: on Thai pharmacy labels usually means Glycyrrhiza. Verify if ambiguous with ชะเอมไทย (Albizia myriophylla).",
  "'eugenol' added as synonym of กานพลู: standalone ingredient claim on dental products (same rule as 'charantin' batch 23).",
  "'gingerol' added as synonym of ขิง: standalone bioactive claim on ginger supplement labels.",
];

const INGREDIENTS = [
  // ── 1. มะแว้งเครือ ──────────────────────────────────────────────────────────
  {
    canonical: "solanum trilobatum",
    display: "มะแว้งเครือ (Solanum trilobatum)",
    drugClass: "Herbal expectorant (Solanum / Cough remedy)",
    indications: ["Cough / Expectorant (herbal)", "Upper respiratory tract (herbal)"],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      "มะแว้งเครือ",
      "สารสกัดมะแว้งเครือ",
      "สมุนไพรมะแว้งเครือ",
      "solanum trilobatum",
      "solanum trilobatum extract",
      "climbing nightshade",
    ],
  },
  // ── 2. มะแว้งต้น ─────────────────────────────────────────────────────────────
  {
    canonical: "solanum indicum",
    display: "มะแว้งต้น (Solanum indicum)",
    drugClass: "Herbal expectorant (Solanum / Cough remedy)",
    indications: ["Cough / Expectorant (herbal)", "Upper respiratory tract (herbal)"],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      "มะแว้งต้น",
      "สารสกัดมะแว้งต้น",
      "สมุนไพรมะแว้งต้น",
      "solanum indicum",
      "solanum indicum extract",
      "indian nightshade",
    ],
  },
  // ── 3. มะขามป้อม ─────────────────────────────────────────────────────────────
  {
    canonical: "phyllanthus emblica",
    display: "มะขามป้อม / Amla (Phyllanthus emblica)",
    drugClass: "Herbal antioxidant (Tannin-rich / Vitamin C)",
    indications: ["Antioxidant", "Immunomodulation", "Vitamin C support (herbal)"],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      "มะขามป้อม",
      "สารสกัดมะขามป้อม",
      "มะขามป้อมสกัด",
      "สมุนไพรมะขามป้อม",
      "phyllanthus emblica",
      "emblica officinalis",
      "emblica extract",
      "indian gooseberry",
      "amla",
      "amla berry",
      "amla extract",
      "amalaki",
    ],
  },
  // ── 4. ชะเอมเทศ ──────────────────────────────────────────────────────────────
  {
    canonical: "glycyrrhiza glabra",
    display: "ชะเอมเทศ / Licorice (Glycyrrhiza glabra)",
    drugClass: "Herbal expectorant / Demulcent (Glycyrrhizin)",
    indications: ["Cough / Sore throat (demulcent)", "Anti-inflammatory (herbal)"],
    preferredCategory: "ยาสมุนไพร",
    uncertainReason: "'ชะเอม' synonym included but may match ชะเอมไทย (Albizia myriophylla) — different species; verify ambiguous matches during audit.",
    synonyms: [
      "ชะเอมเทศ",
      "ชะเอม",
      "สารสกัดชะเอมเทศ",
      "licorice",
      "liquorice",
      "licorice root",
      "licorice extract",
      "licorice root extract",
      "glycyrrhiza glabra",
      "glycyrrhiza extract",
      "glycyrrhizin",
    ],
  },
  // ── 5. ขิง ───────────────────────────────────────────────────────────────────
  {
    canonical: "zingiber officinale",
    display: "ขิง / Ginger (Zingiber officinale)",
    drugClass: "Herbal antiemetic / Carminative (Ginger)",
    indications: ["Nausea / Vomiting (herbal)", "Digestive aid / Carminative", "Motion sickness (herbal)"],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      "ขิง",
      "ขิงสด",
      "ขิงผง",
      "สารสกัดขิง",
      "เหง้าขิง",
      "ginger",
      "ginger root",
      "ginger extract",
      "ginger root extract",
      "ginger powder",
      "zingiber officinale",
      "zingiber officinale extract",
      "gingerol",
    ],
  },
  // ── 6. กานพลู ────────────────────────────────────────────────────────────────
  {
    canonical: "syzygium aromaticum",
    display: "กานพลู / Clove (Syzygium aromaticum)",
    drugClass: "Herbal analgesic / Antiseptic (Eugenol)",
    indications: ["Dental pain / Toothache (topical)", "Antiseptic (herbal)", "Carminative"],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      "กานพลู",
      "น้ำมันกานพลู",
      "สารสกัดกานพลู",
      "clove",
      "clove bud",
      "clove oil",
      "clove extract",
      "syzygium aromaticum",
      "eugenia caryophyllata",
      "eugenol",
    ],
  },
  // ── 7. ตรีผลา (Ayurvedic compound formula) ───────────────────────────────────
  {
    canonical: "triphala",
    display: "ตรีผลา / Triphala (Ayurvedic 3-fruit formula)",
    drugClass: "Traditional Ayurvedic formula (Triphala / Digestive tonic)",
    indications: ["Constipation (herbal)", "Digestive tonic (Ayurvedic)", "Antioxidant"],
    preferredCategory: "ยาสมุนไพร",
    uncertainReason: "Triphala ≠ มะขามป้อม: contains 3 fruits. Matched products must be the complete Triphala formula, not single-herb Amla products — verify during audit.",
    synonyms: [
      "ตรีผลา",
      "ยาตรีผลา",
      "triphala",
      "tri phala",
      "triphala extract",
      "triphala powder",
      "triphala churna",
    ],
  },
  // ── 8. ยาประสะมะแว้ง (Thai traditional formula) ──────────────────────────────
  {
    canonical: "ya prasa mawang",
    display: "ยาประสะมะแว้ง (Thai traditional cough formula)",
    drugClass: "Traditional Thai herbal formula (ยาสามัญประจำบ้าน / Cough)",
    indications: ["Cough / Expectorant (traditional Thai formula)"],
    preferredCategory: "ยาสมุนไพร",
    uncertainReason: "ยาประสะมะแว้ง is a multi-herb formula (มะแว้ง + ชะเอมเทศ + others). Matched products should be the complete formula product, not individual herbs — verify during audit.",
    synonyms: [
      "ยาประสะมะแว้ง",
      "น้ำยาประสะมะแว้ง",
      "ยาประสะมะแว้งต้น",
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
    perIngredient: [],
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
      const ingStats = { display: def.display, synonymsInserted: 0, synonymsSkipped: 0 };

      const ing = await upsertIngredient(client, def);
      if (ing.inserted) stats.ingredients.inserted += 1; else stats.ingredients.skipped += 1;

      for (const synonymText of def.synonyms) {
        const inserted = await insertSynonymIfMissing(client, { ingredientId: ing.id, synonymText });
        if (inserted) {
          stats.synonyms.inserted += 1;
          ingStats.synonymsInserted += 1;
        } else {
          stats.synonyms.skipped += 1;
          ingStats.synonymsSkipped += 1;
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
          note: `Batch 24 rule: ${def.display} -> ${resolvedCategory}`,
        });
        if (ruleInserted) stats.categoryRules.inserted += 1; else stats.categoryRules.skipped += 1;
      } else {
        stats.uncertainCategoryMappings.push({
          ingredient: def.display,
          reason: def.uncertainReason || `category "${def.preferredCategory}" not found in confirmed category set`,
        });
      }

      stats.perIngredient.push(ingStats);
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
  lines.push(` INGREDIENT DICTIONARY SEED — BATCH 24 (Thai Herbal Bundle)  [${stats.mode.toUpperCase()}]`);
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
  lines.push("Per-ingredient breakdown:");
  for (const s of stats.perIngredient) {
    lines.push(`  ${s.display.padEnd(50)} synonyms +${s.synonymsInserted} / skip ${s.synonymsSkipped}`);
  }
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
    lines.push("  → Confirm 'ยาสมุนไพร' via Review Queue, then re-run --commit to attach rules.");
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
    console.log("node scripts/seed_ingredient_dictionary_batch24.js [--dry-run|--commit] [--db-url <url>]");
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
    console.error(`Batch 24 seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseCliArgs, seed, INGREDIENTS };
