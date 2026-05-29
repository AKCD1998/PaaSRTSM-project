"use strict";

const { formatDisplayCategory } = require("./format");
const { runTier0 } = require("./tier0");
const { runTier1 } = require("./tier1");
const { runTier2 } = require("./tier2");

const EXAMPLE_LIMIT = 5;

/**
 * runCategorizationBatch(db, options)
 *
 * Runs Tier 0 (exact taxonomy match) then Tier 1 (rules normalization) over
 * all products present in ada.branch_stock_snapshots, writing results to
 * ada.product_category_states.
 *
 * Safety rules:
 *  - Never overwrites review_status = 'confirmed' (human-reviewed rows).
 *  - Tier 1 never overwrites review_status = 'imported_exact_match' (Tier 0 rows).
 *  - dryRun = true skips all writes and returns metrics only.
 *
 * Options:
 *  productCodes        string[]  optional — limit run to these product codes
 *  dryRun              boolean   default false
 *  skipTier2           boolean   default false — skip pgvector similarity step
 *  tier2Threshold      number    default 0.60 — cosine similarity min for Tier 2 match
 *  triggeredBy         string    optional label recorded in rationale (e.g. 'sync_hook', 'manual')
 *
 * Returns a metrics object.
 */
async function runCategorizationBatch(db, options = {}) {
  const {
    productCodes = null,
    dryRun = false,
    skipTier2 = false,
    tier2Threshold = 0.60,
    triggeredBy = "batch",
  } = options;
  const startedAt = new Date();

  // ── 1. Fetch all products to consider ────────────────────────────────────
  // Source: ada.branch_stock_snapshots (all products we have stock data for)
  // Raw category fallback: public.skus.category_name → ada.products.category_name
  // Skip: already confirmed by a human
  const baseQuery = `
    SELECT DISTINCT ON (bs.product_code)
      bs.product_code,
      COALESCE(s.category_name, p.category_name) AS raw_category_name,
      pcs.review_status                           AS existing_status
    FROM ada.branch_stock_snapshots bs
    LEFT JOIN public.skus s
           ON s.company_code = bs.product_code
    LEFT JOIN ada.products p
           ON p.product_code  = bs.product_code
    LEFT JOIN ada.product_category_states pcs
           ON pcs.product_code = bs.product_code
    WHERE pcs.review_status IS DISTINCT FROM 'confirmed'
    ${productCodes && productCodes.length > 0 ? "AND bs.product_code = ANY($1)" : ""}
    ORDER BY bs.product_code
  `;
  const queryParams = productCodes && productCodes.length > 0 ? [productCodes] : [];
  const { rows: products } = await db.query(baseQuery, queryParams);

  if (products.length === 0) {
    return buildMetrics(startedAt, 0, [], [], [], []);
  }

  const allCodes = products.map((p) => p.product_code);

  // ── 2. Tier 0: exact taxonomy_map match ──────────────────────────────────
  const tier0Results = await runTier0(db, allCodes);
  const tier0ByCode = new Map(tier0Results.map((r) => [r.product_code, r]));

  // ── 3. Tier 1: rules normalization for products not covered by Tier 0 ────
  // Also skip products that already have imported_exact_match — no downgrade.
  const tier1Input = products.filter(
    (p) =>
      !tier0ByCode.has(p.product_code) &&
      p.existing_status !== "imported_exact_match",
  );
  const tier1Results = await runTier1(db, tier1Input);

  if (dryRun) {
    return buildMetrics(startedAt, products.length, tier0Results, tier1Results, [], [], [], []);
  }

  // ── 4. Write results — bulk UNNEST in chunks of 500 ─────────────────────
  // Pre-fetch existing states once so we can preserve previous_* audit columns.
  const allWriteCodes = [
    ...tier0Results.filter((r) => !r.conflict && r.clean_category).map((r) => r.product_code),
    ...tier1Results.map((r) => r.product_code),
  ];
  const { rows: existingRows } = await db.query(
    `SELECT product_code, category_name, review_status
     FROM ada.product_category_states
     WHERE product_code = ANY($1)`,
    [allWriteCodes],
  );
  const existingByCode = new Map(existingRows.map((r) => [r.product_code, r]));

  // Build Tier 0 rows to write
  const skipped = [];
  const written0 = [];
  const tier0Rows = [];
  for (const r of tier0Results) {
    if (r.conflict) { skipped.push(r); continue; }
    const categoryName = formatDisplayCategory(r.shelf_no, r.clean_category);
    if (!categoryName) { skipped.push({ ...r, conflictReason: "empty_category" }); continue; }
    const existing = existingByCode.get(r.product_code);
    tier0Rows.push({
      product_code: r.product_code,
      category_name: categoryName,
      rationale: `Tier 0 exact taxonomy match. Raw label: ${r.raw_label || ""}. By: ${triggeredBy}`,
      prev_category_name: existing?.category_name || null,
      prev_review_status: existing?.review_status || null,
    });
    written0.push({ product_code: r.product_code, category_name: categoryName });
  }

  // Build Tier 1 rows to write
  const written1 = [];
  const tier1Rows = [];
  for (const r of tier1Results) {
    const categoryName = formatDisplayCategory(r.shelf_no, r.clean_category);
    const existing = existingByCode.get(r.product_code);
    tier1Rows.push({
      product_code: r.product_code,
      category_name: categoryName || "",
      review_status: r.review_status,
      rationale: `Tier 1 rules batch. Reason: ${r.reason}. By: ${triggeredBy}`,
      source_match_level: r.reason || null,
      prev_category_name: existing?.category_name || null,
      prev_review_status: existing?.review_status || null,
    });
    written1.push({
      product_code: r.product_code,
      category_name: categoryName,
      review_status: r.review_status,
      reason: r.reason,
    });
  }

  // ── 4a. Write Tier 0 first so it's available as the reference set for Tier 2 ─
  await bulkUpsertTier0(db, tier0Rows, triggeredBy);

  // ── 4b. Tier 2: pgvector similarity on needs_review candidates ───────────
  // Runs after Tier 0 is committed so newly categorized products are in the DB.
  const tier2ByCode = new Map();
  if (!skipTier2) {
    const needsReviewCodes = tier1Results
      .filter((r) => r.review_status === "needs_review")
      .map((r) => r.product_code);

    if (needsReviewCodes.length > 0) {
      const tier2Results = await runTier2(db, needsReviewCodes, {
        similarityThreshold: tier2Threshold,
      });
      for (const r of tier2Results) tier2ByCode.set(r.product_code, r);
    }
  }

  // Upgrade needs_review tier1Rows that got a Tier 2 match to proposed.
  const written2 = [];
  for (const row of tier1Rows) {
    const t2 = tier2ByCode.get(row.product_code);
    if (t2) {
      row.category_name = t2.clean_category || "";
      row.review_status = "proposed";
      row.rationale = `Tier 2 similarity ${t2.reason}. Matched: ${t2.matched_product_code}. By: ${triggeredBy}`;
      row.source_match_level = t2.reason;
      written2.push({ product_code: row.product_code, category_name: row.category_name, reason: t2.reason });
    }
  }

  // ── 4c. Write Tier 1 + Tier 2 upgrades together ──────────────────────────
  await bulkUpsertTier1(db, tier1Rows, triggeredBy);

  return buildMetrics(startedAt, products.length, tier0Results, tier1Results, written0, written1, written2, skipped);
}

