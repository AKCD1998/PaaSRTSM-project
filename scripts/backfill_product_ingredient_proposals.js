#!/usr/bin/env node
"use strict";

/**
 * Backfill PROPOSED product-ingredient matches (Phase 5B).
 *
 * Scans the Review-Queue product universe (ada.branch_stock_snapshots) and
 * proposes knowledge.product_ingredients rows by matching ACTIVE dictionary
 * synonyms against product names. Everything it writes is status='proposed',
 * source='dictionary_backfill' — for pharmacist review only.
 *
 * Safety / non-goals:
 *   - Never auto-confirms. Never overwrites confirmed rows.
 *   - Never touches rejected rows unless --include-rejected is passed.
 *   - Never modifies proposed rows that came from another source (e.g. manual seeds).
 *   - Does not touch review-queue category confirmation or Tier0/1/2.
 *   - Default mode is --dry-run. Use --commit to persist.
 *
 * Audit: writes one knowledge.ingredient_suggestion_audit row per proposed
 * insert / re-proposal (suggestion_type='ingredient'). It deliberately does NOT
 * spam public.audit_logs — that table is reserved for request-scoped admin
 * actions (see apps/admin-api/src/audit.js), whereas this is a batch job.
 *
 * Usage:
 *   node scripts/backfill_product_ingredient_proposals.js [--dry-run|--commit]
 *        [--limit N] [--product-code CODE] [--ingredient SEARCH] [--include-rejected]
 *        [--db-url URL]
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const coverage = require(path.join(__dirname, "ingredient_discovery_coverage"));

const SOURCE = "dictionary_backfill";
const STRENGTH_UNITS = new Set(["mg", "mcg", "g", "gm", "gram", "ml", "iu"]);
const RAW_TEXT_MAX = 200;

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
  const args = {
    dryRun: true, commit: false, limit: null, productCode: null,
    ingredient: null, includeRejected: false, dbUrl: process.env.DATABASE_URL || "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--dry-run") { args.dryRun = true; args.commit = false; }
    else if (t === "--commit") { args.commit = true; args.dryRun = false; }
    else if (t === "--limit") args.limit = Math.max(1, parseInt(argv[++i], 10) || 0) || null;
    else if (t === "--product-code") args.productCode = String(argv[++i] || "").trim() || null;
    else if (t === "--ingredient") args.ingredient = String(argv[++i] || "").trim().toLowerCase() || null;
    else if (t === "--include-rejected") args.includeRejected = true;
    else if (t === "--db-url") args.dbUrl = argv[++i] || "";
    else if (t === "--help" || t === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${t}`);
  }
  return args;
}

// ── synonym loading ───────────────────────────────────────────────────────────
async function loadActiveSynonyms(db, ingredientFilter) {
  const result = await db.query(`
    SELECT s.synonym_text, s.ingredient_id, i.display_name, i.canonical_name
    FROM knowledge.ingredient_synonyms s
    JOIN knowledge.ingredients i ON i.ingredient_id = s.ingredient_id
    WHERE s.status = 'active' AND i.status <> 'deprecated'
      AND COALESCE(BTRIM(s.synonym_text), '') <> ''
  `);

  const synonyms = [];
  for (const row of result.rows) {
    if (
      ingredientFilter &&
      !String(row.canonical_name).toLowerCase().includes(ingredientFilter) &&
      !String(row.display_name).toLowerCase().includes(ingredientFilter)
    ) {
      continue;
    }
    const normalized = coverage.normalizeLatin(row.synonym_text).trim();
    // Guard: skip synonyms that carry no Latin letter after normalization.
    // e.g. Thai text with a trailing digit ("วิตามินเค 1") normalizes to just "1",
    // which would otherwise match every product name containing that digit.
    if (!normalized || !/[a-z]/.test(normalized)) continue;
    synonyms.push({
      ingredientId: Number(row.ingredient_id),
      displayName: row.display_name,
      synonymText: row.synonym_text,
      normalized,
      matchString: ` ${normalized} `,
      length: normalized.length,
    });
  }
  // Prefer longer synonyms first (more specific) for tie-breaks and collisions.
  synonyms.sort((a, b) => b.length - a.length || a.normalized.localeCompare(b.normalized));
  return synonyms;
}

// ── strength parsing (simple, optional) ───────────────────────────────────────
function normalizeUnit(unit) {
  const u = String(unit || "").toLowerCase();
  if (u === "gm" || u === "gram") return "g";
  return u;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Try to read "<synonym> 500 mg" / "<synonym>5mg" out of the (lowercased) name.
 * Returns { value, unit, raw } or null. Never throws; missing strength is fine.
 */
