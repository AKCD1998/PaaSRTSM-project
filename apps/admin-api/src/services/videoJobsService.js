"use strict";

const crypto = require("crypto");
const {
  ASPECT_RATIOS,
  ALLOWED_DURATIONS_BY_PROVIDER,
  ALLOWED_PROVIDER_MODELS,
} = require("./video-providers/videoStudioConstants");
const { getVideoProvider } = require("./video-providers/providerRegistry");

const VISIBLE_LIST_STATUSES_FOR_BRANCH = new Set(["approved"]);
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

function createHttpError(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeNullableText(value, maxChars = null) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (!maxChars || normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars);
}

function parsePositiveInt(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function mapJobRow(row) {
  return {
    jobId: Number(row.job_id),
    jobPublicId: row.job_public_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    status: row.status,
    provider: row.provider,
    model: row.model,
    providerJobId: row.provider_job_id,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    aspectRatio: row.aspect_ratio,
    durationSeconds: row.duration_seconds,
    inputAssetId: row.input_asset_id != null ? Number(row.input_asset_id) : null,
    productIdOrSkuReference: row.product_id_or_sku_reference,
    outputAssetId: row.output_asset_id != null ? Number(row.output_asset_id) : null,
    estimatedCost: row.estimated_cost != null ? Number(row.estimated_cost) : null,
    actualCost: row.actual_cost != null ? Number(row.actual_cost) : null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    retryCount: Number(row.retry_count || 0),
    submittedAt: row.submitted_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    rejectedAt: row.rejected_at,
    rejectedBy: row.rejected_by,
    rejectionReason: row.rejection_reason,
    metadata: row.metadata_json || {},
  };
}

function mapEventRow(row) {
  return {
    eventId: Number(row.event_id),
    videoJobId: Number(row.video_job_id),
    eventType: row.event_type,
    message: row.message,
    payload: row.payload_json || {},
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function validateJobInput(config, { prompt, negativePrompt, aspectRatio, durationSeconds, provider, model, productIdOrSkuReference }) {
  const normalizedPrompt = normalizeNullableText(prompt);
  if (!normalizedPrompt) {
    throw createHttpError("prompt is required.", 400);
  }
  if (normalizedPrompt.length > config.videoMaxPromptLength) {
    throw createHttpError(`prompt must be at most ${config.videoMaxPromptLength} characters.`, 400);
  }

  const normalizedNegativePrompt = normalizeNullableText(negativePrompt, config.videoMaxPromptLength);

  if (!ASPECT_RATIOS.includes(aspectRatio)) {
    throw createHttpError(`aspectRatio must be one of: ${ASPECT_RATIOS.join(", ")}.`, 400);
  }

  const normalizedProvider = normalizeText(provider).toLowerCase();
  const enabledProviders = config.videoProviderEnabled instanceof Set ? config.videoProviderEnabled : new Set();
  if (!normalizedProvider || !enabledProviders.has(normalizedProvider)) {
    throw createHttpError(`provider must be one of: ${[...enabledProviders].join(", ")}.`, 400);
  }

  const allowedDurations = ALLOWED_DURATIONS_BY_PROVIDER[normalizedProvider] || [];
  const normalizedDuration = Number(durationSeconds);
  if (!allowedDurations.includes(normalizedDuration)) {
    throw createHttpError(
      `durationSeconds must be one of: ${allowedDurations.join(", ")} for provider "${normalizedProvider}".`,
      400,
    );
  }

  const allowedModels = ALLOWED_PROVIDER_MODELS[normalizedProvider] || [];
  const normalizedModel = normalizeText(model);
  if (!allowedModels.includes(normalizedModel)) {
    throw createHttpError(
      `model must be one of: ${allowedModels.join(", ")} for provider "${normalizedProvider}".`,
      400,
    );
  }

  const normalizedSkuReference = normalizeNullableText(productIdOrSkuReference, 128);

  return {
    prompt: normalizedPrompt,
    negativePrompt: normalizedNegativePrompt,
    aspectRatio,
    durationSeconds: normalizedDuration,
    provider: normalizedProvider,
    model: normalizedModel,
    productIdOrSkuReference: normalizedSkuReference,
  };
}

async function insertJobEvent(dbLike, { jobId, eventType, message = null, payload = {}, createdBy = null }) {
  await dbLike.query(
    `INSERT INTO content.video_job_events (video_job_id, event_type, message, payload_json, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [jobId, eventType, message, JSON.stringify(payload || {}), createdBy],
  );
}

async function loadJobRow(dbLike, jobId) {
  const result = await dbLike.query(
    `SELECT * FROM content.video_jobs WHERE job_id = $1`,
    [jobId],
  );
  return result.rows[0] || null;
}

async function loadJobRowForUpdate(client, jobId) {
  const result = await client.query(
    `SELECT * FROM content.video_jobs WHERE job_id = $1 FOR UPDATE`,
    [jobId],
  );
  return result.rows[0] || null;
}

function assertJobVisible(job, auth) {
  if (!job) {
    throw createHttpError("Not found", 404);
  }
  if (auth.role === "admin") {
    return;
  }
  if (auth.role === "staff") {
    if (job.created_by !== auth.userId) {
      throw createHttpError("Not found", 404);
    }
    return;
  }
  if (auth.role === "branch") {
    if (job.status !== "approved") {
      throw createHttpError("Not found", 404);
    }
    return;
  }
  throw createHttpError("Not found", 404);
}

async function resolveInputAssetId(db, auth, rawInputAssetId) {
  const inputAssetId = parsePositiveInt(rawInputAssetId, null);
  if (inputAssetId == null) return null;

  const assetResult = await db.query(
    `SELECT asset_id, created_by, asset_type FROM content.video_assets WHERE asset_id = $1`,
    [inputAssetId],
  );
  const assetRow = assetResult.rows[0];
  if (!assetRow) {
    throw createHttpError("inputAssetId does not exist.", 400);
  }
  if (assetRow.created_by !== auth.userId && auth.role !== "admin") {
    throw createHttpError("inputAssetId is not accessible.", 403);
  }
  if (assetRow.asset_type !== "input_image" && assetRow.asset_type !== "input_video") {
    throw createHttpError("inputAssetId must reference an input_image or input_video asset.", 400);
  }
  return inputAssetId;
}

async function createVideoJob({ db, config, auth, body }) {
  const input = validateJobInput(config, body || {});
  const inputAssetId = await resolveInputAssetId(db, auth, body?.inputAssetId);
  const jobPublicId = crypto.randomUUID();

  const insertResult = await db.query(
    `INSERT INTO content.video_jobs (
       job_public_id, created_by, status, provider, model, prompt, negative_prompt,
       aspect_ratio, duration_seconds, input_asset_id, product_id_or_sku_reference
     )
     VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      jobPublicId,
      auth.userId,
      input.provider,
      input.model,
      input.prompt,
      input.negativePrompt,
      input.aspectRatio,
      input.durationSeconds,
      inputAssetId,
      input.productIdOrSkuReference,
    ],
  );
  const jobRow = insertResult.rows[0];

  await insertJobEvent(db, {
    jobId: jobRow.job_id,
    eventType: "job_created",
    createdBy: auth.userId,
  });

  return mapJobRow(jobRow);
}

async function loadInputImageForJob(client, storageProvider, jobRow) {
  if (!jobRow.input_asset_id) {
    return { inputImageBuffer: null, inputImageMimeType: null };
  }
  const assetResult = await client.query(
    `SELECT storage_key, mime_type FROM content.video_assets WHERE asset_id = $1`,
    [jobRow.input_asset_id],
  );
  const assetRow = assetResult.rows[0];
  if (!assetRow || !assetRow.storage_key) {
    throw createHttpError("Input asset has not finished uploading.", 400, { code: "INPUT_ASSET_NOT_READY" });
  }
  const { buffer } = await storageProvider.downloadAsset({ key: assetRow.storage_key });
  return { inputImageBuffer: buffer, inputImageMimeType: assetRow.mime_type || null };
}

async function submitVideoJob({ db, config, auth, jobId, videoJobRunner, storageProvider }) {
  const normalizedJobId = parsePositiveInt(jobId, null);
  if (normalizedJobId == null) {
    throw createHttpError("job id is invalid.", 400);
  }

  const client = await db.connect();
  let queuedJob;
  try {
    await client.query("BEGIN");

    const jobRow = await loadJobRowForUpdate(client, normalizedJobId);
    if (!jobRow) {
      throw createHttpError("Not found", 404);
    }
    if (jobRow.created_by !== auth.userId && auth.role !== "admin") {
      throw createHttpError("Forbidden", 403);
    }

    const dailyCountResult = await client.query(
      `SELECT count(*)::int AS count
       FROM content.video_jobs
       WHERE created_by = $1 AND submitted_at >= date_trunc('day', now())`,
      [jobRow.created_by],
    );
    if (dailyCountResult.rows[0].count >= config.videoMaxJobsPerUserPerDay) {
      throw createHttpError("Daily video job submission limit reached.", 429, { code: "DAILY_LIMIT_REACHED" });
    }

    const concurrentCountResult = await client.query(
      `SELECT count(*)::int AS count
       FROM content.video_jobs
       WHERE created_by = $1 AND status IN ('queued', 'processing')`,
      [jobRow.created_by],
    );
    if (concurrentCountResult.rows[0].count >= config.videoMaxConcurrentJobsPerUser) {
      throw createHttpError("Concurrent video job limit reached.", 429, { code: "CONCURRENCY_LIMIT_REACHED" });
    }

    const casResult = await client.query(
      `UPDATE content.video_jobs
       SET status = 'queued', submitted_at = now(), updated_at = now()
       WHERE job_id = $1 AND status IN ('draft', 'failed')
       RETURNING *`,
      [normalizedJobId],
    );
    if (casResult.rowCount === 0) {
      throw createHttpError("Job already submitted or not in a submittable state", 409, {
        code: "NOT_SUBMITTABLE",
      });
    }
    queuedJob = casResult.rows[0];

    const { inputImageBuffer, inputImageMimeType } = await loadInputImageForJob(client, storageProvider, queuedJob);

    const provider = getVideoProvider(queuedJob.provider, config);
    const providerResult = await provider.createGenerationJob({
      prompt: queuedJob.prompt,
      negativePrompt: queuedJob.negative_prompt,
      aspectRatio: queuedJob.aspect_ratio,
      durationSeconds: queuedJob.duration_seconds,
      model: queuedJob.model,
      inputImageBuffer,
      inputImageMimeType,
    });

    const updateResult = await client.query(
      `UPDATE content.video_jobs
       SET provider_job_id = $2,
           status = $3,
           estimated_cost = $4,
           updated_at = now()
       WHERE job_id = $1
       RETURNING *`,
      [
        normalizedJobId,
        providerResult.providerJobId,
        providerResult.status === "processing" ? "processing" : "queued",
        providerResult.estimatedCost,
      ],
    );
    queuedJob = updateResult.rows[0];

    await insertJobEvent(client, {
      jobId: normalizedJobId,
      eventType: "submitted_to_provider",
      payload: { providerJobId: providerResult.providerJobId },
      createdBy: auth.userId,
    });

    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_rollbackError) { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }

  if (videoJobRunner && typeof videoJobRunner.schedulePoll === "function") {
    videoJobRunner.schedulePoll(normalizedJobId);
  }

  return mapJobRow(queuedJob);
}

async function retryVideoJob({ db, config, auth, jobId, videoJobRunner, storageProvider }) {
  const normalizedJobId = parsePositiveInt(jobId, null);
  if (normalizedJobId == null) {
    throw createHttpError("job id is invalid.", 400);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const jobRow = await loadJobRowForUpdate(client, normalizedJobId);
    if (!jobRow) {
      throw createHttpError("Not found", 404);
    }
    if (jobRow.created_by !== auth.userId && auth.role !== "admin") {
      throw createHttpError("Forbidden", 403);
    }
    if (jobRow.status !== "failed") {
      throw createHttpError("Only failed jobs can be retried.", 400);
    }
    if (Number(jobRow.retry_count) >= config.videoMaxRetries) {
      throw createHttpError("Max retries exceeded", 400, { code: "MAX_RETRIES_EXCEEDED" });
    }

    const casResult = await client.query(
      `UPDATE content.video_jobs
       SET status = 'draft', retry_count = retry_count + 1, updated_at = now()
       WHERE job_id = $1 AND status = 'failed'
       RETURNING *`,
      [normalizedJobId],
    );
    if (casResult.rowCount === 0) {
      throw createHttpError("Job is no longer retryable", 409, { code: "NOT_RETRYABLE" });
    }

    await insertJobEvent(client, {
      jobId: normalizedJobId,
      eventType: "retry_requested",
      createdBy: auth.userId,
    });

    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_rollbackError) { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }

  return submitVideoJob({ db, config, auth, jobId: normalizedJobId, videoJobRunner, storageProvider });
}

async function cancelVideoJob({ db, config, auth, jobId, videoJobRunner }) {
  const normalizedJobId = parsePositiveInt(jobId, null);
  if (normalizedJobId == null) {
    throw createHttpError("job id is invalid.", 400);
  }

  const client = await db.connect();
  let cancelledJob;
  try {
    await client.query("BEGIN");
    const jobRow = await loadJobRowForUpdate(client, normalizedJobId);
    if (!jobRow) {
      throw createHttpError("Not found", 404);
    }
    if (jobRow.created_by !== auth.userId && auth.role !== "admin") {
      throw createHttpError("Forbidden", 403);
    }
    if (!["draft", "queued", "processing"].includes(jobRow.status)) {
      throw createHttpError("Job cannot be cancelled in its current state.", 400);
    }

    if (jobRow.provider_job_id) {
      try {
        const provider = getVideoProvider(jobRow.provider, config);
        const cancelResult = await provider.cancelGenerationJob(jobRow.provider_job_id);
        await insertJobEvent(client, {
          jobId: normalizedJobId,
          eventType: "provider_cancel_attempted",
          payload: cancelResult,
          createdBy: auth.userId,
        });
      } catch (providerError) {
        await insertJobEvent(client, {
          jobId: normalizedJobId,
          eventType: "provider_cancel_failed",
          message: providerError.message,
          createdBy: auth.userId,
        });
      }
    }

    const casResult = await client.query(
      `UPDATE content.video_jobs
       SET status = 'cancelled', updated_at = now()
       WHERE job_id = $1 AND status IN ('draft', 'queued', 'processing')
       RETURNING *`,
      [normalizedJobId],
    );
    if (casResult.rowCount === 0) {
      throw createHttpError("Job cannot be cancelled in its current state.", 409);
    }
    cancelledJob = casResult.rows[0];

    await insertJobEvent(client, {
      jobId: normalizedJobId,
      eventType: "job_cancelled",
      createdBy: auth.userId,
    });

    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_rollbackError) { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }

  if (videoJobRunner && typeof videoJobRunner.stop === "function") {
    videoJobRunner.stop(normalizedJobId);
  }

  return mapJobRow(cancelledJob);
}

async function approveVideoJob({ db, auth, jobId, note }) {
  if (auth.role !== "admin") {
    throw createHttpError("Forbidden", 403);
  }
  const normalizedJobId = parsePositiveInt(jobId, null);
  if (normalizedJobId == null) {
    throw createHttpError("job id is invalid.", 400);
  }

  const client = await db.connect();
  let approvedJob;
  try {
    await client.query("BEGIN");
    const jobRow = await loadJobRowForUpdate(client, normalizedJobId);
    if (!jobRow) {
      throw createHttpError("Not found", 404);
    }
    if (jobRow.status !== "completed") {
      throw createHttpError("Only completed jobs can be approved.", 400);
    }

    const casResult = await client.query(
      `UPDATE content.video_jobs
       SET status = 'approved', approved_at = now(), approved_by = $2, updated_at = now()
       WHERE job_id = $1 AND status = 'completed'
       RETURNING *`,
      [normalizedJobId, auth.userId],
    );
    if (casResult.rowCount === 0) {
      throw createHttpError("Job is no longer approvable", 409);
    }
    approvedJob = casResult.rows[0];

    await insertJobEvent(client, {
      jobId: normalizedJobId,
      eventType: "approved",
      message: normalizeNullableText(note),
      createdBy: auth.userId,
    });

    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_rollbackError) { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }

  return mapJobRow(approvedJob);
}

async function rejectVideoJob({ db, auth, jobId, reason }) {
  if (auth.role !== "admin") {
    throw createHttpError("Forbidden", 403);
  }
  const normalizedJobId = parsePositiveInt(jobId, null);
  if (normalizedJobId == null) {
    throw createHttpError("job id is invalid.", 400);
  }
  const normalizedReason = normalizeNullableText(reason, 2000);
  if (!normalizedReason) {
    throw createHttpError("reason is required.", 400);
  }

  const client = await db.connect();
  let rejectedJob;
  try {
    await client.query("BEGIN");
    const jobRow = await loadJobRowForUpdate(client, normalizedJobId);
    if (!jobRow) {
      throw createHttpError("Not found", 404);
    }
    if (jobRow.status !== "completed") {
      throw createHttpError("Only completed jobs can be rejected.", 400);
    }

    const casResult = await client.query(
      `UPDATE content.video_jobs
       SET status = 'rejected', rejected_at = now(), rejected_by = $2, rejection_reason = $3, updated_at = now()
       WHERE job_id = $1 AND status = 'completed'
       RETURNING *`,
      [normalizedJobId, auth.userId, normalizedReason],
    );
    if (casResult.rowCount === 0) {
      throw createHttpError("Job is no longer rejectable", 409);
    }
    rejectedJob = casResult.rows[0];

    await insertJobEvent(client, {
      jobId: normalizedJobId,
      eventType: "rejected",
      message: normalizedReason,
      createdBy: auth.userId,
    });

    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_rollbackError) { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }

  return mapJobRow(rejectedJob);
}

function buildListWhereClause(auth, filters) {
  const clauses = [];
  const params = [];

  function addParam(value) {
    params.push(value);
    return `$${params.length}`;
  }

  if (auth.role === "staff") {
    clauses.push(`created_by = ${addParam(auth.userId)}`);
  } else if (auth.role === "branch") {
    clauses.push(`status = ${addParam("approved")}`);
  } else if (auth.role !== "admin") {
    clauses.push("1=0");
  }

  if (filters.status) {
    if (auth.role === "branch" && !VISIBLE_LIST_STATUSES_FOR_BRANCH.has(filters.status)) {
      clauses.push("1=0");
    } else {
      clauses.push(`status = ${addParam(filters.status)}`);
    }
  }
  if (filters.createdBy) {
    clauses.push(`created_by = ${addParam(filters.createdBy)}`);
  }
  if (filters.sku) {
    clauses.push(`product_id_or_sku_reference = ${addParam(filters.sku)}`);
  }
  if (filters.promptKeyword) {
    clauses.push(`prompt ILIKE ${addParam(`%${filters.promptKeyword}%`)}`);
  }
  if (filters.dateFrom) {
    clauses.push(`created_at >= ${addParam(filters.dateFrom)}`);
  }
  if (filters.dateTo) {
    clauses.push(`created_at <= ${addParam(filters.dateTo)}`);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return { whereSql, params };
}

async function listVideoJobs({ db, auth, filters = {}, pagination = {} }) {
  const limit = Math.min(parsePositiveInt(pagination.limit, DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT);
  const offset = parsePositiveInt(pagination.offset, 1) - 1;
  const normalizedOffset = offset < 0 ? 0 : offset;

  const { whereSql, params } = buildListWhereClause(auth, filters);
  const limitParamIndex = params.length + 1;
  const offsetParamIndex = params.length + 2;

  const result = await db.query(
    `SELECT * FROM content.video_jobs
     ${whereSql}
     ORDER BY job_id DESC
     LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
    [...params, limit, normalizedOffset],
  );

  return result.rows.map(mapJobRow);
}

async function getVideoJobDetail({ db, auth, jobId }) {
  const normalizedJobId = parsePositiveInt(jobId, null);
  if (normalizedJobId == null) {
    throw createHttpError("Not found", 404);
  }
  const jobRow = await loadJobRow(db, normalizedJobId);
  assertJobVisible(jobRow, auth);
  return mapJobRow(jobRow);
}

async function getVideoJobEvents({ db, auth, jobId }) {
  const normalizedJobId = parsePositiveInt(jobId, null);
  if (normalizedJobId == null) {
    throw createHttpError("Not found", 404);
  }
  const jobRow = await loadJobRow(db, normalizedJobId);
  assertJobVisible(jobRow, auth);

  const result = await db.query(
    `SELECT * FROM content.video_job_events WHERE video_job_id = $1 ORDER BY event_id ASC`,
    [normalizedJobId],
  );
  return result.rows.map(mapEventRow);
}

module.exports = {
  validateJobInput,
  createVideoJob,
  submitVideoJob,
  retryVideoJob,
  cancelVideoJob,
  approveVideoJob,
  rejectVideoJob,
  listVideoJobs,
  getVideoJobDetail,
  getVideoJobEvents,
  mapJobRow,
  mapEventRow,
  loadJobRow,
  insertJobEvent,
  assertJobVisible,
  createHttpError,
};
