"use strict";

const { toVectorLiteral } = require("./sku-embedding-indexer");

const DEFAULT_TOP_K = 20;
const MAX_TOP_K = 50;

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized === "" ? null : normalized;
}

function parseTopK(value, fallback = DEFAULT_TOP_K) {
  if (value == null || value === "") {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return null;
  }
  return Math.min(n, MAX_TOP_K);
}

function parseSearchFilters(input) {
  const source = input || {};
  return {
    productKind: normalizeNullableText(source.product_kind || source.productKind),
    categoryName: normalizeNullableText(source.category_name || source.categoryName),
    supplierCode: normalizeNullableText(source.supplier_code || source.supplierCode),
    level: normalizeNullableText(source.level),
    companyCode: normalizeNullableText(source.company_code || source.companyCode),
  };
}

function buildFilterClause(filters, params) {
  const clauses = [];

  if (filters.productKind) {
    params.push(filters.productKind);
    clauses.push(`s.product_kind = $${params.length}`);
  }

  if (filters.categoryName) {
    params.push(`%${filters.categoryName}%`);
    clauses.push(`s.category_name ILIKE $${params.length}`);
  }

  if (filters.supplierCode) {
    params.push(`%${filters.supplierCode}%`);
    clauses.push(`s.supplier_code ILIKE $${params.length}`);
  }

  if (filters.level) {
    params.push(filters.level);
    clauses.push(`COALESCE(e.metadata->>'level', '') = $${params.length}`);
  }

  if (filters.companyCode) {
    params.push(filters.companyCode);
    clauses.push(`s.company_code = $${params.length}`);
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

function buildPriceJoinSql(options = {}) {
  const includeUnitPrice = options.includeUnitPrice !== false;
  return `
    LEFT JOIN LATERAL (
      SELECT p.price, p.currency, p.effective_start, p.updated_at
      FROM public.prices p
      WHERE p.sku_id = s.sku_id
        AND p.effective_end IS NULL
      ORDER BY p.effective_start DESC NULLS LAST, p.price_id DESC
      LIMIT 1
    ) retail ON TRUE
    ${
      includeUnitPrice
        ? `
    LEFT JOIN LATERAL (
      SELECT up.retail_price, up.currency, up.updated_at
      FROM public.sku_unit_prices up
      WHERE up.sku_id = s.sku_id
        AND up.is_active = TRUE
        AND up.retail_price IS NOT NULL
      ORDER BY up.unit ASC, up.id ASC
      LIMIT 1
    ) unit_retail ON TRUE
    `
        : ""
    }
  `;
}

function buildSearchSelectSql(options = {}) {
  const includeUnitPrice = options.includeUnitPrice !== false;
  return `
    s.sku_id,
    s.company_code,
    s.display_name,
    s.generic_name,
    s.strength_text,
    s.form,
    s.route,
    s.product_kind,
    s.category_name,
    s.supplier_code,
    s.updated_at AS sku_updated_at,
    e.updated_at AS embedding_updated_at,
    e.metadata,
    ${includeUnitPrice ? "COALESCE(retail.price, unit_retail.retail_price)" : "retail.price"} AS retail_price,
    ${includeUnitPrice ? "COALESCE(retail.currency, unit_retail.currency)" : "retail.currency"} AS retail_currency,
    retail.effective_start AS retail_effective_start,
    ${includeUnitPrice ? "COALESCE(retail.updated_at, unit_retail.updated_at)" : "retail.updated_at"} AS retail_updated_at
  `;
}

function buildFiltersOnlySearchQuery({ filters, topK, includeUnitPrice = true }) {
  const params = [];
  const whereSql = buildFilterClause(filters, params);
  params.push(topK);

  const sql = `
    SELECT
      ${buildSearchSelectSql({ includeUnitPrice })},
      NULL::double precision AS similarity_score,
      0::double precision AS keyword_boost
    FROM public.skus s
    LEFT JOIN public.sku_embeddings e
      ON e.sku_id = s.sku_id
    ${buildPriceJoinSql({ includeUnitPrice })}
    ${whereSql}
    ORDER BY s.updated_at DESC, s.sku_id DESC
    LIMIT $${params.length}
  `;

  return { sql, params };
}

function buildHybridSearchQuery({ queryEmbedding, queryText, filters, topK, includeUnitPrice = true }) {
  const params = [toVectorLiteral(queryEmbedding), `%${queryText}%`];
  const whereSql = buildFilterClause(filters, params);
  params.push(topK);
  const limitParam = params.length;

  const keywordBoostExpression = `
    CASE
      WHEN (
        s.display_name ILIKE $2
        OR s.generic_name ILIKE $2
        OR s.company_code ILIKE $2
        OR e.text_for_embedding ILIKE $2
      ) THEN 0.05
      ELSE 0
    END
  `;

  const similarityExpression = `(1 - (e.embedding <=> $1::vector))::double precision`;
  const rankingExpression = `(${similarityExpression} + ${keywordBoostExpression})`;

  const sql = `
    SELECT
      ${buildSearchSelectSql({ includeUnitPrice })},
      ${similarityExpression} AS similarity_score,
      ${keywordBoostExpression} AS keyword_boost
    FROM public.sku_embeddings e
    JOIN public.skus s
      ON s.sku_id = e.sku_id
    ${buildPriceJoinSql({ includeUnitPrice })}
    ${whereSql}
    ORDER BY ${rankingExpression} DESC, s.sku_id ASC
    LIMIT $${limitParam}
  `;

  return { sql, params };
}

async function searchSkusHybrid({ db, embeddingProvider, queryText, filters, topK }) {
  const normalizedQuery = normalizeText(queryText);
  const normalizedFilters = parseSearchFilters(filters || {});

  if (!normalizedQuery) {
    let result = null;
    try {
      const statement = buildFiltersOnlySearchQuery({
        filters: normalizedFilters,
        topK,
        includeUnitPrice: true,
      });
      result = await db.query(statement.sql, statement.params);
    } catch (error) {
      if (error?.code !== "42P01") {
        throw error;
      }
      const statement = buildFiltersOnlySearchQuery({
        filters: normalizedFilters,
        topK,
        includeUnitPrice: false,
      });
      result = await db.query(statement.sql, statement.params);
    }
    return {
      mode: "filters_only",
      rows: result.rows,
    };
  }

  const queryEmbedding = await embeddingProvider.embed(normalizedQuery);
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== embeddingProvider.dimension) {
    throw new Error(
      `Embedding provider returned invalid query vector length: expected ${embeddingProvider.dimension}, got ${
        Array.isArray(queryEmbedding) ? queryEmbedding.length : "non-array"
      }`,
    );
  }

  let result = null;
  try {
    const statement = buildHybridSearchQuery({
      queryEmbedding,
      queryText: normalizedQuery,
      filters: normalizedFilters,
      topK,
      includeUnitPrice: true,
    });
    result = await db.query(statement.sql, statement.params);
  } catch (error) {
    if (error?.code !== "42P01") {
      throw error;
    }
    const statement = buildHybridSearchQuery({
      queryEmbedding,
      queryText: normalizedQuery,
      filters: normalizedFilters,
      topK,
      includeUnitPrice: false,
    });
    result = await db.query(statement.sql, statement.params);
  }
  return {
    mode: "hybrid",
    rows: result.rows,
  };
}

async function checkPgvectorHealth(db) {
  const extensionResult = await db.query(
    "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector' LIMIT 1",
  );
  const tableResult = await db.query("SELECT to_regclass('public.sku_embeddings') AS table_name");

  return {
    pgvector_enabled: extensionResult.rowCount > 0,
    pgvector_version: extensionResult.rows[0]?.extversion || null,
    sku_embeddings_table: tableResult.rows[0]?.table_name || null,
  };
}

module.exports = {
  DEFAULT_TOP_K,
  MAX_TOP_K,
  normalizeText,
  parseTopK,
  parseSearchFilters,
  buildFilterClause,
  buildFiltersOnlySearchQuery,
  buildHybridSearchQuery,
  searchSkusHybrid,
  checkPgvectorHealth,
};
