#!/usr/bin/env node
"use strict";

/**
 * Ingredient Dictionary Seed — Batch 35
 * Women's health & reproductive cluster — 17 entries.
 *
 * STRUCTURE:
 *   Part A — 6 compound traditional formulas (ยาตำรับ สตรี / Post-partum)
 *   Part B — 9 new single herbs (ไพล, ขมิ้นอ้อย, ดีปลี, ฝาง, โกฐเชียง,
 *             กวาวเครือขาว, ไวเท็กซ์, EPO, เรดโคลเวอร์)
 *   Part C — 2 existing ingredients (synonym additions only, will upsert)
 *
 * ── COMPOUND FORMULA RULE (Part A) ──────────────────────────────────────────
 *   Same precedent as Triphala / ยาประสะมะแว้ง (batch 24): each compound
 *   formula is its OWN ingredient entry, NOT a synonym of its component herbs.
 *   ยาประสะไพล ≠ ไพล; ยาปลูกไฟธาตุ ≠ any single component herb.
 *
 * ── KEY DISAMBIGUATION NOTES ────────────────────────────────────────────────
 *   ขมิ้นอ้อย (Curcuma zedoaria) ≠ ขมิ้นชัน (C. longa / batch 19)
 *     Different species: different aroma, different bioactives, different use.
 *     ขมิ้นอ้อย = carminative/digestive; ขมิ้นชัน = anti-inflammatory/curcumin.
 *
 *   กวาวเครือขาว (Pueraria mirifica) ≠ กวาวเครือแดง (Butea superba)
 *     กวาวเครือขาว = phytoestrogens (miroestrol) → women's health
 *     กวาวเครือแดง = phytoandrogenins → men's health (completely different product)
 *     Do NOT merge. Do NOT add "กวาวเครือ" alone as synonym for either.
 *
 *   ดีปลี (Piper retrofractum): "piperine" is NOT included as synonym because
 *     piperine is also the primary bioactive of Piper nigrum (black pepper).
 *     Including piperine would false-match all black pepper / bioperine products.
 *
 *   อีฟนิ่งพริมโรส / EPO: "GLA" included because it appears as standalone label
 *     claim on EPO capsule labels ("GLA 10%", "GLA 45mg"). Caveat: GLA is also
 *     in borage oil (higher %) and black currant seed oil — flag during audit if a
 *     non-EPO product matches via GLA.
 *
 *   miroestrol included for กวาวเครือขาว: highly species-specific phytoestrogen
 *     not found in other plants; appears as potency claim on premium products.
 *
 * ── EXISTING INGREDIENT RE-ADDS (Part C) ────────────────────────────────────
 *   ชะเอมเทศ / glycyrrhiza glabra (batch 24): upsert adds "licorice root" synonym
 *   รากสามสิบ / asparagus racemosus (batch 34): upsert adds "รากสามสิบ" synonym
 *   All other synonyms are already in DB and will be skipped silently.
 *
 * Total: 17 ingredients, ~116 synonyms (Thai: ~45, English/scientific: ~71)
 *
 * Default --dry-run; --commit persists.
 *   node scripts/seed_ingredient_dictionary_batch35.js [--dry-run|--commit] [--db-url <url>]
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const SOURCE = "seed_dictionary_batch_35";

const MODELING_NOTES = [
  "Batch 35 = women's health cluster; 17 entries: 6 compound formulas + 9 single herbs + 2 existing re-adds.",
  "COMPOUND FORMULA RULE: ยาประสะไพล/ยาปลูกไฟธาตุ/etc. are OWN entries (Triphala precedent, batch 24).",
  "ขมิ้นอ้อย (Curcuma zedoaria) ≠ ขมิ้นชัน (Curcuma longa, batch 19): different species, different bioactives.",
  "กวาวเครือขาว (P. mirifica, phytoestrogen) ≠ กวาวเครือแดง (Butea superba, phytoandrogen): do NOT merge.",
  "  'กวาวเครือ' alone NOT used as synonym for either species.",
  "ดีปลี (P. retrofractum): 'piperine' excluded — also primary bioactive of black pepper (P. nigrum) → false match.",
  "EPO 'GLA' included: standalone label claim on EPO capsules. Audit flag: GLA also in borage oil and black currant.",
  "'miroestrol' included for กวาวเครือขาว: highly species-specific phytoestrogen, appears on premium product labels.",
  "ชะเอมเทศ (batch 24) + รากสามสิบ (batch 34) already in DB; upsert adds missing synonyms only.",
  "  ชะเอมเทศ: adds 'licorice root'; รากสามสิบ: adds Thai synonym 'รากสามสิบ'.",
];

const INGREDIENTS = [
  // ─────────────────────────────────────────────────────────────────────────
  // PART A — COMPOUND TRADITIONAL FORMULAS (ยาตำรับ สตรี / Post-partum)
  // ─────────────────────────────────────────────────────────────────────────
  {
    canonical: "ยาประสะไพล",
    display: "ยาประสะไพล (Plai Post-partum Formula)",
    drugClass: "Thai traditional compound formula (Post-partum / ยาสตรี)",
    indications: [
      "Post-partum recovery (traditional Thai)",
      "Anti-inflammatory (traditional Thai formula)",
      "Carminative (traditional Thai)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: ["ยาประสะไพล", "ya prasa plai", "plai compound formula"],
  },
  {
    canonical: "ยาปลูกไฟธาตุ",
    display: "ยาปลูกไฟธาตุ (Digestive-Fire Post-partum Formula)",
    drugClass: "Thai traditional compound formula (Post-partum / ไฟธาตุ)",
    indications: [
      "Post-partum recovery (traditional Thai)",
      "Digestive tonic (traditional Thai formula)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: ["ยาปลูกไฟธาตุ", "ya pluk fai that"],
  },
  {
    canonical: "ยาไฟประลัยกัลป์",
    display: "ยาไฟประลัยกัลป์ (Post-partum Fire Formula)",
    drugClass: "Thai traditional compound formula (Post-partum / Strong tonic)",
    indications: [
      "Post-partum recovery (traditional Thai)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: ["ยาไฟประลัยกัลป์", "ya fai pralai kan"],
  },
  {
    canonical: "ยาไฟห้ากอง",
    display: "ยาไฟห้ากอง (Five-Fires Traditional Formula)",
    drugClass: "Thai traditional compound formula (Five-fires / Post-partum)",
    indications: [
      "Post-partum recovery (traditional Thai)",
      "Traditional Thai tonic (ยาบำรุง)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: ["ยาไฟห้ากอง", "ya fai ha kong"],
  },
  {
    canonical: "ยาเลือดงาม",
    display: "ยาเลือดงาม (Blood-Nourishing Women's Formula)",
    drugClass: "Thai traditional compound formula (Blood tonic / Women's health)",
    indications: [
      "Blood-nourishing tonic (traditional Thai)",
      "Female reproductive tonic (traditional Thai)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: ["ยาเลือดงาม", "ya lueat ngam"],
  },
  {
    canonical: "ยาสตรีหลังคลอด",
    display: "ยาสตรีหลังคลอด (Post-partum Women's Medicine)",
    drugClass: "Thai traditional compound formula (Post-partum / Women's health)",
    indications: [
      "Post-partum recovery (traditional Thai)",
      "Female reproductive tonic (traditional Thai)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: ["ยาสตรีหลังคลอด", "ya satri lang klod"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PART B — SINGLE HERBS (9 new ingredients)
  // ─────────────────────────────────────────────────────────────────────────
  {
    canonical: "zingiber montanum",
    display: "Plai / Cassumunar Ginger (ไพล / Zingiber montanum)",
    drugClass: "Herbal anti-inflammatory / Analgesic (Zingiber montanum / Plai)",
    indications: [
      "Anti-inflammatory (herbal)",
      "Analgesic / Muscle pain (herbal)",
      "Post-partum tonic (herbal)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      // ── Thai names ───────────────────────────────────────────────────────
      "ไพล",
      "เหง้าไพล",
      "สารสกัดไพล",
      "น้ำมันไพล",
      "ไพลสกัด",
      "สมุนไพรไพล",
      // ── Botanical (current + accepted older synonym) ─────────────────────
      "zingiber montanum",
      "zingiber cassumunar",
      "zingiber montanum extract",
      // ── English common / product names ───────────────────────────────────
      "plai",
      "plai oil",
      "plai essential oil",
      "cassumunar ginger",
      "thai ginger",
    ],
  },
  {
    canonical: "curcuma zedoaria",
    display: "Zedoary / Kha Min Oi (ขมิ้นอ้อย / Curcuma zedoaria)",
    drugClass: "Herbal carminative / Digestive anti-spasmodic (Curcuma zedoaria / Zedoary)",
    indications: [
      "Carminative / Digestive tonic (herbal)",
      "Anti-inflammatory (herbal)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      // ── Thai names ───────────────────────────────────────────────────────
      "ขมิ้นอ้อย",
      "เหง้าขมิ้นอ้อย",
      "สารสกัดขมิ้นอ้อย",
      // ── Botanical / English ──────────────────────────────────────────────
      "curcuma zedoaria",
      "curcuma zedoaria extract",
      "zedoary",
      "white turmeric",
      "zedoary extract",
    ],
  },
  {
    canonical: "piper retrofractum",
    display: "Long Pepper / Dee Pli (ดีปลี / Piper retrofractum)",
    drugClass: "Herbal carminative / Bioavailability enhancer (Piper retrofractum / Long pepper)",
    indications: [
      "Carminative (herbal)",
      "Digestive stimulant (herbal)",
      "Anti-inflammatory (herbal)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      // ── Thai names ───────────────────────────────────────────────────────
      "ดีปลี",
      "ผลดีปลี",
      "สารสกัดดีปลี",
      // ── Botanical / English ──────────────────────────────────────────────
      "piper retrofractum",
      "piper retrofractum extract",
      "long pepper",
      "javanese long pepper",
      "long pepper extract",
    ],
  },
  {
    canonical: "caesalpinia sappan",
    display: "Sappanwood / Fang (ฝาง / Caesalpinia sappan)",
    drugClass: "Herbal hemostat / Blood-regulating (Caesalpinia sappan / Sappanwood)",
    indications: [
      "Blood-nourishing tonic (herbal)",
      "Anti-inflammatory (herbal)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      // ── Thai names ───────────────────────────────────────────────────────
      "ฝาง",
      "แก่นฝาง",
      "สารสกัดฝาง",
      // ── Botanical / English ──────────────────────────────────────────────
      "caesalpinia sappan",
      "caesalpinia sappan extract",
      "sappanwood",
      "sappan wood",
      "sappan wood extract",
    ],
  },
  {
    canonical: "angelica sinensis",
    display: "Dong Quai / Tang Kuei (โกฐเชียง / ตังกุย / Angelica sinensis)",
    drugClass: "Herbal female tonic / Blood tonic (Angelica sinensis / Dong quai)",
    indications: [
      "Female reproductive tonic (herbal)",
      "Blood-nourishing tonic (herbal)",
      "Menstrual regulation (herbal)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      // ── Thai names ───────────────────────────────────────────────────────
      "โกฐเชียง",
      "ตังกุย",
      "ตั้งกุ้ย",
      "สารสกัดตังกุย",
      "สารสกัดโกฐเชียง",
      "รากตังกุย",
      // ── Botanical / English ──────────────────────────────────────────────
      "angelica sinensis",
      "angelica sinensis root",
      "angelica sinensis root extract",
      "angelica sinensis extract",
      "dong quai",
      "dong quai root",
      "dong quai extract",
      "dang gui",
      "dang gui root",
      "female ginseng",
    ],
  },
  {
    canonical: "pueraria mirifica",
    display: "White Kwao Krua (กวาวเครือขาว / Pueraria mirifica)",
    drugClass: "Herbal phytoestrogen / Female tonic (Pueraria mirifica / White Kwao Krua)",
    indications: [
      "Phytoestrogen / Menopausal support (herbal)",
      "Female reproductive tonic (herbal)",
      "Breast health (herbal)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      // ── Thai names ───────────────────────────────────────────────────────
      "กวาวเครือขาว",
      "สารสกัดกวาวเครือขาว",
      "กวาวเครือขาวสกัด",
      "สมุนไพรกวาวเครือขาว",
      // ── Botanical / English ──────────────────────────────────────────────
      "pueraria mirifica",
      "pueraria mirifica extract",
      "white kwao krua",
      "kwao krua extract",
      "kwao krua khao",
      // ── Species-specific bioactive (standalone label claim) ───────────────
      "miroestrol",
    ],
  },
  {
    canonical: "vitex agnus-castus",
    display: "Chasteberry / Vitex (ไวเท็กซ์ / Vitex agnus-castus)",
    drugClass: "Herbal hormonal modulator / PMS (Vitex agnus-castus / Chasteberry)",
    indications: [
      "PMS / Premenstrual syndrome (herbal)",
      "Hormonal balance (herbal)",
      "Female reproductive tonic (herbal)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      // ── Thai names ───────────────────────────────────────────────────────
      "ไวเท็กซ์",
      "สารสกัดไวเท็กซ์",
      // ── Botanical / English ──────────────────────────────────────────────
      "vitex agnus-castus",
      "vitex agnus castus",
      "vitex",
      "vitex extract",
      "chasteberry",
      "chasteberry extract",
      "chaste tree berry",
      "agnus castus",
      "monk's pepper",
    ],
  },
  {
    canonical: "oenothera biennis oil",
    display: "Evening Primrose Oil / EPO (อีฟนิ่งพริมโรส / Oenothera biennis)",
    drugClass: "Herbal omega-6 / GLA supplement (Oenothera biennis / Evening primrose)",
    indications: [
      "PMS / Premenstrual syndrome (herbal)",
      "Skin health / Eczema (herbal)",
      "Breast pain / Mastalgia (herbal)",
    ],
    preferredCategory: "อาหารเสริม",
    synonyms: [
      // ── Thai names ───────────────────────────────────────────────────────
      "น้ำมันอีฟนิ่งพริมโรส",
      "อีฟนิ่งพริมโรส",
      // ── Botanical / English ──────────────────────────────────────────────
      "oenothera biennis",
      "oenothera biennis oil",
      "oenothera biennis seed oil",
      "evening primrose oil",
      "evening primrose",
      "evening primrose oil extract",
      // ── Abbreviation / bioactive (standalone label claim) ─────────────────
      "epo",
      "gla",
      "gamma-linolenic acid",
    ],
  },
  {
    canonical: "trifolium pratense",
    display: "Red Clover (เรดโคลเวอร์ / Trifolium pratense)",
    drugClass: "Herbal phytoestrogen / Isoflavone (Trifolium pratense / Red clover)",
    indications: [
      "Phytoestrogen / Menopausal support (herbal)",
      "Cardiovascular support (herbal)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      // ── Thai names ───────────────────────────────────────────────────────
      "เรดโคลเวอร์",
      "สารสกัดเรดโคลเวอร์",
      // ── Botanical / English ──────────────────────────────────────────────
      "trifolium pratense",
      "trifolium pratense extract",
      "red clover",
      "red clover extract",
      "red clover isoflavones",
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PART C — EXISTING INGREDIENTS (synonym additions; upsert finds existing ID)
  // ─────────────────────────────────────────────────────────────────────────
  {
    // batch 24 ingredient — adds only "licorice root" (was missing)
    canonical: "glycyrrhiza glabra",
    display: "Licorice Root / Cha-em Thet (ชะเอมเทศ / Glycyrrhiza glabra)",
    drugClass: "Herbal adaptogen / Anti-inflammatory (Glycyrrhiza glabra / Licorice)",
    indications: [
      "Anti-inflammatory (herbal)",
      "Expectorant / Cough (herbal)",
      "Adaptogen (herbal)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      "ชะเอมเทศ",
      "glycyrrhiza glabra",
      "licorice root",
    ],
  },
  {
    // batch 34 ingredient — adds "รากสามสิบ" Thai synonym (was missing)
    canonical: "asparagus racemosus",
    display: "Shatavari / Cha Phao (สตาวะ / ชะเพาะ / Asparagus racemosus)",
    drugClass: "Herbal adaptogen / Female tonic (Asparagus racemosus / Shatavari)",
    indications: [
      "Female reproductive tonic (herbal)",
      "Galactagogue / Lactation support (herbal)",
      "Adaptogen / Stress support (herbal)",
    ],
    preferredCategory: "ยาสมุนไพร",
    synonyms: [
      "รากสามสิบ",
      "asparagus racemosus",
      "shatavari",
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
    if (seen.has(def.canonical)) throw new Error(`Duplicate canonical: ${def.canonical}`);
    seen.add(def.canonical);
  }

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
          if (stats.skippedSynonymSamples.length < 30) stats.skippedSynonymSamples.push(`${synonymText} (-> ${def.canonical})`);
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
          note: `Batch 35 rule: ${def.canonical} -> ${resolvedCategory}`,
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
  lines.push(` INGREDIENT DICTIONARY SEED — BATCH 35 (Women's Health Cluster)  [${stats.mode.toUpperCase()}]`);
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
  for (const pi of stats.perIngredient) {
    lines.push(`  ${pi.synonymsInserted > 0 ? "+" : "~"} ${pi.synonymsInserted} new / ${pi.synonymsSkipped} skipped  →  ${pi.name}`);
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
    lines.push("  → Confirm categories via Review Queue, then re-run --commit to attach rules.");
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
  if (args.help) { console.log("node scripts/seed_ingredient_dictionary_batch35.js [--dry-run|--commit] [--db-url <url>]"); return; }
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
  main().catch((err) => { console.error(`Batch 35 seed failed: ${err.message}`); process.exitCode = 1; });
}

module.exports = { parseCliArgs, seed, INGREDIENTS };
