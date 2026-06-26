"use strict";

const express = require("express");
const { auditLog } = require("../audit");
const { auditBase } = require("../utils/audit-payload");
const {
  PRODUCT_TYPES,
  ENRICHMENT_STATUSES,
  normalizeNullableProductType,
  normalizeEnrichmentStatus,
  parsePositiveInt,
  previewBackfill,
  commitBackfill,
} = require("../taxonomy/backfill");

const PRODUCT_TYPE_COUNTS_TEMPLATE = Object.freeze(
  Object.fromEntries(PRODUCT_TYPES.map((productType) => [productType, 0])),
);
const ENRICHMENT_COUNTS_TEMPLATE = Object.freeze(
  Object.fromEntries(ENRICHMENT_STATUSES.map((status) => [status, 0])),
);
const UNCLASSIFIED_FILTER = "unclassified";

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function parseOffset(value, fallback, maxValue = null) {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  if (maxValue != null && parsed > maxValue) {
    return maxValue;
  }
  return parsed;
}

function parseTaxonomyListQuery(query) {
  const productTypeRaw = normalizeText(query.product_type).toLowerCase();
  let productType = null;
  let includeUnclassified = false;
  if (productTypeRaw) {
    if (productTypeRaw === UNCLASSIFIED_FILTER) {
      includeUnclassified = true;
    } else {
      productType = normalizeNullableProductType(productTypeRaw);
    }
  }

  const enrichmentStatusRaw = normalizeText(query.enrichment_status).toLowerCase();
  const enrichmentStatus = enrichmentStatusRaw
    ? normalizeEnrichmentStatus(enrichmentStatusRaw)
    : null;

  const q = normalizeText(query.q);
  const limit = parsePositiveInt(query.limit, 50, 200);
  if (limit == null) {
    throw new Error("limit must be a positive integer");
  }
  const offset = parseOffset(query.offset, 0, 1000000);
  if (offset == null) {
    throw new Error("offset must be a non-negative integer");
  }

  return {
    productType,
    includeUnclassified,
    enrichmentStatus,
    q,
    limit,
    offset,
  };
}

