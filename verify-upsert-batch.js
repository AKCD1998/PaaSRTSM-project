"use strict";
// Standalone verification harness for upsertProductBatch() — no real DB.
// Simulates Postgres's ON CONFLICT ... RETURNING behavior with a fake client
// so the JS-side wiring (param array shapes, Map-based linking between
// steps, sort stability, edge cases) can be checked without touching any
// database. Does NOT validate that the raw SQL is syntactically/semantically
// correct against a real Postgres — that still needs a staging DB (see
// docs/sync-program/MANUAL-ACTIONS.md).

// Reproduce upsertProductBatch() here via a tiny require shim isn't possible
// since sync.js isn't structured for import — instead this copies its
// public-facing contract by requiring the whole route module and reaching in.
// Simpler: exec the file's source in a sandbox is overkill; instead just
// re-implement the same 4-query call sequence against a fake client and
// assert on what upsertProductBatch would send.

const assert = require("node:assert/strict");
const path = require("node:path");

// Load sync.js as CommonJS and pull upsertProductBatch via a hack: the
// function isn't exported, so patch module.exports temporarily by requiring
// via a wrapper that appends an export. Simpler and safer: read the file,
// eval the function body isn't worth it — instead just require the real
// route factory and call it with a fake `db`/`config` to exercise the actual
// route handler end-to-end, which calls upsertProductBatch internally. This
// tests the real code path, not a re-implementation.

const syncRouteModule = require(path.join(__dirname, "apps/admin-api/src/routes/sync.js"));

function makeFakeClient(log) {
  let nextItemId = 1000;
  let nextSkuId = 2000;
  return {
    query: async (sql, params) => {
      log.push({ sql: sql.trim(), params });
      if (sql.includes("BEGIN") || sql.includes("COMMIT") || sql.includes("ROLLBACK")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO public.items")) {
        const [productNames, , , productCodes] = params;
        const rows = productCodes.map((code, i) => ({ item_id: nextItemId++, source_company_code: code }));
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("INSERT INTO public.skus")) {
        const [, , , , , productCodes] = params;
        const rows = productCodes.map((code) => ({ sku_id: nextSkuId++, company_code: code }));
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("INSERT INTO public.barcodes")) {
        const [barcodes] = params;
        return { rows: barcodes.map((b) => ({ barcode: b })), rowCount: barcodes.length };
      }
      if (sql.includes("INSERT INTO analytics.product_stock_snapshots")) {
        return { rows: [], rowCount: params[0].length };
      }
      throw new Error("Unexpected query in fake client: " + sql.slice(0, 80));
    },
    release: () => {},
  };
}

async function run() {
  const log = [];
  const client = makeFakeClient(log);
  const app = { post: () => {}, use: () => {} };
  // createSyncRouter expects an express.Router()-like object; express itself
  // isn't needed here since we only care about the handler closures it
  // creates internally calling client.query — but createSyncRouter calls
  // express.Router() internally and registers routes on it, then returns the
  // router. We can invoke the registered handler directly via router.stack.
  const router = syncRouteModule.createSyncRouter({ config: { posApiKeys: new Set() }, db: { connect: async () => client } });

  const productsLayer = router.stack.find(
    (layer) => layer.route && layer.route.path === "/products" && layer.route.methods.post,
  );
  assert.ok(productsLayer, "found POST /products route");
  const handler = productsLayer.route.stack[productsLayer.route.stack.length - 1].handle;

  const records = [
    { productCode: "B003", productName: "Product B003", barcode1: "8850000000001", stockCurrent: 5 },
    { productCode: "A001", productName: "Product A001", barcode1: "8850000000002", barcode2: "8850000000003", stockCurrent: 10 },
    { productCode: "C002", productName: "Product C002", stockCurrent: 0 }, // no barcodes
  ];

  let jsonResult = null;
  const req = { body: { records } };
  const res = { json: (payload) => { jsonResult = payload; return res; }, status: () => res };
  let nextErr = null;
  await handler(req, res, (err) => { nextErr = err; });

  assert.equal(nextErr, null, "no error passed to next()");
  assert.deepEqual(jsonResult, { accepted: 3 }, "accepted count matches input length");

  const beginIdx = log.findIndex((l) => l.sql.includes("BEGIN"));
  const commitIdx = log.findIndex((l) => l.sql.includes("COMMIT"));
  assert.ok(beginIdx === 0, "BEGIN is first");
  assert.ok(commitIdx === log.length - 1, "COMMIT is last");

  const itemsCall = log.find((l) => l.sql.includes("INSERT INTO public.items"));
  const productCodesSentToItems = itemsCall.params[3];
  assert.deepEqual(productCodesSentToItems, ["A001", "B003", "C002"], "items insert receives records in sorted productCode order");

  const skusCall = log.find((l) => l.sql.includes("INSERT INTO public.skus"));
  const [itemIds, , , , , skuProductCodes] = skusCall.params;
  assert.deepEqual(skuProductCodes, ["A001", "B003", "C002"], "skus insert also sorted");
  assert.ok(itemIds.every((id) => typeof id === "number"), "every sku row got a resolved item_id from step 1");

  const barcodesCall = log.find((l) => l.sql.includes("INSERT INTO public.barcodes"));
  const [barcodeList, skuIdsForBarcodes, isPrimaryList] = barcodesCall.params;
  assert.equal(barcodeList.length, 3, "3 barcodes total (1 for B003, 2 for A001, 0 for C002)");
  // Sorted order is A001, B003, C002 -> A001's 2 barcodes (primary, secondary) then B003's 1 (primary)
  assert.deepEqual(isPrimaryList, [true, false, true], "first barcode per product is primary, rest are not");
  assert.ok(skuIdsForBarcodes.every((id) => typeof id === "number"), "every barcode got a resolved sku_id from step 2");

  const snapshotsCall = log.find((l) => l.sql.includes("INSERT INTO analytics.product_stock_snapshots"));
  assert.equal(snapshotsCall.params[0].length, 3, "one stock snapshot row per product, no batching loss");

  console.log("ALL CHECKS PASSED —", log.length, "total queries for a 3-record batch (vs 3 x 5-8 = 15-24 under the old per-record loop)");
}

run().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
