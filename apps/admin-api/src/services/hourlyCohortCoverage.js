"use strict";
const { createHash } = require("node:crypto");

const HOURLY_COMPLETE_COHORT_MAX_RECORDS = 10_000;
const HOURLY_COMPLETE_COHORT_MAX_BODY_BYTES = 4 * 1024 * 1024;
const HOURLY_COMPLETE_COHORT_MAX_WINDOW_MS = 300_000;
const HOURLY_SOURCE_MAX_BATCH_RECORDS = 500;
const HOURLY_SOURCE_DEFAULT_BATCH_RECORDS = 100;
const VERSION = "hourly-cohort-coverage-v1";
const KEYS = ["schemaVersion", "scope", "expectedProductCount", "missingProductCodes", "cohortSha256", "readBatchSize", "readBatchCount", "observationWindowMs"];
function invalid() { throw Object.assign(new Error("Invalid Hourly cohort coverage."), { code: "HOURLY_COHORT_COVERAGE_INVALID" }); }
function code(value) { return typeof value === "string" && value.length > 0 && value.length <= 80 && value === value.trim(); }
function hourlyCohortHash(codes) {
  return createHash("sha256").update(JSON.stringify([...codes].sort()), "utf8").digest("hex");
}

function parseCohortCoverage(value, records, observationKind) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== KEYS.length || KEYS.some(key => !Object.hasOwn(value, key))) invalid();
  if (value.schemaVersion !== VERSION || !["explicit", "web-all"].includes(value.scope)) invalid();
  const count = value.expectedProductCount;
  if (!Number.isSafeInteger(count) || count < 1 || count > HOURLY_COMPLETE_COHORT_MAX_RECORDS || !Array.isArray(records) || !records.length || records.length > count) invalid();
  if (!Array.isArray(value.missingProductCodes) || value.missingProductCodes.length + records.length !== count || value.missingProductCodes.some(item => !code(item))) invalid();
  const present = records.map(row => row.productCode);
  if (present.some(item => !code(item))) invalid();
  const codes = [...present, ...value.missingProductCodes];
  if (new Set(codes).size !== count || !/^[a-f0-9]{64}$/.test(value.cohortSha256) || hourlyCohortHash(codes) !== value.cohortSha256) invalid();
  if (!Number.isSafeInteger(value.observationWindowMs) || value.observationWindowMs < 0 || value.observationWindowMs > HOURLY_COMPLETE_COHORT_MAX_WINDOW_MS) invalid();
  if (observationKind === "morning_anchor") {
    if (value.readBatchSize !== 0 || value.readBatchCount !== 0 || value.observationWindowMs !== 0) invalid();
  } else if (observationKind === "intraday") {
    if (!Number.isSafeInteger(value.readBatchSize) || value.readBatchSize < 1 || value.readBatchSize > HOURLY_SOURCE_MAX_BATCH_RECORDS
        || value.readBatchCount !== Math.ceil(count / value.readBatchSize)) invalid();
  } else invalid();
  return { ...value, missingProductCodes: [...value.missingProductCodes].sort() };
}

function buildCohortCoverage({ expectedProductCodes, rows, missingProductCodes = [], scope = "explicit", readBatchSize = 0, readBatchCount = 0, observationWindowMs = 0, observationKind }) {
  if (!Array.isArray(expectedProductCodes) || new Set(expectedProductCodes).size !== expectedProductCodes.length || expectedProductCodes.some(item => !code(item))) invalid();
  const value = { schemaVersion: VERSION, scope, expectedProductCount: expectedProductCodes.length, missingProductCodes,
    cohortSha256: hourlyCohortHash(expectedProductCodes), readBatchSize, readBatchCount, observationWindowMs };
  const records = rows.map(row => ({ productCode: row.product_code }));
  return parseCohortCoverage(value, records, observationKind);
}

function cohortCoverageDiagnostics(value, records, observationKind) {
  if (value == null) return null;
  try {
    const parsed = parseCohortCoverage(value, records, observationKind);
    return { status: parsed.missingProductCodes.length ? "incomplete-source" : "complete", scope: parsed.scope,
      expectedProducts: parsed.expectedProductCount, observedProducts: records.length, unavailableProducts: parsed.missingProductCodes.length,
      accountedProducts: records.length + parsed.missingProductCodes.length, readBatchSize: parsed.readBatchSize,
      readBatchCount: parsed.readBatchCount, observationWindowMs: parsed.observationWindowMs, atomicSnapshotVerified: false };
  } catch { return { status: "invalid", qualifying: false, reason: "invalid-cohort-coverage" }; }
}

module.exports = { HOURLY_COMPLETE_COHORT_MAX_RECORDS, HOURLY_COMPLETE_COHORT_MAX_BODY_BYTES, HOURLY_COMPLETE_COHORT_MAX_WINDOW_MS, HOURLY_SOURCE_MAX_BATCH_RECORDS, HOURLY_SOURCE_DEFAULT_BATCH_RECORDS, hourlyCohortHash, parseCohortCoverage, buildCohortCoverage, cohortCoverageDiagnostics };
