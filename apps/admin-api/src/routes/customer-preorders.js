"use strict";
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const { createCustomerPreorderService } = require("../services/customerPreorders");
const { createPreorderWorkflow } = require("../services/preorderWorkflow");
const { createPreorderReceiptEvidence } = require("../services/preorderReceiptEvidence");
const { createPreorderTransferEvidence } = require("../services/preorderTransferEvidence");
const { createPreorderWorkspaceMiddleware, requirePreorderCapability } = require("../services/preorderWorkspace");
const { WORKSPACE_CONTRACT } = require("../services/preorderWorkspace");
const { createPreorderPhysicalReceipts } = require("../services/preorderPhysicalReceipts");
const { createPreorderFifoAllocation } = require("../services/preorderFifoAllocation");

function createCustomerPreordersRouter({ config, db, requireAuthMiddleware, requireCsrfMiddleware, requireMobileTokenMiddleware, storageProvider }) {
  const router = express.Router();
  if (!config.featureCustomerPreorders) { router.use((_req, res) => res.status(404).json({ error: "Not found" })); return router; }
  const service = createCustomerPreorderService({ db, config, storageProvider });
  const workflow = createPreorderWorkflow({ db });
  const receipts = createPreorderReceiptEvidence({ db });
  const transfers = createPreorderTransferEvidence({ db });
  const physicalReceipts = createPreorderPhysicalReceipts({ db, config, storageProvider });
  const fifoAllocation = createPreorderFifoAllocation({ db });
  const requireCapability = (capability) => requirePreorderCapability(config, capability);
  const requirePreorderAuth = (req, res, next) => {
    const authorization = String(req.headers?.authorization || "").trim();
    if (!authorization) return requireAuthMiddleware(req, res, next);
    if (!config.featureMobilePda || !config.featurePreorderRoleWorkspace || !requireMobileTokenMiddleware) {
      return res.status(404).json({ error: "Not found", request_id: req.requestId || null });
    }
    if (!/^Bearer\s+\S+$/i.test(authorization)) {
      return res.status(401).json({ error: "Unauthorized", request_id: req.requestId || null });
    }
    return requireMobileTokenMiddleware(req, res, () => {
      const branchCode = String(req.mobile?.branchCode || "");
      if (!req.mobile?.staffId || !/^\d{3}$/.test(branchCode) || branchCode === "000") {
        return res.status(403).json({ error: "Branch identity required", request_id: req.requestId || null });
      }
      // Mobile identities are mapped to a branch staff subject. The profile is
      // still an explicit server-side grant keyed as `staff:<staff_id>`; neither
      // the token's role nor X-Preorder-Workspace can grant extra capabilities.
      req.auth = {
        userId: `staff:${req.mobile.staffId}`,
        role: "staff",
        csrf: "",
        branchCode,
        actorBranchCode: branchCode,
        effectiveBranchCode: branchCode,
        isBranchOverride: false,
        authMethod: "mobile-bearer",
      };
      return next();
    });
  };
  const requirePreorderMutationProtection = (req, res, next) => {
    if (req.auth?.authMethod === "mobile-bearer") return next();
    return requireCsrfMiddleware(req, res, next);
  };
  const requireAnyCapability = (...capabilities) => (req, res, next) => {
    if (!config.featurePreorderRoleWorkspace) return next();
    const granted = req.auth?.preorderWorkspace?.capabilities || [];
    if (!capabilities.some((capability) => granted.includes(capability))) {
      return res.status(403).json({ error: "Forbidden", request_id: req.requestId || null });
    }
    return next();
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 3, fileSize: 5 * 1024 * 1024, fields: 30 } });
  const asyncRoute = (handler) => async (req, res, next) => { try { await handler(req, res); } catch (error) { next(error); } };
  const verifyCancelPassword = (provided) => {
    const expected = Buffer.from(String(config.preorderCancelPassword || ""));
    const actual = Buffer.from(String(provided || ""));
    if (!expected.length) throw Object.assign(new Error("ยังไม่ได้ตั้งรหัสยืนยันการยกเลิกในระบบ"), { statusCode: 503 });
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw Object.assign(new Error("รหัสผ่านไม่ถูกต้อง"), { statusCode: 403 });
    }
  };
  const acceptImages = (req, res, next) => upload.array("images", 3)(req, res, (error) => {
    if (!error) return next();
    const message = error.code === "LIMIT_FILE_SIZE" ? "แต่ละรูปต้องมีขนาดไม่เกิน 5 MB" : error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE" ? "แนบรูปได้ไม่เกิน 3 รูป" : "ข้อมูลไฟล์ไม่ถูกต้อง";
    return next(Object.assign(new Error(message), { statusCode: 400 }));
  });
  router.use(requirePreorderAuth);
  router.use(createPreorderWorkspaceMiddleware(config));
  router.get("/workspace", asyncRoute(async (req, res) => {
    if (!config.featurePreorderRoleWorkspace) return res.status(404).json({ error: "Not found" });
    res.set("Cache-Control", "private, no-store");
    const workspace = req.auth.preorderWorkspace;
    return res.json({ contractVersion: WORKSPACE_CONTRACT, subjectUserId: workspace.subjectUserId, workRole: workspace.role, workRoles: workspace.workRoles, branchCode: workspace.branchCode, capabilities: workspace.capabilities });
  }));
  router.get("/product-suggestions", requireAnyCapability("cases.create", "catalog.match"), asyncRoute(async (req, res) => res.json({ items: await service.productSuggestions(req.auth, req.query) })));
  router.get("/unread-count", requireAnyCapability("cases.read.branch", "cases.read.all"), asyncRoute(async (req, res) => res.json(await service.counts(req.auth))));
  router.get("/cases", asyncRoute(async (req, res, next) => {
    if (config.featurePreorderRoleWorkspace) {
      const allowed = req.auth.preorderWorkspace.capabilities.includes("cases.read.all") || req.auth.preorderWorkspace.capabilities.includes("cases.read.branch");
      if (!allowed) return res.status(403).json({ error: "Forbidden", request_id: req.requestId || null });
    }
    return res.json(await service.list(req.auth, req.query));
  }));
  router.post("/cases", requireCapability("cases.create"), requirePreorderMutationProtection, acceptImages, asyncRoute(async (req, res) => res.status(201).json(await service.create(req.auth, req.body, req.files))));
  router.get("/cases/:publicId", asyncRoute(async (req, res) => {
    if (config.featurePreorderRoleWorkspace) {
      const allowed = req.auth.preorderWorkspace.capabilities.includes("cases.read.all") || req.auth.preorderWorkspace.capabilities.includes("cases.read.branch");
      if (!allowed) return res.status(403).json({ error: "Forbidden", request_id: req.requestId || null });
    }
    return res.json(await service.get(req.auth, req.params.publicId));
  }));
  router.post("/cases/:publicId/read", requireAnyCapability("cases.read.all", "cases.read.branch"), requirePreorderMutationProtection, asyncRoute(async (req, res) => res.json(await service.markRead(req.auth, req.params.publicId))));
  router.post("/cases/:publicId/messages", requireCapability("messages.send"), requirePreorderMutationProtection, acceptImages, asyncRoute(async (req, res) => {
    if (config.featurePreorderRoleWorkspace && req.body?.visibility === "ADMIN_INTERNAL" && !req.auth.preorderWorkspace.capabilities.includes("messages.internal")) return res.status(403).json({ error: "Forbidden", request_id: req.requestId || null });
    return res.status(201).json(await service.createMessage(req.auth, req.params.publicId, req.body, req.files));
  }));
  const action = (path, capability, handler) => router.post(`/cases/:publicId/${path}`, requireCapability(capability), requirePreorderMutationProtection, asyncRoute(async (req, res) => res.json(await handler(req.auth, req.params.publicId, req.body || {}))));
  action("start-review", "commercial.review", workflow.startReview); action("request-info", "commercial.review", workflow.requestInfo); action("provide-info", "customer.info", workflow.provideInfo);
  action("quotes", "commercial.quote", workflow.publishQuote); action("customer-decision", "customer.decision", workflow.customerDecision); action("mark-ordered", "commercial.order", workflow.markOrdered);
  action("mark-unavailable", "commercial.unavailable", workflow.markUnavailable); action("confirm-branch-arrival", "branch.arrival", workflow.confirmArrival); action("customer-notified", "customer.notify", workflow.customerNotified);
  action("complete", "customer.complete", workflow.complete);
  router.post("/cases/:publicId/cancel/verify-password", requireCapability("cases.cancel"), requirePreorderMutationProtection, asyncRoute(async (req, res) => {
    await service.get(req.auth, req.params.publicId);
    verifyCancelPassword(req.body?.password);
    return res.json({ ok: true });
  }));
  action("cancel", "cases.cancel", async (auth, publicId, body) => {
    verifyCancelPassword(body.password);
    return workflow.cancel(auth, publicId, body);
  });
  action("reopen", "commercial.reopen", workflow.reopen);
  router.post("/cases/:publicId/items/:itemId/match-sku", requireCapability("catalog.match"), requirePreorderMutationProtection, asyncRoute(async (req, res) => res.json(await workflow.matchSku(req.auth, req.params.publicId, req.params.itemId, req.body || {}))));
  router.get("/cases/:publicId/items/:itemId/receipt-candidates", requireCapability("receipts.link"), asyncRoute(async (req,res)=>{
    const items = await receipts.candidates(req.auth,req.params.publicId,req.params.itemId);
    return res.json({items:await physicalReceipts.decorateCandidates(req.auth,items)});
  }));
  router.post("/receipt-batches/ensure", requireCapability("receipts.physical.record"), requirePreorderMutationProtection, asyncRoute(async (req,res)=>res.status(201).json(await physicalReceipts.ensureBatch(req.auth,req.body||{}))));
  router.post("/cases/:publicId/items/:itemId/receipt-verifications", requireCapability("receipts.physical.record"), requirePreorderMutationProtection, asyncRoute(async (req,res)=>res.status(201).json(await physicalReceipts.record(req.auth,req.params.publicId,req.params.itemId,req.body||{}))));
  router.post("/receipt-batches/:batchId/photos", requireCapability("receipts.physical.record"), requirePreorderMutationProtection, acceptImages, asyncRoute(async (req,res)=>res.status(201).json(await physicalReceipts.addPhotos(req.auth,req.params.batchId,req.files||[]))));
  router.get("/receipt-batches/:batchId/photos/:photoPublicId/url", requireCapability("receipts.physical.record"), asyncRoute(async (req,res)=>{res.set("Cache-Control","private, no-store");return res.json(await physicalReceipts.signedPhotoUrl(req.auth,req.params.batchId,req.params.photoPublicId));}));
  router.post("/receipt-batches/:batchId/fifo-allocation", requireCapability("receipts.link"), requirePreorderMutationProtection, asyncRoute(async (req,res)=>res.json(await fifoAllocation.allocate(req.auth,req.params.batchId,req.body||{}))));
  router.post("/cases/:publicId/items/:itemId/receipt-links",requireCapability("receipts.link"),requirePreorderMutationProtection,asyncRoute(async(req,res)=>res.status(201).json(await receipts.link(req.auth,req.params.publicId,req.params.itemId,req.body||{}))));
  router.post("/cases/:publicId/receipt-links/:linkId/unlink",requireCapability("receipts.link"),requirePreorderMutationProtection,asyncRoute(async(req,res)=>res.json(await receipts.unlink(req.auth,req.params.publicId,req.params.linkId,req.body||{}))));
  router.post("/cases/:publicId/eta-override",requireCapability("eta.override"),requirePreorderMutationProtection,asyncRoute(async(req,res)=>res.json(await receipts.overrideEta(req.auth,req.params.publicId,req.body||{}))));
  router.get("/cases/:publicId/items/:itemId/transfer-candidates",requireCapability("transfers.link"),asyncRoute(async(req,res)=>res.json({items:await transfers.candidates(req.auth,req.params.publicId,req.params.itemId)})));
  router.post("/cases/:publicId/items/:itemId/transfer-links",requireCapability("transfers.link"),requirePreorderMutationProtection,asyncRoute(async(req,res)=>res.status(201).json(await transfers.link(req.auth,req.params.publicId,req.params.itemId,req.body||{}))));
  router.post("/cases/:publicId/transfer-links/:linkId/unlink",requireCapability("transfers.link"),requirePreorderMutationProtection,asyncRoute(async(req,res)=>res.json(await transfers.unlink(req.auth,req.params.publicId,req.params.linkId,req.body||{}))));
  router.get("/attachments/:attachmentId/download-url", requireAnyCapability("cases.read.all", "cases.read.branch"), asyncRoute(async (req, res) => { res.set("Cache-Control", "private, no-store"); res.set("X-Content-Type-Options", "nosniff"); res.json(await service.signedUrl(req.auth, req.params.attachmentId)); }));
  // Compatibility aliases for the initial flagged UI. Canonical paths are /cases and /attachments/:id/download-url.
  router.get("/", requireAnyCapability("cases.read.all", "cases.read.branch"), asyncRoute(async (req, res) => res.json(await service.list(req.auth, req.query))));
  router.post("/", requireCapability("cases.create"), requirePreorderMutationProtection, acceptImages, asyncRoute(async (req, res) => res.status(201).json(await service.create(req.auth, req.body, req.files))));
  router.get("/:publicId/attachments/:attachmentId/url", requireAnyCapability("cases.read.all", "cases.read.branch"), asyncRoute(async (req, res) => res.json(await service.signedUrl(req.auth, req.params.attachmentId))));
  return router;
}
module.exports = { createCustomerPreordersRouter };
