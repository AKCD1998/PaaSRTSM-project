"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const request = require("supertest");
const {
  computeNextMorningMetrics, computeSameTimeFieldGaps, computeStockComparisons,
  classifySourceFreshness, sourceTimeDiagnostics,
} = require("../apps/admin-api/src/services/hourlyStockEvidence");
const { createHourlyStockEvidenceRouter } = require("../apps/admin-api/src/routes/hourly-stock-evidence");

const row = (productCode, retailOnHand, latestEstimatedOnHand) => ({ productCode, retailOnHand, latestEstimatedOnHand });
function observations() {
  return {
    morningAnchorRows: [row("a", 20, 20), row("b", 10, 8), row("c", 7, 7), row("d", 10, 10)],
    closingRows: [row("a", 20, 20), row("b", 10, 8), row("c", 7, 4), row("d", 10, 8)],
    nextMorningRows: [row("a", 18, 18), row("b", 10, 8), row("c", 5, 2), row("d", 8, 8)],
  };
}

test("report separates persistent gaps, later changes and mixed observations without assigning a cause", () => {
  const compared = computeStockComparisons(observations());
  assert.deepEqual(compared.forwardMismatchGroups, {
    comparedProducts: 4, mismatchCount: 3, missingObservationCount: 0, missingEstimatedValueCount: 0,
    noClosingFieldGapWithLaterRetailChangeCount: 1,
    persistentFieldGapAcrossThreeObservationsCount: 1,
    otherOrMixedCount: 1, forwardMatchesWithClosingFieldGapCount: 1,
  });
  assert.equal(compared.sameTimeFieldGaps.closing.gapCount, 3);
  assert.equal(compared.sameTimeFieldGaps.nextMorning.gapCount, 2);
  const overnight = compared.sameFieldChanges.closingToNextMorning;
  assert.equal(overnight.retailOnHand.decreasedCount, 3);
  assert.equal(overnight.latestEstimatedOnHand.decreasedCount, 2);
  const legacy = computeNextMorningMetrics(observations());
  assert.equal(legacy.eligibleProducts, 4);
  assert.equal(legacy.exactMatchCount, 1);
  assert.equal(legacy.absoluteDriftSum, 5);
  assert.equal("passed" in legacy, false);
  assert.equal(JSON.stringify(compared).includes('"productCode"'), false);
});

test("a gap that appears only at closing is not labeled persistent across the three observations", () => {
  const compared = computeStockComparisons({
    morningAnchorRows: [row("example", 10, 10)],
    closingRows: [row("example", 10, 8)],
    nextMorningRows: [row("example", 10, 8)],
  });
  assert.equal(compared.forwardMismatchGroups.persistentFieldGapAcrossThreeObservationsCount, 0);
  assert.equal(compared.forwardMismatchGroups.otherOrMixedCount, 1);
});

test("same-field changes preserve negative balances and signed movement; nulls are not zero", () => {
  const compared = computeStockComparisons({
    morningAnchorRows: [row("a", -3, null), row("b", 4, -1), row("missing", 1, 1)],
    closingRows: [row("a", -2, null), row("b", 2, -4)],
    nextMorningRows: [],
  });
  assert.equal(compared.sameFieldChanges.morningToClosing.retailOnHand.increasedCount, 1);
  assert.equal(compared.sameFieldChanges.morningToClosing.retailOnHand.decreasedCount, 1);
  assert.equal(compared.sameFieldChanges.morningToClosing.retailOnHand.missingObservationCount, 1);
  assert.equal(compared.sameFieldChanges.morningToClosing.latestEstimatedOnHand.missingValueCount, 1);
  assert.equal(compared.forwardMismatchGroups.missingObservationCount, 3);
  assert.deepEqual(computeSameTimeFieldGaps([]), {
    observedProducts: 0, comparedProducts: 0, equalCount: 0, gapCount: 0,
    missingEstimatedValueCount: 0, absoluteGapSum: 0, absoluteGapMean: null, absoluteGapMax: null,
  });
});

