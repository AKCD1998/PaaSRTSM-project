"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildUpsertSkuEmbeddingStatement,
  upsertSkuEmbedding,
} = require("../apps/admin-api/src/services/sku-embedding-indexer");

function sampleRecord() {
  return {
    skuId: 101,
    sourceUpdatedAt: "2026-02-21T10:00:00.000Z",
    textForEmbedding: "Display Name: Test Product",
    metadata: { product_type: "medicine", level: "base" },
    contentHash: "abc123",
    embeddingProvider: "mock",
    embeddingModel: "text-embedding-3-small",
    embeddingDim: 1536,
    embeddingVector: new Array(1536).fill(0).map((_, index) => (index % 2 === 0 ? 0.01 : -0.01)),
  };
}

test("buildUpsertSkuEmbeddingStatement includes conflict guard for idempotency", () => {
  const statement = buildUpsertSkuEmbeddingStatement(sampleRecord());
  const sql = statement.sql.toLowerCase().replace(/\s+/g, " ");

  assert.match(sql, /on conflict \(sku_id\)/);
  assert.match(sql, /do update set/);
  assert.match(sql, /se\.content_hash is distinct from excluded\.content_hash/);
  assert.match(sql, /se\.embedding_model is distinct from excluded\.embedding_model/);
  assert.match(sql, /se\.source_updated_at is distinct from excluded\.source_updated_at/);
});

test("upsertSkuEmbedding returns unchanged when conflict update is skipped", async () => {
  const db = {
    async query(_sql, _params) {
      return { rowCount: 0, rows: [] };
    },
  };

  const result = await upsertSkuEmbedding(db, sampleRecord(), { execute: true });
  assert.equal(result.action, "unchanged");
});
