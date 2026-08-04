"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBranchStockReconciliationManifest, compareManifests, buildMismatchExamples,
} = require("./branchStockReconciliation");

const at = "2026-07-29T01:00:00.000Z";

test("backend canonical manifest matches the agent golden vector", () => {
  const manifest = buildBranchStockReconciliationManifest([
    { product_code: "B", qty: "2.0000", synced_at: at },
    { product_code: "A", qty: "1.2500", synced_at: at },
  ]);
  assert.equal(manifest.quantitySumScaled, "32500");
  assert.equal(manifest.digest, "62ea399424b94e3ca0a36c14d5a9fb041282562d777bc2da102090607ee4da09");
});

test("manifest comparison names falsifiable fields instead of returning only a boolean", () => {
  const expected = buildBranchStockReconciliationManifest([{ productCode: "A", qty: 1, syncedAt: at }]);
  const actual = { ...expected, quantitySumScaled: "20000", digest: "different" };
  assert.deepEqual(compareManifests(expected, actual), {
    matches: false, mismatchedFields: ["quantitySumScaled", "digest"],
  });
});

test("mismatch examples are bounded and include missing and changed products", () => {
  const result = buildMismatchExamples(
    [{ productCode: "A", qty: 1, syncedAt: at }, { productCode: "B", qty: 2, syncedAt: at }],
    [{ productCode: "A", qty: 3, syncedAt: at }, { productCode: "C", qty: 4, syncedAt: at }],
    2,
  );
  assert.equal(result.mismatchCount, 3);
  assert.equal(result.examples.length, 2);
  assert.equal(result.examplesTruncated, true);
});
