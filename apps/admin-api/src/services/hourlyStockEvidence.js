"use strict";

const crypto = require("node:crypto");

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

function parseClientMeta(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("clientMeta must be an object.");
  const allowed = new Set(["agentVersion", "queryDurationMs", "sqlConnectionAttempts", "sqlConnectionRetryCount", "authoritativeSyncRunId"]);
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
  return { ...(agentVersion == null ? {} : { agentVersion }), ...integers,
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
    clientMeta: parseClientMeta(body.clientMeta),
  };
  if (observationKind === "morning_anchor" && !parsed.clientMeta.authoritativeSyncRunId) {
    throw new Error("Morning anchor requires an authoritative Full Sync receipt.");
  }
  parsed.payloadSha256 = payloadIdentity(parsed);
  if (body.idempotencyKey !== parsed.payloadSha256) throw new Error("idempotencyKey does not match payload identity.");
  parsed.idempotencyKey = parsed.payloadSha256;
  return parsed;
}

function sign(value) {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
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
  classifyCollectionQuality,
  parseCapturePayload,
  payloadIdentity,
};