function sourceEvidence(sourceEventAt) {
  const slot = { capturedAt: "2026-10-17T02:00:01.000Z", sourceEventAt };
  return { slotEvidence: { morning: slot, intraday: Array.from({ length: 11 }, () => slot), nextMorning: slot },
    missingPlannedSlots: [] };
}

test("complete timely captures with no source business cutoff remain freshness unknown", () => {
  const quality = classifySourceFreshness(sourceEvidence(null));
  assert.equal(quality.status, "unknown");
  assert.equal(quality.qualifying, false);
  assert.equal(quality.observedSlotCount, 13);
  assert.equal(quality.missingSourceTimeCount, 13);
  assert.equal(quality.maxReportedSourceAgeSeconds, null);
  assert.ok(quality.reasons.includes("source-time-missing"));
});

test("a recent client timestamp or arbitrary old timestamp cannot certify both source fields", () => {
  for (const stamp of ["2026-10-17T02:00:00.000Z", "2026-10-15T02:00:00.000Z"]) {
    const quality = classifySourceFreshness(sourceEvidence(stamp));
    assert.equal(quality.status, "unknown");
    assert.equal(quality.qualifying, false);
    assert.equal(quality.missingSourceTimeCount, 0);
    assert.equal(quality.sourceCutoffVerified, false);
    assert.equal(quality.maxSourceAgeSeconds, null);
    assert.ok(quality.reasons.includes("source-cutoff-not-verified"));
    assert.ok(quality.reasons.includes("source-age-policy-pending"));
  }
  assert.equal(sourceTimeDiagnostics({ capturedAt: "2026-10-17T02:00:01Z", sourceEventAt: "2026-10-17T02:00:00Z" }).sourceAgeSeconds, 1);
});

test("future or malformed source time is invalid; missing captures stay distinct from freshness", () => {
  for (const stamp of ["2026-10-17T02:00:02.000Z", "not-a-date"]) {
    const quality = classifySourceFreshness(sourceEvidence(stamp));
    assert.equal(quality.status, "invalid");
    assert.equal(quality.invalidSourceTimeCount, 13);
    assert.equal(quality.qualifying, false);
  }
  const empty = classifySourceFreshness({ slotEvidence: { morning: null, intraday: [], nextMorning: null },
    missingPlannedSlots: ["09:00"] });
  assert.equal(empty.status, "unknown");
  assert.equal(empty.observedSlotCount, 0);
  assert.ok(empty.reasons.includes("missing-slots"));
  assert.equal(sourceTimeDiagnostics({ capturedAt: null, sourceEventAt: "2026-10-17T02:00:00Z" }).status, "invalid");
});

function summaryRows() {
  const values = observations();
  const at = (role, plannedSlot, date, rows) => rows.map((value) => {
    const planned = new Date(date + "T" + plannedSlot + ":00+07:00").toISOString();
    return {
      capture_role: role, planned_slot: plannedSlot, planned_for: planned,
      captured_at: new Date(Date.parse(planned) + 1000).toISOString(),
      received_at: new Date(Date.parse(planned) + 2000).toISOString(),
      source_event_at: null, capture_count: 1, product_code: value.productCode,
      retail_on_hand: value.retailOnHand, latest_estimated_on_hand: value.latestEstimatedOnHand,
    };
  });
  return [
    ...at("morning", "08:20", "2026-10-17", values.morningAnchorRows),
    ...at("next_morning", "08:20", "2026-10-18", values.nextMorningRows),
    ...Array.from({ length: 11 }, (_, index) => at("intraday", String(index + 9).padStart(2, "0") + ":00",
      "2026-10-17", values.closingRows)).flat(),
  ];
}

