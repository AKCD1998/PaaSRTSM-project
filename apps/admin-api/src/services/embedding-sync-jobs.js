"use strict";

const { indexSkuEmbeddings, normalizeSyncFilters } = require("./sku-embedding-indexer");

const JOB_CREATE_ADVISORY_KEY = 770031;
const JOB_RUN_ADVISORY_KEY = 770032;
const MAX_ERROR_MESSAGE_CHARS = 500;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const DEFAULT_ITEMS_LIMIT = 200;
const MAX_ITEMS_LIMIT = 500;
const DEFAULT_SYNC_LIMIT = 200;
const MAX_SYNC_LIMIT = 5000;

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized === "" ? null : normalized;
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

function normalizeIsoDateTime(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function truncateErrorMessage(message) {
  const normalized = normalizeText(message);
  if (!normalized) {
    return null;
  }
  const redacted = normalized
    .replace(/(password\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(token\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(secret\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [redacted]");
  if (redacted.length <= MAX_ERROR_MESSAGE_CHARS) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_ERROR_MESSAGE_CHARS - 14)}...[truncated]`;
}

function toSyncMode(modeInput, executeFlag = null) {
  const normalized = normalizeText(modeInput).toLowerCase();
  if (normalized) {
    if (normalized === "dry_run" || normalized === "execute") {
      return normalized;
    }
    throw new Error("mode must be dry_run or execute");
  }
  if (executeFlag === true) {
    return "execute";
  }
  if (executeFlag === false || executeFlag == null) {
    return "dry_run";
  }
  throw new Error("mode must be dry_run or execute");
}

function parseSyncJobRequestBody(body) {
  const mode = toSyncMode(body?.mode, body?.execute);
  const limit = parsePositiveInt(body?.limit, DEFAULT_SYNC_LIMIT, MAX_SYNC_LIMIT);
  if (limit == null) {
    throw new Error(`limit must be a positive integer (max ${MAX_SYNC_LIMIT})`);
  }

  const batchSize = parsePositiveInt(body?.batch_size ?? body?.batchSize, 100, 500);
  if (batchSize == null) {
    throw new Error("batch_size must be a positive integer");
  }

  let rateLimitMs = 0;
  if (body?.rate_limit_ms != null || body?.rateLimitMs != null) {
    const rawRateLimitMs = Number(body?.rate_limit_ms ?? body?.rateLimitMs);
    if (!Number.isInteger(rawRateLimitMs) || rawRateLimitMs < 0) {
      throw new Error("rate_limit_ms must be a non-negative integer");
    }
    rateLimitMs = Math.min(rawRateLimitMs, 2000);
  }

  const sinceRaw = normalizeNullableText(body?.since || body?.updated_since || body?.updatedSince);
  const updatedSince = sinceRaw ? normalizeIsoDateTime(sinceRaw) : null;
  if (sinceRaw && !updatedSince) {
    throw new Error("since must be a valid ISO date/time");
  }

  return {
    mode,
    execute: mode === "execute",
    onlyStale: parseBoolean(body?.only_stale ?? body?.onlyStale, true),
    limit,
    batchSize,
    updatedSince,
    rateLimitMs,
    filters: normalizeSyncFilters(body?.filters || {}),
  };
}

function parseListLimit(value) {
  const parsed = parsePositiveInt(value, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  if (parsed == null) {
    throw new Error(`limit must be a positive integer (max ${MAX_LIST_LIMIT})`);
  }
  return parsed;
}

function parseItemsLimit(value) {
  const parsed = parsePositiveInt(value, DEFAULT_ITEMS_LIMIT, MAX_ITEMS_LIMIT);
  if (parsed == null) {
    throw new Error(`items_limit must be a positive integer (max ${MAX_ITEMS_LIMIT})`);
  }
  return parsed;
}

function summaryToJobCounts(summary) {
  return {
    processed_count: summary.processed || 0,
    inserted_count: summary.inserted || 0,
    updated_count: summary.updated || 0,
    skipped_count: (summary.skipped || 0) + (summary.unchanged || 0),
    error_count: summary.errors || 0,
  };
}

async function withDbClient(db, fn) {
  if (!db || typeof db.query !== "function") {
    throw new Error("db.query is required");
  }

  const supportsConnect = typeof db.connect === "function";
  if (!supportsConnect) {
    return fn(db);
  }

  const client = await db.connect();
  try {
    return await fn(client);
  } finally {
    if (typeof client.release === "function") {
      client.release();
    }
  }
}

async function inTransaction(client, fn) {
  await client.query("BEGIN");
  try {
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function createEmbeddingSyncJob(db, payload) {
  return withDbClient(db, async (client) =>
    inTransaction(client, async () => {
      const lockResult = await client.query("SELECT pg_try_advisory_xact_lock($1) AS acquired", [
        JOB_CREATE_ADVISORY_KEY,
      ]);
      if (!lockResult.rows[0]?.acquired) {
        return {
          conflict: true,
          code: "JOB_ALREADY_RUNNING",
        };
      }

      const activeResult = await client.query(
        `
          SELECT job_id, status
          FROM public.embedding_sync_jobs
          WHERE status IN ('queued', 'running')
          ORDER BY job_id DESC
          LIMIT 1
        `,
      );
      if (activeResult.rowCount > 0) {
        return {
          conflict: true,
          code: "JOB_ALREADY_RUNNING",
          active_job_id: activeResult.rows[0].job_id,
          active_status: activeResult.rows[0].status,
        };
      }

      const insertResult = await client.query(
        `
          INSERT INTO public.embedding_sync_jobs (
            mode,
            status,
            requested_by,
            request_ip,
            params,
            created_at,
            updated_at
          )
          VALUES ($1, 'queued', $2, $3, $4::jsonb, now(), now())
          RETURNING *
        `,
        [
          payload.mode,
          payload.requestedBy,
          payload.requestIp || null,
          JSON.stringify(payload.params || {}),
        ],
      );

      return {
        conflict: false,
        job: insertResult.rows[0],
      };
    }),
  );
}

async function listEmbeddingSyncJobs(db, limit = DEFAULT_LIST_LIMIT) {
  const queryLimit = parseListLimit(limit);
  const result = await db.query(
    `
      SELECT
        job_id,
        mode,
        status,
        requested_by,
        request_ip,
        started_at,
        finished_at,
        processed_count,
        inserted_count,
        updated_count,
        skipped_count,
        error_count,
        error_summary,
        params,
        cancel_requested,
        created_at,
        updated_at
      FROM public.embedding_sync_jobs
      ORDER BY job_id DESC
      LIMIT $1
    `,
    [queryLimit],
  );
  return result.rows;
}

async function getEmbeddingSyncJobDetail(db, jobId, options = {}) {
  const itemsLimit = parseItemsLimit(options.itemsLimit || DEFAULT_ITEMS_LIMIT);
  const normalizedJobId = parsePositiveInt(jobId, null);
  if (normalizedJobId == null) {
    throw new Error("job_id must be a positive integer");
  }

  const jobResult = await db.query(
    `
      SELECT
        job_id,
        mode,
        status,
        requested_by,
        request_ip,
        started_at,
        finished_at,
        processed_count,
        inserted_count,
        updated_count,
        skipped_count,
        error_count,
        error_summary,
        params,
        cancel_requested,
        created_at,
        updated_at
      FROM public.embedding_sync_jobs
      WHERE job_id = $1
      LIMIT 1
    `,
    [normalizedJobId],
  );
  if (jobResult.rowCount === 0) {
    return null;
  }

  const itemsResult = await db.query(
    `
      SELECT
        id,
        job_id,
        sku_id,
        action,
        content_hash_before,
        content_hash_after,
        error_message,
        created_at
      FROM public.embedding_sync_job_items
      WHERE job_id = $1
      ORDER BY id DESC
      LIMIT $2
    `,
    [normalizedJobId, itemsLimit],
  );

  return {
    job: jobResult.rows[0],
    items: itemsResult.rows,
  };
}

async function cancelEmbeddingSyncJob(db, jobId) {
  const normalizedJobId = parsePositiveInt(jobId, null);
  if (normalizedJobId == null) {
    throw new Error("job_id must be a positive integer");
  }

  const result = await db.query(
    `
      UPDATE public.embedding_sync_jobs
      SET cancel_requested = TRUE, updated_at = now()
      WHERE job_id = $1
        AND status IN ('queued', 'running')
      RETURNING *
    `,
    [normalizedJobId],
  );
  return result.rows[0] || null;
}

function mapItemActionForStorage(action) {
  if (action === "insert") {
    return "insert";
  }
  if (action === "update") {
    return "update";
  }
  if (action === "error") {
    return "error";
  }
  return "skip";
}

function shouldPersistJobItem(item) {
  return item.action === "insert" || item.action === "update" || item.action === "error";
}

async function insertEmbeddingSyncJobItems(client, jobId, items) {
  if (!items || items.length === 0) {
    return;
  }

  const values = [];
  const params = [];
  let index = 1;
  for (const item of items) {
    values.push(
      `($${index}, $${index + 1}, $${index + 2}, $${index + 3}, $${index + 4}, $${index + 5}, now())`,
    );
    params.push(
      jobId,
      item.sku_id,
      item.action,
      item.content_hash_before || null,
      item.content_hash_after || null,
      item.error_message || null,
    );
    index += 6;
  }

  await client.query(
    `
      INSERT INTO public.embedding_sync_job_items (
        job_id,
        sku_id,
        action,
        content_hash_before,
        content_hash_after,
        error_message,
        created_at
      )
      VALUES ${values.join(",\n")}
    `,
    params,
  );
}

class EmbeddingSyncJobRunner {
  constructor(options) {
    this.db = options.db;
    this.embeddingProvider = options.embeddingProvider;
    this.logger = typeof options.logger === "function" ? options.logger : () => {};
    this.queue = [];
    this.isProcessing = false;
    this.jobIdsInQueue = new Set();
  }

  enqueue(jobId) {
    const normalizedJobId = parsePositiveInt(jobId, null);
    if (normalizedJobId == null) {
      return;
    }
    if (this.jobIdsInQueue.has(normalizedJobId)) {
      return;
    }
    this.jobIdsInQueue.add(normalizedJobId);
    this.queue.push(normalizedJobId);
    this.kick();
  }

  kick() {
    if (this.isProcessing) {
      return;
    }
    setImmediate(() => {
      this.processQueue().catch((error) => {
        this.logger(`[embedding-sync-jobs] queue failure: ${error.message}`);
      });
    });
  }

  async processQueue() {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    try {
      while (this.queue.length > 0) {
        const jobId = this.queue.shift();
        this.jobIdsInQueue.delete(jobId);
        await this.runJob(jobId);
      }
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        this.kick();
      }
    }
  }

  async runJob(jobId) {
    await withDbClient(this.db, async (client) => {
      const lockResult = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [
        JOB_RUN_ADVISORY_KEY,
      ]);
      if (!lockResult.rows[0]?.acquired) {
        this.logger(`[embedding-sync-jobs] job_id=${jobId} skipped because lock is busy`);
        return;
      }

      try {
        const jobResult = await client.query(
          `
            SELECT *
            FROM public.embedding_sync_jobs
            WHERE job_id = $1
            LIMIT 1
          `,
          [jobId],
        );
        if (jobResult.rowCount === 0) {
          return;
        }
        const job = jobResult.rows[0];
        if (!["queued", "running"].includes(job.status)) {
          return;
        }

        if (job.cancel_requested) {
          await client.query(
            `
              UPDATE public.embedding_sync_jobs
              SET
                status = 'canceled',
                started_at = COALESCE(started_at, now()),
                finished_at = now(),
                updated_at = now()
              WHERE job_id = $1
            `,
            [jobId],
          );
          return;
        }

        await client.query(
          `
            UPDATE public.embedding_sync_jobs
            SET
              status = 'running',
              started_at = COALESCE(started_at, now()),
              updated_at = now()
            WHERE job_id = $1
          `,
          [jobId],
        );

        const params = job.params && typeof job.params === "object" ? job.params : {};
        const mode = job.mode === "execute" ? "execute" : "dry_run";
        const itemBuffer = [];
        let processedSinceLastProgress = 0;

        const summary = await indexSkuEmbeddings(client, this.embeddingProvider, {
          execute: mode === "execute",
          onlyStale: parseBoolean(params.only_stale ?? params.onlyStale, true),
          limit: parsePositiveInt(params.limit, DEFAULT_SYNC_LIMIT, MAX_SYNC_LIMIT) || DEFAULT_SYNC_LIMIT,
          batchSize: parsePositiveInt(params.batch_size ?? params.batchSize, 100, 500) || 100,
          updatedSince: normalizeIsoDateTime(params.updated_since ?? params.updatedSince ?? params.since),
          rateLimitMs: parsePositiveInt(params.rate_limit_ms ?? params.rateLimitMs, 0, 2000) || 0,
          filters: normalizeSyncFilters(params.filters || {}),
          logger: (line) => this.logger(`[embedding-sync-jobs] job_id=${jobId} ${line}`),
          shouldCancel: async () => {
            const cancelResult = await client.query(
              "SELECT cancel_requested FROM public.embedding_sync_jobs WHERE job_id = $1 LIMIT 1",
              [jobId],
            );
            return Boolean(cancelResult.rows[0]?.cancel_requested);
          },
          onItem: async (item) => {
            const action = mapItemActionForStorage(item.action);
            if (!shouldPersistJobItem({ action })) {
              return;
            }
            itemBuffer.push({
              sku_id: item.skuId,
              action,
              content_hash_before: normalizeNullableText(item.contentHashBefore),
              content_hash_after: normalizeNullableText(item.contentHashAfter),
              error_message: action === "error" ? truncateErrorMessage(item.errorMessage) : null,
            });
            if (itemBuffer.length >= 100) {
              await insertEmbeddingSyncJobItems(client, jobId, itemBuffer.splice(0, itemBuffer.length));
            }
          },
          onProgress: async (partialSummary) => {
            processedSinceLastProgress += 1;
            if (processedSinceLastProgress < 25) {
              return;
            }
            processedSinceLastProgress = 0;
            const counts = summaryToJobCounts(partialSummary);
            await client.query(
              `
                UPDATE public.embedding_sync_jobs
                SET
                  processed_count = $2,
                  inserted_count = $3,
                  updated_count = $4,
                  skipped_count = $5,
                  error_count = $6,
                  updated_at = now()
                WHERE job_id = $1
              `,
              [
                jobId,
                counts.processed_count,
                counts.inserted_count,
                counts.updated_count,
                counts.skipped_count,
                counts.error_count,
              ],
            );
          },
        });

        if (itemBuffer.length > 0) {
          await insertEmbeddingSyncJobItems(client, jobId, itemBuffer.splice(0, itemBuffer.length));
        }

        const counts = summaryToJobCounts(summary);
        const finalStatus = summary.canceled ? "canceled" : "succeeded";

        await client.query(
          `
            UPDATE public.embedding_sync_jobs
            SET
              status = $2,
              finished_at = now(),
              processed_count = $3,
              inserted_count = $4,
              updated_count = $5,
              skipped_count = $6,
              error_count = $7,
              error_summary = NULL,
              updated_at = now()
            WHERE job_id = $1
          `,
          [
            jobId,
            finalStatus,
            counts.processed_count,
            counts.inserted_count,
            counts.updated_count,
            counts.skipped_count,
            counts.error_count,
          ],
        );

        this.logger(
          `[embedding-sync-jobs] job_id=${jobId} status=${finalStatus} processed=${counts.processed_count} inserted=${counts.inserted_count} updated=${counts.updated_count} errors=${counts.error_count}`,
        );
      } catch (error) {
        await client.query(
          `
            UPDATE public.embedding_sync_jobs
            SET
              status = 'failed',
              finished_at = now(),
              error_summary = $2,
              updated_at = now()
            WHERE job_id = $1
          `,
          [jobId, truncateErrorMessage(error.message)],
        );
        this.logger(`[embedding-sync-jobs] job_id=${jobId} failed message=${error.message}`);
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [JOB_RUN_ADVISORY_KEY]);
      }
    });
  }
}

module.exports = {
  JOB_CREATE_ADVISORY_KEY,
  JOB_RUN_ADVISORY_KEY,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  DEFAULT_ITEMS_LIMIT,
  MAX_ITEMS_LIMIT,
  DEFAULT_SYNC_LIMIT,
  MAX_SYNC_LIMIT,
  parseSyncJobRequestBody,
  parseListLimit,
  parseItemsLimit,
  summaryToJobCounts,
  createEmbeddingSyncJob,
  listEmbeddingSyncJobs,
  getEmbeddingSyncJobDetail,
  cancelEmbeddingSyncJob,
  truncateErrorMessage,
  EmbeddingSyncJobRunner,
};
