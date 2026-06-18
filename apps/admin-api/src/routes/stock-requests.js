"use strict";

const express = require("express");
const { requireBranchIdentity } = require("../auth/middleware");
const {
  submitStockRequestBatch,
  listOutgoingStockRequestBatches,
  getStockRequestBatchDetail,
  listIncomingStockRequests,
  getIncomingStockRequestDetail,
  getStockRequestEvents,
  saveLineResponseDraft,
  submitStockRequestResponse,
  listStockRequestNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
} = require("../services/stockRequests");

function createStockRequestsRouter(deps) {
  const { config, db, requireAuthMiddleware, requireCsrfMiddleware } = deps;
  const router = express.Router();
  const requireFeatureEnabled = (req, res, next) => {
    if (!config.featureStockRequests) {
      return res.status(404).json({
        error: "Not found",
        request_id: req.requestId || null,
      });
    }
    return next();
  };

  router.post(
    "/stock-requests",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireCsrfMiddleware,
    requireBranchIdentity,
    async (req, res, next) => {
      try {
        const result = await submitStockRequestBatch({
          db,
          auth: req.auth,
          body: req.body,
          requestId: req.requestId,
        });

        return res.status(result.duplicate ? 200 : 201).json({
          ok: true,
          request_id: req.requestId,
          duplicate: result.duplicate,
          batchPublicId: result.batchPublicId,
          requests: result.requests,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/stock-requests/mine",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireBranchIdentity,
    async (req, res, next) => {
      try {
        const records = await listOutgoingStockRequestBatches({
          db,
          auth: req.auth,
          search: req.query.search || "",
        });
        return res.json({
          ok: true,
          request_id: req.requestId,
          records,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/stock-requests/incoming",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireBranchIdentity,
    async (req, res, next) => {
      try {
        const records = await listIncomingStockRequests({
          db,
          auth: req.auth,
          search: req.query.search || "",
        });
        return res.json({
          ok: true,
          request_id: req.requestId,
          records,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/stock-requests/incoming/:publicId",
    requireFeatureEnabled,
    requireAuthMiddleware,
    async (req, res, next) => {
      try {
        const record = await getIncomingStockRequestDetail({
          db,
          auth: req.auth,
          publicId: req.params.publicId,
        });
        return res.json({
          ok: true,
          request_id: req.requestId,
          request: record,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.put(
    "/stock-requests/incoming/:publicId/lines/:lineId/response",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireCsrfMiddleware,
    requireBranchIdentity,
    async (req, res, next) => {
      try {
        const result = await saveLineResponseDraft({
          db,
          auth: req.auth,
          requestPublicId: req.params.publicId,
          lineId: req.params.lineId,
          body: req.body,
        });
        return res.json({
          ok: true,
          request_id: req.requestId,
          response: result,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/stock-requests/incoming/:publicId/submit-response",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireCsrfMiddleware,
    requireBranchIdentity,
    async (req, res, next) => {
      try {
        const result = await submitStockRequestResponse({
          db,
          auth: req.auth,
          requestPublicId: req.params.publicId,
          body: req.body,
          requestId: req.requestId,
        });
        return res.json({
          ok: true,
          request_id: req.requestId,
          ...result,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/notifications",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireBranchIdentity,
    async (req, res, next) => {
      try {
        const records = await listStockRequestNotifications({ db, auth: req.auth });
        return res.json({
          ok: true,
          request_id: req.requestId,
          records,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/notifications/unread-count",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireBranchIdentity,
    async (req, res, next) => {
      try {
        const unreadCount = await getUnreadNotificationCount({ db, auth: req.auth });
        return res.json({
          ok: true,
          request_id: req.requestId,
          unreadCount,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/notifications/:id/read",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireCsrfMiddleware,
    requireBranchIdentity,
    async (req, res, next) => {
      try {
        const result = await markNotificationRead({
          db,
          auth: req.auth,
          notificationId: req.params.id,
        });
        return res.json({
          ok: true,
          request_id: req.requestId,
          notification: result,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/stock-requests/:publicId/events",
    requireFeatureEnabled,
    requireAuthMiddleware,
    async (req, res, next) => {
      try {
        const result = await getStockRequestEvents({
          db,
          auth: req.auth,
          publicId: req.params.publicId,
        });
        return res.json({
          ok: true,
          request_id: req.requestId,
          batchPublicId: result.batchPublicId,
          events: result.events,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/stock-requests/:publicId",
    requireFeatureEnabled,
    requireAuthMiddleware,
    async (req, res, next) => {
      try {
        const batch = await getStockRequestBatchDetail({
          db,
          auth: req.auth,
          publicId: req.params.publicId,
        });
        return res.json({
          ok: true,
          request_id: req.requestId,
          batch,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

module.exports = {
  createStockRequestsRouter,
};
