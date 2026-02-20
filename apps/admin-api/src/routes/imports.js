"use strict";

const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { auditLog } = require("../audit");
const { auditBase } = require("../utils/audit-payload");

const IMPORT_MODE_FULL = "full";
const IMPORT_MODE_PRICE_ONLY = "price-only";
const PRICE_HISTORY_ON = "on";
const PRICE_HISTORY_OFF = "off";

function parseBoolean(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parsePositiveInt(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseMode(value, fallback) {
  if (!value) {
    return fallback;
  }
  const mode = String(value).trim().toLowerCase();
  if (![IMPORT_MODE_FULL, IMPORT_MODE_PRICE_ONLY].includes(mode)) {
    return null;
  }
  return mode;
}

function parsePriceHistory(value, fallback) {
  if (!value) {
    return fallback;
  }
  const mode = String(value).trim().toLowerCase();
  if (![PRICE_HISTORY_ON, PRICE_HISTORY_OFF].includes(mode)) {
    return null;
  }
  return mode;
}

function summarizeImportResult(result) {
  if (!result) {
    return null;
  }

  const metadata = result.decodeResult
    ? {
        encoding: result.decodeResult.encoding,
        marker_hits: result.decodeResult.markerHits,
        replacement_count: result.decodeResult.replacements,
      }
    : null;

  if (result.mode === "dry-run") {
    return {
      mode: "dry-run",
      metadata,
      rows_read: result.plan?.rows_read ?? 0,
      products_parsed: result.plan?.products_parsed ?? 0,
      skipped_rows: result.plan?.skipped_rows ?? 0,
      parse_errors: result.plan?.parse_errors ?? 0,
      planned_actions: result.plan?.planned_actions || {},
      product_kind_breakdown: result.plan?.product_kind_breakdown || {},
      skipped_by_reason: result.plan?.skipped_by_reason || {},
      top_parse_errors: result.plan?.top_parse_errors || [],
    };
  }

  return {
    mode: "commit",
    metadata,
    rows_read: result.parsed?.rowsRead ?? 0,
    products_parsed: result.parsed?.products?.length ?? 0,
    skipped_rows: result.parsed?.skippedRows?.length ?? 0,
    parse_errors: result.summary?.parse_errors || [],
    tables: result.summary?.tables || {},
    skipped_by_reason: result.summary?.skipped_rows || {},
    apply_rules: result.ruleSummary
      ? {
          totals: result.ruleSummary.totals,
          rules_loaded: result.ruleSummary.rules_loaded,
          limit_reached: result.ruleSummary.limitReached,
        }
      : null,
  };
}

function createUploadMiddleware(config) {
  const uploadDir = path.join(os.tmpdir(), "admin-api-uploads");
  fsSync.mkdirSync(uploadDir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const safeExt = ext === ".csv" ? ext : ".tmp";
      cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${safeExt}`);
    },
  });

  return multer({
    storage,
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
    },
  });
}

async function safelyDeleteFile(filePath) {
  if (!filePath) {
    return;
  }
  try {
    await fs.unlink(filePath);
  } catch (_error) {
    // Ignore temp cleanup errors.
  }
}

function toImportMeta(req, payload) {
  return {
    file_name: req.file?.originalname || null,
    mode: payload.mode,
    price_history: payload.priceHistory,
    apply_rules: payload.applyRules || false,
    limit: payload.limit || null,
    batch_size: payload.batchSize || null,
  };
}

function createImportsRouter(deps) {
  const {
    config,
    db,
    runImporter,
    requireAuthMiddleware,
    requireRoleMiddleware,
    requireCsrfMiddleware,
  } = deps;

  const router = express.Router();
  const upload = createUploadMiddleware(config);

  router.post(
    "/products",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    requireCsrfMiddleware,
    upload.single("file"),
    async (req, res, next) => {
      if (!req.file) {
        return res.status(400).json({
          error: "CSV file is required (multipart field: file)",
          request_id: req.requestId,
        });
      }

      const mode = parseMode(req.body?.mode, IMPORT_MODE_FULL);
      const priceHistory = parsePriceHistory(
        req.body?.price_history || req.body?.priceHistory,
        PRICE_HISTORY_OFF,
      );
      const commit = parseBoolean(req.body?.commit, false);
      const applyRules = parseBoolean(req.body?.apply_rules || req.body?.applyRules, false);
      const limit = parsePositiveInt(req.body?.limit, null);
      const batchSize = parsePositiveInt(req.body?.batch_size || req.body?.batchSize, 500);

      if (!mode) {
        await safelyDeleteFile(req.file.path);
        return res.status(400).json({
          error: "mode must be full or price-only",
          request_id: req.requestId,
        });
      }
      if (!priceHistory) {
        await safelyDeleteFile(req.file.path);
        return res.status(400).json({
          error: "price_history must be on or off",
          request_id: req.requestId,
        });
      }
      if (limit === null && req.body?.limit) {
        await safelyDeleteFile(req.file.path);
        return res.status(400).json({
          error: "limit must be a positive integer",
          request_id: req.requestId,
        });
      }
      if (batchSize === null) {
        await safelyDeleteFile(req.file.path);
        return res.status(400).json({
          error: "batch_size must be a positive integer",
          request_id: req.requestId,
        });
      }

      const importPayload = {
        file: req.file.path,
        dryRun: !commit,
        commit,
        limit,
        batchSize,
        mode,
        priceHistory,
        applyRules,
        dbUrl: config.databaseUrl,
      };

      try {
        if (commit) {
          await auditLog(
            db,
            auditBase(req, {
              action: "import.products.commit_started",
              target_type: "import_run",
              target_id: req.requestId,
              meta: toImportMeta(req, importPayload),
            }),
          );
        }

        const result = await runImporter(importPayload);
        const summary = summarizeImportResult(result);

        await auditLog(
          db,
          auditBase(req, {
            action: commit ? "import.products.commit_succeeded" : "import.products.dry_run",
            target_type: "import_run",
            target_id: req.requestId,
            success: true,
            meta: {
              ...toImportMeta(req, importPayload),
              summary,
            },
          }),
        );

        return res.json({
          ok: true,
          request_id: req.requestId,
          summary,
        });
      } catch (error) {
        if (commit) {
          await auditLog(
            db,
            auditBase(req, {
              action: "import.products.commit_failed",
              target_type: "import_run",
              target_id: req.requestId,
              success: false,
              message: error.message,
              meta: toImportMeta(req, importPayload),
            }),
          );
        }
        return next(error);
      } finally {
        await safelyDeleteFile(req.file.path);
      }
    },
  );

  router.post(
    "/prices",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    requireCsrfMiddleware,
    upload.single("file"),
    async (req, res, next) => {
      if (!req.file) {
        return res.status(400).json({
          error: "CSV file is required (multipart field: file)",
          request_id: req.requestId,
        });
      }

      const commit = parseBoolean(req.body?.commit, false);
      const priceHistory = parsePriceHistory(
        req.body?.price_history || req.body?.priceHistory,
        PRICE_HISTORY_OFF,
      );
      const limit = parsePositiveInt(req.body?.limit, null);
      const batchSize = parsePositiveInt(req.body?.batch_size || req.body?.batchSize, 500);
      const modeRaw = req.body?.mode ? parseMode(req.body.mode, null) : IMPORT_MODE_PRICE_ONLY;

      if (!modeRaw || modeRaw !== IMPORT_MODE_PRICE_ONLY) {
        await safelyDeleteFile(req.file.path);
        return res.status(400).json({
          error: "prices import endpoint only supports mode=price-only",
          request_id: req.requestId,
        });
      }
      if (!priceHistory) {
        await safelyDeleteFile(req.file.path);
        return res.status(400).json({
          error: "price_history must be on or off",
          request_id: req.requestId,
        });
      }
      if (limit === null && req.body?.limit) {
        await safelyDeleteFile(req.file.path);
        return res.status(400).json({
          error: "limit must be a positive integer",
          request_id: req.requestId,
        });
      }
      if (batchSize === null) {
        await safelyDeleteFile(req.file.path);
        return res.status(400).json({
          error: "batch_size must be a positive integer",
          request_id: req.requestId,
        });
      }

      const importPayload = {
        file: req.file.path,
        dryRun: !commit,
        commit,
        limit,
        batchSize,
        mode: IMPORT_MODE_PRICE_ONLY,
        priceHistory,
        applyRules: false,
        dbUrl: config.databaseUrl,
      };

      try {
        if (commit) {
          await auditLog(
            db,
            auditBase(req, {
              action: "import.prices.commit_started",
              target_type: "import_run",
              target_id: req.requestId,
              meta: toImportMeta(req, importPayload),
            }),
          );
        }

        const result = await runImporter(importPayload);
        const summary = summarizeImportResult(result);

        await auditLog(
          db,
          auditBase(req, {
            action: commit ? "import.prices.commit_succeeded" : "import.prices.dry_run",
            target_type: "import_run",
            target_id: req.requestId,
            success: true,
            meta: {
              ...toImportMeta(req, importPayload),
              summary,
            },
          }),
        );

        return res.json({
          ok: true,
          request_id: req.requestId,
          summary,
        });
      } catch (error) {
        if (commit) {
          await auditLog(
            db,
            auditBase(req, {
              action: "import.prices.commit_failed",
              target_type: "import_run",
              target_id: req.requestId,
              success: false,
              message: error.message,
              meta: toImportMeta(req, importPayload),
            }),
          );
        }
        return next(error);
      } finally {
        await safelyDeleteFile(req.file.path);
      }
    },
  );

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
  createImportsRouter,
};
