"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProductMovementTraceResponse,
  normalizeProductCodeList,
  normalizeTraceRequestBody,
} = require("../apps/admin-api/src/routes/ordering");

test("normalizeProductCodeList skips empty/#N/A rows and dedupes pasted codes", () => {
  const result = normalizeProductCodeList(["IC-002833", "", "#N/A", "IC-000193", "IC-002833"]);

  assert.deepEqual(result.productCodes, ["IC-002833", "IC-000193"]);
  assert.deepEqual(result.duplicateCodes, ["IC-002833"]);
  assert.deepEqual(result.skippedValues, ["#N/A"]);
});

test("normalizeTraceRequestBody accepts top-level filters and defaults movement types", () => {
  const result = normalizeTraceRequestBody({
    product_codes: ["IC-002833"],
    saved_group_ids: [1, "2", "bad"],
    category_names: ["ยาความดัน"],
    brand_names: ["SUP01"],
    branch_code: "005",
    date_from: "2026-05-01",
    date_to: "2026-05-31",
  });

  assert.deepEqual(result.productCodes, ["IC-002833"]);
  assert.deepEqual(result.savedGroupIds, [1, 2]);
  assert.deepEqual(result.categoryNames, ["ยาความดัน"]);
  assert.deepEqual(result.brandNames, ["SUP01"]);
  assert.equal(result.branchCode, "005");
  assert.deepEqual(result.movementTypes, ["transfer_in", "transfer_out", "supplier_receipt", "sales_summary"]);
});

test("buildProductMovementTraceResponse groups movements by product and computes summary", () => {
  const metaMap = new Map([
    ["IC-002833", { product_name: "Product A", barcode: "8850001", unit: "box" }],
    ["IC-000193", { product_name: "Product B" }],
  ]);
  const response = buildProductMovementTraceResponse({
    productCodes: ["IC-002833", "IC-000193"],
    metaMap,
    movementTypes: ["transfer_in", "transfer_out", "supplier_receipt", "sales_summary"],
    warnings: ["Sales data is summary only, not bill-level transaction data."],
    movements: [
      { product_code: "IC-002833", date: "2026-05-01", type: "transfer_in", qty: 10, document_no: "TR1" },
      { product_code: "IC-002833", date: "2026-05-02", type: "transfer_out", qty: 2, document_no: "TR2" },
      { product_code: "IC-002833", date: "2026-05-03", type: "supplier_receipt", qty: 4, document_no: "PO1" },
    ],
    salesSummaries: [
      {
        product_code: "IC-002833",
        date_from: "2026-05-01",
        date_to: "2026-05-31",
        branch_code: "005",
        sold_qty_base: 6,
        avg_daily_usage: 0.2,
      },
    ],
  });

  assert.equal(response.products.length, 2);
  assert.equal(response.products[0].product_name, "Product A");
  assert.deepEqual(response.products[0].summary, {
    transfer_in_qty: 10,
    transfer_out_qty: 2,
    supplier_receipt_qty: 4,
    sold_qty_base: 6,
    net_movement_qty: 6,
  });
  assert.equal(response.products[0].last_movement_date, "2026-05-31");
  assert.deepEqual(response.products[1].summary, {
    transfer_in_qty: 0,
    transfer_out_qty: 0,
    supplier_receipt_qty: 0,
    sold_qty_base: 0,
    net_movement_qty: 0,
  });
});
