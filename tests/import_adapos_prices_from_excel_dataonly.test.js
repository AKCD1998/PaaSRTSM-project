"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProductPlan,
  planRetailChange,
  planUnitTierChanges,
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
    unitPriceState: new Map(),
    barcodeState: { bySku: new Map(), owners: new Map() },
  });

  assert.equal(plan.summary.products_processed, 1);
  assert.equal(plan.summary.missing_sku, 1);
  assert.equal(plan.summary.sku_found, 0);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].status, "missing_sku");
});

test("unit-level plan keeps multiple units with different prices", () => {
  const productPlan = buildProductPlan({
    product_code: "IC-005555",
    product_name: "ยา A",
    category: "",
    units: [
      {
        unit: "แผง",
        retail_tier_1: 35,
        retail_tiers_optional: [30, 25, 0, 0, 0, 0, 0],
        barcodes: [{ barcode: "9999900280388", primary: true }],
      },
      {
        unit: "10 ชิ้น",
        retail_tier_1: 250,
        retail_tiers_optional: [250, 250, 80, 80, 80, 80, 80],
        barcodes: [{ barcode: "6921875051901", primary: true }],
      },
    ],
  });

  const plan = buildImportPlan([productPlan], {
    skuMap: new Map([["IC-005555", 6401]]),
    retailMap: new Map(),
    wholesaleMap: new Map(),
    unitPriceState: new Map(),
    barcodeState: { bySku: new Map(), owners: new Map() },
  });

  assert.equal(plan.summary.sku_found, 1);
  assert.equal(plan.summary.skipped_no_price, 0);
  assert.equal(plan.changes[0].status, "planned");
  assert.equal(plan.changes[0].unit_changes.length, 2);
  assert.deepEqual(
    plan.changes[0].unit_changes.map((entry) => [entry.unit, entry.retail.new_price]),
    [
      ["แผง", 35],
      ["10 ชิ้น", 250],
    ],
  );
});

test("unit tier planning updates only provided tiers", () => {
  const existing = new Map([
    [2, 90],
    [3, 80],
  ]);
  const planned = planUnitTierChanges(existing, [
    { tier: 2, value: 90 },
    { tier: 3, value: 75 },
    { tier: 4, value: null },
  ]);
  assert.deepEqual(planned, [
    { tier: 2, action: "unchanged", old_price: 90, new_price: 90 },
    { tier: 3, action: "update", old_price: 80, new_price: 75 },
  ]);
});