// ── Bulk upsert helpers (UNNEST, chunked at 500 rows) ─────────────────────────

const CHUNK_SIZE = 500;

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function bulkUpsertTier0(db, rows, triggeredBy) {
  for (const chunk of chunkArray(rows, CHUNK_SIZE)) {
    const productCodes      = chunk.map((r) => r.product_code);
    const categoryNames     = chunk.map((r) => r.category_name);
    const rationales        = chunk.map((r) => r.rationale);
    const prevCategoryNames = chunk.map((r) => r.prev_category_name);
    const prevStatuses      = chunk.map((r) => r.prev_review_status);
    const importedBys       = chunk.map(() => triggeredBy);

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
        INSERT INTO ada.product_category_states
          (product_code, category_name, review_status, rationale,
           source_kind, source_reference, source_match_level,
           previous_category_name, previous_review_status,
           imported_at, imported_by, updated_at)
        SELECT
          unnest($1::text[]),
          unnest($2::text[]),
          'imported_exact_match',
          unnest($3::text[]),
          'taxonomy_workbook',
          'taxonomy_batch/tier0',
          'exact_code',
          unnest($4::text[]),
          unnest($5::text[]),
          now(),
          unnest($6::text[]),
          now()
        ON CONFLICT (product_code) DO UPDATE SET
          category_name          = EXCLUDED.category_name,
          review_status          = EXCLUDED.review_status,
          rationale              = EXCLUDED.rationale,
          source_kind            = EXCLUDED.source_kind,
          source_reference       = EXCLUDED.source_reference,
          source_match_level     = EXCLUDED.source_match_level,
          previous_category_name = EXCLUDED.previous_category_name,
          previous_review_status = EXCLUDED.previous_review_status,
          imported_at            = EXCLUDED.imported_at,
          imported_by            = EXCLUDED.imported_by,
          updated_at             = now()
        WHERE ada.product_category_states.review_status <> 'confirmed'
        `,
        [productCodes, categoryNames, rationales, prevCategoryNames, prevStatuses, importedBys],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

async function bulkUpsertTier1(db, rows, triggeredBy) {
  for (const chunk of chunkArray(rows, CHUNK_SIZE)) {
    const productCodes      = chunk.map((r) => r.product_code);
    const categoryNames     = chunk.map((r) => r.category_name);
    const reviewStatuses    = chunk.map((r) => r.review_status);
    const rationales        = chunk.map((r) => r.rationale);
    const matchLevels       = chunk.map((r) => r.source_match_level);
    const prevCategoryNames = chunk.map((r) => r.prev_category_name);
    const prevStatuses      = chunk.map((r) => r.prev_review_status);
    const importedBys       = chunk.map(() => triggeredBy);

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
        INSERT INTO ada.product_category_states
          (product_code, category_name, review_status, rationale,
           source_kind, source_reference, source_match_level,
           previous_category_name, previous_review_status,
           imported_at, imported_by, updated_at)
        SELECT
          unnest($1::text[]),
          unnest($2::text[]),
          unnest($3::text[]),
          unnest($4::text[]),
          'rules_batch',
          'taxonomy_batch/tier1',
          unnest($5::text[]),
          unnest($6::text[]),
          unnest($7::text[]),
          now(),
          unnest($8::text[]),
          now()
        ON CONFLICT (product_code) DO UPDATE SET
          category_name          = EXCLUDED.category_name,
          review_status          = EXCLUDED.review_status,
          rationale              = EXCLUDED.rationale,
          source_kind            = EXCLUDED.source_kind,
          source_reference       = EXCLUDED.source_reference,
          source_match_level     = EXCLUDED.source_match_level,
          previous_category_name = EXCLUDED.previous_category_name,
          previous_review_status = EXCLUDED.previous_review_status,
          imported_at            = EXCLUDED.imported_at,
          imported_by            = EXCLUDED.imported_by,
          updated_at             = now()
        WHERE ada.product_category_states.review_status NOT IN ('confirmed', 'imported_exact_match')
        `,
        [productCodes, categoryNames, reviewStatuses, rationales, matchLevels,
         prevCategoryNames, prevStatuses, importedBys],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

// ── Metrics builder ───────────────────────────────────────────────────────────
// Counts are always derived from tier*Results so dry-run and live-run agree.
// written* arrays are used for per-row examples when available.

function buildMetrics(startedAt, totalProcessed, tier0Results, tier1Results, written0 = [], written1 = [], written2 = [], skipped = []) {
  const finishedAt = new Date();

  const conflicts     = tier0Results.filter((r) => r.conflict);
  const tier0Matched  = tier0Results.filter((r) => !r.conflict && r.clean_category);
  const tier1Proposed = tier1Results.filter((r) => r.review_status === "proposed");
  const tier1NeedsReview = tier1Results.filter((r) => r.review_status === "needs_review");

  const tier0Examples = written0.length > 0
    ? written0.slice(0, EXAMPLE_LIMIT)
    : tier0Matched.slice(0, EXAMPLE_LIMIT).map((r) => ({
        product_code: r.product_code,
        category_name: formatDisplayCategory(r.shelf_no, r.clean_category),
      }));

  const tier1Examples = written1.filter((r) => r.review_status === "proposed").slice(0, EXAMPLE_LIMIT).length > 0
    ? written1.filter((r) => r.review_status === "proposed").slice(0, EXAMPLE_LIMIT)
    : tier1Proposed.slice(0, EXAMPLE_LIMIT).map((r) => ({
        product_code: r.product_code,
        category_name: formatDisplayCategory(r.shelf_no, r.clean_category),
        reason: r.reason,
      }));

  const tier2Examples = written2.slice(0, EXAMPLE_LIMIT);

  const needsReviewExamples = written1.filter((r) => r.review_status === "needs_review").slice(0, EXAMPLE_LIMIT).length > 0
    ? written1.filter((r) => r.review_status === "needs_review").slice(0, EXAMPLE_LIMIT)
    : tier1NeedsReview.slice(0, EXAMPLE_LIMIT).map((r) => ({
        product_code: r.product_code,
        category_name: r.clean_category,
        reason: r.reason,
      }));

  // Tier 2 count: written2 always populated from live runs; dry-run shows 0 (Tier 2 not run in dry-run)
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    totalProcessed,
    tier0Exact: tier0Matched.length,
    tier1Rules: tier1Proposed.length,
    tier2Similarity: written2.length,
    needsReview: tier1NeedsReview.length - written2.length,
    conflictsSkipped: conflicts.length,
    examples: {
      tier0: tier0Examples,
      tier1Proposed: tier1Examples,
      tier2Similarity: tier2Examples,
      needsReview: needsReviewExamples,
      conflicts: conflicts.slice(0, EXAMPLE_LIMIT).map((r) => ({
        product_code: r.product_code,
        reason: r.conflictReason,
        categories: r.categories,
      })),
    },
  };
}

module.exports = { runCategorizationBatch };
