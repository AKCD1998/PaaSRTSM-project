#!/usr/bin/env node
"use strict";

/**
 * Ingredient Dictionary Seed — Batch 5 (Set 5 Group A: supplements).
 *
 * Collagen, Zinc, Fish Oil/Omega-3, Glutathione, Vitamin A/D/E/K, Glucosamine,
 * Chondroitin. English + Thai synonyms are stored; the (Latin-only) matcher uses
 * the English ones — Thai synonyms are kept for admin search / future Thai-aware
 * matching and are skipped by the scanner (they normalize to empty).
 *
 * Excluded per agreement: short biochem abbreviations (Zn/EPA/DHA/GSH/D2/D3/K1/
 * K2/MK-7/UC-II/NAG/CS...) and retinoid/active-D DRUGS that already exist as their
 * own ingredients (tretinoin, isotretinoin, adapalene, calcitriol, alfacalcidol).
 *
 * Same safe/idempotent pattern as batches 1-4. Default --dry-run; --commit persists.
 *   node scripts/seed_ingredient_dictionary_batch5.js [--dry-run|--commit] [--db-url <url>]
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const SOURCE = "seed_dictionary_batch_5";
const VITAMIN = "วิตามิน";
const JOINT = "9ยาข้อเข่า";

const EXCLUDED_ABBREVIATIONS = ["UC-II", "UC II", "CTP", "Zn", "EPA", "DHA", "ALA", "rTG", "TG", "GSH", "GSSG", "VA", "D2", "D3", "VD", "VE", "K1", "K2", "K3", "MK-4", "MK4", "MK-7", "MK7", "GS", "GH", "HCl", "NAG", "CS", "CDS"];
const EXCLUDED_DRUGS = ["tretinoin", "isotretinoin", "adapalene", "retinoic acid", "calcitriol", "alfacalcidol", "alpha-calcidol", "menadione sodium bisulfite"];

const MODELING_NOTES = [
  "Thai synonyms are stored for admin search but DO NOT drive product matching yet (matcher is Latin-only; product names carry English forms).",
  "Short biochem abbreviations excluded (Zn/EPA/DHA/GSH/D2/D3/K1/K2/MK-7/UC-II/NAG/CS/...).",
  "Retinoid / active-vitamin-D DRUGS excluded from synonyms — they exist as their own ingredients (tretinoin, isotretinoin, adapalene) or are out of scope (calcitriol, alfacalcidol).",
  "zinc ascorbate already belongs to Vitamin C (batch 3) — skips here.",
  "Glucosamine + Chondroitin -> 9ยาข้อเข่า; the rest -> วิตามิน.",
];

const INGREDIENTS = [
  {
    canonical: "collagen", display: "Collagen", drugClass: "Supplement (Collagen)", indications: ["Skin/Joint supplement"], preferredCategory: VITAMIN,
    synonyms: [
      // English
      "collagen", "hydrolyzed collagen", "hydrolysed collagen", "collagen hydrolysate", "collagen peptide", "collagen peptides",
      "collagen tri-peptide", "collagen tripeptide", "marine collagen", "fish collagen", "bovine collagen", "porcine collagen",
      "chicken collagen", "type 1 collagen", "type i collagen", "type 2 collagen", "type ii collagen", "type 3 collagen",
      "type iii collagen", "undenatured collagen", "undenatured type ii collagen", "native type ii collagen", "collagen powder",
      "collagen drink", "collagen jelly", "liquid collagen", "hydrolyzed collagen peptide", "fish collagen peptide",
      "marine collagen peptide", "collagen type i", "collagen type ii", "collagen type iii",
      // Thai
      "คอลลาเจน", "คอลลาเจนเปปไทด์", "คอลลาเจนเพปไทด์", "ไฮโดรไลซ์คอลลาเจน", "ไฮโดรไลซ์ คอลลาเจน", "คอลลาเจนไฮโดรไลเสต",
      "มารีนคอลลาเจน", "คอลลาเจนปลา", "คอลลาเจนจากปลา", "คอลลาเจนวัว", "คอลลาเจนไก่", "คอลลาเจนชนิดที่ 1", "คอลลาเจนชนิดที่ 2",
      "คอลลาเจนชนิดที่ 3", "คอลลาเจนไทป์ 1", "คอลลาเจนไทป์ 2", "คอลลาเจนไทป์ 3", "คอลลาเจนผง", "คอลลาเจนดื่ม", "คอลลาเจนพร้อมดื่ม",
    ],
  },
  {
    canonical: "zinc", display: "Zinc", drugClass: "Mineral (Zinc)", indications: ["Supplement"], preferredCategory: VITAMIN,
    synonyms: [
      "zinc", "zinc supplement", "zinc mineral", "zinc chelate", "chelated zinc", "zinc amino acid chelate", "zinc amino chelate",
      "zinc gluconate", "zinc picolinate", "zinc citrate", "zinc sulfate", "zinc sulphate", "zinc oxide", "zinc acetate",
      "zinc bisglycinate", "zinc glycinate", "zinc methionine", "zinc lactate", "zinc carbonate", "zinc chloride", "zinc ascorbate",
      "zinc orotate", "zinc gluconate dihydrate", "zinc sulfate monohydrate", "zinc sulfate heptahydrate",
      "ซิงค์", "ซิ้งค์", "สังกะสี", "แร่ธาตุสังกะสี", "ซิงค์คีเลต", "สังกะสีคีเลต", "ซิงค์อะมิโนแอซิดคีเลต", "ซิงค์อะมิโนคีเลต",
      "ซิงค์กลูโคเนต", "ซิงค์พิโคลิเนต", "ซิงค์ซิเตรต", "ซิงค์ซัลเฟต", "ซิงค์ออกไซด์", "ซิงค์อะซิเตต", "ซิงค์ไบสไกลซิเนต",
      "สังกะสีกลูโคเนต", "สังกะสีซัลเฟต",
    ],
  },
  {
    canonical: "fish oil", display: "Fish Oil / Omega-3", drugClass: "Omega-3 fatty acid", indications: ["Supplement", "Cardiovascular"], preferredCategory: VITAMIN,
    synonyms: [
      "fish oil", "omega 3", "omega-3", "omega3", "omega 3 fatty acid", "omega-3 fatty acid", "omega 3 fatty acids",
      "omega-3 fatty acids", "marine oil", "deep sea fish oil", "salmon oil", "tuna oil", "anchovy oil", "sardine oil", "krill oil",
      "cod liver oil", "cod-liver oil", "codfish liver oil", "omega 3-6-9", "omega-3-6-9", "eicosapentaenoic acid",
      "docosahexaenoic acid", "ethyl ester fish oil", "omega-3 ethyl ester", "omega 3 ethyl ester", "re-esterified triglyceride",
      "natural triglyceride omega 3", "phospholipid omega 3", "epa ethyl ester", "dha ethyl ester",
      "น้ำมันปลา", "น้ํามันปลา", "น้ำมันปลาทะเล", "น้ำมันปลาทะเลน้ำลึก", "น้ำมันปลาแซลมอน", "น้ำมันตับปลา", "น้ํามันตับปลา",
      "น้ำมันคริลล์", "คริลล์ออยล์", "โอเมก้า 3", "โอเมก้า-3", "โอเมก้า3", "โอเมกา 3", "โอเมกา-3", "กรดไขมันโอเมก้า 3",
      "กรดไอโคซาเพนตะอีโนอิก", "กรดโดโคซาเฮกซาอีโนอิก",
    ],
  },
  {
    canonical: "glutathione", display: "Glutathione", drugClass: "Antioxidant", indications: ["Supplement", "Skin"], preferredCategory: VITAMIN,
    synonyms: [
      "glutathione", "l-glutathione", "l glutathione", "reduced glutathione", "reduced l-glutathione", "liposomal glutathione",
      "acetyl glutathione", "s-acetyl glutathione", "s acetyl glutathione", "n-acetyl glutathione", "setria glutathione",
      "l-glutathione reduced", "glutathione reduced form", "s-acetyl-l-glutathione", "n-acetyl-l-glutathione", "glutathione disulfide",
      "กลูตาไธโอน", "กลูต้าไธโอน", "กลูต้า", "แอลกลูตาไธโอน", "แอล-กลูตาไธโอน", "รีดิวซ์กลูตาไธโอน", "กลูตาไธโอนรีดิวซ์",
      "ไลโปโซมอลกลูตาไธโอน", "อะซิทิลกลูตาไธโอน",
    ],
  },
  {
    canonical: "vitamin a", display: "Vitamin A", drugClass: "Vitamin A", indications: ["Vitamin"], preferredCategory: VITAMIN,
    synonyms: [
      "vitamin a", "vitamin-a", "vit a", "provitamin a", "pro-vitamin a", "retinol", "retinal", "retinaldehyde", "retinoid",
      "beta carotene", "beta-carotene", "betacarotene", "carotene", "carotenoid", "retinyl palmitate", "retinol palmitate",
      "vitamin a palmitate", "retinyl acetate", "retinol acetate", "vitamin a acetate",
      "วิตามินเอ", "วิตามิน เอ", "ไวตามินเอ", "ไวตามิน เอ", "โปรวิตามินเอ", "เรตินอล", "เรทินอล", "เรตินัล", "เรตินัลดีไฮด์",
      "เรตินอยด์", "เบต้าแคโรทีน", "เบตาแคโรทีน", "เบต้า-แคโรทีน", "เบตา-แคโรทีน", "แคโรทีน", "เรตินิลปาลมิเตต", "เรตินิลพาลมิเตต",
      "เรตินิลอะซิเตต",
    ],
  },
  {
    canonical: "vitamin d", display: "Vitamin D", drugClass: "Vitamin D", indications: ["Vitamin"], preferredCategory: VITAMIN,
    synonyms: [
      "vitamin d", "vitamin-d", "vit d", "vitamin d2", "vitamin-d2", "vitamin d-2", "vitamin d3", "vitamin-d3", "vitamin d-3",
      "ergocalciferol", "cholecalciferol", "colecalciferol", "calciferol", "calcifediol", "calcidiol", "25-hydroxyvitamin d",
      "25 hydroxy vitamin d",
      "วิตามินดี", "วิตามิน ดี", "ไวตามินดี", "วิตามินดี2", "วิตามินดี 2", "วิตามินดี-2", "วิตามินดี3", "วิตามินดี 3", "วิตามินดี-3",
      "ดีทู", "ดีทรี", "เออร์โกแคลซิเฟอรอล", "โคเลแคลซิเฟอรอล", "โคลีแคลซิเฟอรอล",
    ],
  },
  {
    canonical: "vitamin e", display: "Vitamin E", drugClass: "Vitamin E", indications: ["Vitamin"], preferredCategory: VITAMIN,
    synonyms: [
      "vitamin e", "vitamin-e", "vit e", "tocopherol", "tocopherols", "alpha tocopherol", "alpha-tocopherol", "d alpha tocopherol",
      "d-alpha-tocopherol", "dl alpha tocopherol", "dl-alpha-tocopherol", "mixed tocopherols", "tocotrienol", "tocotrienols",
      "mixed tocotrienols", "tocopheryl acetate", "alpha tocopheryl acetate", "d-alpha tocopheryl acetate",
      "dl-alpha tocopheryl acetate", "tocopherol acetate", "vitamin e acetate", "tocopheryl succinate", "alpha tocopheryl succinate",
      "tocopherol succinate", "vitamin e succinate", "tocopheryl nicotinate",
      "วิตามินอี", "วิตามิน อี", "ไวตามินอี", "โทโคฟีรอล", "โทโคเฟอรอล", "อัลฟาโทโคฟีรอล", "ดีอัลฟาโทโคฟีรอล", "ดีแอลอัลฟาโทโคฟีรอล",
      "มิกซ์โทโคฟีรอล", "โทโคไตรอีนอล", "โทโคไตรอีนอลส์", "โทโคฟีริลอะซิเตต", "โทโคฟีรอลอะซิเตต", "โทโคฟีริลซักซิเนต",
    ],
  },
  {
    canonical: "vitamin k", display: "Vitamin K", drugClass: "Vitamin K", indications: ["Vitamin"], preferredCategory: VITAMIN,
    synonyms: [
      "vitamin k", "vitamin-k", "vit k", "vitamin k1", "vitamin-k1", "vitamin k-1", "vitamin k2", "vitamin-k2", "vitamin k-2",
      "vitamin k3", "vitamin-k3", "vitamin k-3", "phylloquinone", "phytonadione", "phytomenadione", "menaquinone", "menaquinones",
      "menadione", "menaquinone-4", "menaquinone 4", "menaquinone-7", "menaquinone 7", "menatetrenone",
      "วิตามินเค", "วิตามิน เค", "ไวตามินเค", "วิตามินเค1", "วิตามินเค 1", "วิตามินเค-1", "วิตามินเค2", "วิตามินเค 2", "วิตามินเค-2",
      "เควัน", "เคทู", "เคทรี", "ฟิลโลควิโนน", "ไฟโลควิโนน", "ไฟโตนาดิโอน", "ฟิโตเมนาไดโอน", "เมนาควิโนน", "เมนาไควโนน", "เมนาไดโอน",
    ],
  },
  {
    canonical: "glucosamine", display: "Glucosamine", drugClass: "Joint supplement", indications: ["Osteoarthritis"], preferredCategory: JOINT,
    synonyms: [
      "glucosamine", "glucosamin", "glucosamine sulfate", "glucosamine sulphate", "glucosamine hydrochloride", "glucosamine hcl",
      "glucosamine chloride", "n-acetyl glucosamine", "n acetyl glucosamine", "acetyl glucosamine", "glucosamine potassium",
      "glucosamine sodium", "glucosamine sulfate potassium chloride", "glucosamine sulphate potassium chloride",
      "glucosamine sulfate sodium chloride", "glucosamine sulphate sodium chloride", "n-acetyl-d-glucosamine",
      "กลูโคซามีน", "กลูโคซามิน", "กลูโคซามีนซัลเฟต", "กลูโคซามีน ซัลเฟต", "กลูโคซามีนซัลเฟท", "กลูโคซามีนไฮโดรคลอไรด์",
      "กลูโคซามีน เอชซีแอล", "เอ็นอะซิทิลกลูโคซามีน", "เอ็น-อะซิทิลกลูโคซามีน", "อะซิทิลกลูโคซามีน",
    ],
  },
  {
    canonical: "chondroitin", display: "Chondroitin", drugClass: "Joint supplement", indications: ["Osteoarthritis"], preferredCategory: JOINT,
    synonyms: [
      "chondroitin", "chondroitin sulfate", "chondroitin sulphate", "chondroitin sodium sulfate", "sodium chondroitin sulfate",
      "chondroitin sulfate sodium", "chondroitin-4-sulfate", "chondroitin-6-sulfate", "bovine chondroitin", "shark chondroitin",
      "shark cartilage chondroitin", "cartilage extract", "chondroitin sulfate sodium salt", "chondroitin polysulfate",
      "chondroitin 4-sulfate", "chondroitin 6-sulfate", "glucosamine chondroitin", "glucosamine + chondroitin",
      "คอนดรอยติน", "คอนดรอยตินซัลเฟต", "คอนดรอยติน ซัลเฟต", "คอนดรอยตินซัลเฟท", "คอนดรอยตินโซเดียมซัลเฟต",
      "โซเดียมคอนดรอยตินซัลเฟต", "คอนดรอยตินจากกระดูกอ่อน", "กระดูกอ่อนปลาฉลาม", "สารสกัดกระดูกอ่อนปลาฉลาม",
      "กลูโคซามีน คอนดรอยติน", "กลูโคซามีน + คอนดรอยติน",
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
    excludedAbbreviations: EXCLUDED_ABBREVIATIONS,
    excludedDrugs: EXCLUDED_DRUGS,
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
          if (stats.skippedSynonymSamples.length < 15) stats.skippedSynonymSamples.push(`${synonymText} (-> ${def.display})`);
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
          note: `Batch 5 supplement rule: ${def.display} -> ${resolvedCategory}`,
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
  lines.push(` INGREDIENT DICTIONARY SEED — BATCH 5 (supplements)  [${stats.mode.toUpperCase()}]`);
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
  lines.push(`Excluded abbreviations: ${stats.excludedAbbreviations.join(", ")}`);
  lines.push(`Excluded drugs (own ingredients/out-of-scope): ${stats.excludedDrugs.join(", ")}`);
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
    console.log("node scripts/seed_ingredient_dictionary_batch5.js [--dry-run|--commit] [--db-url <url>]");
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
    console.error(`Batch 5 seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseCliArgs, seed, INGREDIENTS };
