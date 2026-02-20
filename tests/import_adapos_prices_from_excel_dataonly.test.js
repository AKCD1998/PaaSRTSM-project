"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProductPlan,
  planRetailChange,
  planWholesaleChanges,
  planBarcodeChanges,
  buildImportPlan,
} = require("../scripts/import_adapos_prices_from_excel_dataonly");

test("blank/missing tier values do not overwrite existing price fields", () => {
  const retail = planRetailChange(120, null);
  assert.equal(retail.action, "skip");

  const existingWholesale = new Map([
    [1, 110],
    [2, 109],
  ]);
  const changes = planWholesaleChanges(existingWholesale, [
    { tier: 1, value: null },
    { tier: 2, value: null },
    { tier: 3, value: null },
  ]);
  assert.deepEqual(changes, []);
});

test("primary barcode defaults to first incoming primary marker when SKU has no current primary", () => {
  const productPlan = buildProductPlan({
    product_code: "630010001",
    product_name: "สินค้า A",
    category: "",
    units: [
      {
        unit: "ขวด",
        retail_tier_1: 100,
        retail_tiers_optional: [90, 80, 70, 60, 50, 40, 30],
        barcodes: [
          { barcode: "8851000000001", primary: true },
          { barcode: "8851000000002", primary: false },
        ],
      },
      {
        unit: "โหล",
        retail_tier_1: 100,
        retail_tiers_optional: [90, 80, 70, 60, 50, 40, 30],
        barcodes: [{ barcode: "18851000000001", primary: true }],
      },
    ],
  });

  const plan = planBarcodeChanges(
    { by_barcode: new Set(), has_primary: false },
    new Map(),
    101,
    productPlan.incoming_barcodes,
  );
  assert.equal(plan.primary_to_set, "8851000000001");
  assert.equal(plan.inserts.length, 3);
  assert.equal(plan.conflicts.length, 0);
});

test("missing SKU is skipped and logged in import plan", () => {
  const productPlan = buildProductPlan({
    product_code: "IC-000001",
    product_name: "ATK Test Kit",
    category: "อุปกรณ์การแพทย์",
    units: [
      {
        unit: "กล่อง",
        retail_tier_1: 39,
        retail_tiers_optional: [35, 34, 33, 33, 33, 33, 33],
        barcodes: [{ barcode: "8850099990001", primary: true }],
      },
    ],
  });

  const plan = buildImportPlan([productPlan], {
    skuMap: new Map(),
    retailMap: new Map(),
    wholesaleMap: new Map(),
    barcodeState: { bySku: new Map(), owners: new Map() },
  });

  assert.equal(plan.summary.products_processed, 1);
  assert.equal(plan.summary.missing_sku, 1);
  assert.equal(plan.summary.sku_found, 0);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].status, "missing_sku");
});

