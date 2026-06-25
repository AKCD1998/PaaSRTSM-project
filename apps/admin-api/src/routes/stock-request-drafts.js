"use strict";

const express = require("express");
const { requireBranchIdentity } = require("../auth/middleware");
const {
  getActiveDraft,
  putActiveDraft,
  discardActiveDraft,
} = require("../services/stockRequestDrafts");

function createStockRequestDraftsRouter(deps) {
  const { db, requireAuthMiddleware, requireCsrfMiddleware } = deps;
  const router = express.Router();

  router.get(
    "/stock-request-draft/me",
    requireAuthMiddleware,
    async (req, res, next) => {
      try {
        const result = await getActiveDraft({ db, auth: req.auth });
        return res.json({ ok: true, request_id: req.requestId, ...result });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.put(
    "/stock-request-draft/me",
    requireAuthMiddleware,
    requireCsrfMiddleware,
    requireBranchIdentity,
    async (req, res, next) => {
      try {
        const result = await putActiveDraft({ db, auth: req.auth, body: req.body });
        return res.json({ ok: true, request_id: req.requestId, ...result });
      } catch (error) {
        if (error?.code === "DRAFT_VERSION_CONFLICT") {
          return res.status(409).json({
            ok: false,
            message: error.message,
            code: error.code,
            request_id: req.requestId || null,
          });
        }
        return next(error);
      }
    },
  );

  router.delete(
    "/stock-request-draft/me",
    requireAuthMiddleware,
    requireCsrfMiddleware,
    async (req, res, next) => {
      try {
        await discardActiveDraft({ db, auth: req.auth });
        return res.status(204).end();
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

module.exports = { createStockRequestDraftsRouter };
