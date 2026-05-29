"use strict";

/**
 * Tier 2: pgvector cosine-similarity categorization.
 *
 * For each product in `productCodes` that currently has review_status =
 * 'needs_review' in ada.product_category_states AND has an embedding in
 * ada.product_category_embeddings, finds the nearest categorized product
 * (imported_exact_match) in the same embedding table.
 *
 * If cosine similarity >= similarityThreshold the product is assigned that
 * category as 'proposed'. Otherwise it remains 'needs_review'.
 *
 * Returns array of:
 *   { product_code, clean_category, shelf_no: null, source: 'similarity',
 *     review_status, reason, similarity, matched_product_code }
 *
 * NOTE: clean_category here is already the formatted display string
 * (e.g. "3ยาแก้ปวด") copied from the matched categorized product.
 * Tier 2 does NOT assign shelf numbers independently.
 */

const DEFAULT_THRESHOLD = 0.60;

async function runTier2(db, productCodes, options = {}) {
  if (!productCodes || productCodes.length === 0) return [];

  const { similarityThreshold = DEFAULT_THRESHOLD } = options;

  const { rows } = await db.query(
    `
    WITH query_set AS (
      SELECT pcs.product_code, pce.embedding
      FROM ada.product_category_states pcs
      JOIN ada.product_category_embeddings pce
             ON pce.product_code = pcs.product_code
      WHERE pcs.product_code = ANY($1)
        AND pcs.review_status = 'needs_review'
        AND pce.embedding IS NOT NULL
    ),
    ref_set AS (
      SELECT pcs.product_code, pcs.category_name, pce.embedding
      FROM ada.product_category_states pcs
      JOIN ada.product_category_embeddings pce
             ON pce.product_code = pcs.product_code
      WHERE pcs.review_status = 'imported_exact_match'
        AND pce.embedding IS NOT NULL
    )
    SELECT DISTINCT ON (q.product_code)
      q.product_code,
      r.product_code   AS matched_product_code,
      r.category_name  AS matched_category,
      ROUND((1 - (q.embedding <=> r.embedding))::numeric, 4) AS similarity
    FROM query_set q
    CROSS JOIN LATERAL (
      SELECT rs.product_code, rs.category_name, rs.embedding
      FROM ref_set rs
      ORDER BY q.embedding <=> rs.embedding
      LIMIT 1
    ) r
    WHERE (1 - (q.embedding <=> r.embedding)) >= $2
    ORDER BY q.product_code, similarity DESC
    `,
    [productCodes, similarityThreshold],
  );

  return rows.map((r) => ({
    product_code: r.product_code,
    clean_category: r.matched_category,
    shelf_no: null,
    source: "similarity",
    review_status: "proposed",
    reason: `similarity_${Math.round(Number(r.similarity) * 100)}pct`,
    similarity: Number(r.similarity),
    matched_product_code: r.matched_product_code,
  }));
}

module.exports = { runTier2, DEFAULT_TIER2_THRESHOLD: DEFAULT_THRESHOLD };
