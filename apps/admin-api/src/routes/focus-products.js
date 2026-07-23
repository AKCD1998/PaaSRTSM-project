"use strict";

const express = require("express");
const {
  listFocusProducts,
  createFocusProduct,
  updateFocusProduct,
  deactivateFocusProduct,
  createFocusProductsBulk,
} = require("../services/focusProducts");
const { saveFocusLineChatPackage } = require("../services/focusLineChatPackages");

function toIntOrNull(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Read-only, visible to every authenticated account (admin/staff/branch) — no
// role filtering, per product decision: all focus types are shown to everyone.
function createFocusProductsRouter(deps) {
  const { db, requireAuthMiddleware } = deps;
  const router = express.Router();

  router.get("/focus-products", requireAuthMiddleware, async (req, res, next) => {
    try {
      const debug = req.query.debug === "1";
      const result = await listFocusProducts(db, { includeInactive: false, debug });
      const { rows, timings } = debug ? result : { rows: result, timings: undefined };
      return res.json({ ok: true, focusProducts: rows, timings, request_id: req.requestId || null });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

// Admin-only CRUD.
function createFocusProductsAdminRouter(deps) {
  const { db, config, storageProvider, requireAuthMiddleware, requireRoleMiddleware, requireCsrfMiddleware } = deps;
  const router = express.Router();
  const auth = [requireAuthMiddleware, requireRoleMiddleware("admin")];
  const write = [requireAuthMiddleware, requireRoleMiddleware("admin"), requireCsrfMiddleware];

  router.get("/focus-products", auth, async (req, res, next) => {
    try {
      const debug = req.query.debug === "1";
      const result = await listFocusProducts(db, { includeInactive: true, debug });
      const { rows, timings } = debug ? result : { rows: result, timings: undefined };
      return res.json({ ok: true, focusProducts: rows, timings, request_id: req.requestId || null });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/focus-products", write, async (req, res, next) => {
    try {
      const created = await createFocusProduct(db, {
        ...req.body,
        createdBy: req.auth?.userId || null,
      });
      return res.status(201).json({ ok: true, focusProduct: created, request_id: req.requestId || null });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/focus-products/bulk", write, async (req, res, next) => {
    try {
      const focusProducts = await createFocusProductsBulk(db, {
        ...(req.body || {}),
        createdBy: req.auth?.userId || null,
      });
      return res.status(201).json({ ok: true, focusProducts, count: focusProducts.length, request_id: req.requestId || null });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/focus-products/line-packages", write, async (req, res, next) => {
    try {
      const linePackage = await saveFocusLineChatPackage({
        db,
        config,
        storageProvider,
        auth: req.auth,
        body: req.body || {},
      });
      return res.status(linePackage.duplicate ? 200 : 201).json({
        ok: true,
        linePackage,
        duplicate: linePackage.duplicate,
        request_id: req.requestId || null,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/focus-products/:id", write, async (req, res, next) => {
    try {
      const id = toIntOrNull(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid focus product id", request_id: req.requestId || null });
      const updated = await updateFocusProduct(db, id, {
        ...(req.body || {}),
        updatedBy: req.auth?.userId || null,
      });
      return res.json({ ok: true, focusProduct: updated, request_id: req.requestId || null });
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/focus-products/:id", write, async (req, res, next) => {
    try {
      const id = toIntOrNull(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid focus product id", request_id: req.requestId || null });
      await deactivateFocusProduct(db, id);
      return res.json({ ok: true, request_id: req.requestId || null });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createFocusProductsRouter, createFocusProductsAdminRouter };
