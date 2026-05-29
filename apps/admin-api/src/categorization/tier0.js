"use strict";

/**
 * Tier 0: exact product_code match against public.taxonomy_map.
 *
 * Returns one result object per product_code in the input list.
 * A product is flagged as a conflict when multiple active taxonomy rows
 * exist for the same code and they disagree on clean_category.
 * Products with no taxonomy row are simply absent from the returned array.
 */
async function runTier0(db, productCodes) {
  if (!productCodes || productCodes.length === 0) return [];

  const { rows } = await db.query(
    `
    SELECT
      product_code,
      clean_category,
      shelf_no,
      pharmacist_zone,
      raw_label
    FROM public.taxonomy_map
    WHERE product_code = ANY($1)
      AND status = 'active'
    ORDER BY product_code, taxonomy_id
    `,
    [productCodes],
  );

  // Group rows by product_code
  const byCode = new Map();
  for (const row of rows) {
    const list = byCode.get(row.product_code) || [];
    list.push(row);
    byCode.set(row.product_code, list);
  }

  const results = [];

  for (const [product_code, matches] of byCode.entries()) {
    // Collect distinct clean_categories ignoring null/empty
    const categories = [
      ...new Set(matches.map((m) => (m.clean_category || "").trim()).filter(Boolean)),
    ];

    if (categories.length > 1) {
      results.push({
        product_code,
        conflict: true,
        conflictReason: "multiple_taxonomy_categories",
        rawLabels: matches.map((m) => m.raw_label),
        categories,
      });
      continue;
    }

    const first = matches[0];
    results.push({
      product_code,
      conflict: false,
      clean_category: first.clean_category ? String(first.clean_category).trim() : null,
      shelf_no: first.shelf_no != null ? Number(first.shelf_no) : null,
      pharmacist_zone: Boolean(first.pharmacist_zone),
      raw_label: first.raw_label || null,
    });
  }

  return results;
}

module.exports = { runTier0 };
