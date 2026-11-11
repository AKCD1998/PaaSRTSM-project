"use strict";
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { requireAuth, requireRole } = require("../auth/middleware");

function createPjkDocumentsRouter({ config, archiveRoot = path.resolve(__dirname, "../../data/pjk-documents"), readPdf }) {
  const router = express.Router();
  let storageClient;
  const readStoredPdf = readPdf || (async doc => {
    if (!config.r2Endpoint || !config.r2BucketName || !config.r2AccessKeyId || !config.r2SecretAccessKey) {
      const error = new Error("คลัง PDF ยังไม่พร้อม"); error.status = 503; throw error;
    }
    const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
    storageClient ||= new S3Client({ endpoint: config.r2Endpoint, region: config.r2Region || "auto",
      credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey } });
    if (!/^pjk-documents\/20261111\/[a-f0-9]{64}\.pdf$/.test(doc.objectKey || "")) throw new Error("Invalid archive object");
    const response = await storageClient.send(new GetObjectCommand({ Bucket: config.r2BucketName, Key: doc.objectKey }));
    return Buffer.from(await response.Body.transformToByteArray());
  });
  router.use(requireAuth(config), requireRole("admin"));
  router.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  const load = () => JSON.parse(fs.readFileSync(path.join(archiveRoot, "manifest.json"), "utf8"));
  router.get("/", (req, res, next) => {
    try {
      const archive = load();
      const q = String(req.query.q || "").trim().toLowerCase().slice(0, 200);
      const branch = String(req.query.branch || "");
      const month = String(req.query.month || "");
      const rows = archive.documents.filter(d => (!branch || d.branch === branch) &&
        (!month || (month === "unknown" ? !d.month : d.month === month)) &&
        (!q || JSON.stringify([d.branch, d.sourceSheet, d.slots, d.note]).toLowerCase().includes(q)));
      const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
      res.json({ asOf: archive.asOf, total: rows.length, archiveTotal: archive.documents.length,
        months: [...new Set(archive.documents.map(d => d.month).filter(Boolean))].sort().reverse(),
        monthlyBundles: (archive.monthlyBundles || []).map(({ file, objectKey, ...d }) => d),
        exclusions: archive.exclusions || [],
        documents: rows.slice(offset, offset + 50).map(({ file, objectKey, ...d }) => d) });
    } catch (e) { next(e); }
  });
  router.get("/monthly/:month/pdf", async (req, res, next) => {
    try {
      const doc = (load().monthlyBundles || []).find(d => d.month === req.params.month);
      if (!doc) return res.status(404).json({ error: "ไม่พบเอกสารรวมเดือนนี้" });
      const bytes = await readStoredPdf(doc);
      if (bytes.subarray(0, 4).toString() !== "%PDF") throw new Error("Invalid archive PDF");
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `attachment; filename="PJK-${doc.month}-All-Branches-Signed.pdf"`);
      res.set("X-Content-Type-Options", "nosniff");
      res.send(bytes);
    } catch (e) { next(e); }
  });
  router.get("/:id/pdf", async (req, res, next) => {
    try {
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(req.params.id)) return res.status(404).json({ error: "ไม่พบเอกสาร" });
      const doc = load().documents.find(d => d.id === req.params.id);
      if (!doc || !/^[a-zA-Z0-9-]+\.pdf$/.test(doc.file)) return res.status(404).json({ error: "ไม่พบเอกสาร" });
      const bytes = await readStoredPdf(doc);
      if (bytes.subarray(0, 4).toString() !== "%PDF") throw new Error("Invalid archive PDF");
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `inline; filename="${doc.file}"`);
      res.set("X-Content-Type-Options", "nosniff");
      res.send(bytes);
    } catch (e) { next(e); }
  });
  return router;
}
module.exports = { createPjkDocumentsRouter };
