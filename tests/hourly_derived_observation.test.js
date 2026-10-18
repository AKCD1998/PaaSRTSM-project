"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { parseDerivedObservation, derivedObservationDiagnostics } = require("../apps/admin-api/src/services/hourlyDerivedObservation");
const { parseCapturePayload, payloadIdentity } = require("../apps/admin-api/src/services/hourlyStockEvidence");
const { persistCapture } = require("../apps/admin-api/src/routes/hourly-stock-evidence");

function derived(overrides = {}) {
  return { schemaVersion: "adapos-ordinary16-derived-v1", estimateBasis: "retail-plus-wholesale-plus-ordinary16",
    sampleCount: 2, consistency: "unverified", qualifying: false, businessCutoffAt: null,
    readStartedAt: "2026-10-17T03:00:00.000Z", readCompletedAt: "2026-10-17T03:00:00.500Z",
    records: [{ productCode: "A", derivedOnHand: 8, reason: "observed-unverified" },
      { productCode: "B", derivedOnHand: null, reason: "changed-between-reads" }], ...overrides };
}
function payload(overrides = {}) {
  const body = { contractVersion: "hourly-dual-stock-evidence-v1", datasetTag: "hourly_dual_stock_evidence",
    branchCode: "004", observationKind: "intraday", plannedSlot: "10:00", capturedAt: "2026-10-17T03:00:01.000Z", sourceEventAt: null,
    records: [{ productCode: "A", retailOnHand: 10, latestEstimatedOnHand: 10 }, { productCode: "B", retailOnHand: 4, latestEstimatedOnHand: null }],
    clientMeta: {}, derivedObservation: derived(), ...overrides };
  body.idempotencyKey = payloadIdentity(body);
  return body;
}

test("derived observation is identity-bound, independent of the canonical pair and legacy metadata", () => {
  const body = payload(), parsed = parseCapturePayload(body);
  assert.equal(parsed.records[0].latestEstimatedOnHand, 10);
  assert.equal(parsed.derivedObservation.records[0].derivedOnHand, 8);
  assert.deepEqual(parsed.clientMeta, {});
  const changed = structuredClone(body); changed.derivedObservation.records[0].derivedOnHand = 7;
  assert.throws(() => parseCapturePayload(changed), /identity/);
  changed.idempotencyKey = payloadIdentity(changed);
  assert.notEqual(parseCapturePayload(changed).idempotencyKey, parsed.idempotencyKey);
  const legacy = payload({ derivedObservation: undefined });
  assert.equal(parseCapturePayload(legacy).derivedObservation, undefined);
  assert.notEqual(legacy.idempotencyKey, parsed.idempotencyKey);
  assert.throws(() => parseCapturePayload(payload({ clientMeta: { derivedObservation: derived() } })), /not allowed/);
});

test("derived contract rejects bad cohorts/windows, unsupported data and false consistency/cutoff claims", () => {
  const body = payload();
  for (const overrides of [{ sampleCount: 1 }, { qualifying: true }, { consistency: "verified" },
    { businessCutoffAt: "2026-10-17T03:00:00.000Z" }, { unknown: "do-not-echo" },
    { readCompletedAt: "2026-10-17T03:00:11.000Z" }, { readStartedAt: "2026-10-17T02:59:00.000Z" },
    { readStartedAt: "bad" }, { records: [] }, { records: [derived().records[0], derived().records[0]] },
    { records: [{ productCode: "A", derivedOnHand: null, reason: "observed-unverified" }, derived().records[1]] },
    { records: [derived().records[0], { productCode: "B", derivedOnHand: 4, reason: "changed-between-reads" }] }]) {
    assert.throws(() => parseCapturePayload(payload({ derivedObservation: derived(overrides) })));
  }
  assert.throws(() => parseCapturePayload(payload({ branchCode: "001" })), /branch 004/);
  assert.throws(() => parseCapturePayload(payload({ observationKind: "morning_anchor", plannedSlot: "08:20",
    capturedAt: "2026-10-17T01:20:01.000Z", clientMeta: { authoritativeSyncRunId: "1" } })), /intraday/);
  const reversed = derived({ records: derived().records.toReversed() });
  assert.deepEqual(parseDerivedObservation(reversed, body.records, body.capturedAt).records, derived().records);
});

test("diagnostics report changed/missing evidence and basis-specific counts without product quantities or freshness PASS", () => {
  const body = payload();
  const diag = derivedObservationDiagnostics(body.derivedObservation, body.records, body.capturedAt);
  assert.equal(diag.status, "changed");
  assert.equal(diag.qualifying, false);
  assert.equal(diag.availableProducts, 1);
  assert.equal(diag.changedProducts, 1);
  assert.deepEqual(diag.comparisonToStoredEstimate, { basis: "derived-versus-stored-estimate", comparedProducts: 1,
    equalCount: 0, gapCount: 1, missingStoredEstimateProducts: 0 });
  for (const key of ["productCode", "derivedOnHand", "retailOnHand"]) assert.equal(JSON.stringify(diag).includes(key), false);
  assert.equal(derivedObservationDiagnostics(null, body.records, body.capturedAt).status, "missing");
  assert.equal(derivedObservationDiagnostics({ bad: "do-not-echo" }, body.records, body.capturedAt).status, "invalid");
  const future = derivedObservationDiagnostics(derived({ readCompletedAt: "2026-10-17T03:00:02.000Z" }), body.records, body.capturedAt);
  assert.equal(future.status, "invalid");
  assert.equal(future.reason, "source-clock-after-capture");
  assert.equal(future.qualifying, false);
});

test("validated derived records persist only in dedicated JSON metadata; primary row parameters retain their meaning", async () => {
  const parsed = parseCapturePayload(payload());
  const calls = [];
  const client = { async query(text, params) {
    calls.push({ text, params });
    return text.includes("RETURNING capture_id") ? { rowCount: 1, rows: [{ capture_id: "1", received_at: parsed.capturedAt }] } : { rows: [] };
  } };
  await persistCapture(client, parsed);
  const metadata = JSON.parse(calls.find(call => call.text.includes("RETURNING capture_id")).params[10]);
  assert.deepEqual(metadata.derivedObservation, parsed.derivedObservation);
  const rowParams = calls.find(call => call.text.includes("UNNEST")).params;
  assert.deepEqual(rowParams.slice(1), [["A", "B"], [10, 4], [10, null]]);
  assert.equal(calls[0].text, "BEGIN");
  assert.equal(calls.at(-1).text, "COMMIT");
});
