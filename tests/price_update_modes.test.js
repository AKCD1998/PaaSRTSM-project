"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ensureSkuForImport,
  upsertRetailPrice,
  parseCliArgs,
  IMPORT_MODE_PRICE_ONLY,
  PRICE_HISTORY_ON,
} = require("../scripts/import_adapos_csv");

function makeMockClient(responseQueue) {
  let index = 0;
  const calls = [];

  return {
    calls,
    async query(sql, params) {
      calls.push({
        sql: String(sql).replace(/\s+/g, " ").trim(),
        params,
      });
      if (index >= responseQueue.length) {
        throw new Error(`No mock response for query #${index + 1}`);
      }
      const current = responseQueue[index];
      index += 1;

      if (typeof current === "function") {
        return current(sql, params, calls);
      }
      return {
        rowCount: current.rowCount ?? (current.rows ? current.rows.length : 0),
        rows: current.rows || [],
      };
    },
  };
}

function baseProduct(overrides = {}) {
  return {
    sku_code: "630010001",
    name_th: "Cetirizine 10",
    category: "ยาแก้แพ้",
    supplier_code: "TT00001",
    product_kind: "medicine",
    source_updated_at: null,
    audit: { updated_by: "" },
    ...overrides,
  };
}

test("parseCliArgs supports mode and price-history flags", () => {
  const args = parseCliArgs([
    "--file",
    "dummy.csv",
    "--mode",
    "price-only",
    "--price-history",
    "on",
  ]);

  assert.equal(args.mode, "price-only");
  assert.equal(args.priceHistory, "on");
});

test("price-only mode does not overwrite non-price metadata for existing SKU", async () => {
  const client = makeMockClient([
    {
      rowCount: 1,
      rows: [{ sku_id: 501, item_id: 300 }],
    },
  ]);

  const result = await ensureSkuForImport(client, baseProduct(), { mode: IMPORT_MODE_PRICE_ONLY });
  assert.equal(result.skuId, 501);
  assert.equal(result.itemId, 300);
  assert.equal(result.itemAction, "skipped");
  assert.equal(result.skuAction, "skipped");
  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0].sql, /FROM public\.skus/i);
  assert.match(client.calls[0].sql, /company_code = \$1/i);
});

test("price-only mode inserts new item+sku when SKU does not exist", async () => {
  const client = makeMockClient([
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [{ item_id: 901, inserted: true }] },
    { rowCount: 1, rows: [{ sku_id: 902, inserted: true }] },
  ]);

  const result = await ensureSkuForImport(client, baseProduct({ sku_code: "630099999" }), {
    mode: IMPORT_MODE_PRICE_ONLY,
  });

  assert.equal(result.skuId, 902);
  assert.equal(result.itemId, 901);
  assert.equal(result.itemAction, "inserted");
  assert.equal(result.skuAction, "inserted");
  assert.equal(client.calls.length, 3);
  assert.match(client.calls[1].sql, /INSERT INTO public\.items/i);
  assert.match(client.calls[2].sql, /INSERT INTO public\.skus/i);
});

test("price history mode closes active row and inserts new current row", async () => {
  const client = makeMockClient([
    { rowCount: 1, rows: [{ price_id: 111, price: "18.00" }] },
    { rowCount: 1, rows: [] },
    { rowCount: 1, rows: [] },
  ]);

  const result = await upsertRetailPrice(client, 902, 19.5, { priceHistory: PRICE_HISTORY_ON });
  assert.equal(result.inserted, 1);
  assert.equal(result.history_closed, 1);
  assert.equal(client.calls.length, 3);
  assert.match(client.calls[1].sql, /UPDATE public\.prices/i);
  assert.match(client.calls[1].sql, /effective_end = now\(\)/i);
  assert.match(client.calls[2].sql, /INSERT INTO public\.prices/i);
});

test("price history mode is idempotent when active price is unchanged", async () => {
  const client = makeMockClient([
    { rowCount: 1, rows: [{ price_id: 200, price: "20.00" }] },
  ]);

  const result = await upsertRetailPrice(client, 902, 20, { priceHistory: PRICE_HISTORY_ON });
  assert.equal(result.unchanged, 1);
  assert.equal(result.inserted, 0);
  assert.equal(result.history_closed, 0);
  assert.equal(client.calls.length, 1);
});
