#!/usr/bin/env node
"use strict";

/**
 * Ingredient discovery coverage report (READ-ONLY).
 *
 * Scans every product name in the catalog and measures how many products can be
 * auto-proposed using the current knowledge.ingredient_synonyms dictionary.
 *
 * It writes NOTHING to the database. It only SELECTs.
 *
 * Usage:
 *   node scripts/ingredient_discovery_coverage.js [--db-url <postgresUrl>] [--json] [--top <n>]
 *
 * Output: a human-readable coverage report on stdout. With --json, also emits a
 * machine-readable JSON blob after the report (separated by a marker line).
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

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
  const args = { dbUrl: process.env.DATABASE_URL || "", json: false, top: 100, candidates: null };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--db-url") args.dbUrl = argv[++i] || "";
    else if (t === "--json") args.json = true;
    else if (t === "--top") args.top = Math.max(1, parseInt(argv[++i], 10) || 100);
    else if (t === "--candidates") args.candidates = String(argv[++i] || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (t === "--help" || t === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${t}`);
  }
  return args;
}

// ── text normalization ──────────────────────────────────────────────────────
// Latin-only normalization: lowercase, collapse every non [a-z0-9] run to a
// single space, pad with spaces so token-boundary substring checks are exact.
function normalizeLatin(text) {
  return ` ${String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

// Alphabetic tokens (>= 3 chars) used for unmatched-token frequency. Pure
// numeric / unit-glued tokens like "2x5" are dropped because they are not [a-z]+.
function latinTokens(text) {
  const out = [];
  for (const m of String(text || "").toLowerCase().matchAll(/[a-z]{3,}/g)) {
    out.push(m[0]);
  }
  return out;
}

// Dosage forms, packaging, units and generic marketing noise. These are never
// useful ingredient candidates, so they are excluded from the unmatched-token
// ranking to keep the "add these first" list signal-rich.
const STOPWORDS = new Set([
  // units
  "mg", "mcg", "gm", "gr", "kg", "ml", "cc", "iu", "meq", "ppm", "pct",
  // forms
  "tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule", "capsules",
  "syrup", "syr", "susp", "suspension", "sol", "soln", "solution", "inj",
  "injection", "cream", "gel", "ointment", "oint", "lotion", "spray", "drop",
  "drops", "powder", "sachet", "sachets", "lozenge", "lozenges", "patch",
  "suppository", "suppositories", "emulsion", "paste", "foam", "shampoo",
  "soap", "liquid", "elixir", "granule", "granules", "effervescent",
  // packaging
  "pcs", "pc", "set", "sets", "bottle", "bottles", "btl", "box", "boxes",
  "strip", "strips", "blister", "amp", "ampoule", "ampoules", "vial", "vials",
  "kit", "pack", "packs", "tube", "tubes", "jar", "roll", "pair", "piece",
  "pieces", "can", "cans", "bag", "bags", "pouch", "refill", "carton",
  // descriptors
  "soft", "hard", "film", "coated", "oral", "plus", "forte", "gold", "new",
  "original", "extra", "max", "maximum", "mini", "junior", "adult", "adults",
  "kids", "child", "children", "baby", "daily", "night", "day", "fresh",
  "clear", "pure", "natural", "advance", "advanced", "active", "care",
  "premium", "super", "ultra", "double", "triple", "value", "size", "large",
  "small", "medium", "long", "short", "free", "non", "anti", "pro", "vita",
  "formula", "complex", "blend", "system", "series", "type", "model", "color",
  "colour", "white", "black", "blue", "green", "pink", "red", "yellow",
  // SR/release qualifiers and misc
  "for", "and", "with", "the", "per", "each", "use", "used", "made", "from",
  "thai", "thailand",
]);

function isCandidateToken(token) {
  if (token.length < 4) return false; // 3-char tokens are mostly noise/units
  if (STOPWORDS.has(token)) return false;
  return true;
}

// ── data loading ────────────────────────────────────────────────────────────
async function loadSynonyms(db) {
  const result = await db.query(`
    SELECT s.synonym_id, s.ingredient_id, s.synonym_text,
           i.canonical_name, i.display_name
    FROM knowledge.ingredient_synonyms s
    JOIN knowledge.ingredients i ON i.ingredient_id = s.ingredient_id
    WHERE s.status <> 'deprecated'
      AND i.status <> 'deprecated'
      AND COALESCE(BTRIM(s.synonym_text), '') <> ''
  `);
  const synonyms = [];
  for (const row of result.rows) {
    const norm = normalizeLatin(row.synonym_text).trim();
    if (!norm) continue;
    synonyms.push({
      ingredientId: Number(row.ingredient_id),
      canonicalName: row.canonical_name,
      displayName: row.display_name,
      // matchString is padded so substring search hits whole tokens only
      matchString: ` ${norm} `,
    });
  }
  return synonyms;
}

async function loadProducts(db) {
  const result = await db.query(`
    SELECT product_code,
           COALESCE(product_name_eng, '')  AS name_eng,
           COALESCE(product_name_thai, '') AS name_thai
    FROM ada.branch_stock_snapshots
    WHERE product_code IS NOT NULL
  `);
  return result.rows.map((r) => ({
    productCode: r.product_code,
    nameEng: r.name_eng,
    nameThai: r.name_thai,
  }));
}

// ── core scan ────────────────────────────────────────────────────────────────
function runScan(products, synonyms) {
  const ingredientProductCounts = new Map(); // ingredientId -> { displayName, count }
  const unmatchedTokenDocFreq = new Map();   // token -> distinct unmatched product count
  const unmatchedProducts = [];              // [{ productCode, tokens:Set }]

  let matchedAtLeastOne = 0;
  let matchedTwoPlus = 0;
  let unmatched = 0;

  for (const product of products) {
    const haystack = normalizeLatin(product.nameEng || product.nameThai);
    const matchedIngredients = new Set();

    for (const syn of synonyms) {
      if (haystack.includes(syn.matchString)) {
        matchedIngredients.add(syn.ingredientId);
        if (!ingredientProductCounts.has(syn.ingredientId)) {
          ingredientProductCounts.set(syn.ingredientId, { displayName: syn.displayName, canonicalName: syn.canonicalName, count: 0 });
        }
      }
    }

    if (matchedIngredients.size >= 1) {
      matchedAtLeastOne += 1;
      if (matchedIngredients.size >= 2) matchedTwoPlus += 1;
      for (const id of matchedIngredients) ingredientProductCounts.get(id).count += 1;
    } else {
      unmatched += 1;
      const tokens = new Set(latinTokens(product.nameEng || product.nameThai).filter(isCandidateToken));
      for (const tok of tokens) {
        unmatchedTokenDocFreq.set(tok, (unmatchedTokenDocFreq.get(tok) || 0) + 1);
      }
      unmatchedProducts.push({ productCode: product.productCode, tokens });
    }
  }

  return {
    total: products.length,
    matchedAtLeastOne,
    matchedTwoPlus,
    unmatched,
    ingredientProductCounts,
    unmatchedTokenDocFreq,
    unmatchedProducts,
  };
}

// Greedy: pick the token that covers the most still-uncovered unmatched products,
// repeat. Shows realistic incremental coverage if those tokens become ingredients.
function greedyCoverage(unmatchedProducts, topTokens, total, limit) {
  const remaining = unmatchedProducts.map((p) => p.tokens);
  const covered = new Array(remaining.length).fill(false);
  const tokenSet = new Set(topTokens.map((t) => t.token));
  const picks = [];
  let cumulativeNewlyCovered = 0;

  for (let step = 0; step < limit; step += 1) {
    let bestToken = null;
    let bestGain = 0;
    const gain = new Map();
    for (let i = 0; i < remaining.length; i += 1) {
      if (covered[i]) continue;
      for (const tok of remaining[i]) {
        if (!tokenSet.has(tok)) continue;
        const g = (gain.get(tok) || 0) + 1;
        gain.set(tok, g);
        if (g > bestGain) { bestGain = g; bestToken = tok; }
      }
    }
    if (!bestToken || bestGain === 0) break;
    for (let i = 0; i < remaining.length; i += 1) {
      if (!covered[i] && remaining[i].has(bestToken)) covered[i] = true;
    }
    tokenSet.delete(bestToken);
    cumulativeNewlyCovered += bestGain;
    picks.push({
      token: bestToken,
      newlyCoveredProducts: bestGain,
      cumulativeNewlyCovered,
      cumulativeCoveragePct: total ? ((cumulativeNewlyCovered) / total) * 100 : 0,
    });
  }
  return picks;
}

// ── report rendering ─────────────────────────────────────────────────────────
function pct(part, whole) {
  return whole ? ((part / whole) * 100) : 0;
}

function renderReport(scan, topN) {
  const lines = [];
  const {
    total, matchedAtLeastOne, matchedTwoPlus, unmatched,
    ingredientProductCounts, unmatchedTokenDocFreq, unmatchedProducts,
  } = scan;

  const matchedIngredients = [...ingredientProductCounts.entries()]
    .map(([ingredientId, v]) => ({ ingredientId, ...v }))
    .sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName));

  const unmatchedTokens = [...unmatchedTokenDocFreq.entries()]
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token))
    .slice(0, topN);

  const recommendations = greedyCoverage(unmatchedProducts, unmatchedTokens, total, 30);

  lines.push("==================================================");
  lines.push(" INGREDIENT DISCOVERY COVERAGE REPORT");
  lines.push(`  generated: ${new Date().toISOString()}`);
  lines.push("==================================================");
  lines.push("");
  lines.push(`Total Products:      ${total}`);
  lines.push("");
  lines.push(`Matched (1+ ingredient):  ${matchedAtLeastOne}`);
  lines.push(`Matched (2+ ingredients): ${matchedTwoPlus}`);
  lines.push(`Unmatched:                ${unmatched}`);
  lines.push("");
  lines.push(`Coverage: ${pct(matchedAtLeastOne, total).toFixed(2)}%`);
  lines.push("");
  lines.push("Dictionary size used in this scan:");
  lines.push(`  ingredients matched at least 1 product: ${matchedIngredients.length}`);
  lines.push("");

  lines.push("--------------------------------------------------");
  lines.push(`Top ${topN} most common UNMATCHED words (ingredient candidates)`);
  lines.push("(document frequency = # of distinct unmatched products containing the word)");
  lines.push("--------------------------------------------------");
  unmatchedTokens.forEach((t, i) => {
    lines.push(`${String(i + 1).padStart(3)}. ${t.token.padEnd(28)} ${String(t.count).padStart(5)}  (${pct(t.count, total).toFixed(2)}% of catalog)`);
  });
  lines.push("");

  lines.push("--------------------------------------------------");
  lines.push("Most common MATCHED ingredients (current dictionary)");
  lines.push("--------------------------------------------------");
  if (!matchedIngredients.length) {
    lines.push("  (none — the current dictionary matched no products)");
  } else {
    matchedIngredients.forEach((m, i) => {
      lines.push(`${String(i + 1).padStart(3)}. ${m.displayName.padEnd(28)} ${String(m.count).padStart(5)} products  (${pct(m.count, total).toFixed(2)}%)`);
    });
  }
  lines.push("");

  lines.push("--------------------------------------------------");
  lines.push("RECOMMENDATIONS — add these first to maximize coverage");
  lines.push("(greedy: each row is the next word that covers the most still-");
  lines.push(" uncovered products; cumulative shows combined reachable coverage)");
  lines.push("--------------------------------------------------");
  recommendations.forEach((r, i) => {
    lines.push(
      `${String(i + 1).padStart(2)}. ${r.token.padEnd(24)} +${String(r.newlyCoveredProducts).padStart(4)} products` +
      `  →  cumulative ${r.cumulativeCoveragePct.toFixed(2)}% (${r.cumulativeNewlyCovered}/${total})`,
    );
  });
  lines.push("");

  return {
    text: lines.join("\n"),
    data: {
      total, matchedAtLeastOne, matchedTwoPlus, unmatched,
      coveragePct: pct(matchedAtLeastOne, total),
      matchedIngredients,
      unmatchedTokens,
      recommendations,
    },
  };
}

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  loadEnvFallback(rootDir);
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log("node scripts/ingredient_discovery_coverage.js [--db-url <url>] [--json] [--top <n>]");
    return;
  }
  if (!args.dbUrl) throw new Error("Missing database URL. Use --db-url or set DATABASE_URL");

  const client = new Client(dbConfigFromUrl(args.dbUrl));
  await client.connect();
  try {
    const [synonyms, products] = await Promise.all([loadSynonyms(client), loadProducts(client)]);
    const scan = runScan(products, synonyms);
    const report = renderReport(scan, args.top);
    console.log(report.text);

    if (args.candidates && args.candidates.length) {
      const candTokens = args.candidates.map((token) => ({ token }));
      const picks = greedyCoverage(scan.unmatchedProducts, candTokens, scan.total, args.candidates.length);
      console.log("--------------------------------------------------");
      console.log("CURATED INGREDIENT CANDIDATES — projected coverage");
      console.log("(greedy over the supplied --candidates list only)");
      console.log("--------------------------------------------------");
      picks.forEach((r, i) => {
        console.log(
          `${String(i + 1).padStart(2)}. ${r.token.padEnd(20)} +${String(r.newlyCoveredProducts).padStart(4)} products` +
          `  →  cumulative ${r.cumulativeCoveragePct.toFixed(2)}% (${r.cumulativeNewlyCovered}/${scan.total})`,
        );
      });
      console.log("");
    }

    if (args.json) {
      console.log("----- JSON -----");
      console.log(JSON.stringify(report.data, null, 2));
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Coverage report failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  normalizeLatin,
  latinTokens,
  isCandidateToken,
  loadSynonyms,
  loadProducts,
  runScan,
  greedyCoverage,
  renderReport,
};
