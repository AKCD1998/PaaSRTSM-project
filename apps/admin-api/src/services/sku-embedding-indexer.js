"use strict";

const crypto = require("crypto");
const { buildSkuEmbeddingText, buildSkuEmbeddingMetadata } = require("../embeddings/sku-text");

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

function clampBatchSize(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return DEFAULT_BATCH_SIZE;
  }
  return Math.min(n, MAX_BATCH_SIZE);
}

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function parsePositiveInt(value, fallback = null) {
  if (value == null || value === "") {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized === "" ? null : normalized;
}

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function timestampsEqual(a, b) {
  return normalizeTimestamp(a) === normalizeTimestamp(b);
}

function sleep(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, n));
}

function normalizeSyncFilters(filters = {}) {
  const source = filters && typeof filters === "object" ? filters : {};
  const companyCode = normalizeNullableText(source.company_code || source.companyCode);
  const productKind = normalizeNullableText(source.product_kind || source.productKind);
  const categoryName = normalizeNullableText(source.category_name || source.categoryName);
  const supplierCode = normalizeNullableText(source.supplier_code || source.supplierCode);
  const skuIdMin = parsePositiveInt(source.sku_id_min ?? source.skuIdMin, null);
  const skuIdMax = parsePositiveInt(source.sku_id_max ?? source.skuIdMax, null);

  return {
    companyCode,
    productKind,
    categoryName,
    supplierCode,
    skuIdMin,
    skuIdMax,
  };
}

function buildSyncFilterClause(filters, params) {
  const clauses = [];

  if (filters.companyCode) {
    params.push(filters.companyCode);
    clauses.push(`s.company_code = $${params.length}`);
  }

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

  if (filters.skuIdMin != null) {
    params.push(filters.skuIdMin);
    clauses.push(`s.sku_id >= $${params.length}`);
  }

  if (filters.skuIdMax != null) {
    params.push(filters.skuIdMax);
    clauses.push(`s.sku_id <= $${params.length}`);
  }

  return clauses;
}

function toVectorLiteral(vector) {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("Cannot convert empty embedding vector");
  }
  const values = vector.map((value, index) => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new Error(`Embedding vector has non-finite value at index ${index}`);
    }
    return Number(n.toFixed(10));
  });
  return `[${values.join(",")}]`;
}

function classifyDryRunAction(sku, record) {
  if (!sku.embedding_sku_id) {
    return "insert";
  }

  const unchanged =
    normalizeNullableText(sku.existing_content_hash) === normalizeNullableText(record.contentHash) &&
    normalizeNullableText(sku.existing_embedding_model) === normalizeNullableText(record.embeddingModel) &&
    normalizeNullableText(sku.existing_embedding_provider) === normalizeNullableText(record.embeddingProvider) &&
    timestampsEqual(sku.embedding_source_updated_at, record.sourceUpdatedAt);

  return unchanged ? "skip" : "update";
}

