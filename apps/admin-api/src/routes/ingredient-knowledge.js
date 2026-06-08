"use strict";

const express = require("express");

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function parseSearch(value) {
  return normalizeText(value).slice(0, 120);
}

function toNumberOrNull(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function mapIngredientRow(row) {
  return {
    ingredientId: Number(row.ingredient_id),
    canonicalName: row.canonical_name,
    displayName: row.display_name,
    strengthValue: toNumberOrNull(row.strength_value),
    strengthUnit: row.strength_unit || null,
    rawText: row.raw_text || null,
    source: row.source || "",
    status: row.status || "",
    confidence: toNumberOrNull(row.confidence),
    drugClasses: parseJsonArray(row.drug_classes).map((item) => ({
      drugClassId: Number(item.drugClassId),
      name: item.name,
      status: item.status,
      confidence: toNumberOrNull(item.confidence),
      source: item.source || null,
    })),
    indications: parseJsonArray(row.indications).map((item) => ({
      indicationId: Number(item.indicationId),
      name: item.name,
      status: item.status,
      source: item.source || null,
    })),
  };
}

function mapIngredientDictionaryRow(row) {
  return {
    ingredientId: Number(row.ingredient_id),
    canonicalName: row.canonical_name,
    displayName: row.display_name,
    status: row.status,
    synonyms: parseJsonArray(row.synonyms).map((item) => ({
      synonymId: Number(item.synonymId),
      synonymText: item.synonymText,
      language: item.language || null,
      source: item.source || null,
      status: item.status,
    })),
  };
}

async function loadProductMetadata(db, productCode) {
  const result = await db.query(
    `
      SELECT
        input.product_code,
        COALESCE(bs.product_name_thai, s.display_name, p.display_name, input.product_code) AS product_name_thai,
        COALESCE(bs.product_name_eng, '') AS product_name_eng,
        COALESCE(
          (SELECT pb.barcode
           FROM ada.product_barcodes pb
           WHERE pb.product_code = input.product_code
           ORDER BY pb.source_synced_at DESC NULLS LAST, pb.barcode ASC
           LIMIT 1),
          bs.barcode,
          (SELECT b.barcode
           FROM public.barcodes b
           WHERE b.sku_id = s.sku_id
           ORDER BY b.is_primary DESC, b.updated_at DESC NULLS LAST, b.barcode ASC
           LIMIT 1),
          ''
        ) AS barcode
      FROM (SELECT $1::text AS product_code) input
      LEFT JOIN ada.branch_stock_snapshots bs
        ON bs.product_code = input.product_code
      LEFT JOIN public.skus s
        ON s.company_code = input.product_code
      LEFT JOIN ada.products p
        ON p.product_code = input.product_code
      LIMIT 1
    `,
    [productCode],
  );

  const row = result.rows[0] || {};
  return {
    productCode,
    productNameThai: row.product_name_thai || productCode,
    productNameEng: row.product_name_eng || "",
    barcode: row.barcode || "",
  };
}

async function loadProductIngredients(db, productCode) {
  const result = await db.query(
    `
      SELECT
        pi.ingredient_id,
        i.canonical_name,
        i.display_name,
        pi.strength_value,
        pi.strength_unit,
        pi.raw_text,
        pi.source,
        pi.status,
        pi.confidence,
        COALESCE(
          jsonb_agg(DISTINCT jsonb_build_object(
            'drugClassId', dc.drug_class_id,
            'name', dc.name,
            'status', idc.status,
            'confidence', idc.confidence,
            'source', idc.source
          )) FILTER (WHERE dc.drug_class_id IS NOT NULL),
          '[]'::jsonb
        ) AS drug_classes,
        COALESCE(
          jsonb_agg(DISTINCT jsonb_build_object(
            'indicationId', ind.indication_id,
            'name', ind.name,
            'status', ii.status,
            'source', ii.source
          )) FILTER (WHERE ind.indication_id IS NOT NULL),
          '[]'::jsonb
        ) AS indications
      FROM knowledge.product_ingredients pi
      JOIN knowledge.ingredients i
        ON i.ingredient_id = pi.ingredient_id
      LEFT JOIN knowledge.ingredient_drug_classes idc
        ON idc.ingredient_id = i.ingredient_id
       AND idc.status <> 'rejected'
      LEFT JOIN knowledge.drug_classes dc
        ON dc.drug_class_id = idc.drug_class_id
      LEFT JOIN knowledge.ingredient_indications ii
        ON ii.ingredient_id = i.ingredient_id
       AND ii.status <> 'rejected'
      LEFT JOIN knowledge.indications ind
        ON ind.indication_id = ii.indication_id
      WHERE pi.product_code = $1
        AND pi.status <> 'rejected'
      GROUP BY
        pi.ingredient_id,
        i.canonical_name,
        i.display_name,
        pi.strength_value,
        pi.strength_unit,
        pi.raw_text,
        pi.source,
        pi.status,
        pi.confidence
      ORDER BY i.display_name ASC, i.canonical_name ASC
    `,
    [productCode],
  );

  return result.rows.map(mapIngredientRow);
}

async function loadIngredientCategorySuggestions(db, productCode) {
  const result = await db.query(
    `
      WITH product_ingredient_context AS (
        SELECT
          pi.product_code,
          pi.ingredient_id,
          i.display_name AS ingredient_name,
          idc.drug_class_id,
          dc.name AS drug_class_name,
          ii.indication_id,
          ind.name AS indication_name
        FROM knowledge.product_ingredients pi
        JOIN knowledge.ingredients i
          ON i.ingredient_id = pi.ingredient_id
        LEFT JOIN knowledge.ingredient_drug_classes idc
          ON idc.ingredient_id = pi.ingredient_id
         AND idc.status <> 'rejected'
        LEFT JOIN knowledge.drug_classes dc
          ON dc.drug_class_id = idc.drug_class_id
        LEFT JOIN knowledge.ingredient_indications ii
          ON ii.ingredient_id = pi.ingredient_id
         AND ii.status <> 'rejected'
        LEFT JOIN knowledge.indications ind
          ON ind.indication_id = ii.indication_id
        WHERE pi.product_code = $1
          AND pi.status <> 'rejected'
      )
      SELECT DISTINCT ON (r.category_name, r.rule_id)
        r.category_name,
        r.priority,
        CASE
          WHEN r.ingredient_id IS NOT NULL THEN 'ingredient_rule'
          WHEN r.drug_class_id IS NOT NULL THEN 'drug_class_rule'
          ELSE 'indication_rule'
        END AS source,
        CONCAT_WS(
          ' -> ',
          ctx.ingredient_name,
          CASE WHEN r.drug_class_id IS NOT NULL THEN ctx.drug_class_name END,
          CASE WHEN r.indication_id IS NOT NULL THEN ctx.indication_name END,
          r.category_name
        ) AS reason
      FROM knowledge.ingredient_category_rules r
      JOIN product_ingredient_context ctx
        ON (r.ingredient_id IS NOT NULL AND r.ingredient_id = ctx.ingredient_id)
        OR (r.drug_class_id IS NOT NULL AND r.drug_class_id = ctx.drug_class_id)
        OR (r.indication_id IS NOT NULL AND r.indication_id = ctx.indication_id)
      WHERE r.rule_status = 'active'
      ORDER BY r.category_name, r.rule_id, r.priority ASC
      LIMIT 20
    `,
    [productCode],
  );

  return result.rows
    .map((row) => ({
      categoryName: row.category_name,
      reason: row.reason || row.category_name,
      source: row.source,
      priority: Number(row.priority || 100),
    }))
    .sort((left, right) => left.priority - right.priority || left.categoryName.localeCompare(right.categoryName, "th"));
}

async function searchIngredients(db, search) {
  const params = [];
  let whereSql = "";
  if (search) {
    params.push(`%${search}%`);
    whereSql = `
      WHERE i.canonical_name ILIKE $1
         OR i.display_name ILIKE $1
         OR EXISTS (
           SELECT 1
           FROM knowledge.ingredient_synonyms s
           WHERE s.ingredient_id = i.ingredient_id
             AND s.synonym_text ILIKE $1
         )
    `;
  }

  const result = await db.query(
    `
      SELECT
        i.ingredient_id,
        i.canonical_name,
        i.display_name,
        i.status,
        COALESCE(
          jsonb_agg(jsonb_build_object(
            'synonymId', s.synonym_id,
            'synonymText', s.synonym_text,
            'language', s.language,
            'source', s.source,
            'status', s.status
          ) ORDER BY s.synonym_text ASC) FILTER (WHERE s.synonym_id IS NOT NULL),
          '[]'::jsonb
        ) AS synonyms
      FROM knowledge.ingredients i
      LEFT JOIN knowledge.ingredient_synonyms s
        ON s.ingredient_id = i.ingredient_id
       AND s.status <> 'deprecated'
      ${whereSql}
      GROUP BY i.ingredient_id, i.canonical_name, i.display_name, i.status
      ORDER BY i.display_name ASC, i.canonical_name ASC
      LIMIT 50
    `,
    params,
  );

  return result.rows.map(mapIngredientDictionaryRow);
}

function createIngredientKnowledgeRouter(deps) {
  const { db, requireAuthMiddleware, requireRoleMiddleware } = deps;
  const router = express.Router();

  router.get(
    "/products/:productCode/ingredient-supervision",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    async (req, res, next) => {
      const productCode = normalizeText(req.params.productCode);
      if (!productCode) {
        return res.status(400).json({ error: "productCode is required", request_id: req.requestId || null });
      }

      try {
        const [product, ingredients, categorySuggestions] = await Promise.all([
          loadProductMetadata(db, productCode),
          loadProductIngredients(db, productCode),
          loadIngredientCategorySuggestions(db, productCode),
        ]);

        return res.json({
          ok: true,
          product,
          ingredients,
          categorySuggestions,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/ingredients",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    async (req, res, next) => {
      try {
        const records = await searchIngredients(db, parseSearch(req.query.search));
        return res.json({ ok: true, records });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

module.exports = {
  createIngredientKnowledgeRouter,
  loadProductMetadata,
  loadProductIngredients,
  loadIngredientCategorySuggestions,
  searchIngredients,
};
