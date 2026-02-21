"use strict";

const express = require("express");
const { getRequestIp } = require("../auth/middleware");
const {
  resolveEmbeddingSettings,
  createEmbeddingProvider,
} = require("../embeddings/provider");
const {
  MAX_TOP_K,
  parseTopK,
  parseSearchFilters,
  searchSkusHybrid,
  checkPgvectorHealth,
} = require("../services/sku-hybrid-search");
const {
  parseSyncJobRequestBody,
  parseListLimit,
  parseItemsLimit,
  createEmbeddingSyncJob,
  listEmbeddingSyncJobs,
  getEmbeddingSyncJobDetail,
  cancelEmbeddingSyncJob,
  EmbeddingSyncJobRunner,
} = require("../services/embedding-sync-jobs");

const MAX_QUERY_LENGTH = 500;
const SYNC_TRIGGER_LIMIT_WINDOW_MS = 60_000;
const SYNC_TRIGGER_LIMIT_COUNT = 1;

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
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

function checkAndConsumeSyncTriggerRateLimit(bucket, userId, nowMs = Date.now()) {
  const key = normalizeText(userId).toLowerCase() || "unknown";
  const current = bucket.get(key) || {
    count: 0,
    resetAt: nowMs + SYNC_TRIGGER_LIMIT_WINDOW_MS,
  };

  if (nowMs > current.resetAt) {
    current.count = 0;
    current.resetAt = nowMs + SYNC_TRIGGER_LIMIT_WINDOW_MS;
  }

  if (current.count >= SYNC_TRIGGER_LIMIT_COUNT) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
    };
  }

  current.count += 1;
  bucket.set(key, current);
  return {
    allowed: true,
    retryAfterSeconds: 0,
  };
}

function createSearchRouter(deps) {
  const {
    config,
    db,
    requireAuthMiddleware,
    requireRoleMiddleware,
    requireCsrfMiddleware,
    embeddingProvider,
    embeddingSyncJobRunner,
  } = deps;

  const provider = embeddingProvider || buildEmbeddingProvider(config || {});
  const jobRunner =
    embeddingSyncJobRunner ||
    new EmbeddingSyncJobRunner({
      db,
      embeddingProvider: provider,
      logger: (message) => {
        // eslint-disable-next-line no-console
        console.log(message);
      },
    });
  const syncTriggerBucket = new Map();
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
        options = parseSyncJobRequestBody(req.body || {});
      } catch (error) {
        return res.status(400).json({
          error: error.message,
          request_id: req.requestId || null,
        });
      }

      try {
        const rateLimit = checkAndConsumeSyncTriggerRateLimit(syncTriggerBucket, req.auth?.userId);
        if (!rateLimit.allowed) {
          res.set("Retry-After", String(rateLimit.retryAfterSeconds));
          return res.status(429).json({
            error: "Too many sync requests",
            code: "SYNC_TRIGGER_RATE_LIMITED",
            request_id: req.requestId || null,
          });
        }

        const createResult = await createEmbeddingSyncJob(db, {
          mode: options.mode,
          requestedBy: req.auth?.userId || "unknown",
          requestIp: getRequestIp(req),
          params: {
            mode: options.mode,
            only_stale: options.onlyStale,
            limit: options.limit,
            batch_size: options.batchSize,
            updated_since: options.updatedSince,
            rate_limit_ms: options.rateLimitMs,
            filters: options.filters || {},
            provider: provider.name,
            model: provider.model,
            dimension: provider.dimension,
          },
        });

        if (createResult.conflict) {
          return res.status(409).json({
            error: "Another embedding sync job is already running",
            code: createResult.code || "JOB_ALREADY_RUNNING",
            active_job_id: createResult.active_job_id || null,
            request_id: req.requestId || null,
          });
        }

        const job = createResult.job;
        jobRunner.enqueue(job.job_id);
        return res.status(202).json({
          ok: true,
          request_id: req.requestId || null,
          job_id: job.job_id,
          job,
        });
      } catch (error) {
        if (error.code === "42P01") {
          return res.status(400).json({
            error:
              "Embedding sync job table missing. Run migrations/013_add_embedding_sync_jobs.sql first.",
            request_id: req.requestId || null,
          });
        }
        return next(error);
      }
    },
  );

  router.get(
    "/skus/sync/jobs",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    async (req, res, next) => {
      try {
        const limit = parseListLimit(req.query?.limit);
        const rows = await listEmbeddingSyncJobs(db, limit);
        return res.json({
          ok: true,
          request_id: req.requestId || null,
          rows,
        });
      } catch (error) {
        if (error.message.includes("must be")) {
          return res.status(400).json({
            error: error.message,
            request_id: req.requestId || null,
          });
        }
        if (error.code === "42P01") {
          return res.status(400).json({
            error:
              "Embedding sync job table missing. Run migrations/013_add_embedding_sync_jobs.sql first.",
            request_id: req.requestId || null,
          });
        }
        return next(error);
      }
    },
  );

  router.get(
    "/skus/sync/jobs/:job_id",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    async (req, res, next) => {
      try {
        const itemsLimit = parseItemsLimit(req.query?.items_limit);
        const detail = await getEmbeddingSyncJobDetail(db, req.params.job_id, {
          itemsLimit,
        });
        if (!detail) {
          return res.status(404).json({
            error: "Job not found",
            request_id: req.requestId || null,
          });
        }
        return res.json({
          ok: true,
          request_id: req.requestId || null,
          ...detail,
        });
      } catch (error) {
        if (error.message.includes("must be")) {
          return res.status(400).json({
            error: error.message,
            request_id: req.requestId || null,
          });
        }
        if (error.code === "42P01") {
          return res.status(400).json({
            error:
              "Embedding sync job table missing. Run migrations/013_add_embedding_sync_jobs.sql first.",
            request_id: req.requestId || null,
          });
        }
        return next(error);
      }
    },
  );

  router.post(
    "/skus/sync/jobs/:job_id/cancel",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    requireCsrfMiddleware,
    async (req, res, next) => {
      try {
        const job = await cancelEmbeddingSyncJob(db, req.params.job_id);
        return res.json({
          ok: true,
          request_id: req.requestId || null,
          canceled: Boolean(job),
          job,
        });
      } catch (error) {
        if (error.message.includes("must be")) {
          return res.status(400).json({
            error: error.message,
            request_id: req.requestId || null,
          });
        }
        if (error.code === "42P01") {
          return res.status(400).json({
            error:
              "Embedding sync job table missing. Run migrations/013_add_embedding_sync_jobs.sql first.",
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
  checkAndConsumeSyncTriggerRateLimit,
};
