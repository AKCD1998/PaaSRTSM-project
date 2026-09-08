"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildStockRecommendationPriorityIndexRows,
} = require("../apps/admin-api/src/services/stockRecommendations");

test("priority index exposes only compact fields and uses shortage as needed quantity", () => {
  const rows = buildStockRecommendationPriorityIndexRows([
    {
      productCode: " P-001 ",
      action: "transfer_and_purchase",
      shortageQty: "12.34567",
      transferPlanQty: 4,
      purchaseQty: 8.34567,
      reason: "must not be copied into the compact index",
      donors: [{ branchCode: "003", qty: 4 }],
    },
    { productCode: "", action: "PURCHASE", shortageQty: 9 },
  ]);

  assert.deepEqual(rows, [{
    productCode: "P-001",
    action: "TRANSFER_AND_PURCHASE",
    neededQty: 12.3457,
    transferPlanQty: 4,
    purchaseQty: 8.3457,
  }]);
  assert.equal("reason" in rows[0], false);
  assert.equal("donors" in rows[0], false);
});

test("priority index safely normalizes missing quantities", () => {
  assert.deepEqual(buildStockRecommendationPriorityIndexRows([{
    productCode: "P-002",
    action: "NO_ACTION",
  }]), [{
    productCode: "P-002",
    action: "NO_ACTION",
    neededQty: 0,
    transferPlanQty: 0,
    purchaseQty: 0,
  }]);
});
