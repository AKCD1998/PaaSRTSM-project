"use strict";

function branchStockValueKeys(branchCode) {
  return {
    qty: ["qty", "quantity", `qty_branch_${branchCode}`, `qtyBranch${branchCode}`],
    cost: ["costAvg", "cost_avg", `cost_avg_branch_${branchCode}`, `costAvgBranch${branchCode}`],
  };
}

function firstDefined(record, keys) {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

module.exports = { branchStockValueKeys, firstDefined };
