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

function sleep(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, n));
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
  if (!execute) {
    return {
      action: "planned",
      skuId: record.skuId,
    };
  }

  const statement = buildUpsertSkuEmbeddingStatement(record);
  const result = await db.query(statement.sql, statement.params);
  if (result.rowCount === 0) {
    return {
      action: "unchanged",
      skuId: record.skuId,
    };
  }
  return {
    action: result.rows[0]?.inserted ? "inserted" : "updated",
    skuId: record.skuId,
  };
}

async function fetchSkuEmbeddingBatch(db, options = {}) {
  const afterSkuId = parsePositiveInt(options.afterSkuId, 0) || 0;
  const batchSize = clampBatchSize(options.batchSize);
  const onlyStale = Boolean(options.onlyStale);
  const updatedSince = options.updatedSince || null;

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
      e.source_updated_at AS embedding_source_updated_at
    FROM public.skus s
    LEFT JOIN public.items i
      ON i.item_id = s.item_id
    LEFT JOIN public.sku_embeddings e
      ON e.sku_id = s.sku_id
    WHERE s.sku_id > $1
      AND ($2::timestamptz IS NULL OR s.updated_at >= $2::timestamptz)
      AND (
        NOT $3::boolean
        OR e.sku_id IS NULL
        OR e.source_updated_at IS NULL
        OR e.source_updated_at < s.updated_at
      )
    ORDER BY s.sku_id ASC
    LIMIT $4
  `;

  const result = await db.query(sql, [afterSkuId, updatedSince, onlyStale, batchSize]);
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
  };

  let afterSkuId = parsePositiveInt(options.afterSkuId, 0) || 0;

  while (true) {
    const remaining = maxRows == null ? batchSize : Math.max(maxRows - summary.processed, 0);
    if (remaining === 0) {
      break;
    }

    const rows = await fetchSkuEmbeddingBatch(db, {
      afterSkuId,
      updatedSince,
      onlyStale,
      batchSize: Math.min(batchSize, remaining),
    });
    if (rows.length === 0) {
      break;
    }

    summary.batches += 1;

    for (const sku of rows) {
      const textForEmbedding = buildSkuEmbeddingText(sku);
      if (!textForEmbedding) {
        summary.skipped += 1;
        summary.processed += 1;
        afterSkuId = sku.sku_id;
        summary.last_sku_id = sku.sku_id;
        logger(`[sku-embeddings] sku_id=${sku.sku_id} skipped=empty_text`);
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
        const writeResult = await upsertSkuEmbedding(db, record, { execute });
        summary[writeResult.action] += 1;
        summary.processed += 1;
        summary.last_sku_id = sku.sku_id;
        afterSkuId = sku.sku_id;

        logger(
          `[sku-embeddings] sku_id=${sku.sku_id} text_chars=${textForEmbedding.length} dim=${embeddingVector.length} action=${writeResult.action}`,
        );

        if (rateLimitMs > 0) {
          await sleep(rateLimitMs);
        }
      } catch (error) {
        summary.errors += 1;
        summary.processed += 1;
        summary.last_sku_id = sku.sku_id;
        afterSkuId = sku.sku_id;
        logger(`[sku-embeddings] sku_id=${sku.sku_id} error=${error.message}`);
      }
    }
  }

  return summary;
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  clampBatchSize,
  toVectorLiteral,
  computeContentHash,
  buildSkuEmbeddingRecord,
  buildUpsertSkuEmbeddingStatement,
  upsertSkuEmbedding,
  fetchSkuEmbeddingBatch,
  indexSkuEmbeddings,
};