function appFor(rows, { denied = false } = {}) {
  const db = {
    async query(sql, params) {
      assert.match(sql, /captures\.source_event_at/);
      assert.match(sql, /PARTITION BY captures\.capture_id/);
      assert.match(sql, /client_meta - 'derivedObservation'/);
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
      assert.deepEqual(params, ["004", "2026-10-17"]);
      return { rows };
    },
    async connect() { throw new Error("Summary must not acquire a write transaction"); },
  };
  const app = express();
  app.use("/evidence", createHourlyStockEvidenceRouter({
    config: { featureHourlyStockEvidence: false, featureHourlyStockEvidenceRetention: false,
      hourlyStockEvidenceMaxSlotDelaySeconds: 300 },
    db,
    requireAuthMiddleware: (_req, res, next) => denied ? res.sendStatus(401) : next(),
    requireRoleMiddleware: (role) => { assert.equal(role, "admin"); return (_req, _res, next) => next(); },
  }));
  return app;
}

test("summary is inspectable while receiver OFF and separates collection PASS from unknown freshness", async () => {
  const response = await request(appFor(summaryRows())).get("/evidence/summary?branchCode=004&date=2026-10-17");
  assert.equal(response.status, 200);
  const body = response.body;
  assert.equal(body.collectionQuality.qualifying, true);
  assert.equal(body.collectionQuality.scope, "capture-and-delivery-only");
  assert.equal(body.sourceFreshness.qualifying, false);
  assert.equal(body.sourceFreshness.missingSourceTimeCount, 13);
  assert.equal(body.stockAccuracyAssessment.status, "not-assessed");
  assert.equal(body.comparisonSemantics.basis, "cross-field-cross-time");
  assert.equal(body.comparisonSemantics.stockAccuracyEstablished, false);
  assert.equal(body.metrics.exactMatchCount, 1);
  assert.equal(body.stockComparisons.forwardMismatchGroups.mismatchCount, 3);
  assert.equal(body.slotEvidence.intraday.length, 11);
  assert.equal(body.slotEvidence.intraday[0].plannedSlot, "09:00");
  assert.equal(body.slotEvidence.intraday[10].sameTimeFieldGaps.gapCount, 3);
  assert.equal(JSON.stringify(body).includes('"productCode"'), false);
});

test("summary projects supplemental derived basis once per capture; legacy and morning comparisons stay unchanged", async () => {
  const rows = summaryRows();
  const selected = rows.filter(row => row.capture_role === "intraday" && row.planned_slot === "09:00");
  // The SQL projection returns the product array once, not once per product.
  selected[0].client_meta = { derivedObservation: {
    schemaVersion: "adapos-ordinary16-derived-v1", estimateBasis: "retail-plus-wholesale-plus-ordinary16", sampleCount: 2,
    consistency: "unverified", qualifying: false, businessCutoffAt: null, readStartedAt: selected[0].planned_for,
    readCompletedAt: selected[0].planned_for,
    records: selected.map((row, i) => ({ productCode: row.product_code, derivedOnHand: i ? null : 19,
      reason: i ? "changed-between-reads" : "observed-unverified" })),
  } };
  let response = await request(appFor(rows)).get("/evidence/summary?branchCode=004&date=2026-10-17");
  assert.equal(response.status, 200);
  const diag = response.body.slotEvidence.intraday[0].derivedObservationDiagnostics;
  assert.equal(diag.status, "changed");
  assert.equal(diag.availableProducts, 1);
  assert.equal(diag.changedProducts, 3);
  assert.equal(diag.qualifying, false);
  assert.equal(response.body.slotEvidence.intraday[1].derivedObservationDiagnostics.status, "missing");
  assert.equal(response.body.metrics.exactMatchCount, 1);
  assert.equal(response.body.sourceFreshness.qualifying, false);
  assert.equal(JSON.stringify(response.body).includes('"productCode"'), false);
  assert.equal(JSON.stringify(response.body).includes('"derivedOnHand"'), false);
  selected[0].client_meta.derivedObservation.secret = "must-not-echo";
  response = await request(appFor(rows)).get("/evidence/summary?branchCode=004&date=2026-10-17");
  assert.equal(response.body.slotEvidence.intraday[0].derivedObservationDiagnostics.status, "invalid");
  assert.equal(JSON.stringify(response.body).includes("must-not-echo"), false);
});

