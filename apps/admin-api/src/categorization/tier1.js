"use strict";

/**
 * Tier 1: deterministic normalization using typo_aliases + category_shelf_rules.
 *
 * Input:  array of { product_code, raw_category_name }
 * Output: array of { product_code, clean_category, shelf_no, source, review_status, reason }
 *
 * Rules:
 *  - raw_category_name run through typo_aliases (case-insensitive key lookup)
 *  - if canonical name found in category_shelf_rules → proposed (unless always_human_confirm)
 *  - if category has always_human_confirm → needs_review
 *  - if no rule found but we have a raw name → needs_review (unrecognized category)
 *  - if no raw name at all → needs_review (no_source_category)
 *
 * Shelf note: Tier 1 does NOT assign shelf_no.
 * The workbook (Tier 0) is the only reliable shelf source.
 * If a rule has exactly one allowed shelf, we still don't assume it here —
 * shelf assignment goes through human review.
 */
async function loadTier1References(db) {
  const [aliasResult, ruleResult] = await Promise.all([
    db.query(`SELECT raw_variant, canonical_category FROM public.typo_aliases`),
    db.query(
      `SELECT clean_category, is_cold_chain_possible, is_controlled,
              always_human_confirm, allowed_unprefixed
       FROM public.category_shelf_rules`,
    ),
  ]);

  const aliasMap = new Map(
    aliasResult.rows.map((r) => [r.raw_variant.toLowerCase(), r.canonical_category]),
  );
  const ruleMap = new Map(
    ruleResult.rows.map((r) => [r.clean_category, r]),
  );

  return { aliasMap, ruleMap };
}

function normalizeRawCategory(raw, aliasMap) {
  if (!raw || !String(raw).trim()) return null;
  const trimmed = String(raw).trim();
  const canonical = aliasMap.get(trimmed.toLowerCase());
  return canonical !== undefined ? canonical : trimmed;
}

function runTier1Products(products, aliasMap, ruleMap) {
  const results = [];

  for (const product of products) {
    const raw = product.raw_category_name;

    if (!raw || !String(raw).trim()) {
      results.push({
        product_code: product.product_code,
        clean_category: null,
        shelf_no: null,
        source: "rule",
        review_status: "needs_review",
        reason: "no_source_category",
      });
      continue;
    }

    const canonical = normalizeRawCategory(raw, aliasMap);
    const typoFixed = canonical !== String(raw).trim();
    const rule = ruleMap.get(canonical);

    if (rule) {
      const alwaysHuman = Boolean(rule.always_human_confirm);
      results.push({
        product_code: product.product_code,
        clean_category: canonical,
        shelf_no: null,
        source: "rule",
        review_status: alwaysHuman ? "needs_review" : "proposed",
        reason: typoFixed ? "typo_corrected_rule_match" : "rule_match",
        is_cold_chain: Boolean(rule.is_cold_chain_possible),
        is_controlled: Boolean(rule.is_controlled),
      });
    } else {
      results.push({
        product_code: product.product_code,
        clean_category: canonical,
        shelf_no: null,
        source: "rule",
        review_status: "needs_review",
        reason: typoFixed ? "typo_corrected_no_rule" : "unrecognized_category",
      });
    }
  }

  return results;
}

async function runTier1(db, products) {
  if (!products || products.length === 0) return [];
  const { aliasMap, ruleMap } = await loadTier1References(db);
  return runTier1Products(products, aliasMap, ruleMap);
}

module.exports = { runTier1 };
