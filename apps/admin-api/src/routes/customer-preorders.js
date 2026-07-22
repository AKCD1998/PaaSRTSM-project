"use strict";
const express = require("express");
const multer = require("multer");
const { createCustomerPreorderService } = require("../services/customerPreorders");
const { createPreorderWorkflow } = require("../services/preorderWorkflow");
const { createPreorderReceiptEvidence } = require("../services/preorderReceiptEvidence");
const { createPreorderTransferEvidence } = require("../services/preorderTransferEvidence");

function createCustomerPreordersRouter({ config, db, requireAuthMiddleware, requireCsrfMiddleware, storageProvider }) {
  const router = express.Router();
  if (!config.featureCustomerPreorders) { router.use((_req, res) => res.status(404).json({ error: "Not found" })); return router; }
  const service = createCustomerPreorderService({ db, config, storageProvider });
  const workflow = createPreorderWorkflow({ db });
  const receipts = createPreorderReceiptEvidence({ db });
  const transfers = createPreorderTransferEvidence({ db });
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 3, fileSize: 5 * 1024 * 1024, fields: 30 } });
  const asyncRoute = (handler) => async (req, res, next) => { try { await handler(req, res); } catch (error) { next(error); } };
  const acceptImages = (req, res, next) => upload.array("images", 3)(req, res, (error) => {
    if (!error) return next();
    const message = error.code === "LIMIT_FILE_SIZE" ? "แต่ละรูปต้องมีขนาดไม่เกิน 5 MB" : error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE" ? "แนบรูปได้ไม่เกิน 3 รูป" : "ข้อมูลไฟล์ไม่ถูกต้อง";
    return next(Object.assign(new Error(message), { statusCode: 400 }));
  });
  router.use(requireAuthMiddleware);
  router.get("/product-suggestions", asyncRoute(async (req, res) => res.json({ items: await service.productSuggestions(req.auth, req.query) })));
  router.get("/unread-count", asyncRoute(async (req, res) => res.json(await service.counts(req.auth))));
  router.get("/cases", asyncRoute(async (req, res) => res.json(await service.list(req.auth, req.query))));
  router.post("/cases", requireCsrfMiddleware, acceptImages, asyncRoute(async (req, res) => res.status(201).json(await service.create(req.auth, req.body, req.files))));
  router.get("/cases/:publicId", asyncRoute(async (req, res) => res.json(await service.get(req.auth, req.params.publicId))));
  router.post("/cases/:publicId/read", requireCsrfMiddleware, asyncRoute(async (req, res) => res.json(await service.markRead(req.auth, req.params.publicId))));
  router.post("/cases/:publicId/messages", requireCsrfMiddleware, acceptImages, asyncRoute(async (req, res) => res.status(201).json(await service.createMessage(req.auth, req.params.publicId, req.body, req.files))));
  const action = (path, handler) => router.post(`/cases/:publicId/${path}`, requireCsrfMiddleware, asyncRoute(async (req, res) => res.json(await handler(req.auth, req.params.publicId, req.body || {}))));
  action("start-review", workflow.startReview); action("request-info", workflow.requestInfo); action("provide-info", workflow.provideInfo);
  action("quotes", workflow.publishQuote); action("customer-decision", workflow.customerDecision); action("mark-ordered", workflow.markOrdered);
  action("mark-unavailable", workflow.markUnavailable); action("confirm-branch-arrival", workflow.confirmArrival); action("customer-notified", workflow.customerNotified);
  action("complete", workflow.complete); action("cancel", workflow.cancel); action("reopen", workflow.reopen);
  router.post("/cases/:publicId/items/:itemId/match-sku", requireCsrfMiddleware, asyncRoute(async (req, res) => res.json(await workflow.matchSku(req.auth, req.params.publicId, req.params.itemId, req.body || {}))));
  router.get("/cases/:publicId/items/:itemId/receipt-candidates", asyncRoute(async (req,res)=>res.json({items:await receipts.candidates(req.auth,req.params.publicId,req.params.itemId)})));
  router.post("/cases/:publicId/items/:itemId/receipt-links",requireCsrfMiddleware,asyncRoute(async(req,res)=>res.status(201).json(await receipts.link(req.auth,req.params.publicId,req.params.itemId,req.body||{}))));
  router.post("/cases/:publicId/receipt-links/:linkId/unlink",requireCsrfMiddleware,asyncRoute(async(req,res)=>res.json(await receipts.unlink(req.auth,req.params.publicId,req.params.linkId,req.body||{}))));
  router.post("/cases/:publicId/eta-override",requireCsrfMiddleware,asyncRoute(async(req,res)=>res.json(await receipts.overrideEta(req.auth,req.params.publicId,req.body||{}))));
  router.get("/cases/:publicId/items/:itemId/transfer-candidates",asyncRoute(async(req,res)=>res.json({items:await transfers.candidates(req.auth,req.params.publicId,req.params.itemId)})));
  router.post("/cases/:publicId/items/:itemId/transfer-links",requireCsrfMiddleware,asyncRoute(async(req,res)=>res.status(201).json(await transfers.link(req.auth,req.params.publicId,req.params.itemId,req.body||{}))));
  router.post("/cases/:publicId/transfer-links/:linkId/unlink",requireCsrfMiddleware,asyncRoute(async(req,res)=>res.json(await transfers.unlink(req.auth,req.params.publicId,req.params.linkId,req.body||{}))));
  router.get("/attachments/:attachmentId/download-url", asyncRoute(async (req, res) => { res.set("Cache-Control", "private, no-store"); res.set("X-Content-Type-Options", "nosniff"); res.json(await service.signedUrl(req.auth, req.params.attachmentId)); }));
  // Compatibility aliases for the initial flagged UI. Canonical paths are /cases and /attachments/:id/download-url.
  router.get("/", asyncRoute(async (req, res) => res.json(await service.list(req.auth, req.query))));
  router.post("/", requireCsrfMiddleware, acceptImages, asyncRoute(async (req, res) => res.status(201).json(await service.create(req.auth, req.body, req.files))));
  router.get("/:publicId/attachments/:attachmentId/url", asyncRoute(async (req, res) => res.json(await service.signedUrl(req.auth, req.params.attachmentId))));
  return router;
}
module.exports = { createCustomerPreordersRouter };
