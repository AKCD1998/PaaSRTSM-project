"use strict";
const express = require("express");
const { requireAuth, requireRole, requireCsrf } = require("../auth/middleware");
const { createKy9DocumentService } = require("../services/ky9Documents");
const { createKy9ReceivingArchive } = require("../services/ky9ReceivingArchive");

function createKy9DocumentsRouter({ config, db }) {
  const router = express.Router();
  const service = createKy9DocumentService(db);
  const archive = createKy9ReceivingArchive(db);
  // Defense on every verb, including reads, history and direct nested requests.
  router.use(requireAuth(config), requireRole("admin"));
  router.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  const run = fn => async (req, res, next) => {
    try { res.json(await fn(req)); }
    catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === "42P01" || error.code === "3F000") {
        return res.status(503).json({ error: "ทะเบียนเอกสารยังไม่พร้อม กรุณาติดต่อผู้ดูแลเพื่อติดตั้งส่วนฐานข้อมูล" });
      }
      next(error);
    }
  };
  router.get("/archive/batches", run(req => archive.batches(req.auth)));
  router.get("/archive/rows", run(req => archive.search(req.auth, req.query)));
  router.get("/archive/rows/:key", run(req => archive.detail(req.auth, req.params.key, req.query.batch)));
  router.get("/archive/handoff", run(req => archive.handoff(req.auth, req.query)));
  router.get("/:period", run(req => service.read(req.params.period, req.auth)));
  router.get("/:period/events", run(req => service.history(req.params.period, req.auth, req.query.before)));
  router.use(requireCsrf);
  router.post("/:period", run(req => service.create(req.params.period, req.auth, req.body)));
  router.put("/:period", run(req => service.updatePeriod(req.params.period, req.auth, req.body)));
  router.post("/:period/incidents", run(req => service.saveIncident(req.params.period, req.auth, null, req.body)));
  router.put("/:period/incidents/:id", run(req => service.saveIncident(req.params.period, req.auth, req.params.id, req.body)));
  router.post("/:period/notes", run(req => service.addNote(req.params.period, req.auth, req.body)));
  router.post("/:period/drafts", run(req => service.addDraft(req.params.period, req.auth, req.body)));
  return router;
}
module.exports = { createKy9DocumentsRouter };
