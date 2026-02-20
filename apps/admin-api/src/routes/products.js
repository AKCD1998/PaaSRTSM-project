"use strict";

const express = require("express");
const { auditLog } = require("../audit");
const { auditBase } = require("../utils/audit-payload");

const EDITABLE_FIELDS = [
  "display_name",
  "category_name",
  "supplier_code",
  "product_kind",
  "enrichment_status",
  "enrichment_notes",
  "generic_name",
  "strength_text",
  "form",
  "route",
];

const ENRICHMENT_STATUS_SET = new Set(["missing", "partial", "verified"]);

function parsePositiveInt(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseOffset(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeNullableText(value) {
  if (value == null) {
    return null;
  }
  const normalized = normalizeText(value);
  return normalized === "" ? null : normalized;
}

function parseIncludeHistory(value) {
  const normalized = normalizeText(value).toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function buildFiltersFromQuery(query) {
  const keyword = normalizeText(query.keyword);
  const categoryName = normalizeNullableText(query.category_name);
  const supplierCode = normalizeNullableText(query.supplier_code);
  const productKind = normalizeNullableText(query.product_kind);
  const enrichmentStatusRaw = normalizeText(query.enrichment_status).toLowerCase();
  const enrichmentStatus = enrichmentStatusRaw || null;

  if (enrichmentStatus && !ENRICHMENT_STATUS_SET.has(enrichmentStatus)) {
    throw new Error("enrichment_status must be one of missing|partial|verified");
  }

  const limit = parsePositiveInt(query.limit, 50);
  if (limit == null) {
    throw new Error("limit must be a positive integer");
  }
  const boundedLimit = Math.min(limit, 200);
  const offset = parseOffset(query.offset, 0);
  if (offset == null) {
    throw new Error("offset must be a non-negative integer");
  }

  return {
    keyword,
    categoryName,
    supplierCode,
    productKind,
    enrichmentStatus,
    limit: boundedLimit,
    offset,
  };
}

function buildWhereClause(filters) {
  const clauses = [];
  const params = [];

  if (filters.keyword) {
    params.push(`%${filters.keyword}%`);
    const p = `$${params.length}`;
    clauses.push(
      `(s.display_name ILIKE ${p} OR s.company_code ILIKE ${p} OR s.generic_name ILIKE ${p} OR EXISTS (SELECT 1 FROM public.barcodes b WHERE b.sku_id = s.sku_id AND b.barcode ILIKE ${p}))`,
    );
  }

  if (filters.categoryName) {
    params.push(`%${filters.categoryName}%`);
    clauses.push(`s.category_name ILIKE $${params.length}`);
  }

  if (filters.supplierCode) {
    params.push(`%${filters.supplierCode}%`);
    clauses.push(`s.supplier_code ILIKE $${params.length}`);
  }

  if (filters.productKind) {
    params.push(filters.productKind);
    clauses.push(`s.product_kind = $${params.length}`);
  }

  if (filters.enrichmentStatus) {
    params.push(filters.enrichmentStatus);
    clauses.push(`COALESCE(s.enrichment_status, 'missing') = $${params.length}`);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return { whereSql, params };
}

function pickChangedFields(beforeRow, afterRow) {
  const changed = {};
  for (const field of EDITABLE_FIELDS) {
    const beforeValue = beforeRow[field];
    const afterValue = afterRow[field];
    const beforeNorm = normalizeNullableText(beforeValue);
    const afterNorm = normalizeNullableText(afterValue);
    if (beforeNorm !== afterNorm) {
      changed[field] = {
        before: beforeValue,
        after: afterValue,
      };
    }
  }
  return changed;
}

function parseUpdatePayload(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object");
  }

  const updates = {};
  for (const field of EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) {
      continue;
    }

    if (field === "enrichment_status") {
      const status = normalizeText(body[field]).toLowerCase();
      if (!status) {
        throw new Error("enrichment_status cannot be empty");
      }
      if (!ENRICHMENT_STATUS_SET.has(status)) {
        throw new Error("enrichment_status must be one of missing|partial|verified");
      }
      updates[field] = status;
      continue;
    }

    updates[field] = normalizeNullableText(body[field]);
  }

  return updates;
}

async function queryProducts(db, filters) {
  const where = buildWhereClause(filters);

  const countSql = `
    SELECT COUNT(*)::integer AS total
    FROM public.skus s
    ${where.whereSql}
  `;
  const countResult = await db.query(countSql, where.params);
  const total = countResult.rows[0]?.total || 0;

  const listParams = [...where.params, filters.limit, filters.offset];
  const listSql = `
    SELECT
      s.sku_id,
      s.company_code,
      s.display_name,
      s.category_name,
      s.supplier_code,
      s.product_kind,
      s.enrichment_status,
      s.avg_cost,
      s.updated_at,
      COALESCE(retail.price, unit_retail.retail_price) AS retail_price,
      COALESCE(retail.currency, unit_retail.currency) AS retail_currency,
      retail.effective_start AS retail_effective_start,
      COALESCE(retail.updated_at, unit_retail.updated_at) AS retail_updated_at
    FROM public.skus s
    LEFT JOIN LATERAL (
      SELECT p.price, p.currency, p.effective_start, p.updated_at
      FROM public.prices p
      WHERE p.sku_id = s.sku_id
        AND p.effective_end IS NULL
      ORDER BY p.effective_start DESC NULLS LAST, p.price_id DESC
      LIMIT 1
    ) retail ON TRUE
    LEFT JOIN LATERAL (
      SELECT up.retail_price, up.currency, up.updated_at
      FROM public.sku_unit_prices up
      WHERE up.sku_id = s.sku_id
        AND up.is_active = TRUE
        AND up.retail_price IS NOT NULL
      ORDER BY up.unit ASC, up.id ASC
      LIMIT 1
    ) unit_retail ON TRUE
    ${where.whereSql}
    ORDER BY s.sku_id DESC
    LIMIT $${where.params.length + 1}
    OFFSET $${where.params.length + 2}
  `;

  let listResult = null;
  try {
    listResult = await db.query(listSql, listParams);
  } catch (error) {
    if (error?.code !== "42P01") {
      throw error;
    }
    const legacyListSql = `
      SELECT
        s.sku_id,
        s.company_code,
        s.display_name,
        s.category_name,
        s.supplier_code,
        s.product_kind,
        s.enrichment_status,
        s.avg_cost,
        s.updated_at,
        retail.price AS retail_price,
        retail.currency AS retail_currency,
        retail.effective_start AS retail_effective_start,
        retail.updated_at AS retail_updated_at
      FROM public.skus s
      LEFT JOIN LATERAL (
        SELECT p.price, p.currency, p.effective_start, p.updated_at
        FROM public.prices p
        WHERE p.sku_id = s.sku_id
          AND p.effective_end IS NULL
        ORDER BY p.effective_start DESC NULLS LAST, p.price_id DESC
        LIMIT 1
      ) retail ON TRUE
      ${where.whereSql}
      ORDER BY s.sku_id DESC
      LIMIT $${where.params.length + 1}
      OFFSET $${where.params.length + 2}
    `;
    listResult = await db.query(legacyListSql, listParams);
  }
  return {
    total,
    limit: filters.limit,
    offset: filters.offset,
    rows: listResult.rows,
  };
}

async function queryProductDetail(db, skuId, includeHistory) {
  const skuSql = `
    SELECT
      s.sku_id,
      s.item_id,
      s.company_code,
      s.display_name,
      s.category_name,
      s.supplier_code,
      s.product_kind,
      s.avg_cost,
      s.generic_name,
      s.strength_text,
      s.form,
      s.route,
      COALESCE(s.enrichment_status, 'missing') AS enrichment_status,
      s.enrichment_notes,
      s.enriched_at,
      s.enriched_by,
      s.updated_at,
      s.source_updated_at,
      s.source_updated_by,
      i.source_company_code,
      i.display_name AS item_display_name,
      i.category_name AS item_category_name,
      i.supplier_code AS item_supplier_code,
      i.product_kind AS item_product_kind
    FROM public.skus s
    LEFT JOIN public.items i
      ON i.item_id = s.item_id
    WHERE s.sku_id = $1
    LIMIT 1
  `;
  const skuResult = await db.query(skuSql, [skuId]);
  if (skuResult.rowCount === 0) {
    return null;
  }
  const sku = skuResult.rows[0];

  const barcodesSql = `
    SELECT barcode, is_primary, updated_at
    FROM public.barcodes
    WHERE sku_id = $1
    ORDER BY is_primary DESC, barcode ASC
  `;
  const barcodesResult = await db.query(barcodesSql, [skuId]);

  const retailSql = `
    SELECT
      price_id,
      price,
      currency,
      effective_start,
      effective_end,
      updated_at
    FROM public.prices
    WHERE sku_id = $1
      AND effective_end IS NULL
    ORDER BY effective_start DESC NULLS LAST, price_id DESC
    LIMIT 1
  `;
  const retailResult = await db.query(retailSql, [skuId]);

  const tiersSql = `
    SELECT tier, price, currency, is_active, updated_at
    FROM public.sku_price_tiers
    WHERE sku_id = $1
      AND price_kind = 'wholesale'
    ORDER BY tier ASC
  `;
  const tiersResult = await db.query(tiersSql, [skuId]);

  const unitPricesSql = `
    SELECT
      up.id,
      up.unit,
      up.retail_price,
      up.currency,
      up.updated_at,
      up.source_updated_at,
      COALESCE(
        json_agg(
          json_build_object(
            'tier', ut.tier,
            'price', ut.price,
            'is_active', ut.is_active
          )
          ORDER BY ut.tier ASC
        ) FILTER (WHERE ut.id IS NOT NULL),
        '[]'::json
      ) AS tiers
    FROM public.sku_unit_prices up
    LEFT JOIN public.sku_unit_price_tiers ut
      ON ut.sku_unit_price_id = up.id
    WHERE up.sku_id = $1
      AND up.is_active = TRUE
    GROUP BY up.id, up.unit, up.retail_price, up.currency, up.updated_at, up.source_updated_at
    ORDER BY up.unit ASC, up.id ASC
  `;
  let unitPricesResult = { rows: [] };
  try {
    unitPricesResult = await db.query(unitPricesSql, [skuId]);
  } catch (error) {
    if (error?.code !== "42P01") {
      throw error;
    }
  }

  let priceHistory = [];
  if (includeHistory) {
    const historySql = `
      SELECT
        price_id,
        price,
        currency,
        effective_start,
        effective_end,
        updated_at
      FROM public.prices
      WHERE sku_id = $1
      ORDER BY effective_start DESC NULLS LAST, price_id DESC
      LIMIT 100
    `;
    const historyResult = await db.query(historySql, [skuId]);
    priceHistory = historyResult.rows;
  }

  return {
    ...sku,
    barcodes: barcodesResult.rows,
    retail_price: retailResult.rows[0] || null,
    wholesale_tiers: tiersResult.rows,
    unit_prices: unitPricesResult.rows,
    price_history: priceHistory,
  };
}

function createProductsRouter(deps) {
  const { db, requireAuthMiddleware, requireRoleMiddleware, requireCsrfMiddleware } = deps;
  const router = express.Router();

  router.get("/", requireAuthMiddleware, async (req, res, next) => {
    try {
      const filters = buildFiltersFromQuery(req.query || {});
      const result = await queryProducts(db, filters);
      return res.json({
        ok: true,
        request_id: req.requestId,
        ...result,
      });
    } catch (error) {
      if (error.message.includes("must be")) {
        return res.status(400).json({
          error: error.message,
          request_id: req.requestId,
        });
      }
      return next(error);
    }
  });

  router.get("/:sku_id", requireAuthMiddleware, async (req, res, next) => {
    const skuId = parsePositiveInt(req.params.sku_id, null);
    if (skuId == null) {
      return res.status(400).json({
        error: "sku_id must be a positive integer",
        request_id: req.requestId,
      });
    }

    try {
      const includeHistory = parseIncludeHistory(req.query?.include_history);
      const product = await queryProductDetail(db, skuId, includeHistory);
      if (!product) {
        return res.status(404).json({
          error: "Product not found",
          request_id: req.requestId,
        });
      }

      return res.json({
        ok: true,
        request_id: req.requestId,
        product,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.put(
    "/:sku_id",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    requireCsrfMiddleware,
    async (req, res, next) => {
      const skuId = parsePositiveInt(req.params.sku_id, null);
      if (skuId == null) {
        return res.status(400).json({
          error: "sku_id must be a positive integer",
          request_id: req.requestId,
        });
      }

      let updates = null;
      try {
        updates = parseUpdatePayload(req.body);
      } catch (error) {
        return res.status(400).json({
          error: error.message,
          request_id: req.requestId,
        });
      }

      const updateEntries = Object.entries(updates);
      if (updateEntries.length === 0) {
        return res.status(400).json({
          error: "No editable fields provided",
          request_id: req.requestId,
        });
      }

      try {
        const beforeSql = `
          SELECT
            sku_id,
            company_code,
            display_name,
            category_name,
            supplier_code,
            product_kind,
            enrichment_status,
            enrichment_notes,
            generic_name,
            strength_text,
            form,
            route
          FROM public.skus
          WHERE sku_id = $1
          LIMIT 1
        `;
        const beforeResult = await db.query(beforeSql, [skuId]);
        if (beforeResult.rowCount === 0) {
          return res.status(404).json({
            error: "Product not found",
            request_id: req.requestId,
          });
        }
        const beforeRow = beforeResult.rows[0];

        const assignments = [];
        const params = [];
        let index = 1;
        for (const [column, value] of updateEntries) {
          assignments.push(`${column} = $${index}`);
          params.push(value);
          index += 1;
        }
        assignments.push("updated_at = now()");
        params.push(skuId);

        const updateSql = `
          UPDATE public.skus
          SET ${assignments.join(", ")}
          WHERE sku_id = $${index}
          RETURNING
            sku_id,
            company_code,
            display_name,
            category_name,
            supplier_code,
            product_kind,
            enrichment_status,
            enrichment_notes,
            generic_name,
            strength_text,
            form,
            route,
            updated_at
        `;
        const updateResult = await db.query(updateSql, params);
        const afterRow = updateResult.rows[0];
        const changed = pickChangedFields(beforeRow, afterRow);
        const changedFields = Object.keys(changed);

        await auditLog(
          db,
          auditBase(req, {
            action: "product.update",
            target_type: "sku",
            target_id: String(skuId),
            success: true,
            meta: {
              company_code: afterRow.company_code,
              changed_fields: changedFields,
              before: Object.fromEntries(changedFields.map((field) => [field, changed[field].before])),
              after: Object.fromEntries(changedFields.map((field) => [field, changed[field].after])),
            },
          }),
        );

        return res.json({
          ok: true,
          request_id: req.requestId,
          sku_id: skuId,
          company_code: afterRow.company_code,
          changed_fields: changedFields,
          product: afterRow,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

module.exports = {
  createProductsRouter,
  buildFiltersFromQuery,
  parseUpdatePayload,
  EDITABLE_FIELDS,
};
