"use strict";

const STOCK_VIEW_SHOPEE = "hourly004-shopee";
const PROJECTION_URL = "https://sc-official-website.onrender.com/api/internal/shopee004-stock/projection";
const normalizeUnit = value => String(value || "").normalize("NFKC").trim().toLowerCase();

// Consumer only: no cross-database reservations, stock writer, Sync hook or POS query.
function createShopee004StockDisplay({ config, fetchImpl = globalThis.fetch, now = () => new Date() }) {
  return async function project(display) {
    if (config.featureShopee004StockAvailability !== true) {
      return { ...display, shopeeStock004: { status: "disabled", branchCode: "004", applied: false } };
    }
    let projection = null, failure = "projection-unavailable";
    const codes = display.records.map(r => r.productCode);
    const requestedCodes = new Set(codes);
    try {
      const token = config.shopee004StockProjectionToken;
      if (typeof token !== "string" || token.length < 32 || codes.length > 10000 || requestedCodes.size !== codes.length) throw new Error();
      const response = await fetchImpl(PROJECTION_URL, { method: "POST", redirect: "error", cache: "no-store",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ productCodes: codes }), signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error();
      // Bound both declared and streamed response sizes. Never log its body.
      if (Number(response.headers?.get("content-length") || 0) > 4000000) throw new Error();
      let raw = "", bytes = 0; const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > 4000000) throw new Error();
        raw += decoder.decode(chunk, { stream: true });
      }
      raw += decoder.decode();
      const value = JSON.parse(raw);
      const age = now().getTime() - Date.parse(value.asOf);
      if (value.schemaVersion !== "shopee004-commitments-v1" || value.branchCode !== "004"
        || value.posPostingPolicy !== "not-recorded-in-pos" || value.mode !== "live" || value.status !== "available"
        || value.emailCoverage !== "email-orders-only" || !Number.isFinite(Date.parse(value.cutoverAt))
        || Date.parse(value.cutoverAt) > Date.parse(value.asOf)
        || value.pendingOrders !== 0 || value.reviewOrders !== 0 || !Number.isFinite(age) || age < -5000 || age > 30000
        || !Array.isArray(value.records) || value.records.length !== codes.length
        || new Set(value.records.map(r => r.productCode)).size !== codes.length
        || value.records.some(r => !requestedCodes.has(r.productCode)
          || !Number.isSafeInteger(r.reservedQuantity) || r.reservedQuantity < 0
          || !Number.isSafeInteger(r.shippedUnpostedQuantity) || r.shippedUnpostedQuantity < 0
          || !Number.isSafeInteger(r.reservedQuantity + r.shippedUnpostedQuantity)
          || ((r.reservedQuantity + r.shippedUnpostedQuantity) > 0 && (typeof r.unit !== "string" || !r.unit)))) {
        failure = value.mode === "paused" ? "reservation-paused-holds-retained" : "projection-not-qualified";
        throw new Error();
      }
      projection = value;
    } catch { /* Fail closed for the optional availability view, with no raw upstream errors. */ }
    const commitments = new Map(projection?.records.map(r => [r.productCode,r]) || []);
    let unknownProducts = 0;
    const records = display.records.map(record => {
      const line = commitments.get(record.productCode);
      const demand = line ? line.reservedQuantity + line.shippedUnpostedQuantity : null;
      const reason = !projection ? failure : !Number.isFinite(record.qtyBranch004) ? "pos-stock-unavailable"
        : demand > 0 && normalizeUnit(record.unit) !== normalizeUnit(line.unit) ? "pos-reservation-unit-mismatch" : null;
      if (reason) unknownProducts++;
      const quantity = reason ? null : record.qtyBranch004 - demand;
      return { ...record, posQtyBranch004: record.qtyBranch004, qtyBranch004: quantity,
        qtyTotalAllBranches: reason ? null : record.qtyTotalAllBranches - demand,
        stock004: { ...record.stock004, basis: reason ? "shopee-availability-unknown" : "hourly-and-shopee",
          posBasis: record.stock004?.basis || "full-sync", reason,
          shopee: { reservedQuantity: line?.reservedQuantity ?? null,
            shippedUnpostedQuantity: line?.shippedUnpostedQuantity ?? null, asOf: projection?.asOf || null } } };
    });
    return { ...display, records, shopeeStock004: { status: projection ? (unknownProducts ? "partial" : "available") : failure,
      branchCode: "004", applied: Boolean(projection), asOf: projection?.asOf || null,
      lastEmailIngestedAt: projection?.lastEmailIngestedAt || null, cutoverAt: projection?.cutoverAt || null,
      sourceLabelReviewOrders: Number.isSafeInteger(projection?.sourceLabelReviewOrders) ? projection.sourceLabelReviewOrders : null,
      pageUnknownProducts: unknownProducts, emailCoverage: "email-orders-only", physicalStockWrites: false,
      businessFreshnessQualified: false, atomicSnapshotVerified: false } };
  };
}
module.exports = { createShopee004StockDisplay, STOCK_VIEW_SHOPEE, PROJECTION_URL };
