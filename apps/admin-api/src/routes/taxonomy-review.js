"use strict";

const express = require("express");
const { normalizeNullableProductType, parsePositiveInt, PRODUCT_TYPES } = require("../taxonomy/backfill");

const REVIEW_STATUSES = new Set(["auto", "confirmed", "needs_review"]);
const PRODUCT_TYPE_PRIORITY = Object.freeze({
  drug: 1,
  herb: 2,
  supplement: 3,
  antiseptic: 4,
  cosmeceutical: 5,
  cosmetic: 6,
  device: 7,
  service: 8,
  other: 9,
});

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeReviewStatus(value, { fallback = null } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (!REVIEW_STATUSES.has(normalized)) {
    throw new Error("review_status must be auto, confirmed, or needs_review");
  }
  return normalized;
}

function parseReviewListQuery(query) {
  const productTypeRaw = normalizeText(query.product_type).toLowerCase();
  const productType = productTypeRaw ? normalizeNullableProductType(productTypeRaw) : null;
  const reviewStatus = normalizeReviewStatus(query.review_status, { fallback: "auto" });
  const page = parsePositiveInt(query.page, 1, 100000);
  const limit = parsePositiveInt(query.limit, 50, 200);

  if (page == null) {
    throw new Error("page must be a positive integer");
  }
  if (limit == null) {
    throw new Error("limit must be a positive integer");
  }

  return {
    productType,
    reviewStatus,
    page,
    limit,
    offset: (page - 1) * limit,
  };
}

function parseReviewPatchBody(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object");
  }
  if (!Object.prototype.hasOwnProperty.call(body, "taxonomy_review_status")) {
    throw new Error("taxonomy_review_status is required");
  }

  const taxonomyReviewStatus = normalizeReviewStatus(body.taxonomy_review_status);
  const nextProductType = Object.prototype.hasOwnProperty.call(body, "product_type")
    ? normalizeNullableProductType(body.product_type)
    : undefined;

  return {
    taxonomyReviewStatus,
    productType: nextProductType,
  };
}

function createProductTypeCaseExpression(columnName = "s.product_type") {
  const entries = Object.entries(PRODUCT_TYPE_PRIORITY)
    .map(([productType, priority]) => `WHEN '${productType}' THEN ${priority}`)
    .join(" ");
  return `CASE ${columnName} ${entries} ELSE 99 END`;
}

async function queryReviewCounts(db) {
  const result = await db.query(
    `
      SELECT
        COALESCE(taxonomy_review_status, 'unreviewed') AS review_status,
        COUNT(*)::integer AS count
      FROM public.skus
      WHERE status = 'active'
      GROUP BY COALESCE(taxonomy_review_status, 'unreviewed')
    `,
  );

  const counts = {
    auto: 0,
    confirmed: 0,
    needs_review: 0,
  };

  for (const row of result.rows) {
    if (Object.prototype.hasOwnProperty.call(counts, row.review_status)) {
      counts[row.review_status] = Number(row.count || 0);
    }
  }

  return counts;
}

async function queryReviewList(db, filters) {
  const params = ["active", filters.reviewStatus];
  const clauses = [
    `s.status = $1`,
    `s.taxonomy_review_status = $2`,
  ];

  if (filters.productType) {
    params.push(filters.productType);
    clauses.push(`s.product_type = $${params.length}`);
  }

  const whereSql = `WHERE ${clauses.join(" AND ")}`;
  const countResult = await db.query(
    `
      SELECT COUNT(*)::integer AS total
      FROM public.skus s
      ${whereSql}
    `,
    params,
  );

  const pageParams = [...params, filters.limit, filters.offset];
  const listResult = await db.query(
    `
      SELECT
        s.company_code,
        s.display_name,
        s.product_type,
        s.taxonomy_note,
        s.taxonomy_review_status
      FROM public.skus s
      ${whereSql}
      ORDER BY
        ${createProductTypeCaseExpression("s.product_type")},
        LOWER(COALESCE(s.display_name, '')),
        s.company_code
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `,
    pageParams,
  );

  return {
    total: Number(countResult.rows[0]?.total || 0),
    items: listResult.rows.map((row) => ({
      company_code: row.company_code,
      display_name: row.display_name,
      product_type: row.product_type,
      taxonomy_note: row.taxonomy_note,
      taxonomy_review_status: row.taxonomy_review_status,
    })),
  };
}

function createTaxonomyReviewRouter(deps) {
  const { db, requireAuthMiddleware, requireRoleMiddleware, requireCsrfMiddleware } = deps;
  const router = express.Router();
  const read = [requireAuthMiddleware, requireRoleMiddleware("admin")];
  const write = [requireAuthMiddleware, requireRoleMiddleware("admin"), requireCsrfMiddleware];

  router.get("/taxonomy-review", ...read, async (req, res, next) => {
    let filters;
    try {
      filters = parseReviewListQuery(req.query || {});
    } catch (error) {
      return res.status(400).json({
        error: error.message,
        request_id: req.requestId || null,
      });
    }

    try {
      const [counts, list] = await Promise.all([
        queryReviewCounts(db),
        queryReviewList(db, filters),
      ]);

      return res.json({
        total: list.total,
        page: filters.page,
        limit: filters.limit,
        counts,
        items: list.items,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/taxonomy-review/:company_code", ...write, async (req, res, next) => {
    const companyCode = normalizeText(req.params.company_code);
    if (!companyCode) {
      return res.status(400).json({
        error: "company_code is required",
        request_id: req.requestId || null,
      });
    }

    let payload;
    try {
      payload = parseReviewPatchBody(req.body || {});
    } catch (error) {
      return res.status(400).json({
        error: error.message,
        request_id: req.requestId || null,
      });
    }

    try {
      const existingResult = await db.query(
        `
          SELECT company_code
          FROM public.skus
          WHERE company_code = $1
            AND status = 'active'
          LIMIT 1
        `,
        [companyCode],
      );

      if (existingResult.rowCount === 0) {
        return res.status(404).json({
          error: "SKU not found",
          request_id: req.requestId || null,
        });
      }

      const updateResult = await db.query(
        `
          UPDATE public.skus
          SET
            taxonomy_review_status = $2,
            product_type = COALESCE($3, product_type)
          WHERE company_code = $1
            AND status = 'active'
          RETURNING
            company_code,
            display_name,
            product_type,
            taxonomy_note,
            taxonomy_review_status
        `,
        [companyCode, payload.taxonomyReviewStatus, payload.productType ?? null],
      );

      return res.json(updateResult.rows[0]);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  PRODUCT_TYPES,
  REVIEW_STATUSES,
  createTaxonomyReviewRouter,
  parseReviewListQuery,
  parseReviewPatchBody,
};
