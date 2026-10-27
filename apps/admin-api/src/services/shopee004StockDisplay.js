"use strict";

const STOCK_VIEW_SHOPEE = "hourly004-shopee";
const {createProjectionReader,createConfirmedReferenceCache,PROJECTION_REQUEST_BUDGET_MS}=require('./shopee004ProjectionRecovery');
const PROJECTION_URL = "https://sc-official-website.onrender.com/api/internal/shopee004-stock/projection";
const normalizeUnit = value => String(value || "").normalize("NFKC").trim().toLowerCase();
const safeCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 20000 ? value : null;
const safeTime = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

// Consumer only: no cross-database reservations, stock writer, Sync hook or POS query.
function createShopee004StockDisplay({ config, fetchImpl = globalThis.fetch, now = () => new Date(), projectionReader, referenceCache } = {}) {
  const read=projectionReader||createProjectionReader({fetchImpl});
  const references=referenceCache||createConfirmedReferenceCache({now});
  let previousToken=null;
  return async function project(display) {
    if (config.featureShopee004StockAvailability !== true) {
      references.clear();
      return { ...display, shopeeStock004: { status: "disabled", branchCode: "004", applied: false } };
    }
    let projection = null, diagnostic = null, failure = "projection-unavailable",temporaryFailure=false,readAttempts=0;
    const codes = display.records.map(r => r.productCode);
    const requestedCodes = new Set(codes);
    try {
      const token = config.shopee004StockProjectionToken;
      if(previousToken&&previousToken!==token)references.clear();previousToken=token;
      if (typeof token !== "string" || token.length < 32 || codes.length > 10000 || requestedCodes.size !== codes.length) throw new Error();
      const requestStartedAt=now().getTime();
      const loaded=await read(PROJECTION_URL,codes,token);const value=loaded.value;readAttempts=loaded.attempts;
      const receivedAt=now().getTime(),readDuration=receivedAt-requestStartedAt;
      // Operational status is separate from quantity qualification. A review
      // queue does not mean POS Hourly failed, and no raw upstream text escapes.
      if (value?.schemaVersion === "shopee004-commitments-v1" && value.branchCode === "004"
        && value.posPostingPolicy === "not-recorded-in-pos" && value.emailCoverage === "email-orders-only") {
        diagnostic = { reviewOrders:safeCount(value.reviewOrders),pendingOrders:safeCount(value.pendingOrders),
          asOf:safeTime(value.asOf),lastEmailIngestedAt:safeTime(value.lastEmailIngestedAt) };
      }
      const age = receivedAt - Date.parse(value.asOf);
      // Preserve the 30-second pre-request age allowance. A snapshot created
      // during this bounded read must not expire just because transport is slow.
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
        || !Number.isFinite(readDuration) || readDuration < 0 || readDuration > PROJECTION_REQUEST_BUDGET_MS
        || !Number.isFinite(age) || age < -5000 || age > 30000 + readDuration
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
      references.observeCutover(value.cutoverAt);
    } catch (error) {
      if (["TimeoutError","AbortError"].includes(error?.name)||error?.code==='PROJECTION_TIMEOUT') failure = "projection-timeout";
      temporaryFailure=error?.temporary===true;
      // Fail closed for quantities, with only a bounded operational diagnosis.
    }
    const commitments = new Map(projection?.records.map(r => [r.productCode,r]) || []);
    let unknownProducts = 0,estimatedProducts=0,referenceProducts=0;
    const records = display.records.map(record => {
      const line = commitments.get(record.productCode);
      const demand = line ? line.reservedQuantity + line.shippedUnpostedQuantity : null;
      const reason = !projection ? failure : line?.availabilityStatus === 'review_required' ? 'shopee-product-needs-review'
        : !Number.isFinite(record.qtyBranch004) ? "pos-stock-unavailable"
        : demand > 0 && normalizeUnit(record.unit) !== normalizeUnit(line.unit) ? "pos-reservation-unit-mismatch" : null;
      if (reason) unknownProducts++;
      const estimated=!reason&&line?.availabilityStatus==='known-commitments-only';if(estimated)estimatedProducts++;
      const quantity = reason ? null : record.qtyBranch004 - demand;
      const lastConfirmed=reason&&temporaryFailure?references.get(record,failure):null;
      if(lastConfirmed)referenceProducts++;
      const result={ ...record, posQtyBranch004: record.qtyBranch004, qtyBranch004: quantity,
        qtyTotalAllBranches: reason ? null : record.qtyTotalAllBranches - demand,
        stock004: { ...record.stock004, basis: reason ? "shopee-availability-unknown" : estimated?'hourly-and-shopee-known-only':"hourly-and-shopee",
          posBasis: record.stock004?.basis || "full-sync", reason,viewStatus:lastConfirmed?'reference':reason||estimated?'unverified':'confirmed',
          ...(lastConfirmed?{lastConfirmed}:{}),
          shopee: { reservedQuantity: line?.reservedQuantity ?? null,
            shippedUnpostedQuantity: line?.shippedUnpostedQuantity ?? null, asOf: projection?.asOf || null,
            allOrdersAllocated:projection?!(projection.unallocatedOrders>0):false,unallocatedOrders:projection?.unallocatedOrders??null } } };
      if(!reason&&!estimated)references.remember(result,projection);
      if(reason&&!temporaryFailure)references.remove(record.productCode);
      return result;
    });
    return { ...display, records, shopeeStock004: { status: projection ? (projection.unallocatedOrders>0?'partial-known-commitments':unknownProducts || projection.status === 'partial' ? "partial" : "available") : failure,
      branchCode: "004", applied: Boolean(projection), asOf: projection?.asOf || diagnostic?.asOf || null,
      lastEmailIngestedAt: projection?.lastEmailIngestedAt || diagnostic?.lastEmailIngestedAt || null, cutoverAt: projection?.cutoverAt || null,
      reviewOrders:diagnostic?.reviewOrders ?? null,pendingOrders:diagnostic?.pendingOrders ?? null,
      unallocatedOrders:projection?.unallocatedOrders??null,pageEstimatedProducts:estimatedProducts,
      issueClass:temporaryFailure?'temporary':projection?'none':'unverified',pageReferenceProducts:referenceProducts,readAttempts,
      sourceLabelReviewOrders: Number.isSafeInteger(projection?.sourceLabelReviewOrders) ? projection.sourceLabelReviewOrders : null,
      pageUnknownProducts: unknownProducts, emailCoverage: "email-orders-only", physicalStockWrites: false,
      businessFreshnessQualified: false, atomicSnapshotVerified: false } };
  };
}
module.exports = { createShopee004StockDisplay, STOCK_VIEW_SHOPEE, PROJECTION_URL };