function buildTaxonomyWhere(filters) {
  const clauses = [];
  const params = [];

  if (filters.includeUnclassified) {
    clauses.push("s.product_type IS NULL");
  } else if (filters.productType) {
    params.push(filters.productType);
    clauses.push(`s.product_type = $${params.length}`);
  }

  if (filters.enrichmentStatus) {
    params.push(filters.enrichmentStatus);
    clauses.push(`COALESCE(s.enrichment_status, 'missing') = $${params.length}`);
  }

  if (filters.q) {
    params.push(`%${filters.q}%`);
    const pointer = `$${params.length}`;
    clauses.push(`(s.company_code ILIKE ${pointer} OR s.display_name ILIKE ${pointer})`);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function parsePatchBody(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object");
  }
  if (!Object.prototype.hasOwnProperty.call(body, "product_type")) {
    throw new Error("product_type is required");
  }
  return {
    productType: normalizeNullableProductType(body.product_type),
  };
}

function parseBulkBody(body) {
  const commit = body?.commit === true;
  const preview = body?.commit === false || body?.commit == null;
  if (!commit && !preview) {
    throw new Error("commit must be true or false");
  }

  const limit = body?.limit == null ? null : parsePositiveInt(body.limit, null, 100000);
  if (body?.limit != null && limit == null) {
    throw new Error("limit must be a positive integer");
  }

  return { commit, limit };
}

async function queryTaxonomyStats(db) {
  const totalResult = await db.query(
    `
      SELECT
        COUNT(*)::integer AS total,
        COUNT(*) FILTER (WHERE product_type IS NOT NULL)::integer AS classified,
        COUNT(*) FILTER (WHERE product_type IS NULL)::integer AS unclassified
      FROM public.skus
    `,
  );
  const productTypeResult = await db.query(
    `
      SELECT product_type, COUNT(*)::integer AS count
      FROM public.skus
      GROUP BY product_type
    `,
  );
  const enrichmentResult = await db.query(
    `
      SELECT COALESCE(enrichment_status, 'missing') AS enrichment_status, COUNT(*)::integer AS count
      FROM public.skus
      GROUP BY COALESCE(enrichment_status, 'missing')
    `,
  );

  const byProductType = { ...PRODUCT_TYPE_COUNTS_TEMPLATE };
  for (const row of productTypeResult.rows) {
    if (row.product_type && Object.prototype.hasOwnProperty.call(byProductType, row.product_type)) {
      byProductType[row.product_type] = row.count;
    }
  }

  const enrichmentStatus = { ...ENRICHMENT_COUNTS_TEMPLATE };
  for (const row of enrichmentResult.rows) {
    if (
      row.enrichment_status &&
      Object.prototype.hasOwnProperty.call(enrichmentStatus, row.enrichment_status)
    ) {
      enrichmentStatus[row.enrichment_status] = row.count;
    }
  }

  return {
    total: totalResult.rows[0]?.total || 0,
    classified: totalResult.rows[0]?.classified || 0,
    unclassified: totalResult.rows[0]?.unclassified || 0,
    by_product_type: byProductType,
    enrichment_status: enrichmentStatus,
  };
}

async function queryTaxonomyList(db, filters) {
  const where = buildTaxonomyWhere(filters);
  const countResult = await db.query(
    `
      SELECT COUNT(*)::integer AS total
      FROM public.skus s
      ${where.whereSql}
    `,
    where.params,
  );

  const params = [...where.params, filters.limit, filters.offset];
  const listResult = await db.query(
    `
      SELECT
        s.company_code AS sku_code,
        s.display_name AS name,
        s.product_kind,
        s.product_type,
        COALESCE(s.enrichment_status, 'missing') AS enrichment_status,
        s.category_name
      FROM public.skus s
      ${where.whereSql}
      ORDER BY s.sku_id ASC
      LIMIT $${where.params.length + 1}
      OFFSET $${where.params.length + 2}
    `,
    params,
  );

  return {
    total: countResult.rows[0]?.total || 0,
    limit: filters.limit,
    offset: filters.offset,
    rows: listResult.rows,
  };
}

function createTaxonomyRouter(deps) {
  const { db, requireAuthMiddleware, requireRoleMiddleware, requireCsrfMiddleware } = deps;
  const router = express.Router();
  const read = [requireAuthMiddleware, requireRoleMiddleware("admin", "staff")];
  const write = [requireAuthMiddleware, requireRoleMiddleware("admin"), requireCsrfMiddleware];

  router.get("/taxonomy/stats", ...read, async (req, res, next) => {
    try {
      const stats = await queryTaxonomyStats(db);
      return res.json({
        ok: true,
        request_id: req.requestId,
        ...stats,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/taxonomy", ...read, async (req, res, next) => {
    try {
      const filters = parseTaxonomyListQuery(req.query || {});
      const result = await queryTaxonomyList(db, filters);
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

  router.patch("/:sku_code/taxonomy", ...write, async (req, res, next) => {
    const skuCode = normalizeText(req.params.sku_code);
    if (!skuCode) {
      return res.status(400).json({
        error: "sku_code is required",
        request_id: req.requestId,
      });
    }

    let payload = null;
    try {
      payload = parsePatchBody(req.body || {});
    } catch (error) {
      return res.status(400).json({
        error: error.message,
        request_id: req.requestId,
      });
    }

    try {
      const beforeResult = await db.query(
        `
          SELECT
            company_code AS sku_code,
            display_name AS name,
            product_type,
            COALESCE(enrichment_status, 'missing') AS enrichment_status,
            category_name,
            product_kind
          FROM public.skus
          WHERE company_code = $1
          LIMIT 1
        `,
        [skuCode],
      );
      if (beforeResult.rowCount === 0) {
        return res.status(404).json({
          error: "Product not found",
          request_id: req.requestId,
        });
      }

      const before = beforeResult.rows[0];
      const nextEnrichmentStatus =
        payload.productType === "device" || payload.productType === "service"
          ? "not_applicable"
          : null;

      const updateResult = await db.query(
        `
          UPDATE public.skus
          SET
            product_type = $2,
            enrichment_status = COALESCE($3, enrichment_status),
            updated_at = now()
          WHERE company_code = $1
          RETURNING
            company_code AS sku_code,
            display_name AS name,
            product_type,
            COALESCE(enrichment_status, 'missing') AS enrichment_status,
            category_name,
            product_kind
        `,
        [skuCode, payload.productType, nextEnrichmentStatus],
      );

      const after = updateResult.rows[0];
      const changed = {};
      if (before.product_type !== after.product_type) {
        changed.product_type = { before: before.product_type, after: after.product_type };
      }
      if (before.enrichment_status !== after.enrichment_status) {
        changed.enrichment_status = {
          before: before.enrichment_status,
          after: after.enrichment_status,
        };
      }

      const changedFields = Object.keys(changed);
      if (changedFields.length > 0) {
        await auditLog(
          db,
          auditBase(req, {
            action: "product.taxonomy.update",
            target_type: "sku",
            target_id: after.sku_code,
            success: true,
            meta: {
              changed_fields: changedFields,
              before: Object.fromEntries(
                changedFields.map((field) => [field, changed[field].before]),
              ),
              after: Object.fromEntries(
                changedFields.map((field) => [field, changed[field].after]),
              ),
            },
          }),
        );
      }

      return res.json({
        ok: true,
        request_id: req.requestId,
        sku_code: after.sku_code,
        changed_fields: changedFields,
        product: after,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/taxonomy/bulk-classify", ...write, async (req, res, next) => {
    let payload = null;
    try {
      payload = parseBulkBody(req.body || {});
    } catch (error) {
      return res.status(400).json({
        error: error.message,
        request_id: req.requestId,
      });
    }

    if (!payload.commit) {
      try {
        const summary = await previewBackfill(db, { limit: payload.limit });
        return res.json({
          ok: true,
          request_id: req.requestId,
          summary,
        });
      } catch (error) {
        return next(error);
      }
    }

    let client = null;
    try {
      client = await db.connect();
      await client.query("BEGIN");
      const summary = await commitBackfill(client, { limit: payload.limit });
      await client.query("COMMIT");

      return res.json({
        ok: true,
        request_id: req.requestId,
        summary,
      });
    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (_rollbackError) {
          // Ignore rollback errors and return the original failure.
        }
      }
      return next(error);
    } finally {
      if (client) {
        await client.release();
      }
    }
  });

  return router;
}

module.exports = {
  createTaxonomyRouter,
  queryTaxonomyStats,
  queryTaxonomyList,
  parseTaxonomyListQuery,
  parsePatchBody,
  parseBulkBody,
  UNCLASSIFIED_FILTER,
};
