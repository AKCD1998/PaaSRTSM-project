"use strict";

const express = require("express");
const { buildPermissionsResponse } = require("../auth/users");

function createMeRouter(deps) {
  const { requireAuthMiddleware, config } = deps;
  const router = express.Router();

  router.get("/", requireAuthMiddleware, (req, res) => {
    const { role, userId } = req.auth;

    return res.json({
      ok: true,
      request_id: req.requestId,
      user: {
        id: userId,
        role,
        branch_code: req.auth.effectiveBranchCode || null,
        actor_branch_code: req.auth.actorBranchCode || null,
        effective_branch_code: req.auth.effectiveBranchCode || null,
        is_branch_override: Boolean(req.auth.isBranchOverride),
      },
      csrf_token: req.auth.csrf,
      permissions: buildPermissionsResponse(role, userId, config),
    });
  });

  return router;
}

module.exports = {
  createMeRouter,
};
