"use strict";

const express = require("express");
const {
  resolveEmbeddingSettings,
  createEmbeddingProvider,
} = require("../embeddings/provider");
const { indexSkuEmbeddings } = require("../services/sku-embedding-indexer");
const {
  MAX_TOP_K,
  parseTopK,
  parseSearchFilters,
  searchSkusHybrid,
  checkPgvectorHealth,
} = require("../services/sku-hybrid-search");

const MAX_QUERY_LENGTH = 500;
const MAX_SYNC_LIMIT = 2_000;

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }
  const normalized = normalizeText(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parsePositiveInt(value, fallback = null, maxValue = null) {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  if (maxValue != null && parsed > maxValue) {
    return maxValue;
  }
  return parsed;
}

function parseSearchQueryParams(query) {
  const q = normalizeText(query.q || query.query || "");
  if (q.length > MAX_QUERY_LENGTH) {
    throw new Error(`q is too long (max ${MAX_QUERY_LENGTH} chars)`);
  }

  const k = parseTopK(query.k || query.topK || query.top_k);
  if (k == null) {
    throw new Error(`k must be a positive integer (max ${MAX_TOP_K})`);
  }

  const filters = parseSearchFilters(query);
  return { q, k, filters };
}

function parseSyncBody(body) {
  const execute = parseBoolean(body?.execute, false);
  const onlyStale = parseBoolean(body?.only_stale ?? body?.onlyStale, true);
  const limit = parsePositiveInt(body?.limit, 200, MAX_SYNC_LIMIT);
  if (limit == null) {
    throw new Error("limit must be a positive integer");
  }
  const batchSize = parsePositiveInt(body?.batch_size ?? body?.batchSize, 100, 500);
  if (batchSize == null) {
    throw new Error("batch_size must be a positive integer");
  }

  const sinceRaw = normalizeText(body?.since);
  let updatedSince = null;
  if (sinceRaw) {
    const iso = new Date(sinceRaw);
    if (Number.isNaN(iso.getTime())) {
      throw new Error("since must be a valid ISO date/time");
    }
    updatedSince = iso.toISOString();
  }

  const rateLimitMs = parsePositiveInt(body?.rate_limit_ms ?? body?.rateLimitMs, 0, 2_000);
  if (rateLimitMs == null && body?.rate_limit_ms != null) {
    throw new Error("rate_limit_ms must be a positive integer");
  }

  return {
    execute,
    onlyStale,
    limit,
    batchSize,
    updatedSince,
    rateLimitMs: rateLimitMs || 0,
  };
}

function buildEmbeddingProvider(config, overrides = {}) {
  const settings = resolveEmbeddingSettings({
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    embeddingDimension: config.embeddingDimension,
    embeddingTimeoutMs: config.embeddingTimeoutMs,
    openaiBaseUrl: config.embeddingOpenAiBaseUrl,
    openaiApiKey: process.env.OPENAI_API_KEY,
    localEmbeddingUrl: process.env.EMBEDDING_LOCAL_URL,
    ...overrides,
  });
  return createEmbeddingProvider(settings);
}

function createSearchRouter(deps) {
  const {
    config,
    db,
    requireAuthMiddleware,
    requireRoleMiddleware,
    requireCsrfMiddleware,
    embeddingProvider,
  } = deps;

  const provider = embeddingProvider || buildEmbeddingProvider(config || {});
  const router = express.Router();

  router.get("/health", async (req, res, next) => {
    try {
      const health = await checkPgvectorHealth(db);
      const ok = health.pgvector_enabled && Boolean(health.sku_embeddings_table);
      return res.status(ok ? 200 : 503).json({
        ok,
        request_id: req.requestId || null,
        service: "sku-hybrid-search",
        ...health,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get(
    "/skus",
    requireAuthMiddleware,
    requireRoleMiddleware("admin", "staff"),
    async (req, res, next) => {
      try {
        const { q, k, filters } = parseSearchQueryParams(req.query || {});
        const result = await searchSkusHybrid({
          db,
          embeddingProvider: provider,
          queryText: q,
          filters,
          topK: k,
        });

        return res.json({
          ok: true,
          request_id: req.requestId || null,
          mode: result.mode,
          top_k: k,
          query: q,
          filters,
          rows: result.rows,
        });
      } catch (error) {
        if (error.message.includes("must be") || error.message.includes("too long")) {
          return res.status(400).json({
            error: error.message,
            request_id: req.requestId || null,
          });
        }
        if (error.code === "42P01") {
          return res.status(400).json({
            error: "sku_embeddings table not found. Run migrations/012_add_sku_embeddings.sql first.",
            request_id: req.requestId || null,
          });
        }
        if (error.code === "42883") {
          return res.status(400).json({
            error: "pgvector extension/operator missing. Run migrations/012_add_sku_embeddings.sql first.",
            request_id: req.requestId || null,
          });
        }
        return next(error);
      }
    },
  );

  router.post(
    "/skus/sync",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    requireCsrfMiddleware,
    async (req, res, next) => {
      let options = null;
      try {
        options = parseSyncBody(req.body || {});
      } catch (error) {
        return res.status(400).json({
          error: error.message,
          request_id: req.requestId || null,
        });
      }

      try {
        const summary = await indexSkuEmbeddings(db, provider, {
          execute: options.execute,
          onlyStale: options.onlyStale,
          updatedSince: options.updatedSince,
          limit: options.limit,
          batchSize: options.batchSize,
          rateLimitMs: options.rateLimitMs,
        });

        return res.json({
          ok: true,
          request_id: req.requestId || null,
          summary,
        });
      } catch (error) {
        if (error.code === "42P01") {
          return res.status(400).json({
            error: "sku_embeddings table not found. Run migrations/012_add_sku_embeddings.sql first.",
            request_id: req.requestId || null,
          });
        }
        return next(error);
      }
    },
  );

  return router;
}

module.exports = {
  createSearchRouter,
  parseSearchQueryParams,
  parseSyncBody,
};
