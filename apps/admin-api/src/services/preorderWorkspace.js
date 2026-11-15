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
    "cases.read.branch", "cases.create", "cases.cancel", "customer.decision", "customer.info",
    "branch.arrival", "customer.notify", "customer.complete", "messages.send",
  ]),
});

function forbidden() {
  return Object.assign(new Error("Forbidden"), { statusCode: 403 });
}

function resolvePreorderWorkspace(auth, config, requestedRole = null) {
  const subjectUserId = String(auth?.userId || "").trim().toLowerCase();
  const profile = config.preorderWorkspaceProfiles?.get(subjectUserId);
  if (!profile) throw forbidden();

  const workRoles = Array.isArray(profile.workRoles) ? profile.workRoles : [profile.workRole];
  const role = requestedRole ? String(requestedRole).trim() : profile.workRole;
  if (!workRoles.includes(role)) throw forbidden();

  // A CEO/admin may switch into only the additional roles explicitly listed
  // on their server-owned profile. A normal single-role account keeps the
  // existing system-role checks below.
  const executiveProfile = auth.role === "admin" && workRoles.includes("purchasing");
  if (role === "purchasing" && auth.role !== "admin") throw forbidden();
  if (role === "fulfillment" && auth.role !== "staff" && !executiveProfile) throw forbidden();
  if (role === "branch") {
    if (!profile.branchCode || (!executiveProfile && (!["staff", "branch"].includes(auth.role)
        || auth.effectiveBranchCode !== profile.branchCode))) throw forbidden();
  }

  const capabilities = ROLE_CAPABILITIES[role];
  if (!capabilities) throw forbidden();
  return Object.freeze({
    contractVersion: WORKSPACE_CONTRACT,
    subjectUserId: auth.userId,
    role,
    workRoles: Object.freeze([...workRoles]),
    branchCode: role === "branch" ? profile.branchCode : null,
    capabilities,
  });
}

function createPreorderWorkspaceMiddleware(config) {
  return function preorderWorkspaceMiddleware(req, res, next) {
    if (!config.featurePreorderRoleWorkspace) return next();
    try {
      req.auth.preorderWorkspace = resolvePreorderWorkspace(
        req.auth,
        config,
        req.get?.("X-Preorder-Workspace") || null,
      );
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