function parseStrength(lowerName, synonymText) {
  const re = new RegExp(`${escapeRegex(String(synonymText).toLowerCase())}\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(mg|mcg|gram|gm|g|ml|iu)\\b`);
  const m = lowerName.match(re);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = normalizeUnit(m[2]);
  if (!Number.isFinite(value) || !STRENGTH_UNITS.has(unit)) return null;
  return { value, unit, raw: m[0].trim().slice(0, RAW_TEXT_MAX) };
}

// ── per-product scan ──────────────────────────────────────────────────────────
function computeConfidence(normalized, hasStrength) {
  const tokenCount = normalized.split(" ").filter(Boolean).length;
  let confidence = tokenCount >= 2 ? 0.8 : 0.6;
  if (hasStrength) confidence = Math.min(0.95, confidence + 0.1);
  return Number(confidence.toFixed(4));
}

/**
 * Scan one product, returning at most one candidate per ingredient (longest
 * matching synonym wins). Pure — used directly by unit tests.
 */
function scanProduct(product, synonyms) {
  const nameRaw = product.nameEng || product.nameThai || "";
  const haystack = coverage.normalizeLatin(nameRaw);
  const lowerName = nameRaw.toLowerCase();

  const perIngredient = new Map(); // ingredientId -> best match
  const tokenOwners = new Map();   // normalized synonym -> Set(ingredientId)

  for (const syn of synonyms) {
    if (!haystack.includes(syn.matchString)) continue;

    let owners = tokenOwners.get(syn.normalized);
    if (!owners) { owners = new Set(); tokenOwners.set(syn.normalized, owners); }
    owners.add(syn.ingredientId);

    const current = perIngredient.get(syn.ingredientId);
    if (!current || syn.length > current.length) {
      const strength = parseStrength(lowerName, syn.synonymText);
      perIngredient.set(syn.ingredientId, {
        ingredientId: syn.ingredientId,
        displayName: syn.displayName,
        synonymText: syn.synonymText,
        normalized: syn.normalized,
        length: syn.length,
        strengthValue: strength ? strength.value : null,
        strengthUnit: strength ? strength.unit : null,
        rawText: (strength ? strength.raw : syn.synonymText).slice(0, RAW_TEXT_MAX),
        confidence: computeConfidence(syn.normalized, Boolean(strength)),
      });
    }
  }

  // Ambiguity: a single normalized token that maps to more than one ingredient.
  let ambiguousTokens = 0;
  for (const owners of tokenOwners.values()) {
    if (owners.size > 1) ambiguousTokens += 1;
  }

  return {
    productCode: product.productCode,
    productName: nameRaw,
    candidates: [...perIngredient.values()],
    ambiguousTokens,
  };
}

// ── classification against existing rows ──────────────────────────────────────
/**
 * Decide what to do with a candidate given the existing row (or undefined).
 * Returns { action: 'insert'|'update'|'skip', reason }.
 */
function classify(existing, candidate, includeRejected) {
  if (!existing) return { action: "insert", reason: "new" };
  if (existing.status === "confirmed") return { action: "skip", reason: "confirmed" };
  if (existing.status === "needs_review") return { action: "skip", reason: "needs_review" };
  if (existing.status === "rejected") {
    return includeRejected ? { action: "update", reason: "re-propose-rejected" } : { action: "skip", reason: "rejected" };
  }
  // proposed
  if (existing.source !== SOURCE) return { action: "skip", reason: "proposed-other-source" };
  const exStrength = existing.strength_value == null ? null : Number(existing.strength_value);
  const candStrength = candidate.strengthValue == null ? null : Number(candidate.strengthValue);
  const changed =
    String(existing.raw_text || "") !== String(candidate.rawText || "") ||
    Number(existing.confidence) !== Number(candidate.confidence) ||
    exStrength !== candStrength;
  return changed ? { action: "update", reason: "refresh" } : { action: "skip", reason: "unchanged" };
}

// ── DB write helpers ──────────────────────────────────────────────────────────
async function loadExistingRows(db, productCodes) {
  if (productCodes.length === 0) return new Map();
  const map = new Map();
  const CHUNK = 1000;
  for (let i = 0; i < productCodes.length; i += CHUNK) {
    const chunk = productCodes.slice(i, i + CHUNK);
    const r = await db.query(
      `SELECT product_code, ingredient_id, status, source, raw_text, confidence, strength_value
       FROM knowledge.product_ingredients WHERE product_code = ANY($1::text[])`,
      [chunk],
    );
    for (const row of r.rows) map.set(`${row.product_code}|${row.ingredient_id}`, row);
  }
  return map;
}

