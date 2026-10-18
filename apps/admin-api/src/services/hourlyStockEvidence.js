"use strict";

const crypto = require("node:crypto");
const { parseSourceRead } = require("./hourlyStockSourceRead");
const { parseDerivedObservation } = require("./hourlyDerivedObservation");

const CONTRACT_VERSION = "hourly-dual-stock-evidence-v1";
const DATASET_TAG = "hourly_dual_stock_evidence";
const ACTIVE_BRANCHES = new Set(["000", "001", "003", "004", "005"]);
const INTRADAY_SLOTS = new Set(Array.from({ length: 11 }, (_, index) => `${String(index + 9).padStart(2, "0")}:00`));
const MAX_RECORDS = 500;
const MAX_BODY_BYTES = 256 * 1024;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function payloadIdentity(payload) {
  const identity = {
    contractVersion: payload.contractVersion,
    datasetTag: payload.datasetTag,
    branchCode: payload.branchCode,
    observationKind: payload.observationKind,
    plannedSlot: payload.plannedSlot,
    capturedAt: payload.capturedAt,
    sourceEventAt: payload.sourceEventAt,
    records: payload.records.map((record) => ({
      productCode: record.productCode,
      retailOnHand: record.retailOnHand,
      latestEstimatedOnHand: record.latestEstimatedOnHand,
    })),
    ...(payload.derivedObservation == null ? {} : { derivedObservation: payload.derivedObservation }),
    ...(payload.observationKind === "morning_anchor"
      ? { authoritativeSyncRunId: String(payload.clientMeta?.authoritativeSyncRunId) } : {}),
  };
  return sha256(canonicalJson(identity));
}

function parseIsoTimestamp(value, fieldName, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== "string" || value.length > 40) throw new Error(`${fieldName} must be an ISO timestamp.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${fieldName} must be a canonical ISO timestamp.`);
  }
  return parsed.toISOString();
}

function finiteNumber(value, fieldName, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e12) {
    throw new Error(`${fieldName} must be a finite bounded number.`);
  }
  return value;
}

function parseClientMeta(value, recordCount, observationKind) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("clientMeta must be an object.");
  const allowed = new Set(["agentVersion", "queryDurationMs", "sqlConnectionAttempts", "sqlConnectionRetryCount", "authoritativeSyncRunId", "sourceRead"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`clientMeta.${key} is not allowed.`);
  }
  const agentVersion = value.agentVersion == null ? null : String(value.agentVersion).trim();
  if (agentVersion != null && (!agentVersion || agentVersion.length > 40)) throw new Error("clientMeta.agentVersion is invalid.");
  const integers = {};
  for (const key of ["queryDurationMs", "sqlConnectionAttempts", "sqlConnectionRetryCount"]) {
    if (value[key] == null) continue;
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 3_600_000) {
      throw new Error(`clientMeta.${key} is invalid.`);
    }
    integers[key] = value[key];
  }
  const authoritativeSyncRunId = value.authoritativeSyncRunId == null ? null : String(value.authoritativeSyncRunId);
  if (authoritativeSyncRunId != null && !/^[1-9][0-9]{0,17}$/.test(authoritativeSyncRunId)) {
    throw new Error("clientMeta.authoritativeSyncRunId is invalid.");
  }
  if (value.sourceRead != null && observationKind !== "intraday") throw new Error("sourceRead is intraday-only.");
  const sourceRead = parseSourceRead(value.sourceRead, recordCount);
  return { ...(agentVersion == null ? {} : { agentVersion }), ...integers,
    ...(sourceRead == null ? {} : { sourceRead }),
    ...(authoritativeSyncRunId == null ? {} : { authoritativeSyncRunId }) };
}

function parseCapturePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Payload must be an object.");
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_BODY_BYTES) throw new Error("Payload exceeds 256 KiB.");
  if (body.contractVersion !== CONTRACT_VERSION || body.datasetTag !== DATASET_TAG) {
    throw new Error("Unsupported hourly evidence contract.");
  }
  const branchCode = String(body.branchCode || "").trim();
  if (!ACTIVE_BRANCHES.has(branchCode)) throw new Error("branchCode is not in the active fleet.");
  const observationKind = String(body.observationKind || "").trim();
  if (!new Set(["morning_anchor", "intraday"]).has(observationKind)) throw new Error("Invalid observationKind.");
  const plannedSlot = String(body.plannedSlot || "").trim();
  if (observationKind === "morning_anchor" ? plannedSlot !== "08:20" : !INTRADAY_SLOTS.has(plannedSlot)) {
    throw new Error("plannedSlot is invalid for observationKind.");
  }
  const capturedAt = parseIsoTimestamp(body.capturedAt, "capturedAt");
  const bangkokDate = new Date(new Date(capturedAt).getTime() + (7 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  const plannedFor = new Date(`${bangkokDate}T${plannedSlot}:00+07:00`).toISOString();
  if (capturedAt < plannedFor) throw new Error("Capture cannot precede its planned slot.");
  if (observationKind === "morning_anchor" && new Date(capturedAt).getTime() >= new Date(plannedFor).getTime() + 40 * 60_000) {
    throw new Error("Morning anchor must be captured before 09:00 Bangkok time.");
  }
  const sourceEventAt = parseIsoTimestamp(body.sourceEventAt, "sourceEventAt", { nullable: true });
  if (sourceEventAt && sourceEventAt > capturedAt) throw new Error("sourceEventAt cannot be after capturedAt.");
  if (!Array.isArray(body.records) || body.records.length < 1 || body.records.length > MAX_RECORDS) {
    throw new Error(`records must contain 1-${MAX_RECORDS} rows.`);
  }
  const seen = new Set();
  const records = body.records.map((record, index) => {
    const productCode = String(record?.productCode || "").trim();
    if (!productCode || productCode.length > 80) throw new Error(`records[${index}].productCode is invalid.`);
    if (seen.has(productCode)) throw new Error(`records[${index}].productCode is duplicated.`);
    seen.add(productCode);
    return {
      productCode,
      retailOnHand: finiteNumber(record.retailOnHand, `records[${index}].retailOnHand`),
      latestEstimatedOnHand: finiteNumber(
        record.latestEstimatedOnHand,
        `records[${index}].latestEstimatedOnHand`,
        { nullable: true },
      ),
    };
  }).sort((left, right) => left.productCode.localeCompare(right.productCode));
  const parsed = {
    contractVersion: CONTRACT_VERSION,
    datasetTag: DATASET_TAG,
    branchCode,
    observationKind,
    plannedSlot,
    capturedAt,
    plannedFor,
    slotDelaySeconds: (new Date(capturedAt).getTime() - new Date(plannedFor).getTime()) / 1000,
    sourceEventAt,
    records,
    clientMeta: parseClientMeta(body.clientMeta, records.length, observationKind),
  };
  if (observationKind === "morning_anchor" && !parsed.clientMeta.authoritativeSyncRunId) {
    throw new Error("Morning anchor requires an authoritative Full Sync receipt.");
  }
  if (body.derivedObservation != null) {
    if (branchCode !== "004" || observationKind !== "intraday") throw new Error("Derived observations are intraday branch 004 only.");
    parsed.derivedObservation = parseDerivedObservation(body.derivedObservation, records, capturedAt);
  }
  parsed.payloadSha256 = payloadIdentity(parsed);
  if (body.idempotencyKey !== parsed.payloadSha256) throw new Error("idempotencyKey does not match payload identity.");
  parsed.idempotencyKey = parsed.payloadSha256;
  return parsed;
}

function sign(value) {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

// Gaps between two stored fields are observations, not a stock error verdict.
function computeSameTimeFieldGaps(rows = []) {
  const result = {
    observedProducts: rows.length, comparedProducts: 0, equalCount: 0, gapCount: 0,
    missingEstimatedValueCount: 0, absoluteGapSum: 0, absoluteGapMean: null, absoluteGapMax: null,
  };
  for (const row of rows) {
    if (row.latestEstimatedOnHand == null) { result.missingEstimatedValueCount++; continue; }
    const gap = Math.abs(row.latestEstimatedOnHand - row.retailOnHand);
    result.comparedProducts++;
    result.absoluteGapSum += gap;
    result.absoluteGapMax = Math.max(result.absoluteGapMax ?? 0, gap);
    if (gap === 0) result.equalCount++;
    else result.gapCount++;
  }
  if (result.comparedProducts) result.absoluteGapMean = result.absoluteGapSum / result.comparedProducts;
  return result;
}

function computeSameFieldChanges(beforeRows, afterRows, field) {
  const before = new Map(beforeRows.map((row) => [row.productCode, row]));
  const after = new Map(afterRows.map((row) => [row.productCode, row]));
  const codes = new Set([...before.keys(), ...after.keys()]);
  const result = {
    comparedProducts: 0, unchangedCount: 0, increasedCount: 0, decreasedCount: 0,
    missingObservationCount: 0, missingValueCount: 0, absoluteChangeSum: 0,
  };
  for (const code of codes) {
    if (!before.has(code) || !after.has(code)) { result.missingObservationCount++; continue; }
    const left = before.get(code)[field];
    const right = after.get(code)[field];
    if (left == null || right == null) { result.missingValueCount++; continue; }
    const change = right - left;
    result.comparedProducts++;
    result.absoluteChangeSum += Math.abs(change);
    if (change === 0) result.unchangedCount++;
    else if (change > 0) result.increasedCount++;
    else result.decreasedCount++;
  }
  return result;
}

function computeStockComparisons({ morningAnchorRows = [], closingRows = [], nextMorningRows = [] }) {
  const maps = [morningAnchorRows, closingRows, nextMorningRows]
    .map((rows) => new Map(rows.map((row) => [row.productCode, row])));
  const codes = new Set(maps.flatMap((map) => [...map.keys()]));
  const forwardMismatchGroups = {
    comparedProducts: 0, mismatchCount: 0, missingObservationCount: 0, missingEstimatedValueCount: 0,
    noClosingFieldGapWithLaterRetailChangeCount: 0,
    persistentFieldGapAcrossThreeObservationsCount: 0,
    otherOrMixedCount: 0, forwardMatchesWithClosingFieldGapCount: 0,
  };
  for (const code of codes) {
    const [morning, closing, next] = maps.map((map) => map.get(code));
    if (!morning || !closing || !next) { forwardMismatchGroups.missingObservationCount++; continue; }
    if (morning.latestEstimatedOnHand == null || closing.latestEstimatedOnHand == null) {
      forwardMismatchGroups.missingEstimatedValueCount++;
      continue;
    }
    forwardMismatchGroups.comparedProducts++;
    if (closing.latestEstimatedOnHand === next.retailOnHand) {
      if (closing.latestEstimatedOnHand !== closing.retailOnHand) {
        forwardMismatchGroups.forwardMatchesWithClosingFieldGapCount++;
      }
      continue;
    }
    forwardMismatchGroups.mismatchCount++;
    if (closing.latestEstimatedOnHand === closing.retailOnHand) {
      forwardMismatchGroups.noClosingFieldGapWithLaterRetailChangeCount++;
    } else if (next.latestEstimatedOnHand != null
        && morning.retailOnHand === closing.retailOnHand && closing.retailOnHand === next.retailOnHand
        && morning.latestEstimatedOnHand === closing.latestEstimatedOnHand
        && closing.latestEstimatedOnHand === next.latestEstimatedOnHand) {
      forwardMismatchGroups.persistentFieldGapAcrossThreeObservationsCount++;
    } else {
      forwardMismatchGroups.otherOrMixedCount++;
    }
  }
  const changes = (before, after) => ({
    retailOnHand: computeSameFieldChanges(before, after, "retailOnHand"),
    latestEstimatedOnHand: computeSameFieldChanges(before, after, "latestEstimatedOnHand"),
  });
  return {
    sameTimeFieldGaps: {
      morning: computeSameTimeFieldGaps(morningAnchorRows),
      closing: computeSameTimeFieldGaps(closingRows),
      nextMorning: computeSameTimeFieldGaps(nextMorningRows),
    },
    sameFieldChanges: {
      morningToClosing: changes(morningAnchorRows, closingRows),
      closingToNextMorning: changes(closingRows, nextMorningRows),
    },
    forwardMismatchGroups,
  };
}

function sourceTimeDiagnostics({ capturedAt, sourceEventAt }) {
  if (sourceEventAt == null) return { status: "unknown", reason: "source-time-missing", sourceAgeSeconds: null };
  const captured = capturedAt == null ? NaN : new Date(capturedAt).getTime();
  const source = new Date(sourceEventAt).getTime();
  if (!Number.isFinite(captured) || !Number.isFinite(source) || source > captured) {
    return { status: "invalid", reason: "invalid-source-time", sourceAgeSeconds: null };
  }
  // source_event_at is optional in v1. Its meaning is not proof that BOTH
  // quantity fields include all movements up to this time. Never substitute
  // SQL read time, product edit time, receipt time or a 300s slot-delay budget.
  return {
    status: "unknown", reason: "source-cutoff-not-verified",
    sourceAgeSeconds: (captured - source) / 1000,
  };
}

function classifySourceFreshness({ slotEvidence, missingPlannedSlots }) {
  const slots = [slotEvidence.morning, ...slotEvidence.intraday, slotEvidence.nextMorning].filter(Boolean);
  const diagnostics = slots.map(sourceTimeDiagnostics);
  const reasons = [];
  if (!slotEvidence.morning || !slotEvidence.nextMorning || missingPlannedSlots.length) reasons.push("missing-slots");
  const missingSourceTimeCount = diagnostics.filter((value) => value.reason === "source-time-missing").length;
  const invalidSourceTimeCount = diagnostics.filter((value) => value.status === "invalid").length;
  const invalidSourceReadCount = slots.filter((slot) => slot.sourceReadDiagnostics?.status === "invalid").length;
  if (missingSourceTimeCount) reasons.push("source-time-missing");
  if (invalidSourceTimeCount) reasons.push("invalid-source-time");
  if (invalidSourceReadCount) reasons.push("invalid-source-read-metadata");
  reasons.push("source-cutoff-not-verified", "source-age-policy-pending");
  const ages = diagnostics.map((value) => value.sourceAgeSeconds).filter((value) => value != null);
  return {
    status: invalidSourceTimeCount || invalidSourceReadCount ? "invalid" : "unknown",
    qualifying: false,
    observedSlotCount: slots.length, missingSourceTimeCount, invalidSourceTimeCount, invalidSourceReadCount,
    minReportedSourceAgeSeconds: ages.length ? Math.min(...ages) : null,
    maxReportedSourceAgeSeconds: ages.length ? Math.max(...ages) : null,
    sourceCutoffVerified: false,
    maxSourceAgeSeconds: null,
    reasons,
  };
}

function computeNextMorningMetrics({ morningAnchorRows = [], closingRows = [], nextMorningRows = [] }) {
  const maps = [morningAnchorRows, closingRows, nextMorningRows].map((rows) => new Map(rows.map((row) => [row.productCode, row])));
  const productCodes = new Set(maps.flatMap((map) => [...map.keys()]));
  const metrics = {
    status: "compared",
    eligibleProducts: 0,
    exactMatchCount: 0,
    directionAgreementCount: 0,
    directionMismatchCount: 0,
    absoluteDriftSum: 0,
    absoluteDriftMean: null,
    absoluteDriftMax: null,
    missingMorningAnchor: 0,
    missingClosing: 0,
    missingNextMorning: 0,
    missingEstimatedValue: 0,
  };
  for (const productCode of productCodes) {
    const morning = maps[0].get(productCode);
    const closing = maps[1].get(productCode);
    const next = maps[2].get(productCode);
    if (!morning) { metrics.missingMorningAnchor++; continue; }
    if (!closing) { metrics.missingClosing++; continue; }
    if (!next) { metrics.missingNextMorning++; continue; }
    if (morning.latestEstimatedOnHand == null || closing.latestEstimatedOnHand == null) {
      metrics.missingEstimatedValue++;
      continue;
    }
    const drift = Math.abs(closing.latestEstimatedOnHand - next.retailOnHand);
    const estimatedMovement = closing.latestEstimatedOnHand - morning.latestEstimatedOnHand;
    const canonicalMovement = next.retailOnHand - morning.retailOnHand;
    metrics.eligibleProducts++;
    metrics.absoluteDriftSum += drift;
    metrics.absoluteDriftMax = metrics.absoluteDriftMax == null ? drift : Math.max(metrics.absoluteDriftMax, drift);
    if (drift === 0) metrics.exactMatchCount++;
    if (sign(estimatedMovement) === sign(canonicalMovement)) metrics.directionAgreementCount++;
    else metrics.directionMismatchCount++;
  }
  metrics.absoluteDriftMean = metrics.eligibleProducts === 0 ? null : metrics.absoluteDriftSum / metrics.eligibleProducts;
  return metrics;
}

function classifyCollectionQuality({ slotEvidence, missingPlannedSlots, metrics, maxSlotDelaySeconds }) {
  const slots = [slotEvidence.morning, ...slotEvidence.intraday, slotEvidence.nextMorning].filter(Boolean);
  const reasons = [];
  if (!slotEvidence.morning || !slotEvidence.nextMorning || missingPlannedSlots.length) reasons.push("missing-slots");
  if (slots.some((slot) => slot.captureCount !== 1)) reasons.push("duplicate-captures");
  if (slots.some((slot) => !Number.isFinite(slot.slotDelaySeconds)
      || !Number.isFinite(slot.ingestionDelaySeconds))) reasons.push("invalid-timing");
  if (slots.some((slot) => slot.slotDelaySeconds < 0)) reasons.push("early-captures");
  // Negative delivery delay means branch/server clocks cannot establish the
  // capture order. Preserve evidence and metrics, but do not qualify it.
  if (slots.some((slot) => slot.ingestionDelaySeconds < 0)) reasons.push("clock-skew");
  const policyReady = Number.isSafeInteger(maxSlotDelaySeconds) && maxSlotDelaySeconds >= 0 && maxSlotDelaySeconds <= 3600;
  if (!policyReady) reasons.push("lateness-policy-pending");
  else if (slots.some((slot) => slot.slotDelaySeconds > maxSlotDelaySeconds)) reasons.push("late-captures");
  if (!metrics || metrics.eligibleProducts === 0 || metrics.missingMorningAnchor || metrics.missingClosing
      || metrics.missingNextMorning || metrics.missingEstimatedValue) reasons.push("incomplete-cohort");
  return { qualifying: reasons.length === 0, reasons, maxSlotDelaySeconds: policyReady ? maxSlotDelaySeconds : null };
}

module.exports = {
  ACTIVE_BRANCHES,
  CONTRACT_VERSION,
  DATASET_TAG,
  MAX_BODY_BYTES,
  MAX_RECORDS,
  canonicalJson,
  computeNextMorningMetrics,
  computeSameTimeFieldGaps,
  computeStockComparisons,
  classifyCollectionQuality,
  classifySourceFreshness,
  parseCapturePayload,
  payloadIdentity,
  sourceTimeDiagnostics,
};
