"use strict";

const { createHash } = require("node:crypto");

const BRANCH_STOCK_RECONCILIATION_VERSION = "branch-stock-v1";
const QUANTITY_SCALE = 4;
const QUANTITY_FACTOR = 10 ** QUANTITY_SCALE;
const MANIFEST_COMPARISON_FIELDS = Object.freeze([
  "version", "quantityScale", "recordCount", "uniqueProductCount",
  "duplicateProductCount", "quantitySumScaled", "negativeQuantityCount",
  "digestAlgorithm", "digest", "sourceSnapshotMinAt", "sourceSnapshotMaxAt",
]);

function firstDefined(record, keys) {
  for (const key of keys) if (record?.[key] !== undefined) return record[key];
  return undefined;
}

function scaledQuantity(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} has an invalid quantity.`);
  if (Math.abs(number) > Number.MAX_SAFE_INTEGER / QUANTITY_FACTOR) {
    throw new Error(`${label} quantity is outside the reconciliation range.`);
  }
  return BigInt(Math.round(number * QUANTITY_FACTOR));
}

function canonicalRows(records) {
  const rows = records.map((record, index) => {
    const productCode = String(firstDefined(record, ["productCode", "product_code"]) ?? "").trim();
    if (!productCode) throw new Error(`records[${index}] requires productCode.`);
    const quantity = scaledQuantity(firstDefined(record, ["qty", "quantity"]), `records[${index}]`);
    const rawTimestamp = firstDefined(record, [
      "syncedAt", "synced_at", "sourceSyncedAt", "source_synced_at",
    ]);
    const sourceTimestamp = new Date(rawTimestamp);
    if (Number.isNaN(sourceTimestamp.getTime())) {
      throw new Error(`records[${index}] requires a valid source timestamp.`);
    }
    return { productCode, quantity, sourceTimestamp: sourceTimestamp.toISOString() };
  });
  rows.sort((a, b) => a.productCode < b.productCode ? -1 : a.productCode > b.productCode ? 1 : 0);
  return rows;
}

function buildBranchStockReconciliationManifest(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Branch-stock reconciliation refuses an empty snapshot.");
  }
  const rows = canonicalRows(records);
  const codes = new Set();
  let quantitySum = 0n;
  let negativeQuantityCount = 0;
  let duplicateProductCount = 0;
  let sourceSnapshotMinAt = rows[0].sourceTimestamp;
  let sourceSnapshotMaxAt = rows[0].sourceTimestamp;
  const hash = createHash("sha256");
  for (const row of rows) {
    if (codes.has(row.productCode)) duplicateProductCount += 1;
    codes.add(row.productCode);
    quantitySum += row.quantity;
    if (row.quantity < 0n) negativeQuantityCount += 1;
    if (row.sourceTimestamp < sourceSnapshotMinAt) sourceSnapshotMinAt = row.sourceTimestamp;
    if (row.sourceTimestamp > sourceSnapshotMaxAt) sourceSnapshotMaxAt = row.sourceTimestamp;
    hash.update(`${JSON.stringify(row.productCode)}\t${row.quantity}\n`, "utf8");
  }
  return {
    version: BRANCH_STOCK_RECONCILIATION_VERSION,
    quantityScale: QUANTITY_SCALE,
    recordCount: rows.length,
    uniqueProductCount: codes.size,
    duplicateProductCount,
    quantitySumScaled: quantitySum.toString(),
    negativeQuantityCount,
    digestAlgorithm: "sha256",
    digest: hash.digest("hex"),
    sourceSnapshotMinAt,
    sourceSnapshotMaxAt,
  };
}

function compareManifests(expected, actual) {
  const mismatchedFields = MANIFEST_COMPARISON_FIELDS.filter(
    (field) => String(expected?.[field]) !== String(actual?.[field]),
  );
  return { matches: mismatchedFields.length === 0, mismatchedFields };
}

function buildMismatchExamples(expectedRecords, actualRecords, limit = 20) {
  const expected = new Map(canonicalRows(expectedRecords).map((row) => [row.productCode, row.quantity]));
  const actual = new Map(canonicalRows(actualRecords).map((row) => [row.productCode, row.quantity]));
  const codes = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  const examples = [];
  let mismatchCount = 0;
  for (const productCode of codes) {
    const expectedQty = expected.get(productCode);
    const actualQty = actual.get(productCode);
    if (expectedQty === actualQty) continue;
    mismatchCount += 1;
    if (examples.length < limit) {
      examples.push({
        productCode,
        expectedQtyScaled: expectedQty == null ? null : expectedQty.toString(),
        actualQtyScaled: actualQty == null ? null : actualQty.toString(),
      });
    }
  }
  return { mismatchCount, examples, examplesTruncated: mismatchCount > examples.length };
}

module.exports = {
  BRANCH_STOCK_RECONCILIATION_VERSION,
  MANIFEST_COMPARISON_FIELDS,
  buildBranchStockReconciliationManifest,
  compareManifests,
  buildMismatchExamples,
};
