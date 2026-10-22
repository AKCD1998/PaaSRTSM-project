"use strict";

const { parseCohortCoverage } = require("./hourlyCohortCoverage");
const { parseDerivedObservation } = require("./hourlyDerivedObservation");

const EXPECTED_PRODUCTS = 6835;
const STOCK_VIEW = "hourly004";
function iso(value) {
  const ms = value == null ? NaN : new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function bangkokDay(now) {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Read projection only. Never updates the canonical Full Sync quantities or Delta.
// The cache is private to this router and only holds a fully validated capture.
function createHourly004StockDisplay({ db, config, now = () => new Date() }) {
  let cached = null;
  let loading = null;
  async function loadCapture(header) {
    if (cached?.id === header.capture_id) return cached;
    if (loading?.id === header.capture_id) return loading.promise;
    const promise = (async () => {
      const [metaResult, rowsResult] = await Promise.all([
        db.query(`SELECT client_meta->'cohortCoverage' AS coverage,
          client_meta->'derivedObservation' AS derived
          FROM evidence.hourly_stock_capture_runs WHERE capture_id = $1`, [header.capture_id]),
        db.query(`SELECT product_code FROM evidence.hourly_stock_capture_rows
          WHERE capture_id = $1 ORDER BY product_code`, [header.capture_id]),
      ]);
      const records = rowsResult.rows.map(row => ({ productCode: row.product_code }));
      const meta = metaResult.rows[0];
      if (Number(header.record_count) !== EXPECTED_PRODUCTS || records.length !== EXPECTED_PRODUCTS || !meta) throw new Error("Invalid capture");
      const coverage = parseCohortCoverage(meta.coverage, records, "intraday");
      const derived = parseDerivedObservation(meta.derived, records, header.captured_at, { completeCohort: true });
      const capturedAt = iso(header.captured_at);
      if (!coverage || coverage.expectedProductCount !== EXPECTED_PRODUCTS || coverage.missingProductCodes.length
          || !derived || !capturedAt || derived.readCompletedAt > capturedAt) throw new Error("Invalid capture");
      const result = { id: header.capture_id, capturedAt, plannedSlot: header.planned_slot,
        readStartedAt: derived.readStartedAt, readCompletedAt: derived.readCompletedAt,
        quantities: new Map(derived.records.map(row => [row.productCode, row])),
        availableProducts: derived.records.filter(row => row.derivedOnHand !== null).length };
      cached = result;
      return result;
    })();
    loading = { id: header.capture_id, promise };
    try { return await promise; }
    finally { if (loading?.promise === promise) loading = null; }
  }

  return async function project(records, sourceRows) {
    const time = now();
    const day = bangkokDay(time);
    let capture = null;
    let status = "disabled";
    if (config.featureHourlyStockEvidence === true && config.featureHourlyStockEvidenceCompleteCohort === true) {
      try {
        // Both capture and slot must belong to today. This is a day-boundary rule,
        // not a business freshness threshold; the UI exposes the actual times.
        const result = await db.query(`SELECT capture_id, record_count, captured_at, planned_slot
          FROM evidence.hourly_stock_capture_runs
          WHERE branch_code = '004' AND observation_kind = 'intraday'
            AND captured_at >= $1::timestamptz AND captured_at <= $2::timestamptz
            AND planned_for >= $1::timestamptz AND planned_for <= $2::timestamptz
          ORDER BY planned_for DESC, captured_at DESC, received_at DESC, capture_id DESC LIMIT 1`,
        [`${day}T00:00:00+07:00`, time.toISOString()]);
        if (!result.rows.length) status = "no-today-capture";
        else {
          try { capture = await loadCapture(result.rows[0]); status = "available"; }
          catch { cached = null; status = "invalid-capture"; }
        }
      } catch { status = "unavailable"; }
    } else cached = null;

    const fallbackReasons = {};
    let hourlyProducts = 0;
    const sources = new Map(sourceRows.map(row => [row.product_code, row]));
    const projected = records.map(record => {
      const base = record.qtyBranch004;
      const fullSyncAt = iso(sources.get(record.productCode)?.full_sync_at_004);
      const item = capture?.quantities.get(record.productCode);
      let reason = status;
      if (capture) {
        reason = !item ? "not-in-cohort" : item.derivedOnHand === null ? item.reason
          : !fullSyncAt ? "full-sync-time-unknown"
          : fullSyncAt > capture.readStartedAt ? "full-sync-newer" : null;
      }
      if (reason) fallbackReasons[reason] = (fallbackReasons[reason] || 0) + 1;
      else hourlyProducts += 1;
      const quantity = reason ? base : item.derivedOnHand;
      return { ...record, qtyBranch004: quantity,
        qtyTotalAllBranches: record.qtyTotalAllBranches + quantity - base,
        fullSyncQtyBranch004: base,
        stock004: { basis: reason ? "full-sync" : "hourly-calculated", reason,
          capturedAt: capture?.capturedAt || null, plannedSlot: capture?.plannedSlot || null,
          fullSyncAt } };
    });
    return { records: projected, hourlyStock004: { branchCode: "004", status,
      expectedProducts: EXPECTED_PRODUCTS, availableProducts: capture?.availableProducts || 0,
      suppressedProducts: capture ? EXPECTED_PRODUCTS - capture.availableProducts : 0,
      capturedAt: capture?.capturedAt || null, plannedSlot: capture?.plannedSlot || null,
      readStartedAt: capture?.readStartedAt || null, readCompletedAt: capture?.readCompletedAt || null,
      pageHourlyProducts: hourlyProducts, pageFallbackProducts: records.length - hourlyProducts,
      fallbackReasons, consistency: "unverified", atomicSnapshotVerified: false,
      businessFreshnessQualified: false } };
  };
}

module.exports = { createHourly004StockDisplay, STOCK_VIEW, EXPECTED_PRODUCTS };
