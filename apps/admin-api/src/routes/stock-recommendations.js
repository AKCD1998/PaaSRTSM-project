"use strict";

const express = require("express");
const {
  listStockRecommendations,
  getStockRecommendationSummary,
  getStockRecommendationDetail,
} = require("../services/stockRecommendations");

function createStockRecommendationsRouter(deps) {
  const { db, requireAuthMiddleware } = deps;
  const router = express.Router();

  router.get("/stock-recommendations", requireAuthMiddleware, async (req, res, next) => {
    try {
      const payload = await listStockRecommendations({
        db,
        auth: req.auth,
        filters: req.query || {},
      });
      return res.json({
        ok: true,
        request_id: req.requestId || null,
        ...payload,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/stock-recommendations/summary", requireAuthMiddleware, async (req, res, next) => {
    try {
      const payload = await getStockRecommendationSummary({
        db,
        auth: req.auth,
        filters: req.query || {},
      });
      return res.json({
        ok: true,
        request_id: req.requestId || null,
        ...payload,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/stock-recommendations/:branchCode/:productCode", requireAuthMiddleware, async (req, res, next) => {
    try {
      const payload = await getStockRecommendationDetail({
        db,
        auth: req.auth,
        branchCode: req.params.branchCode,
        productCode: req.params.productCode,
        filters: req.query || {},
      });
      return res.json({
        ok: true,
        request_id: req.requestId || null,
        ...payload,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createStockRecommendationsRouter };
