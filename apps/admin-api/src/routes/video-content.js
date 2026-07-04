"use strict";

const fs = require("fs");
const fsPromises = require("fs/promises");
const os = require("os");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { requirePermission } = require("../auth/permissions");
const {
  ASPECT_RATIOS,
  ALLOWED_DURATIONS_BY_PROVIDER_MODEL,
  ALLOWED_PROVIDER_MODELS,
  MAX_UPLOAD_MIME_TYPES,
} = require("../services/video-providers/videoStudioConstants");
const {
  createVideoJob,
  submitVideoJob,
  retryVideoJob,
  cancelVideoJob,
  approveVideoJob,
  rejectVideoJob,
  listVideoJobs,
  getVideoJobDetail,
  getVideoJobEvents,
  getUsageSummary,
} = require("../services/videoJobsService");
const {
  initAssetUpload,
  finalizeAssetUpload,
  getAssetForDownload,
  safelyDeleteFile,
} = require("../services/videoAssetsService");
const { verifyDownloadToken, resolveBaseDir } = require("../services/storage/localDiskStorageProvider");

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function parsePositiveInt(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function createUploadMiddleware(config) {
  const uploadDir = path.join(os.tmpdir(), "admin-api-video-uploads");
  fs.mkdirSync(uploadDir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext || ".tmp"}`);
    },
  });

  return multer({
    storage,
    limits: {
      fileSize: config.videoMaxUploadBytes,
      files: 1,
    },
    fileFilter: (_req, file, cb) => {
      if (!MAX_UPLOAD_MIME_TYPES.includes(file.mimetype)) {
        cb(new Error(`Unsupported mime type: ${file.mimetype}`));
        return;
      }
      cb(null, true);
    },
  });
}

function guessContentTypeFromKey(key) {
  const ext = path.extname(String(key || "")).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function createVideoContentRouter(deps) {
  const { config, db, requireAuthMiddleware, requireCsrfMiddleware, videoJobRunner, storageProvider } = deps;
  const router = express.Router();
  const upload = createUploadMiddleware(config);

  const requireFeatureEnabled = (req, res, next) => {
    if (!config.featureVideoStudio) {
      return res.status(404).json({
        error: "Not found",
        request_id: req.requestId || null,
      });
    }
    return next();
  };

  router.get(
    "/video-jobs/config",
    requireFeatureEnabled,
    requireAuthMiddleware,
    async (req, res, next) => {
      try {
        const providers = [...(config.videoProviderEnabled instanceof Set ? config.videoProviderEnabled : [])];
        return res.json({
          ok: true,
          request_id: req.requestId,
          aspectRatios: ASPECT_RATIOS,
          durationsByProviderModel: ALLOWED_DURATIONS_BY_PROVIDER_MODEL,
          providerModels: ALLOWED_PROVIDER_MODELS,
          providers,
          promptMaxLength: config.videoMaxPromptLength,
          usdToThbRate: config.usdToThbRate,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/video-jobs",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireCsrfMiddleware,
    requirePermission("content.video.create"),
    async (req, res, next) => {
      try {
        const job = await createVideoJob({ db, config, auth: req.auth, body: req.body });
        return res.status(201).json({ ok: true, request_id: req.requestId, job });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/video-jobs",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requirePermission("content.video.view"),
    async (req, res, next) => {
      try {
        const filters = {
          status: normalizeText(req.query.status) || null,
          createdBy: normalizeText(req.query.createdBy) || null,
          sku: normalizeText(req.query.sku) || null,
          promptKeyword: normalizeText(req.query.promptKeyword) || null,
          dateFrom: normalizeText(req.query.dateFrom) || null,
          dateTo: normalizeText(req.query.dateTo) || null,
        };
        const pagination = {
          limit: parsePositiveInt(req.query.limit, 50),
          offset: parsePositiveInt(req.query.offset, 1),
        };
        const jobs = await listVideoJobs({ db, auth: req.auth, filters, pagination });
        return res.json({ ok: true, request_id: req.requestId, jobs });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/video-jobs/:id",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requirePermission("content.video.view"),
    async (req, res, next) => {
      try {
        const job = await getVideoJobDetail({ db, auth: req.auth, jobId: req.params.id });
        return res.json({ ok: true, request_id: req.requestId, job });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/video-jobs/:id/submit",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireCsrfMiddleware,
    requirePermission("content.video.create"),
    async (req, res, next) => {
      try {
        const job = await submitVideoJob({ db, config, auth: req.auth, jobId: req.params.id, videoJobRunner, storageProvider });
        return res.json({ ok: true, request_id: req.requestId, job });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/video-jobs/:id/retry",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireCsrfMiddleware,
    requirePermission("content.video.retry"),
    async (req, res, next) => {
      try {
        const job = await retryVideoJob({ db, config, auth: req.auth, jobId: req.params.id, videoJobRunner, storageProvider });
        return res.json({ ok: true, request_id: req.requestId, job });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/video-jobs/:id/cancel",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireCsrfMiddleware,
    requirePermission("content.video.create"),
    async (req, res, next) => {
      try {
        const job = await cancelVideoJob({ db, config, auth: req.auth, jobId: req.params.id, videoJobRunner });
        return res.json({ ok: true, request_id: req.requestId, job });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/video-jobs/:id/approve",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireCsrfMiddleware,
    requirePermission("content.video.approve"),
    async (req, res, next) => {
      try {
        const job = await approveVideoJob({ db, auth: req.auth, jobId: req.params.id, note: req.body?.note });
        return res.json({ ok: true, request_id: req.requestId, job });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/video-jobs/:id/reject",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireCsrfMiddleware,
    requirePermission("content.video.reject"),
    async (req, res, next) => {
      try {
        const job = await rejectVideoJob({ db, auth: req.auth, jobId: req.params.id, reason: req.body?.reason });
        return res.json({ ok: true, request_id: req.requestId, job });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/video-jobs/:id/events",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requirePermission("content.video.view"),
    async (req, res, next) => {
      try {
        const events = await getVideoJobEvents({ db, auth: req.auth, jobId: req.params.id });
        return res.json({ ok: true, request_id: req.requestId, events });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/video-jobs/:id/download",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requirePermission("content.video.download"),
    async (req, res, next) => {
      try {
        const job = await getVideoJobDetail({ db, auth: req.auth, jobId: req.params.id });
        if (!job.outputAssetId) {
          return res.status(404).json({ error: "Job has no output asset yet", request_id: req.requestId });
        }
        const { storageKey } = await getAssetForDownload({ db, auth: req.auth, assetId: job.outputAssetId });
        const url = await storageProvider.getSignedDownloadUrl({ key: storageKey, expiresInSeconds: 300 });
        return res.json({ ok: true, request_id: req.requestId, url });
      } catch (error) {
        return next(error);
      }
    },
  );

  function withThb(usageRow, usdToThbRate) {
    return {
      ...usageRow,
      totalEstimatedCostThb: Number((usageRow.totalEstimatedCostUsd * usdToThbRate).toFixed(2)),
      totalActualCostThb: Number((usageRow.totalActualCostUsd * usdToThbRate).toFixed(2)),
    };
  }

  router.get(
    "/usage-summary",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requirePermission("content.video.admin"),
    async (req, res, next) => {
      try {
        const summary = await getUsageSummary({ db, auth: req.auth });
        const rate = config.usdToThbRate;
        return res.json({
          ok: true,
          request_id: req.requestId,
          usdToThbRate: rate,
          allTime: withThb(summary.allTime, rate),
          thisMonth: withThb(summary.thisMonth, rate),
          byProviderModel: summary.byProviderModel.map((row) => withThb(row, rate)),
          byUser: summary.byUser.map((row) => withThb(row, rate)),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/assets/upload-init",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireCsrfMiddleware,
    requirePermission("content.video.create"),
    async (req, res, next) => {
      try {
        const result = await initAssetUpload({ db, config, auth: req.auth, body: req.body });
        return res.status(201).json({ ok: true, request_id: req.requestId, ...result });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/assets/upload-complete",
    requireFeatureEnabled,
    requireAuthMiddleware,
    requireCsrfMiddleware,
    requirePermission("content.video.create"),
    upload.single("file"),
    async (req, res, next) => {
      if (!req.file) {
        return res.status(400).json({
          error: "File is required (multipart field: file)",
          request_id: req.requestId,
        });
      }
      try {
        const asset = await finalizeAssetUpload({
          db,
          storageProvider,
          auth: req.auth,
          assetId: req.body?.assetId,
          tempFilePath: req.file.path,
          originalFilename: req.file.originalname,
          mimeType: req.file.mimetype,
          fileSizeBytes: req.file.size,
        });
        return res.json({ ok: true, request_id: req.requestId, asset });
      } catch (error) {
        return next(error);
      } finally {
        await safelyDeleteFile(req.file.path);
      }
    },
  );

  // Only meaningful for the local storage provider — the HMAC token IS the auth
  // (time-limited, tied to a specific key), so no session/CSRF is required on this
  // route. If a non-local storage provider is active, this route 404s: remote
  // providers serve their own signed URLs directly and never route through here.
  router.get("/assets/binary", async (req, res, next) => {
    try {
      if (String(config.videoStorageProvider || "local").toLowerCase() !== "local") {
        return res.status(404).json({ error: "Not found", request_id: req.requestId || null });
      }

      const { key, exp, token } = req.query;
      if (!verifyDownloadToken(config, { key: String(key || ""), exp: String(exp || ""), token: String(token || "") })) {
        return res.status(403).json({ error: "Invalid or expired token", request_id: req.requestId || null });
      }

      const baseDir = resolveBaseDir(config);
      const filePath = path.resolve(baseDir, String(key));
      if (filePath !== baseDir && !filePath.startsWith(baseDir + path.sep)) {
        return res.status(403).json({ error: "Invalid key", request_id: req.requestId || null });
      }

      await fsPromises.access(filePath, fs.constants.R_OK);
      res.setHeader("Content-Type", guessContentTypeFromKey(String(key)));
      // ?download=1 -> real "Save As" prompt (used by the download link/button).
      // Without it -> inline, so the <video> preview player can still stream it.
      const disposition = req.query.download === "1" ? "attachment" : "inline";
      const filename = path.basename(String(key));
      res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
      const stream = fs.createReadStream(filePath);
      stream.on("error", (error) => next(error));
      stream.pipe(res);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return res.status(404).json({ error: "Not found", request_id: req.requestId || null });
      }
      return next(error);
    }
  });

  router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      return res.status(400).json({
        error: `Upload error: ${error.message}`,
        request_id: req.requestId,
      });
    }
    return next(error);
  });

  return router;
}

module.exports = {
  createVideoContentRouter,
};
