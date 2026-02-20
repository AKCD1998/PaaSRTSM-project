"use strict";

const express = require("express");

function createMeRouter(deps) {
  const { requireAuthMiddleware } = deps;
  const router = express.Router();

  router.get("/", requireAuthMiddleware, (req, res) => {
    const role = req.auth.role;
    const canWrite = role === "admin";

    return res.json({
      ok: true,
      request_id: req.requestId,
      user: {
        id: req.auth.userId,
        role,
      },
      csrf_token: req.auth.csrf,
      permissions: {
        can_edit_products: canWrite,
        can_run_imports: canWrite,
        can_apply_rules: canWrite,
      },
    });
  });

  return router;
}

module.exports = {
  createMeRouter,
};