function computeContentHash(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function buildSkuEmbeddingRecord(sku, embeddingProvider, embeddingVector) {
  const textForEmbedding = buildSkuEmbeddingText(sku);
  const metadata = buildSkuEmbeddingMetadata(sku);

  return {
    skuId: sku.sku_id,
    sourceUpdatedAt: sku.sku_updated_at || sku.updated_at || null,
    textForEmbedding,
    metadata,
    contentHash: computeContentHash(textForEmbedding),
    embeddingProvider: embeddingProvider.name,
    embeddingModel: embeddingProvider.model,
    embeddingDim: embeddingProvider.dimension,
    embeddingVector,
  };
}

function buildUpsertSkuEmbeddingStatement(record) {
  const sql = `
    INSERT INTO public.sku_embeddings AS se (
      sku_id,
      embedding,
      embedding_dim,
      embedding_model,
      embedding_provider,
      text_for_embedding,
      content_hash,
      metadata,
      source_updated_at,
      updated_at
    )
    VALUES (
      $1,
      $2::vector,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8::jsonb,
      $9::timestamptz,
      now()
    )
    ON CONFLICT (sku_id)
    DO UPDATE SET
      embedding = EXCLUDED.embedding,
      embedding_dim = EXCLUDED.embedding_dim,
      embedding_model = EXCLUDED.embedding_model,
      embedding_provider = EXCLUDED.embedding_provider,
      text_for_embedding = EXCLUDED.text_for_embedding,
      content_hash = EXCLUDED.content_hash,
      metadata = EXCLUDED.metadata,
      source_updated_at = EXCLUDED.source_updated_at,
      updated_at = now()
    WHERE
      se.content_hash IS DISTINCT FROM EXCLUDED.content_hash
      OR se.embedding_model IS DISTINCT FROM EXCLUDED.embedding_model
      OR se.embedding_provider IS DISTINCT FROM EXCLUDED.embedding_provider
      OR se.source_updated_at IS DISTINCT FROM EXCLUDED.source_updated_at
    RETURNING (xmax = 0) AS inserted
  `;

  return {
    sql,
    params: [
      record.skuId,
      toVectorLiteral(record.embeddingVector),
      record.embeddingDim,
      record.embeddingModel,
      record.embeddingProvider,
      record.textForEmbedding,
      record.contentHash,
      JSON.stringify(record.metadata || {}),
      record.sourceUpdatedAt,
    ],
  };
}

async function upsertSkuEmbedding(db, record, options = {}) {
  const execute = Boolean(options.execute);
  const existingRow = options.existingRow || null;
  if (!execute) {
    const action = classifyDryRunAction(existingRow || {}, record);
    return {
      action,
      skuId: record.skuId,
      contentHashBefore: normalizeNullableText(existingRow?.existing_content_hash),
      contentHashAfter: record.contentHash,
      reason: action === "skip" ? "unchanged" : "dry_run_prediction",
    };
  }

  const statement = buildUpsertSkuEmbeddingStatement(record);
  const result = await db.query(statement.sql, statement.params);
  if (result.rowCount === 0) {
    return {
      action: "skip",
      skuId: record.skuId,
      contentHashBefore: normalizeNullableText(existingRow?.existing_content_hash),
      contentHashAfter: record.contentHash,
      reason: "unchanged",
    };
  }
  return {
    action: result.rows[0]?.inserted ? "insert" : "update",
    skuId: record.skuId,
    contentHashBefore: normalizeNullableText(existingRow?.existing_content_hash),
    contentHashAfter: record.contentHash,
    reason: result.rows[0]?.inserted ? "inserted" : "updated",
  };
}

async function fetchSkuEmbeddingBatch(db, options = {}) {
  const afterSkuId = parsePositiveInt(options.afterSkuId, 0) || 0;
  const batchSize = clampBatchSize(options.batchSize);
  const onlyStale = Boolean(options.onlyStale);
  const updatedSince = options.updatedSince || null;
  const embeddingModel = normalizeNullableText(options.embeddingModel);
  const embeddingProvider = normalizeNullableText(options.embeddingProvider);
  const filters = normalizeSyncFilters(options.filters || {});

  const params = [afterSkuId, updatedSince, onlyStale, embeddingModel, embeddingProvider];
  const where = [
    "s.sku_id > $1",
    "($2::timestamptz IS NULL OR s.updated_at >= $2::timestamptz)",
    `(
      NOT $3::boolean
      OR e.sku_id IS NULL
      OR e.source_updated_at IS NULL
      OR e.source_updated_at < s.updated_at
      OR ($4::text IS NOT NULL AND e.embedding_model IS DISTINCT FROM $4::text)
      OR ($5::text IS NOT NULL AND e.embedding_provider IS DISTINCT FROM $5::text)
    )`,
  ];

  const filterClauses = buildSyncFilterClause(filters, params);
  where.push(...filterClauses);
  params.push(batchSize);

  const sql = `
    SELECT
      s.sku_id,
      s.item_id,
      s.uom,
      s.qty_in_base,
      s.pack_level,
      s.display_name,
      s.status,
      s.company_code,
      s.uom_th,
      s.category_name,
      s.supplier_code,
      s.avg_cost,
      s.generic_name,
      s.strength_text,
      s.form,
      s.route,
      s.product_kind,
      s.updated_at AS sku_updated_at,
      i.display_name AS item_display_name,
      i.generic_name AS item_generic_name,
      e.sku_id AS embedding_sku_id,
      e.content_hash AS existing_content_hash,
      e.embedding_model AS existing_embedding_model,
      e.embedding_provider AS existing_embedding_provider,
      e.source_updated_at AS embedding_source_updated_at
    FROM public.skus s
    LEFT JOIN public.items i
      ON i.item_id = s.item_id
    LEFT JOIN public.sku_embeddings e
      ON e.sku_id = s.sku_id
    WHERE ${where.join("\n      AND ")}
    ORDER BY s.sku_id ASC
    LIMIT $${params.length}
  `;

  const result = await db.query(sql, params);
  return result.rows;
}

async function indexSkuEmbeddings(db, embeddingProvider, options = {}) {
  const execute = Boolean(options.execute);
  const batchSize = clampBatchSize(options.batchSize);
  const onlyStale = Boolean(options.onlyStale);
  const updatedSince = options.updatedSince || null;
  const maxRows = parsePositiveInt(options.limit, null);
  const rateLimitMs = parsePositiveInt(options.rateLimitMs, 0) || 0;
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const onItem = typeof options.onItem === "function" ? options.onItem : null;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const shouldCancel = typeof options.shouldCancel === "function" ? options.shouldCancel : null;
  const filters = normalizeSyncFilters(options.filters || {});

  const summary = {
    mode: execute ? "execute" : "dry-run",
    processed: 0,
    planned: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: 0,
    batches: 0,
    last_sku_id: null,
    only_stale: onlyStale,
    canceled: false,
  };

  let afterSkuId = parsePositiveInt(options.afterSkuId, 0) || 0;

  while (true) {
    if (shouldCancel && (await shouldCancel(summary))) {
      summary.canceled = true;
      break;
    }

    const remaining = maxRows == null ? batchSize : Math.max(maxRows - summary.processed, 0);
    if (remaining === 0) {
      break;
    }

    const rows = await fetchSkuEmbeddingBatch(db, {
      afterSkuId,
      updatedSince,
      onlyStale,
      embeddingModel: embeddingProvider.model,
      embeddingProvider: embeddingProvider.name,
      filters,
      batchSize: Math.min(batchSize, remaining),
    });
    if (rows.length === 0) {
      break;
    }

    summary.batches += 1;

    for (const sku of rows) {
      if (shouldCancel && (await shouldCancel(summary))) {
        summary.canceled = true;
        break;
      }

      const textForEmbedding = buildSkuEmbeddingText(sku);
      if (!textForEmbedding) {
        summary.skipped += 1;
        summary.processed += 1;
        afterSkuId = sku.sku_id;
        summary.last_sku_id = sku.sku_id;
        logger(`[sku-embeddings] sku_id=${sku.sku_id} skipped=empty_text`);
        if (onItem) {
          await onItem({
            skuId: sku.sku_id,
            action: "skip",
            reason: "empty_text",
            contentHashBefore: normalizeNullableText(sku.existing_content_hash),
            contentHashAfter: null,
            errorMessage: null,
            mode: summary.mode,
          });
        }
        if (onProgress) {
          await onProgress({ ...summary });
        }
        continue;
      }

      try {
        const embeddingVector = await embeddingProvider.embed(textForEmbedding);
        if (!Array.isArray(embeddingVector) || embeddingVector.length !== embeddingProvider.dimension) {
          throw new Error(
            `provider returned invalid dimension for sku_id=${sku.sku_id} (expected=${embeddingProvider.dimension})`,
          );
        }

        const record = buildSkuEmbeddingRecord(sku, embeddingProvider, embeddingVector);
        const writeResult = await upsertSkuEmbedding(db, record, {
          execute,
          existingRow: sku,
        });
        if (writeResult.action === "insert") {
          summary.inserted += 1;
          if (!execute) {
            summary.planned += 1;
          }
        } else if (writeResult.action === "update") {
          summary.updated += 1;
          if (!execute) {
            summary.planned += 1;
          }
        } else if (writeResult.action === "skip") {
          summary.unchanged += writeResult.reason === "unchanged" ? 1 : 0;
          summary.skipped += writeResult.reason === "unchanged" ? 0 : 1;
        }

        summary.processed += 1;
        summary.last_sku_id = sku.sku_id;
        afterSkuId = sku.sku_id;

        logger(
          `[sku-embeddings] sku_id=${sku.sku_id} text_chars=${textForEmbedding.length} dim=${embeddingVector.length} action=${writeResult.action}`,
        );

        if (onItem) {
          await onItem({
            skuId: sku.sku_id,
            action: writeResult.action,
            reason: writeResult.reason || "",
            contentHashBefore: writeResult.contentHashBefore || normalizeNullableText(sku.existing_content_hash),
            contentHashAfter: writeResult.contentHashAfter || null,
            errorMessage: null,
            mode: summary.mode,
          });
        }
        if (onProgress) {
          await onProgress({ ...summary });
        }

        if (rateLimitMs > 0) {
          await sleep(rateLimitMs);
        }
      } catch (error) {
        summary.errors += 1;
        summary.processed += 1;
        summary.last_sku_id = sku.sku_id;
        afterSkuId = sku.sku_id;
        logger(`[sku-embeddings] sku_id=${sku.sku_id} error=${error.message}`);
        if (onItem) {
          await onItem({
            skuId: sku.sku_id,
            action: "error",
            reason: "processing_error",
            contentHashBefore: normalizeNullableText(sku.existing_content_hash),
            contentHashAfter: null,
            errorMessage: error.message,
            mode: summary.mode,
          });
        }
        if (onProgress) {
          await onProgress({ ...summary });
        }
      }
    }

    if (summary.canceled) {
      break;
    }
  }

  return summary;
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  clampBatchSize,
  normalizeSyncFilters,
  buildSyncFilterClause,
  normalizeTimestamp,
  timestampsEqual,
  toVectorLiteral,
  classifyDryRunAction,
  computeContentHash,
  buildSkuEmbeddingRecord,
  buildUpsertSkuEmbeddingStatement,
  upsertSkuEmbedding,
  fetchSkuEmbeddingBatch,
  indexSkuEmbeddings,
};
