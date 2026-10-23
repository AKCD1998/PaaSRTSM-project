"use strict";

const STOCK_VIEW_SHOPEE = "hourly004-shopee";
const PROJECTION_URL = "https://sc-official-website.onrender.com/api/internal/shopee004-stock/projection";
const normalizeUnit = value => String(value || "").normalize("NFKC").trim().toLowerCase();
const safeCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 20000 ? value : null;
const safeTime = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

// Consumer only: no cross-database reservations, stock writer, Sync hook or POS query.
function createShopee004StockDisplay({ config, fetchImpl = globalThis.fetch, now = () => new Date() }) {
  return async function project(display) {
    if (config.featureShopee004StockAvailability !== true) {
      return { ...display, shopeeStock004: { status: "disabled", branchCode: "004", applied: false } };
    }
    let projection = null, diagnostic = null, failure = "projection-unavailable";
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
      // Operational status is separate from quantity qualification. A review
      // queue does not mean POS Hourly failed, and no raw upstream text escapes.
      if (value?.schemaVersion === "shopee004-commitments-v1" && value.branchCode === "004"
        && value.posPostingPolicy === "not-recorded-in-pos" && value.emailCoverage === "email-orders-only") {
        diagnostic = { reviewOrders:safeCount(value.reviewOrders),pendingOrders:safeCount(value.pendingOrders),
          asOf:safeTime(value.asOf),lastEmailIngestedAt:safeTime(value.lastEmailIngestedAt) };
      }
      const age = now().getTime() - Date.parse(value.asOf);
      const v2=value.availabilityContract==='per-product-review-v2';
      const scoped = v2 || value.availabilityContract === 'per-product-review-v1';
      const unallocated=v2?safeCount(value.unallocatedOrders):0;
      const scopedReady = scoped && value.scopeValidated === true
        && safeCount(value.pendingOrders) !== null && safeCount(value.reviewOrders) !== null
        && unallocated!==null && unallocated<=value.pendingOrders+value.reviewOrders
        && ['available','partial'].includes(value.status)
        && value.status === (value.pendingOrders || value.reviewOrders || (v2&&value.pageReviewProducts) ? 'partial' : 'available')
        && Array.isArray(value.records)
        && value.records.every(r => ['available','review_required',...(v2?['known-commitments-only']:[])].includes(r.availabilityStatus)
          && (r.availabilityStatus==='review_required'||r.availabilityStatus===(unallocated?'known-commitments-only':'available')))
        && value.pageReviewProducts === value.records.filter(r => r.availabilityStatus === 'review_required').length
        && (value.status !== 'available' || value.pageReviewProducts === 0);
      const legacyReady = !scoped && value.availabilityContract == null && value.status === 'available'
        && value.pendingOrders === 0 && value.reviewOrders === 0;
      if (value.schemaVersion !== "shopee004-commitments-v1" || value.branchCode !== "004"
        || value.posPostingPolicy !== "not-recorded-in-pos" || value.mode !== "live" || !(scopedReady || legacyReady)
        || value.emailCoverage !== "email-orders-only" || !Number.isFinite(Date.parse(value.cutoverAt))
        || Date.parse(value.cutoverAt) > Date.parse(value.asOf)
        || !Number.isFinite(age) || age < -5000 || age > 30000
        || !Array.isArray(value.records) || value.records.length !== codes.length
        || new Set(value.records.map(r => r.productCode)).size !== codes.length
        || value.records.some(r => !requestedCodes.has(r.productCode)
          || (!(v2&&r.availabilityStatus==='review_required'&&r.reservedQuantity===null&&r.shippedUnpostedQuantity===null&&r.unit===null)
          && (!Number.isSafeInteger(r.reservedQuantity) || r.reservedQuantity < 0
          || !Number.isSafeInteger(r.shippedUnpostedQuantity) || r.shippedUnpostedQuantity < 0
          || !Number.isSafeInteger(r.reservedQuantity + r.shippedUnpostedQuantity)
          || ((r.reservedQuantity + r.shippedUnpostedQuantity) > 0 && (typeof r.unit !== "string" || !r.unit)))))) {
        failure = value.mode === "paused" ? "reservation-paused-holds-retained"
          : diagnostic?.reviewOrders > 0 ? "shopee-orders-need-review"
            : diagnostic?.pendingOrders > 0 ? "shopee-orders-processing" : "projection-not-qualified";
        throw new Error();
      }
      projection = value;
    } catch (error) {
      if (["TimeoutError","AbortError"].includes(error?.name)) failure = "projection-timeout";
      // Fail closed for quantities, with only a bounded operational diagnosis.
    }
    const commitments = new Map(projection?.records.map(r => [r.productCode,r]) || []);
    let unknownProducts = 0,estimatedProducts=0;
    const records = display.records.map(record => {
      const line = commitments.get(record.productCode);
      const demand = line ? line.reservedQuantity + line.shippedUnpostedQuantity : null;
      const reason = !projection ? failure : line?.availabilityStatus === 'review_required' ? 'shopee-product-needs-review'
        : !Number.isFinite(record.qtyBranch004) ? "pos-stock-unavailable"
        : demand > 0 && normalizeUnit(record.unit) !== normalizeUnit(line.unit) ? "pos-reservation-unit-mismatch" : null;
      if (reason) unknownProducts++;
      const estimated=!reason&&line?.availabilityStatus==='known-commitments-only';if(estimated)estimatedProducts++;
      const quantity = reason ? null : record.qtyBranch004 - demand;
      return { ...record, posQtyBranch004: record.qtyBranch004, qtyBranch004: quantity,
        qtyTotalAllBranches: reason ? null : record.qtyTotalAllBranches - demand,
        stock004: { ...record.stock004, basis: reason ? "shopee-availability-unknown" : estimated?'hourly-and-shopee-known-only':"hourly-and-shopee",
          posBasis: record.stock004?.basis || "full-sync", reason,
          shopee: { reservedQuantity: line?.reservedQuantity ?? null,
            shippedUnpostedQuantity: line?.shippedUnpostedQuantity ?? null, asOf: projection?.asOf || null,
            allOrdersAllocated:projection?!(projection.unallocatedOrders>0):false,unallocatedOrders:projection?.unallocatedOrders??null } } };
    });
    return { ...display, records, shopeeStock004: { status: projection ? (projection.unallocatedOrders>0?'partial-known-commitments':unknownProducts || projection.status === 'partial' ? "partial" : "available") : failure,
      branchCode: "004", applied: Boolean(projection), asOf: projection?.asOf || diagnostic?.asOf || null,
      lastEmailIngestedAt: projection?.lastEmailIngestedAt || diagnostic?.lastEmailIngestedAt || null, cutoverAt: projection?.cutoverAt || null,
      reviewOrders:diagnostic?.reviewOrders ?? null,pendingOrders:diagnostic?.pendingOrders ?? null,
      unallocatedOrders:projection?.unallocatedOrders??null,pageEstimatedProducts:estimatedProducts,
      sourceLabelReviewOrders: Number.isSafeInteger(projection?.sourceLabelReviewOrders) ? projection.sourceLabelReviewOrders : null,
      pageUnknownProducts: unknownProducts, emailCoverage: "email-orders-only", physicalStockWrites: false,
      businessFreshnessQualified: false, atomicSnapshotVerified: false } };
  };
}
module.exports = { createShopee004StockDisplay, STOCK_VIEW_SHOPEE, PROJECTION_URL };