test("summary source timestamps survive query projection without being treated as verified provenance", async () => {
  const rows = summaryRows().map((value) => ({ ...value,
    source_event_at: new Date(Date.parse(value.captured_at) - 2000) }));
  const response = await request(appFor(rows)).get("/evidence/summary?branchCode=004&date=2026-10-17");
  assert.equal(response.status, 200);
  assert.equal(response.body.sourceFreshness.maxReportedSourceAgeSeconds, 2);
  assert.equal(response.body.sourceFreshness.qualifying, false);
  assert.equal(response.body.slotEvidence.morning.sourceTime.sourceAgeSeconds, 2);
  assert.equal(typeof response.body.slotEvidence.morning.sourceEventAt, "string");
});

test("summary keeps admin authentication and incomplete/null/duplicate collection evidence separate", async () => {
  assert.equal((await request(appFor(summaryRows(), { denied: true }))
    .get("/evidence/summary?branchCode=004&date=2026-10-17")).status, 401);
  const rows = summaryRows().filter((value) => value.planned_slot !== "10:00");
  rows.find((value) => value.capture_role === "intraday").latest_estimated_on_hand = null;
  rows.find((value) => value.capture_role === "morning").capture_count = 2;
  const response = await request(appFor(rows)).get("/evidence/summary?branchCode=004&date=2026-10-17");
  assert.equal(response.status, 200);
  assert.equal(response.body.collectionQuality.qualifying, false);
  assert.ok(response.body.collectionQuality.reasons.includes("duplicate-captures"));
  assert.ok(response.body.collectionQuality.reasons.includes("incomplete-cohort"));
  assert.deepEqual(response.body.missingPlannedSlots, ["10:00"]);
  assert.ok(response.body.sourceFreshness.reasons.includes("missing-slots"));
});

test("summary projects source-read metadata while receiver OFF and withholds unsupported historical fields", async () => {
  const rows = summaryRows();
  const count = rows.filter((row) => row.capture_role === "intraday" && row.planned_slot === "09:00").length;
  for (const row of rows.filter((row) => row.capture_role === "intraday" && row.planned_slot === "09:00")) {
    row.client_meta = { sourceRead: { schemaVersion: "adapos-stored-stock-read-v1", estimateBasis: "stored-master-day-end",
      productCount: count, missingEstimateProducts: 0, missingPendingProducts: 0, missingRefreshProducts: count,
      invalidRefreshProducts: 0, nonMasterProducts: 0, nonzeroDayEndProducts: 0, nonzeroPendingNowProducts: 0,
      formulaMatchedProducts: count, formulaMismatchProducts: 0, formulaUnknownProducts: 0,
      readAt: row.planned_for, oldestRefreshAt: null, newestRefreshAt: null } };
  }
  let response = await request(appFor(rows)).get("/evidence/summary?branchCode=004&date=2026-10-17");
  assert.equal(response.status, 200);
  assert.equal(response.body.slotEvidence.intraday[0].sourceReadDiagnostics.sourceRead.productCount, count);
  assert.equal(response.body.sourceFreshness.qualifying, false);
  assert.equal(response.body.collectionQuality.qualifying, true);
  rows.find((row) => row.capture_role === "intraday" && row.planned_slot === "09:00").client_meta.sourceRead.untrusted = "withhold-me";
  response = await request(appFor(rows)).get("/evidence/summary?branchCode=004&date=2026-10-17");
  assert.equal(response.body.slotEvidence.intraday[0].sourceReadDiagnostics.status, "invalid");
  assert.equal(JSON.stringify(response.body).includes("withhold-me"), false);
});