async function insertProposals(db, rows) {
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    // 7 bound params/row; status is a literal ('proposed') and updated_at is now().
    chunk.forEach((row, idx) => {
      const b = idx * 7;
      // Explicit casts: nullable strength params otherwise leave PG unable to
      // infer the column type in a multi-row VALUES list.
      values.push(`($${b + 1}::text,$${b + 2}::bigint,$${b + 3}::numeric,$${b + 4}::text,$${b + 5}::text,$${b + 6}::text,'proposed',$${b + 7}::numeric,now())`);
      params.push(row.productCode, row.ingredientId, row.strengthValue, row.strengthUnit, row.rawText, SOURCE, row.confidence);
    });
    await db.query(
      `INSERT INTO knowledge.product_ingredients
         (product_code, ingredient_id, strength_value, strength_unit, raw_text, source, status, confidence, updated_at)
       VALUES ${values.join(",")}
       ON CONFLICT (product_code, ingredient_id) DO NOTHING`,
      params,
    );
  }
}

async function updateProposals(db, rows) {
  for (const row of rows) {
    // Guard: only update proposed-own rows or rejected (when re-proposing).
    await db.query(
      `UPDATE knowledge.product_ingredients
       SET strength_value = $3::numeric, strength_unit = $4::text, raw_text = $5::text, source = $6::text,
           status = 'proposed', confidence = $7::numeric, updated_at = now()
       WHERE product_code = $1 AND ingredient_id = $2
         AND status IN ('proposed','rejected')
         AND (status = 'rejected' OR source = $6)`,
      [row.productCode, row.ingredientId, row.strengthValue, row.strengthUnit, row.rawText, SOURCE, row.confidence],
    );
  }
}

async function insertAuditRows(db, rows) {
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    chunk.forEach((row, idx) => {
      const b = idx * 3; // 3 bound params per row
      values.push(`($${b + 1}::text,'ingredient',$${b + 2}::jsonb,$${b + 3}::text,'proposed')`);
      params.push(
        row.productCode,
        JSON.stringify({ ingredientId: row.ingredientId, displayName: row.displayName, synonym: row.synonymText, strengthValue: row.strengthValue, strengthUnit: row.strengthUnit, confidence: row.confidence }),
        SOURCE,
      );
    });
    await db.query(
      `INSERT INTO knowledge.ingredient_suggestion_audit
         (product_code, suggestion_type, suggested_payload, source, status)
       VALUES ${values.join(",")}`,
      params,
    );
  }
}

