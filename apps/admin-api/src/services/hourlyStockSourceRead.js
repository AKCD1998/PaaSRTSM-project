"use strict";

const VERSION = "adapos-stored-stock-read-v1";
const COUNTERS = ["productCount", "missingEstimateProducts", "missingPendingProducts", "missingRefreshProducts",
  "invalidRefreshProducts", "nonMasterProducts", "nonzeroDayEndProducts", "nonzeroPendingNowProducts",
  "formulaMatchedProducts", "formulaMismatchProducts", "formulaUnknownProducts"];
const TIMES = ["readAt", "oldestRefreshAt", "newestRefreshAt"];

function parseSourceRead(value, recordCount) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("sourceRead must be an object.");
  const allowed = new Set(["schemaVersion", "estimateBasis", ...COUNTERS, ...TIMES]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("sourceRead has an unsupported field.");
  if (value.schemaVersion !== VERSION || value.estimateBasis !== "stored-master-day-end") {
    throw new Error("sourceRead has an unsupported source contract.");
  }
  const parsed = { schemaVersion: VERSION, estimateBasis: value.estimateBasis };
  for (const key of COUNTERS) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 500) throw new Error("sourceRead has an invalid counter.");
    parsed[key] = value[key];
  }
  const count = parsed.productCount;
  if (!count || count !== recordCount || COUNTERS.some((key) => parsed[key] > count)
      || parsed.formulaMatchedProducts + parsed.formulaMismatchProducts + parsed.formulaUnknownProducts !== count
      || parsed.missingRefreshProducts + parsed.invalidRefreshProducts > count
      || parsed.missingPendingProducts > parsed.formulaUnknownProducts
      || parsed.nonMasterProducts > parsed.formulaUnknownProducts
      || parsed.missingEstimateProducts > parsed.formulaUnknownProducts) {
    throw new Error("sourceRead counters are inconsistent with the capture.");
  }
  for (const key of TIMES) {
    const valueAt = value[key];
    if (valueAt == null && key !== "readAt") { parsed[key] = null; continue; }
    if (typeof valueAt !== "string" || valueAt.length > 40 || !Number.isFinite(new Date(valueAt).getTime())
        || new Date(valueAt).toISOString() !== valueAt) throw new Error("sourceRead has an invalid timestamp.");
    parsed[key] = valueAt;
  }
  const hasValidRefresh = count > parsed.missingRefreshProducts + parsed.invalidRefreshProducts;
  if (hasValidRefresh !== (parsed.oldestRefreshAt != null && parsed.newestRefreshAt != null)
      || (parsed.oldestRefreshAt == null) !== (parsed.newestRefreshAt == null)
      || (hasValidRefresh && (Date.parse(parsed.oldestRefreshAt) > Date.parse(parsed.newestRefreshAt) || Date.parse(parsed.newestRefreshAt) > Date.parse(parsed.readAt)))) {
    throw new Error("sourceRead refresh bounds are inconsistent.");
  }
  return parsed;
}

// Operational refresh time is advisory client metadata, never a verified
// business cutoff. Invalid historical metadata cannot leak free-form fields.
function sourceReadDiagnostics(value, capturedAt) {
  if (value == null) return { status: "unknown", qualifying: false, reason: "source-read-metadata-missing", sourceRead: null };
  let parsed;
  try { parsed = parseSourceRead(value, value.productCount); }
  catch { return { status: "invalid", qualifying: false, reason: "invalid-source-read-metadata", sourceRead: null }; }
  const invalidClock = !Number.isFinite(new Date(capturedAt).getTime()) || Date.parse(parsed.readAt) > Date.parse(capturedAt);
  return {
    status: parsed.invalidRefreshProducts || invalidClock ? "invalid" : "unknown",
    qualifying: false,
    reason: invalidClock ? "source-clock-after-capture" : parsed.invalidRefreshProducts ? "invalid-refresh-time" : "operational-refresh-is-not-business-cutoff",
    timestampScope: "operational-refresh-only",
    businessCutoffAt: null,
    sourceRead: parsed,
  };
}

module.exports = { parseSourceRead, sourceReadDiagnostics };
