"use strict";
const { HOURLY_COMPLETE_COHORT_MAX_RECORDS, HOURLY_COMPLETE_COHORT_MAX_WINDOW_MS } = require("./hourlyCohortCoverage");
// Intraday-only supplemental evidence. Never substitutes the canonical pair.

const DERIVED_VERSION = "adapos-ordinary16-derived-v1";
const DERIVED_BASIS = "retail-plus-wholesale-plus-ordinary16";
const REASONS = new Set(["observed-unverified", "changed-between-reads", "invalid-source-component", "non-master-stock-code", "outside-branch-movement"]);
function invalid() { throw new Error("Invalid intraday derived observation."); }
function parseDerivedObservation(value, records, capturedAt, { completeCohort = false } = {}) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const keys = ["schemaVersion", "estimateBasis", "sampleCount", "consistency", "qualifying", "businessCutoffAt", "readStartedAt", "readCompletedAt", "records"];
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
  if (value.schemaVersion !== DERIVED_VERSION || value.estimateBasis !== DERIVED_BASIS || value.sampleCount !== 2
      || value.consistency !== "unverified" || value.qualifying !== false || value.businessCutoffAt !== null) invalid();
  for (const key of ["readStartedAt", "readCompletedAt"]) {
    if (typeof value[key] !== "string" || value[key].length > 40 || !Number.isFinite(Date.parse(value[key]))
        || new Date(value[key]).toISOString() !== value[key]) invalid();
  }
  const duration = Date.parse(value.readCompletedAt) - Date.parse(value.readStartedAt);
  if (duration < 0 || duration > (completeCohort ? HOURLY_COMPLETE_COHORT_MAX_WINDOW_MS : 10_000) || !Number.isFinite(Date.parse(capturedAt))) invalid();
  const expected = new Set(records.map(row => row.productCode));
  if (!Array.isArray(value.records) || !expected.size || expected.size > (completeCohort ? HOURLY_COMPLETE_COHORT_MAX_RECORDS : 500) || value.records.length !== expected.size) invalid();
  const seen = new Set();
  const parsedRows = value.records.map(row => {
    if (!row || typeof row !== "object" || Object.keys(row).length !== 3
        || !Object.hasOwn(row, "productCode") || !Object.hasOwn(row, "derivedOnHand") || !Object.hasOwn(row, "reason")) invalid();
    if (!expected.has(row.productCode) || seen.has(row.productCode) || !REASONS.has(row.reason)) invalid();
    seen.add(row.productCode);
    if (row.reason === "observed-unverified") {
      if (typeof row.derivedOnHand !== "number" || !Number.isFinite(row.derivedOnHand) || Math.abs(row.derivedOnHand) > 1e12) invalid();
    } else if (row.derivedOnHand !== null) invalid();
    return { productCode: row.productCode, derivedOnHand: row.derivedOnHand, reason: row.reason };
  }).sort((a, b) => a.productCode.localeCompare(b.productCode));
  return { ...value, records: parsedRows };
}

function derivedObservationDiagnostics(value, records, capturedAt, options = {}) {
  const base = { estimateBasis: DERIVED_BASIS, consistency: "unverified", qualifying: false, businessCutoffAt: null };
  if (value == null) return { ...base, status: "missing", reason: "derived-observation-missing" };
  let parsed;
  try { parsed = parseDerivedObservation(value, records, capturedAt, options); }
  catch { return { ...base, status: "invalid", reason: "invalid-derived-observation" }; }
  const available = parsed.records.filter(row => row.reason === "observed-unverified");
  const changed = parsed.records.filter(row => row.reason === "changed-between-reads").length;
  const originals = new Map(records.map(row => [row.productCode, row.latestEstimatedOnHand]));
  const compared = available.filter(row => originals.get(row.productCode) != null);
  const equal = compared.filter(row => Math.abs(row.derivedOnHand - originals.get(row.productCode)) <= 1e-6).length;
  const clockAfterCapture = parsed.readCompletedAt > new Date(capturedAt).toISOString();
  return { ...base, status: clockAfterCapture ? "invalid" : changed ? "changed" : available.length === parsed.records.length ? "unverified" : "unavailable",
    reason: clockAfterCapture ? "source-clock-after-capture" : "nolock-views-do-not-prove-consistent-snapshot", sampleCount: 2,
    sourceClockAfterCapture: clockAfterCapture,
    readStartedAt: parsed.readStartedAt, readCompletedAt: parsed.readCompletedAt,
    observedProducts: parsed.records.length, availableProducts: available.length, changedProducts: changed,
    unavailableProducts: parsed.records.length - available.length,
    comparisonToStoredEstimate: { basis: "derived-versus-stored-estimate", comparedProducts: compared.length,
      equalCount: equal, gapCount: compared.length - equal, missingStoredEstimateProducts: available.length - compared.length } };
}


module.exports = { parseDerivedObservation, derivedObservationDiagnostics };
