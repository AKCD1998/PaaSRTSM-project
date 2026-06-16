"use strict";

// Tier 3: ingredient-rule categorization for products still in needs_review.
async function runTier3(db, productCodes, options = {}) {
  if (!productCodes || productCodes.length === 0) return [];

  const { dryRun = false } = options;
  void dryRun;

  const { rows } = await db.query(
    `
    WITH eligible_products AS (
      SELECT pcs.product_code
      FROM ada.product_category_states pcs
      WHERE pcs.product_code = ANY($1)
        AND pcs.review_status = 'needs_review'
    ),
    rule_matches AS (
      SELECT
        pi.product_code,
        ki.canonical_name,
        ki.display_name,
        icr.category_name,
        icr.priority
      FROM knowledge.product_ingredients pi
      JOIN eligible_products ep
        ON ep.product_code = pi.product_code
      JOIN knowledge.ingredients ki
        ON ki.ingredient_id = pi.ingredient_id
      JOIN knowledge.ingredient_category_rules icr
        ON icr.ingredient_id = pi.ingredient_id
      WHERE pi.status IN ('proposed', 'confirmed')
        AND ki.status = 'active'
        AND icr.rule_status = 'active'
    ),
    category_candidates AS (
      SELECT
        rm.product_code,
        rm.category_name,
        MAX(rm.priority) AS max_priority,
        string_agg(DISTINCT rm.canonical_name, ', ' ORDER BY rm.canonical_name) AS matched_ingredients
      FROM rule_matches rm
      GROUP BY rm.product_code, rm.category_name
    ),
    product_conflicts AS (
      SELECT
        cc.product_code,
        COUNT(*) AS category_count
      FROM category_candidates cc
      GROUP BY cc.product_code
    ),
    ranked_candidates AS (
      SELECT
        cc.product_code,
        cc.category_name,
        cc.max_priority,
        cc.matched_ingredients,
        pc.category_count,
        ROW_NUMBER() OVER (
          PARTITION BY cc.product_code
          ORDER BY cc.max_priority DESC, cc.category_name ASC
        ) AS candidate_rank
      FROM category_candidates cc
      JOIN product_conflicts pc
        ON pc.product_code = cc.product_code
    )
    SELECT
      product_code,
      category_name AS clean_category,
      CASE
        WHEN category_count = 1 THEN 'ingredient_rule_match'
        ELSE 'ingredient_rule_conflict_resolved'
      END AS reason,
      matched_ingredients
    FROM ranked_candidates
    WHERE candidate_rank = 1
    ORDER BY product_code
    `,
    [productCodes],
  );

  return rows.map((row) => ({
    product_code: row.product_code,
    clean_category: row.clean_category,
    shelf_no: null,
    source: "ingredient_rules",
    review_status: "proposed",
    reason: row.reason,
    matched_ingredients: row.matched_ingredients,
  }));
}

module.exports = { runTier3 };
