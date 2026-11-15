"use strict";

const WORKSPACE_CONTRACT = "sc-preorder-three-role-r3-v1";
const ROLE_CAPABILITIES = Object.freeze({
  purchasing: Object.freeze([
    "cases.read.all", "commercial.review", "commercial.quote", "commercial.order",
    "commercial.unavailable", "commercial.reopen", "catalog.match", "messages.send",
    "messages.internal",
  ]),
  fulfillment: Object.freeze([
    "cases.read.all", "receipts.link", "receipts.physical.record", "eta.override",
  ]),
  branch: Object.freeze([
    "cases.read.branch", "cases.create", "customer.decision", "customer.info", "messages.send",
  ]),
});

function forbidden() {
  return Object.assign(new Error("Forbidden"), { statusCode: 403 });
}

function resolvePreorderWorkspace(auth, config) {
  const subjectUserId = String(auth?.userId || "").trim().toLowerCase();
  const profile = config.preorderWorkspaceProfiles?.get(subjectUserId);
  if (!profile) throw forbidden();

  if (profile.workRole === "purchasing" && auth.role !== "admin") throw forbidden();
  if (profile.workRole === "fulfillment" && auth.role !== "staff") throw forbidden();
  if (profile.workRole === "branch") {
    if (!["staff", "branch"].includes(auth.role)
        || !profile.branchCode
        || auth.effectiveBranchCode !== profile.branchCode) throw forbidden();
  }

  const capabilities = ROLE_CAPABILITIES[profile.workRole];
  if (!capabilities) throw forbidden();
  return Object.freeze({
    contractVersion: WORKSPACE_CONTRACT,
    subjectUserId: auth.userId,
    role: profile.workRole,
    branchCode: profile.workRole === "branch" ? profile.branchCode : null,
    capabilities,
  });
}

function createPreorderWorkspaceMiddleware(config) {
  return function preorderWorkspaceMiddleware(req, res, next) {
    if (!config.featurePreorderRoleWorkspace) return next();
    try {
      req.auth.preorderWorkspace = resolvePreorderWorkspace(req.auth, config);
      return next();
    } catch (error) {
      if (error.statusCode === 403) {
        return res.status(403).json({ error: "Forbidden", request_id: req.requestId || null });
      }
      return next(error);
    }
  };
}

function requirePreorderCapability(config, capability) {
  return function preorderCapabilityMiddleware(req, res, next) {
    if (!config.featurePreorderRoleWorkspace) return next();
    const granted = req.auth?.preorderWorkspace?.capabilities || [];
    if (!granted.includes(capability)) {
      return res.status(403).json({ error: "Forbidden", request_id: req.requestId || null });
    }
    return next();
  };
}

module.exports = {
  WORKSPACE_CONTRACT,
  ROLE_CAPABILITIES,
  resolvePreorderWorkspace,
  createPreorderWorkspaceMiddleware,
  requirePreorderCapability,
};