// ── main run ──────────────────────────────────────────────────────────────────
async function run(db, args) {
  const synonyms = await loadActiveSynonyms(db, args.ingredient);
  let products = await coverage.loadProducts(db);
  if (args.productCode) products = products.filter((p) => p.productCode === args.productCode);
  if (args.limit) products = products.slice(0, args.limit);

  const stats = {
    mode: args.commit ? "commit" : "dry-run",
    synonymsLoaded: synonyms.length,
    productsScanned: products.length,
    productsWithMatches: 0,
    multiIngredientProducts: 0,
    ambiguousTokenHits: 0,
    inserted: 0,
    updated: 0,
    skippedConfirmed: 0,
    skippedRejected: 0,
    skippedOtherSource: 0,
    skippedNeedsReview: 0,
    skippedUnchanged: 0,
    ingredientCounts: new Map(),
    samples: [],
  };

  // Pass 1: scan
  const scans = [];
  for (const product of products) {
    const scan = scanProduct(product, synonyms);
    if (scan.candidates.length > 0) {
      stats.productsWithMatches += 1;
      if (scan.candidates.length >= 2) stats.multiIngredientProducts += 1;
      stats.ambiguousTokenHits += scan.ambiguousTokens;
      scans.push(scan);
      if (stats.samples.length < 12) {
        stats.samples.push({ productCode: scan.productCode, productName: scan.productName, ingredients: scan.candidates.map((c) => `${c.displayName}${c.strengthValue != null ? ` ${c.strengthValue}${c.strengthUnit}` : ""}`) });
      }
    }
  }

  // Pass 2: classify against existing rows
  const matchedCodes = scans.map((s) => s.productCode);
  const existing = await loadExistingRows(db, matchedCodes);

  const toInsert = [];
  const toUpdate = [];
  for (const scan of scans) {
    for (const c of scan.candidates) {
      const key = `${scan.productCode}|${c.ingredientId}`;
      const decision = classify(existing.get(key), c, args.includeRejected);
      const row = { productCode: scan.productCode, ...c };
      if (decision.action === "insert") { toInsert.push(row); stats.inserted += 1; stats.ingredientCounts.set(c.displayName, (stats.ingredientCounts.get(c.displayName) || 0) + 1); }
      else if (decision.action === "update") { toUpdate.push(row); stats.updated += 1; stats.ingredientCounts.set(c.displayName, (stats.ingredientCounts.get(c.displayName) || 0) + 1); }
      else if (decision.reason === "confirmed") stats.skippedConfirmed += 1;
      else if (decision.reason === "rejected") stats.skippedRejected += 1;
      else if (decision.reason === "proposed-other-source") stats.skippedOtherSource += 1;
      else if (decision.reason === "needs_review") stats.skippedNeedsReview += 1;
      else if (decision.reason === "unchanged") stats.skippedUnchanged += 1;
    }
  }

  // Pass 3: write (commit only)
  if (args.commit && (toInsert.length || toUpdate.length)) {
    await db.query("BEGIN");
    try {
      let phase = "insert";
      try {
        if (toInsert.length) await insertProposals(db, toInsert);
        phase = "update";
        if (toUpdate.length) await updateProposals(db, toUpdate);
        phase = "audit";
        // Audit every freshly-proposed / re-proposed suggestion.
        const auditRows = [...toInsert, ...toUpdate];
        if (auditRows.length) await insertAuditRows(db, auditRows);
      } catch (e) {
        throw new Error(`[phase=${phase} toInsert=${toInsert.length} toUpdate=${toUpdate.length}] ${e.message}`);
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  }

  return stats;
}

function printSummary(stats) {
  const top = [...stats.ingredientCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  const lines = [];
  lines.push("==================================================");
  lines.push(` PRODUCT-INGREDIENT PROPOSAL BACKFILL  [${stats.mode.toUpperCase()}]`);
  lines.push("==================================================");
  lines.push(`Active synonyms loaded   : ${stats.synonymsLoaded}`);
  lines.push(`Products scanned         : ${stats.productsScanned}`);
  lines.push(`Products with matches    : ${stats.productsWithMatches}`);
  lines.push(`  of which 2+ ingredients: ${stats.multiIngredientProducts}`);
  lines.push(`Ambiguous token hits     : ${stats.ambiguousTokenHits} (same word -> >1 ingredient)`);
  lines.push("");
  lines.push(`Proposed rows to INSERT  : ${stats.inserted}`);
  lines.push(`Proposed rows to UPDATE  : ${stats.updated}`);
  lines.push(`Skipped (confirmed)      : ${stats.skippedConfirmed}`);
  lines.push(`Skipped (rejected)       : ${stats.skippedRejected}`);
  lines.push(`Skipped (other-source)   : ${stats.skippedOtherSource}`);
  lines.push(`Skipped (needs_review)   : ${stats.skippedNeedsReview}`);
  lines.push(`Skipped (unchanged)      : ${stats.skippedUnchanged}`);
  lines.push("");
  lines.push("Top matched ingredients (insert+update):");
  for (const [name, count] of top) lines.push(`  ${String(count).padStart(4)}  ${name}`);
  lines.push("");
  lines.push("Sample matched products:");
  for (const s of stats.samples) lines.push(`  ${s.productCode}: ${s.ingredients.join(", ")}`);
  lines.push(`    "${(stats.samples[0] && stats.samples[0].productName) || ""}"`);
  if (stats.mode === "dry-run") {
    lines.push("");
    lines.push("DRY-RUN: no changes were written. Re-run with --commit to persist.");
  }
  console.log(lines.join("\n"));
}

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  loadEnvFallback(rootDir);
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log("node scripts/backfill_product_ingredient_proposals.js [--dry-run|--commit] [--limit N] [--product-code CODE] [--ingredient SEARCH] [--include-rejected] [--db-url URL]");
    return;
  }
  if (!args.dbUrl) throw new Error("Missing database URL. Use --db-url or set DATABASE_URL");

  const client = new Client(dbConfigFromUrl(args.dbUrl));
  await client.connect();
  try {
    const stats = await run(client, args);
    printSummary(stats);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Backfill failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseCliArgs,
  parseStrength,
  scanProduct,
  classify,
  computeConfidence,
  loadActiveSynonyms,
  run,
};
