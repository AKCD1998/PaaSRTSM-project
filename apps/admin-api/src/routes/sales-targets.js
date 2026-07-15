"use strict";

const express = require("express");
const { listSalesTargets, upsertSalesTargets, getSalesProgress } = require("../services/salesTargets");

// Resolves which branch a request is allowed to read/write for this feature.
// Admins may target any branch via ?branchCode=; everyone else is locked to
// their own effectiveBranchCode regardless of what they pass in the query,
// same scoping convention as me.js.
function resolveBranchCode(req, res) {
  const { role, effectiveBranchCode } = req.auth;
  const requested = typeof req.query.branchCode === "string" ? req.query.branchCode.trim() : "";

  if (role === "admin") {
    const branchCode = requested || effectiveBranchCode;
    if (!branchCode) {
      res.status(400).json({ error: "branchCode query param is required", request_id: req.requestId || null });
      return null;
    }
    return branchCode;
  }

  if (!effectiveBranchCode) {
    res.status(403).json({ error: "No branch associated with this account", request_id: req.requestId || null });
    return null;
  }
  return effectiveBranchCode;
}

// Read access (targets + computed progress): any authenticated account,
// branch-scoped for non-admins. Write access (setting targets): admin-only.
function createSalesTargetsRouter(deps) {
  const { db, requireAuthMiddleware, requireRoleMiddleware, requireCsrfMiddleware } = deps;
  const router = express.Router();
  const write = [requireAuthMiddleware, requireRoleMiddleware("admin"), requireCsrfMiddleware];

  router.get("/sales-targets", requireAuthMiddleware, async (req, res, next) => {
    try {
      const branchCode = resolveBranchCode(req, res);
      if (!branchCode) return undefined;
      const result = await listSalesTargets({ db, branchCode, month: req.query.month });
      return res.json({ ok: true, ...result, request_id: req.requestId || null });
    } catch (error) {
      return next(error);
    }
  });

  router.put("/sales-targets", write, async (req, res, next) => {
    try {
      const branchCode = resolveBranchCode(req, res);
      if (!branchCode) return undefined;
      const { month, tiers } = req.body || {};
      const result = await upsertSalesTargets({
        db,
        branchCode,
        month,
        tiers,
        actor: req.auth?.userId || null,
      });
      return res.json({ ok: true, ...result, request_id: req.requestId || null });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/sales-targets/progress", requireAuthMiddleware, async (req, res, next) => {
    try {
      const branchCode = resolveBranchCode(req, res);
      if (!branchCode) return undefined;
      const result = await getSalesProgress({
        db,
        branchCode,
        month: req.query.month,
        asOfDate: req.query.asOfDate,
      });
      return res.json({ ok: true, ...result, request_id: req.requestId || null });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createSalesTargetsRouter };
