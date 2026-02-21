"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { indexSkuEmbeddings } = require("../apps/admin-api/src/services/sku-embedding-indexer");

function createMockEmbeddingProvider() {
  return {
    name: "mock",
    model: "text-embedding-3-small",
    dimension: 4,
    async embed(inputText) {
      const seed = inputText.length % 10;
      return [0.01 * seed, 0.02 * seed, 0.03 * seed, 0.04 * seed];
    },
  };
}

function createInMemoryDb() {
  const skus = [
    {
      sku_id: 1,
      item_id: 1,
      uom: "TAB",
      qty_in_base: 10,
      pack_level: "base",
      display_name: "Amoxicillin 500 mg",
      status: "active",
      company_code: "630010001",
      uom_th: "เม็ด",
      category_name: "ยาฆ่าเชื้อ",
      supplier_code: "TT00001",
      avg_cost: "12.00",
      generic_name: "Amoxicillin",
      strength_text: "500 mg",
      form: "capsule",
      route: "oral",
      product_kind: "medicine",
      sku_updated_at: "2026-02-21T10:00:00.000Z",
      item_display_name: "Amoxicillin",
      item_generic_name: "Amoxicillin",
    },
    {
      sku_id: 2,
      item_id: 2,
      uom: "TAB",
      qty_in_base: 20,
      pack_level: "base",
      display_name: "Azithromycin 250 mg",
      status: "active",
      company_code: "630010002",
      uom_th: "เม็ด",
      category_name: "ยาฆ่าเชื้อ",
      supplier_code: "TT00002",
      avg_cost: "15.00",
      generic_name: "Azithromycin",
      strength_text: "250 mg",
      form: "tablet",
      route: "oral",
      product_kind: "medicine",
      sku_updated_at: "2026-02-21T10:00:00.000Z",
      item_display_name: "Azithromycin",
      item_generic_name: "Azithromycin",
    },
  ];

  const embeddingsBySkuId = new Map();
  let upsertCalls = 0;

  return {
    get upsertCalls() {
      return upsertCalls;
    },
    get embeddingCount() {
      return embeddingsBySkuId.size;
    },
    async query(sql, params) {
      const normalized = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

      if (normalized.includes("from public.skus s") && normalized.includes("left join public.sku_embeddings e")) {
        const afterSkuId = Number(params[0] || 0);
        const onlyStale = Boolean(params[2]);
        const embeddingModel = params[3] || null;
        const embeddingProvider = params[4] || null;
        const limit = Number(params[params.length - 1] || 100);

        const rows = skus
          .filter((sku) => sku.sku_id > afterSkuId)
          .filter((sku) => {
            const existing = embeddingsBySkuId.get(sku.sku_id);
            if (!onlyStale) {
              return true;
            }
            if (!existing) {
              return true;
            }
            const staleByUpdatedAt =
              !existing.source_updated_at || existing.source_updated_at < sku.sku_updated_at;
            const staleByModel = embeddingModel && existing.embedding_model !== embeddingModel;
            const staleByProvider = embeddingProvider && existing.embedding_provider !== embeddingProvider;
            return staleByUpdatedAt || staleByModel || staleByProvider;
          })
          .slice(0, limit)
          .map((sku) => {
            const existing = embeddingsBySkuId.get(sku.sku_id) || null;
            return {
              ...sku,
              embedding_sku_id: existing ? sku.sku_id : null,
              existing_content_hash: existing ? existing.content_hash : null,
              existing_embedding_model: existing ? existing.embedding_model : null,
              existing_embedding_provider: existing ? existing.embedding_provider : null,
              embedding_source_updated_at: existing ? existing.source_updated_at : null,
            };
          });

        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (normalized.startsWith("insert into public.sku_embeddings as se")) {
        upsertCalls += 1;
        const skuId = Number(params[0]);
        const embeddingModel = params[3];
        const embeddingProvider = params[4];
        const textForEmbedding = params[5];
        const contentHash = params[6];
        const sourceUpdatedAt = params[8] || null;

        const existing = embeddingsBySkuId.get(skuId);
        if (
          existing &&
          existing.content_hash === contentHash &&
          existing.embedding_model === embeddingModel &&
          existing.embedding_provider === embeddingProvider &&
          existing.source_updated_at === sourceUpdatedAt
        ) {
          return { rowCount: 0, rows: [] };
        }

        embeddingsBySkuId.set(skuId, {
          content_hash: contentHash,
          embedding_model: embeddingModel,
          embedding_provider: embeddingProvider,
          source_updated_at: sourceUpdatedAt,
          text_for_embedding: textForEmbedding,
        });

        return {
          rowCount: 1,
          rows: [{ inserted: existing ? false : true }],
        };
      }

      throw new Error(`Unhandled SQL in integration-ish indexer test: ${normalized}`);
    },
  };
}

test("indexSkuEmbeddings dry-run then execute updates embeddings deterministically", async () => {
  const db = createInMemoryDb();
  const provider = createMockEmbeddingProvider();

  const dryRun = await indexSkuEmbeddings(db, provider, {
    execute: false,
    onlyStale: true,
    limit: 10,
    batchSize: 5,
  });

  assert.equal(dryRun.mode, "dry-run");
  assert.equal(dryRun.processed, 2);
  assert.equal(dryRun.planned, 2);
  assert.equal(dryRun.errors, 0);
  assert.equal(db.upsertCalls, 0);
  assert.equal(db.embeddingCount, 0);

  const execute = await indexSkuEmbeddings(db, provider, {
    execute: true,
    onlyStale: true,
    limit: 10,
    batchSize: 5,
  });

  assert.equal(execute.mode, "execute");
  assert.equal(execute.processed, 2);
  assert.equal(execute.inserted, 2);
  assert.equal(execute.updated, 0);
  assert.equal(execute.errors, 0);
  assert.equal(db.embeddingCount, 2);
  assert.equal(db.upsertCalls, 2);
});
