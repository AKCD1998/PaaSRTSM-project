"use strict";

const express = require("express");
const {
  listStockRecommendations,
  listStockRecommendationsByProduct,
  getStockRecommendationSummary,
  getStockRecommendationDetail,
} = require("../services/stockRecommendations");

function createStockRecommendationsRouter(deps) {
  const { db, config = {}, requireAuthMiddleware } = deps;
  const router = express.Router();
  const handleError = (error, req, res, next) => {
    if (error?.code === "STOCK_RECOMMENDATION_INPUT_UNAVAILABLE") {
      return res.status(503).json({
        ok: false,
        error: "Recommendation input unavailable",
        code: error.code,
        availability: error.availability || {
          status: "unavailable",
          failures: [],
          failuresTruncated: false,
        },
        request_id: req.requestId || null,
      });
    }
    return next(error);
  };

  router.get("/stock-recommendations", requireAuthMiddleware, async (req, res, next) => {
    try {
      const payload = await listStockRecommendations({
        db,
        config,
        auth: req.auth,
        filters: req.query || {},
      });
      return res.json({
        ok: true,
        request_id: req.requestId || null,
        ...payload,
      });
    } catch (error) {
      return handleError(error, req, res, next);
    }
  });

  // One row per product with all branches nested (branch-stock-style
  // comparison view), grouped from the same snapshot table the flattened
  // list endpoint reads.
  router.get("/stock-recommendations/by-product", requireAuthMiddleware, async (req, res, next) => {
    try {
      const payload = await listStockRecommendationsByProduct({
        db,
        config,
        auth: req.auth,
        filters: req.query || {},
      });
      return res.json({
        ok: true,
        request_id: req.requestId || null,
        ...payload,
      });
    } catch (error) {
      return handleError(error, req, res, next);
    }
  });

  router.get("/stock-recommendations/summary", requireAuthMiddleware, async (req, res, next) => {
    try {
      const payload = await getStockRecommendationSummary({
        db,
        config,
        auth: req.auth,
        filters: req.query || {},
      });
      return res.json({
        ok: true,
        request_id: req.requestId || null,
        ...payload,
      });
    } catch (error) {
      return handleError(error, req, res, next);
    }
  });

  router.get("/stock-recommendations/:branchCode/:productCode", requireAuthMiddleware, async (req, res, next) => {
    try {
      const payload = await getStockRecommendationDetail({
        db,
        config,
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
      return handleError(error, req, res, next);
    }
  });

  return router;
}

module.exports = { createStockRecommendationsRouter };
