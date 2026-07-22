"use strict";

const TRANSITIONS = Object.freeze({
  SUBMITTED: { start_review: ["admin", "IN_REVIEW"], request_info: ["admin", "NEEDS_INFO"], publish_quote: ["admin", "WAITING_CUSTOMER_DECISION"], cancel: ["staff", "CANCELLED"], unavailable: ["admin", "UNAVAILABLE"] },
  IN_REVIEW: { request_info: ["admin", "NEEDS_INFO"], publish_quote: ["admin", "WAITING_CUSTOMER_DECISION"], cancel: ["staff", "CANCELLED"], unavailable: ["admin", "UNAVAILABLE"] },
  NEEDS_INFO: { provide_info: ["staff", null], cancel: ["staff", "CANCELLED"], unavailable: ["admin", "UNAVAILABLE"] },
  WAITING_CUSTOMER_DECISION: { accept: ["staff", "PROCUREMENT_PENDING"], decline: ["staff", "CUSTOMER_DECLINED"], unavailable: ["admin", "UNAVAILABLE"] },
  PROCUREMENT_PENDING: { request_info: ["admin", "NEEDS_INFO"], ordered: ["admin", "ORDERED"], cancel: ["staff", "CANCELLED"], unavailable: ["admin", "UNAVAILABLE"] },
  ORDERED: { receipt_complete: ["admin", "RECEIVED_AT_HQ"] },
  RECEIVED_AT_HQ: { dispatch: ["admin", "IN_TRANSIT_TO_BRANCH"], arrive: ["staff|admin", "ARRIVED_AT_BRANCH"] },
  IN_TRANSIT_TO_BRANCH: { arrive: ["staff|admin", "ARRIVED_AT_BRANCH"] },
  ARRIVED_AT_BRANCH: { notify_customer: ["staff", "CUSTOMER_NOTIFIED"] },
  CUSTOMER_NOTIFIED: { complete: ["staff|admin", "COMPLETED"] },
});
const TERMINAL = new Set(["COMPLETED", "CUSTOMER_DECLINED", "UNAVAILABLE", "CANCELLED"]);

function resolveTransition({ status, action, role, priorStatus }) {
  if (action === "reopen" && role === "admin" && TERMINAL.has(status)) return priorStatus || "IN_REVIEW";
  const rule = TRANSITIONS[status]?.[action];
  if (!rule || !rule[0].split("|").includes(role)) return null;
  return rule[1] || priorStatus || "IN_REVIEW";
}

module.exports = { TRANSITIONS, TERMINAL, resolveTransition };
