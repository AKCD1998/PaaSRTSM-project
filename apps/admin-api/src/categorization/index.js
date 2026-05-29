"use strict";

const { formatDisplayCategory } = require("./format");
const { runTier0 } = require("./tier0");
const { runTier1 } = require("./tier1");

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
 *  productCodes  string[]  optional — limit run to these product codes
 *  dryRun        boolean   default false
 *  triggeredBy   string    optional label recorded in rationale (e.g. 'sync_hook', 'manual')
 *
 * Returns a metrics object.
 */
async function runCategorizationBatch(db, options = {}) {
  const { productCodes = null, dryRun = false, triggeredBy = "batch" } = options;
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
    return buildMetrics(startedAt, products.length, tier0Results, tier1Results, [], []);
  }

  // ── 4. Write results ─────────────────────────────────────────────────────
  const written0 = [];
  const written1 = [];
  const skipped = [];

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    for (const r of tier0Results) {
      if (r.conflict) {
        skipped.push(r);
        continue;
      }
      const categoryName = formatDisplayCategory(r.shelf_no, r.clean_category);
      if (!categoryName) {
        skipped.push({ ...r, conflictReason: "empty_category" });
        continue;
      }
      await upsertTier0(client, r.product_code, categoryName, r.raw_label, triggeredBy);
      written0.push({ product_code: r.product_code, category_name: categoryName });
    }

    for (const r of tier1Results) {
      const categoryName = formatDisplayCategory(r.shelf_no, r.clean_category);
      await upsertTier1(
        client,
        r.product_code,
        categoryName,
        r.review_status,
        r.reason,
        triggeredBy,
      );
      written1.push({
        product_code: r.product_code,
        category_name: categoryName,
        review_status: r.review_status,
        reason: r.reason,
      });
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return buildMetrics(startedAt, products.length, tier0Results, tier1Results, written0, written1, skipped);
}

// ── Upsert helpers ────────────────────────────────────────────────────────────

async function upsertTier0(client, productCode, categoryName, rawLabel, triggeredBy) {
  await client.query(
    `
    INSERT INTO ada.product_category_states
      (product_code, category_name, review_status, rationale,
       source_kind, source_reference, source_match_level,
       previous_category_name, previous_review_status,
       imported_at, imported_by, updated_at)
    VALUES
      ($1, $2, 'imported_exact_match',
       $3,
       'taxonomy_workbook', 'taxonomy_batch/tier0', 'exact_code',
       (SELECT category_name   FROM ada.product_category_states WHERE product_code = $1),
       (SELECT review_status   FROM ada.product_category_states WHERE product_code = $1),
       now(), $4, now())
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
    [
      productCode,
      categoryName,
      `Tier 0 exact taxonomy match. Raw label: ${rawLabel || ""}. Triggered by: ${triggeredBy}`,
      triggeredBy,
    ],
  );
}

async function upsertTier1(client, productCode, categoryName, reviewStatus, reason, triggeredBy) {
  await client.query(
    `
    INSERT INTO ada.product_category_states
      (product_code, category_name, review_status, rationale,
       source_kind, source_reference, source_match_level,
       previous_category_name, previous_review_status,
       imported_at, imported_by, updated_at)
    VALUES
      ($1, $2, $3,
       $4,
       'rules_batch', 'taxonomy_batch/tier1', $5,
       (SELECT category_name  FROM ada.product_category_states WHERE product_code = $1),
       (SELECT review_status  FROM ada.product_category_states WHERE product_code = $1),
       now(), $6, now())
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
    [
      productCode,
      categoryName || "",
      reviewStatus,
      `Tier 1 rules batch. Reason: ${reason}. Triggered by: ${triggeredBy}`,
      reason || null,
      triggeredBy,
    ],
  );
}

// ── Metrics builder ───────────────────────────────────────────────────────────

function buildMetrics(startedAt, totalProcessed, tier0Results, tier1Results, written0, written1, skipped = []) {
  const finishedAt = new Date();

  const conflicts = tier0Results.filter((r) => r.conflict);
  const tier0Exact = written0.length;

  const tier1Proposed = written1.filter((r) => r.review_status === "proposed");
  const tier1NeedsReview = written1.filter((r) => r.review_status === "needs_review");

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    totalProcessed,
    tier0Exact,
    tier1Rules: tier1Proposed.length,
    needsReview: tier1NeedsReview.length,
    conflictsSkipped: conflicts.length,
    examples: {
      tier0: written0.slice(0, EXAMPLE_LIMIT),
      tier1Proposed: tier1Proposed.slice(0, EXAMPLE_LIMIT),
      needsReview: tier1NeedsReview.slice(0, EXAMPLE_LIMIT),
      conflicts: conflicts.slice(0, EXAMPLE_LIMIT).map((r) => ({
        product_code: r.product_code,
        reason: r.conflictReason,
        categories: r.categories,
      })),
    },
  };
}

module.exports = { runCategorizationBatch };
