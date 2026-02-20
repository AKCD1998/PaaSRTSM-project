"use strict";

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  decodeAdaPosBuffer,
  parseAdaPosRows,
  buildDryRunPlan,
} = require("../scripts/import_adapos_csv");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "adapos_sample.csv");

test("parser extracts core fields from sanitized AdaPos rows", () => {
  const buffer = fs.readFileSync(FIXTURE_PATH);
  const decoded = decodeAdaPosBuffer(buffer);
  const parsed = parseAdaPosRows(decoded.text);

  assert.equal(parsed.products.length, 5);

  const first = parsed.products[0];
  assert.equal(first.sku_code, "630010001");
  assert.equal(first.name_th, "พาราเซตามอล 500 มก.");
  assert.equal(first.avg_cost, 12.5);
  assert.equal(first.supplier_code, "TT00001");
  assert.equal(first.retail_price, 18);
  assert.equal(first.product_kind, "medicine");
  assert.equal(first.source_updated_at, "2026-02-20T09:55:11+07:00");
  assert.deepEqual(first.wholesale_tiers, [
    { tier: 1, value: 17.5, index: 27 },
    { tier: 2, value: 17, index: 28 },
    { tier: 3, value: 16.5, index: 29 },
    { tier: 4, value: 16, index: 30 },
  ]);

  const second = parsed.products[1];
  assert.equal(second.sku_code, "630010002");
  assert.equal(second.name_th, "ยาแก้ไอเด็ก");
  assert.equal(second.avg_cost, 9.75);
  assert.equal(second.supplier_code, "TT00002");
  assert.equal(second.product_kind, "medicine");
  assert.deepEqual(second.wholesale_tiers, []);

  const third = parsed.products[2];
  assert.equal(third.product_kind, "medical_food");

  const fourth = parsed.products[3];
  assert.equal(fourth.product_kind, "supplement");
});

test("dry-run planning is deterministic for same input", () => {
  const buffer = fs.readFileSync(FIXTURE_PATH);
  const decoded = decodeAdaPosBuffer(buffer);

  const parsedA = parseAdaPosRows(decoded.text);
  const parsedB = parseAdaPosRows(decoded.text);

  const planA = buildDryRunPlan(parsedA);
  const planB = buildDryRunPlan(parsedB);

  assert.deepEqual(planA, planB);
  assert.deepEqual(planA.planned_actions, {
    items_upsert: 5,
    skus_upsert: 5,
    barcodes_upsert: 4,
    prices_update_or_insert: 5,
    sku_price_tiers_upsert: 7,
  });
  assert.deepEqual(planA.product_kind_breakdown, {
    medical_food: 1,
    medicine: 3,
    supplement: 1,
  });
});
