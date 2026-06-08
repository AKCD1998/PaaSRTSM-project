#!/usr/bin/env node
"use strict";

/**
 * Ingredient Dictionary Seed — Batch 1 (high-confidence single-active-ingredient).
 *
 * Phase 4.6. Seeds the knowledge.* dictionary ONLY:
 *   - knowledge.ingredients
 *   - knowledge.ingredient_synonyms
 *   - knowledge.drug_classes + knowledge.ingredient_drug_classes
 *   - knowledge.indications  + knowledge.ingredient_indications
 *   - knowledge.ingredient_category_rules (only when a clearly suitable existing
 *     confirmed/imported category name exists; never invents categories)
 *
 * It does NOT touch knowledge.product_ingredients (no backfill), does NOT change
 * any API/frontend/review-queue behavior, and never auto-confirms product rows.
 *
 * Idempotent. Default mode is --dry-run (everything runs inside a transaction
 * that is ROLLED BACK). Use --commit to persist. Counts are accurate in both
 * modes because the same upserts run either way.
 *
 * Usage:
 *   node scripts/seed_ingredient_dictionary_batch_1.js [--dry-run] [--commit] [--db-url <url>]
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const SOURCE = "seed_dictionary_batch_1";

// ── ingredient definitions ───────────────────────────────────────────────────
// categoryKeywords are used to resolve a category ONLY against existing
// confirmed/imported category names. preferredCategory is the exact name we
// expect; it is still verified against the live category set before use.
const INGREDIENTS = [
  {
    canonical: "paracetamol", display: "Paracetamol",
    synonyms: ["paracetamol", "acetaminophen"],
    drugClass: "Analgesic/Antipyretic",
    indications: ["Pain", "Fever"],
    preferredCategory: "3ยาแก้ปวด",
  },
  {
    canonical: "amoxicillin", display: "Amoxicillin",
    synonyms: ["amoxicillin", "amoxycillin", "amoxicillin trihydrate"],
    drugClass: "Antibiotic (Penicillin)",
    indications: ["Bacterial infection"],
    preferredCategory: "2ยาฆ่าเชื้อ",
  },
  {
    canonical: "ibuprofen", display: "Ibuprofen",
    synonyms: ["ibuprofen"],
    drugClass: "NSAID",
    indications: ["Pain", "Inflammation", "Fever"],
    preferredCategory: "3ยาแก้ปวด",
  },
  {
    canonical: "diclofenac", display: "Diclofenac",
    synonyms: ["diclofenac", "diclofenac sodium", "diclofenac potassium", "diclofenac diethylamine"],
    drugClass: "NSAID",
    indications: ["Pain", "Inflammation"],
    preferredCategory: "3ยาแก้ปวด",
  },
  {
    canonical: "clotrimazole", display: "Clotrimazole",
    synonyms: ["clotrimazole"],
    drugClass: "Antifungal",
    indications: ["Fungal infection"],
    preferredCategory: "2ยาฆ่าเชื้อรา",
  },
  {
    canonical: "triamcinolone", display: "Triamcinolone",
    synonyms: ["triamcinolone", "triamcinolone acetonide"],
    drugClass: "Corticosteroid",
    indications: ["Inflammation", "Allergy"],
    preferredCategory: null, // topical/oral/injectable steroid — no clean shelf; report uncertain
  },
  {
    canonical: "betamethasone", display: "Betamethasone",
    synonyms: ["betamethasone", "betamethasone valerate", "betamethasone dipropionate"],
    drugClass: "Corticosteroid",
    indications: ["Inflammation", "Allergy"],
    preferredCategory: null, // topical steroid vs systemic — ambiguous; report uncertain
  },
  {
    canonical: "metformin", display: "Metformin",
    synonyms: ["metformin", "metformin hydrochloride", "metformin hcl"],
    drugClass: "Antidiabetic (Biguanide)",
    indications: ["Diabetes"],
    preferredCategory: "8ยาเบาหวาน",
  },
  {
    canonical: "atorvastatin", display: "Atorvastatin",
    synonyms: ["atorvastatin", "atorvastatin calcium"],
    drugClass: "Statin (Lipid-lowering)",
    indications: ["Hyperlipidemia"],
    preferredCategory: "8ยาลดไขมัน",
  },
  {
    canonical: "ketoconazole", display: "Ketoconazole",
    synonyms: ["ketoconazole"],
    drugClass: "Antifungal",
    indications: ["Fungal infection"],
    preferredCategory: "2ยาฆ่าเชื้อรา",
  },
  {
    canonical: "etoricoxib", display: "Etoricoxib",
    synonyms: ["etoricoxib"],
    drugClass: "NSAID (COX-2 inhibitor)",
    indications: ["Pain", "Inflammation"],
    preferredCategory: "3ยาแก้ปวด",
  },
  {
    canonical: "acetylcysteine", display: "Acetylcysteine",
    synonyms: ["acetylcysteine", "n-acetylcysteine"],
    drugClass: "Mucolytic",
    indications: ["Mucus/Phlegm"],
    preferredCategory: "ละลายเสมหะ",
  },
  {
    canonical: "cetirizine", display: "Cetirizine",
    synonyms: ["cetirizine", "cetirizine hydrochloride", "cetirizine hcl", "cetirizine dihydrochloride"],
    drugClass: "Antihistamine",
    indications: ["Allergy"],
    preferredCategory: "2ยาแก้แพ้",
  },
  {
    canonical: "loratadine", display: "Loratadine",
    synonyms: ["loratadine"],
    drugClass: "Antihistamine",
    indications: ["Allergy"],
    preferredCategory: "2ยาแก้แพ้",
  },
  {
    canonical: "bromhexine", display: "Bromhexine",
    synonyms: ["bromhexine", "bromhexine hydrochloride", "bromhexine hcl"],
    drugClass: "Mucolytic",
    indications: ["Mucus/Phlegm"],
    preferredCategory: "ละลายเสมหะ",
  },
  {
    canonical: "simethicone", display: "Simethicone",
    synonyms: ["simethicone", "simeticone"],
    drugClass: "Antiflatulent",
    indications: ["Bloating/Flatulence"],
    preferredCategory: "ขับลม",
  },
  {
    canonical: "amlodipine", display: "Amlodipine",
    synonyms: ["amlodipine", "amlodipine besylate", "amlodipine besilate", "amlodipine maleate"],
    drugClass: "Calcium channel blocker",
    indications: ["Hypertension"],
    preferredCategory: "7ยาความดัน",
  },
  {
    canonical: "pregabalin", display: "Pregabalin",
    synonyms: ["pregabalin"],
    drugClass: "Neuropathic pain agent",
    indications: ["Neuropathic pain"],
    preferredCategory: "3ยาแก้ปวดชา",
  },
  {
    canonical: "omeprazole", display: "Omeprazole",
    synonyms: ["omeprazole"],
    drugClass: "Proton pump inhibitor",
    indications: ["Acid reflux/Gastric acid"],
    preferredCategory: "4ยาลดกรด",
  },
  {
    canonical: "dextromethorphan", display: "Dextromethorphan",
    synonyms: ["dextromethorphan", "dextromethorphan hydrobromide", "dextromethorphan hbr"],
    drugClass: "Antitussive",
    indications: ["Cough"],
    preferredCategory: "2ยาแก้ไอ",
  },
];

// ── env / db (shared pattern with other scripts) ─────────────────────────────
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

// ── upsert helpers (RETURNING (xmax = 0) AS inserted to detect fresh inserts) ──
async function loadCategorySet(client) {
  const result = await client.query(`
    SELECT DISTINCT category_name
    FROM ada.product_category_states
    WHERE review_status IN ('confirmed', 'imported_exact_match')
      AND category_name IS NOT NULL
      AND BTRIM(category_name) <> ''
  `);
  return new Set(result.rows.map((r) => r.category_name));
}

async function upsertIngredient(client, { canonical, display }) {
  const r = await client.query(
    `
      INSERT INTO knowledge.ingredients (canonical_name, display_name, status, updated_at)
      VALUES ($1, $2, 'active', now())
      ON CONFLICT (canonical_name) DO UPDATE SET
        display_name = EXCLUDED.display_name, status = 'active', updated_at = now()
      RETURNING ingredient_id, (xmax = 0) AS inserted
    `,
    [canonical, display],
  );
  return { id: Number(r.rows[0].ingredient_id), inserted: r.rows[0].inserted };
}

async function insertSynonymIfMissing(client, { ingredientId, synonymText }) {
  const r = await client.query(
    `
      INSERT INTO knowledge.ingredient_synonyms
        (ingredient_id, synonym_text, language, source, status, updated_at)
      SELECT $1, $2, 'en', $3, 'active', now()
      WHERE NOT EXISTS (
        SELECT 1 FROM knowledge.ingredient_synonyms
        WHERE LOWER(BTRIM(synonym_text)) = LOWER(BTRIM($2))
      )
      RETURNING synonym_id
    `,
    [ingredientId, synonymText, SOURCE],
  );
  return r.rowCount > 0;
}

async function upsertDrugClass(client, name) {
  const r = await client.query(
    `
      INSERT INTO knowledge.drug_classes (name, status, updated_at)
      VALUES ($1, 'active', now())
      ON CONFLICT (name) DO UPDATE SET status = 'active', updated_at = now()
      RETURNING drug_class_id, (xmax = 0) AS inserted
    `,
    [name],
  );
  return { id: Number(r.rows[0].drug_class_id), inserted: r.rows[0].inserted };
}

async function upsertIndication(client, name) {
  const r = await client.query(
    `
      INSERT INTO knowledge.indications (name, status, updated_at)
      VALUES ($1, 'active', now())
      ON CONFLICT (name) DO UPDATE SET status = 'active', updated_at = now()
      RETURNING indication_id, (xmax = 0) AS inserted
    `,
    [name],
  );
  return { id: Number(r.rows[0].indication_id), inserted: r.rows[0].inserted };
}

async function upsertIngredientDrugClass(client, { ingredientId, drugClassId }) {
  const r = await client.query(
    `
      INSERT INTO knowledge.ingredient_drug_classes
        (ingredient_id, drug_class_id, confidence, source, status, confirmed_by, confirmed_at, updated_at)
      VALUES ($1, $2, 1, $3, 'confirmed', $3, now(), now())
      ON CONFLICT (ingredient_id, drug_class_id) DO UPDATE SET
        source = EXCLUDED.source, status = 'confirmed', updated_at = now()
      RETURNING (xmax = 0) AS inserted
    `,
    [ingredientId, drugClassId, SOURCE],
  );
  return r.rows[0].inserted;
}

async function upsertIngredientIndication(client, { ingredientId, indicationId }) {
  const r = await client.query(
    `
      INSERT INTO knowledge.ingredient_indications
        (ingredient_id, indication_id, source, status, confirmed_by, confirmed_at, updated_at)
      VALUES ($1, $2, $3, 'confirmed', $3, now(), now())
      ON CONFLICT (ingredient_id, indication_id) DO UPDATE SET
        source = EXCLUDED.source, status = 'confirmed', updated_at = now()
      RETURNING (xmax = 0) AS inserted
    `,
    [ingredientId, indicationId, SOURCE],
  );
  return r.rows[0].inserted;
}

async function insertCategoryRuleIfMissing(client, { ingredientId, categoryName, priority, note }) {
  const r = await client.query(
    `
      INSERT INTO knowledge.ingredient_category_rules
        (ingredient_id, drug_class_id, indication_id, category_name, priority, rule_status, note, created_by, updated_at)
      SELECT $1, NULL, NULL, $2, $3, 'active', $4, $5, now()
      WHERE NOT EXISTS (
        SELECT 1 FROM knowledge.ingredient_category_rules
        WHERE ingredient_id = $1 AND drug_class_id IS NULL AND indication_id IS NULL
          AND category_name = $2 AND created_by = $5
      )
      RETURNING rule_id
    `,
    [ingredientId, categoryName, priority, note, SOURCE],
  );
  return r.rowCount > 0;
}

// ── main seed routine ────────────────────────────────────────────────────────
async function seed(client, { commit }) {
  const stats = {
    mode: commit ? "commit" : "dry-run",
    ingredients: { inserted: 0, skipped: 0 },
    synonyms: { inserted: 0, skipped: 0 },
    drugClassMappings: { inserted: 0, skipped: 0 },
    indicationMappings: { inserted: 0, skipped: 0 },
    categoryRules: { inserted: 0, skipped: 0 },
    uncertainCategoryMappings: [],
  };

  await client.query("BEGIN");
  try {
    const categorySet = await loadCategorySet(client);

    for (const def of INGREDIENTS) {
      const ing = await upsertIngredient(client, def);
      if (ing.inserted) stats.ingredients.inserted += 1; else stats.ingredients.skipped += 1;

      for (const synonymText of def.synonyms) {
        const inserted = await insertSynonymIfMissing(client, { ingredientId: ing.id, synonymText });
        if (inserted) stats.synonyms.inserted += 1; else stats.synonyms.skipped += 1;
      }

      const dc = await upsertDrugClass(client, def.drugClass);
      const dcMap = await upsertIngredientDrugClass(client, { ingredientId: ing.id, drugClassId: dc.id });
      if (dcMap) stats.drugClassMappings.inserted += 1; else stats.drugClassMappings.skipped += 1;

      for (const indicationName of def.indications) {
        const ind = await upsertIndication(client, indicationName);
        const indMap = await upsertIngredientIndication(client, { ingredientId: ing.id, indicationId: ind.id });
        if (indMap) stats.indicationMappings.inserted += 1; else stats.indicationMappings.skipped += 1;
      }

      // category rule — only when a clearly suitable EXISTING category is present
      const resolvedCategory =
        def.preferredCategory && categorySet.has(def.preferredCategory) ? def.preferredCategory : null;

      if (resolvedCategory) {
        const ruleInserted = await insertCategoryRuleIfMissing(client, {
          ingredientId: ing.id,
          categoryName: resolvedCategory,
          priority: 20,
          note: `Batch 1 ingredient rule: ${def.display} -> ${def.drugClass} -> ${resolvedCategory}`,
        });
        if (ruleInserted) stats.categoryRules.inserted += 1; else stats.categoryRules.skipped += 1;
      } else {
        stats.uncertainCategoryMappings.push({
          ingredient: def.display,
          drugClass: def.drugClass,
          preferredCategory: def.preferredCategory,
          reason: def.preferredCategory
            ? `Preferred category "${def.preferredCategory}" not found among confirmed/imported categories`
            : "No clearly suitable existing category (deliberately deferred)",
        });
      }
    }

    if (commit) {
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK"); // dry-run: discard everything, counts already collected
    }
    return stats;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function printSummary(stats) {
  const lines = [];
  lines.push("==================================================");
  lines.push(` INGREDIENT DICTIONARY SEED — BATCH 1  [${stats.mode.toUpperCase()}]`);
  lines.push("==================================================");
  lines.push(`Ingredients      : inserted ${stats.ingredients.inserted}, skipped ${stats.ingredients.skipped}`);
  lines.push(`Synonyms         : inserted ${stats.synonyms.inserted}, skipped ${stats.synonyms.skipped}`);
  lines.push(`Drug-class maps  : inserted ${stats.drugClassMappings.inserted}, skipped ${stats.drugClassMappings.skipped}`);
  lines.push(`Indication maps  : inserted ${stats.indicationMappings.inserted}, skipped ${stats.indicationMappings.skipped}`);
  lines.push(`Category rules   : inserted ${stats.categoryRules.inserted}, skipped ${stats.categoryRules.skipped}`);
  lines.push("");
  lines.push(`Uncertain category mappings (no rule written): ${stats.uncertainCategoryMappings.length}`);
  for (const u of stats.uncertainCategoryMappings) {
    lines.push(`  - ${u.ingredient} (${u.drugClass}): ${u.reason}`);
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
    console.log("node scripts/seed_ingredient_dictionary_batch_1.js [--dry-run] [--commit] [--db-url <url>]");
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
    console.error(`Batch 1 seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseCliArgs, seed, INGREDIENTS };
