"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { upsertProductBatch } = require("./sync");

function makeMockClient(rowsByStep) {
  let step = 0;
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();
      if (normalized.startsWith("INSERT INTO PUBLIC.ITEMS")) {
        return { rows: rowsByStep.items || [], rowCount: (rowsByStep.items || []).length };
      }
      if (normalized.startsWith("INSERT INTO PUBLIC.SKUS")) {
        return { rows: rowsByStep.skus || [], rowCount: (rowsByStep.skus || []).length };
      }
      if (normalized.startsWith("INSERT INTO PUBLIC.BARCODES")) {
        return { rows: [], rowCount: 0 };
      }
      step += 1;
      return { rows: [], rowCount: 0 };
    },
  };
}

test("upsertProductBatch writes both the history snapshot and the current-stock upsert", async () => {
  const client = makeMockClient({
    items: [{ item_id: 1, source_company_code: "P001" }],
    skus: [{ sku_id: 10, company_code: "P001" }],
  });

  await upsertProductBatch(client, [
    {
      productCode: "P001",
      productName: "Test Product",
      stockCurrent: 42,
      stockRetail: 40,
      stockWarehouse: 2,
    },
  ]);

  const snapshotInsert = client.queries.find((q) => /INSERT INTO analytics\.product_stock_snapshots/i.test(q.sql));
  const currentStockUpsert = client.queries.find((q) => /INSERT INTO analytics\.product_current_stock/i.test(q.sql));

  assert.ok(snapshotInsert, "expected a history snapshot insert");
  assert.ok(currentStockUpsert, "expected a current-stock upsert");
  assert.match(currentStockUpsert.sql, /ON CONFLICT \(product_code\) DO UPDATE SET/);
  assert.match(currentStockUpsert.sql, /WHERE analytics\.product_current_stock\.snapshot_at <= EXCLUDED\.snapshot_at/);
  assert.deepEqual(currentStockUpsert.params[0], ["P001"]);
  assert.deepEqual(currentStockUpsert.params[1], [42]);
});
