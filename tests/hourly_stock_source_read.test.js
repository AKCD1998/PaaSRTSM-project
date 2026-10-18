"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { parseSourceRead, sourceReadDiagnostics } = require("../apps/admin-api/src/services/hourlyStockSourceRead");
const { parseCapturePayload, payloadIdentity, classifySourceFreshness } = require("../apps/admin-api/src/services/hourlyStockEvidence");

function metadata(overrides = {}) {
  return { schemaVersion: "adapos-stored-stock-read-v1", estimateBasis: "stored-master-day-end", productCount: 1,
    missingEstimateProducts: 0, missingPendingProducts: 0, missingRefreshProducts: 0,
    invalidRefreshProducts: 0, nonMasterProducts: 0, nonzeroDayEndProducts: 1, nonzeroPendingNowProducts: 1,
    formulaMatchedProducts: 1, formulaMismatchProducts: 0, formulaUnknownProducts: 0,
    readAt: "2026-10-17T03:00:00.000Z", oldestRefreshAt: "2026-10-17T00:45:00.000Z",
    newestRefreshAt: "2026-10-17T00:45:00.000Z", ...overrides };
}
function payload(sourceRead) {
  const body = { contractVersion: "hourly-dual-stock-evidence-v1", datasetTag: "hourly_dual_stock_evidence",
    branchCode: "004", observationKind: "intraday", plannedSlot: "10:00", capturedAt: "2026-10-17T03:00:01.000Z",
    sourceEventAt: null, records: [{ productCode: "A", retailOnHand: 10, latestEstimatedOnHand: 8 }],
    clientMeta: { sourceRead } };
  body.idempotencyKey = payloadIdentity(body);
  return body;
}

test("optional source-read metadata is accepted without changing evidence identity or quantities", () => {
  const body = payload(metadata());
  const parsed = parseCapturePayload(body);
  assert.equal(parsed.clientMeta.sourceRead.productCount, 1);
  assert.equal(parsed.sourceEventAt, null);
  assert.equal(parsed.records[0].latestEstimatedOnHand, 8);
  const legacy = { ...body, clientMeta: {} };
  assert.equal(payloadIdentity(legacy), payloadIdentity(body));
  assert.deepEqual(parseCapturePayload(legacy).clientMeta, {});
});

test("source-read metadata rejects free-form fields, impossible counters and substituted cutoff claims", () => {
  for (const value of [metadata({ businessCutoffAt: "2026-10-17T03:00:00.000Z" }),
    metadata({ extra: "untrusted" }), metadata({ productCount: 2 }),
    metadata({ formulaMismatchProducts: 1 }), metadata({ missingPendingProducts: 1 }),
    metadata({ oldestRefreshAt: null }), metadata({ readAt: "not-a-date" }),
    metadata({ newestRefreshAt: "2026-10-18T03:00:00.000Z" }),
    metadata({ missingRefreshProducts: 1, invalidRefreshProducts: 1 })]) {
    assert.throws(() => parseSourceRead(value, 1));
  }
  assert.throws(() => parseCapturePayload(payload(metadata({ productCount: 2 }))));
});

test("missing or invalid refresh evidence stays explicit and never qualifies as fresh", () => {
  const noRefresh = metadata({ missingRefreshProducts: 1, oldestRefreshAt: null, newestRefreshAt: null });
  assert.equal(parseSourceRead(noRefresh, 1).missingRefreshProducts, 1);
  const recent = sourceReadDiagnostics(metadata(), "2026-10-17T03:00:01.000Z");
  assert.equal(recent.status, "unknown");
  assert.equal(recent.timestampScope, "operational-refresh-only");
  assert.equal(recent.qualifying, false);
  assert.equal(recent.businessCutoffAt, null);
  const invalid = sourceReadDiagnostics(metadata({ invalidRefreshProducts: 1, oldestRefreshAt: null, newestRefreshAt: null }), "2026-10-17T03:00:01.000Z");
  assert.equal(invalid.status, "invalid");
  assert.equal(sourceReadDiagnostics(metadata(), "2026-10-17T02:00:00.000Z").status, "invalid");
  assert.equal(sourceReadDiagnostics({ unsupported: "untrusted" }, "2026-10-17T03:00:01.000Z").sourceRead, null);
});

test("source-read diagnostics cannot turn complete timely delivery into verified freshness", () => {
  const slot = { capturedAt: "2026-10-17T03:00:01.000Z", sourceEventAt: null,
    sourceReadDiagnostics: sourceReadDiagnostics(metadata(), "2026-10-17T03:00:01.000Z") };
  const result = classifySourceFreshness({ slotEvidence: { morning: slot, intraday: [slot], nextMorning: slot }, missingPlannedSlots: [] });
  assert.equal(result.qualifying, false);
  assert.equal(result.status, "unknown");
  const invalidSlot = { ...slot, sourceReadDiagnostics: { status: "invalid" } };
  const invalid = classifySourceFreshness({ slotEvidence: { morning: slot, intraday: [invalidSlot], nextMorning: slot }, missingPlannedSlots: [] });
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.invalidSourceReadCount, 1);
});

test("new source-read metadata is intraday-only; the existing morning receipt contract stays intact", () => {
  const body = payload(metadata());
  body.observationKind = "morning_anchor";
  body.plannedSlot = "08:20";
  body.capturedAt = "2026-10-17T01:20:01.000Z";
  body.clientMeta.authoritativeSyncRunId = "1";
  body.idempotencyKey = payloadIdentity(body);
  assert.throws(() => parseCapturePayload(body), /intraday-only/);
});
