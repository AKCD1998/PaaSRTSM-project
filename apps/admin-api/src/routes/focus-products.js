"use strict";

const express = require("express");
const {
  listFocusProducts,
  createFocusProduct,
  updateFocusProduct,
  deactivateFocusProduct,
} = require("../services/focusProducts");

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
      const rows = await listFocusProducts(db, { includeInactive: false });
      return res.json({ ok: true, focusProducts: rows, request_id: req.requestId || null });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

// Admin-only CRUD.
function createFocusProductsAdminRouter(deps) {
  const { db, requireAuthMiddleware, requireRoleMiddleware, requireCsrfMiddleware } = deps;
  const router = express.Router();
  const auth = [requireAuthMiddleware, requireRoleMiddleware("admin")];
  const write = [requireAuthMiddleware, requireRoleMiddleware("admin"), requireCsrfMiddleware];

  router.get("/focus-products", auth, async (req, res, next) => {
    try {
      const rows = await listFocusProducts(db, { includeInactive: true });
      return res.json({ ok: true, focusProducts: rows, request_id: req.requestId || null });
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

  router.patch("/focus-products/:id", write, async (req, res, next) => {
    try {
      const id = toIntOrNull(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid focus product id", request_id: req.requestId || null });
      const updated = await updateFocusProduct(db, id, req.body || {});
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
