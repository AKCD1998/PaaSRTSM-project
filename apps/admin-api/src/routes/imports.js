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
const PRICE_SOURCE_AUTO = "auto";
const PRICE_SOURCE_CSV = "csv";
const PRICE_SOURCE_EXCEL_DATAONLY = "excel-dataonly";

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

function parsePriceSource(value, fallback) {
  if (!value) {
    return fallback;
  }
  const mode = String(value).trim().toLowerCase();
  if (![PRICE_SOURCE_AUTO, PRICE_SOURCE_CSV, PRICE_SOURCE_EXCEL_DATAONLY].includes(mode)) {
    return null;
  }
  return mode;
}

function detectFilePriceSource(fileName) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  if (ext === ".xls" || ext === ".xlsx") {
    return PRICE_SOURCE_EXCEL_DATAONLY;
  }
  return PRICE_SOURCE_CSV;
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

function summarizeExcelPriceImportResult(result) {
  if (!result) {
    return null;
  }

  const parserSummary = result.parser_summary || {};
  const summary = result.summary || {};
  const changes = result.plan?.changes || [];
  const topChanges = changes
    .filter((entry) => entry.status === "planned")
    .slice(0, 20)
    .map((entry) => ({
      sku_code: entry.product_code,
      unit: entry.unit || "-",
      retail_old: entry.retail?.old_price ?? null,
      retail_new: entry.retail?.new_price ?? null,
      changed_tiers_count: entry.changed_tiers_count || 0,
    }));

  return {
    mode: result.mode || "dry-run",
    source_format: PRICE_SOURCE_EXCEL_DATAONLY,
    rows_read: parserSummary.rows_read ?? 0,
    products_parsed: parserSummary.products_parsed ?? 0,
    skipped_rows: (summary.skipped_no_price || 0) + (summary.skipped_ambiguous_unit_prices || 0),
    planned_actions: {
      prices_update_or_insert: summary.price_rows_planned_updates || 0,
      barcodes_new: summary.barcodes_new || 0,
      barcodes_existing: summary.barcodes_existing || 0,
      missing_sku: summary.missing_sku || 0,
    },
    parser_row_type_counts: parserSummary.row_type_counts || {},
    top_changes: topChanges,
    import_stats: summary,
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
      const safeExt = [".csv", ".xls", ".xlsx"].includes(ext) ? ext : ".tmp";
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
    source_format: payload.sourceFormat || null,
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
    runExcelPriceImporter,
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
          error: "File is required (multipart field: file)",
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
          error: "File is required (multipart field: file)",
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
      const sourceMode = parsePriceSource(
        req.body?.source_format || req.body?.sourceFormat,
        PRICE_SOURCE_AUTO,
      );

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
      if (!sourceMode) {
        await safelyDeleteFile(req.file.path);
        return res.status(400).json({
          error: "source_format must be auto, csv, or excel-dataonly",
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

      const detectedSource = sourceMode === PRICE_SOURCE_AUTO
        ? detectFilePriceSource(req.file.originalname || req.file.path)
        : sourceMode;
      if (detectedSource === PRICE_SOURCE_EXCEL_DATAONLY && priceHistory === PRICE_HISTORY_ON) {
        await safelyDeleteFile(req.file.path);
        return res.status(400).json({
          error: "price_history=on is not supported for excel-dataonly source",
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
        sourceFormat: detectedSource,
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

        let result = null;
        let summary = null;
        if (detectedSource === PRICE_SOURCE_EXCEL_DATAONLY) {
          result = await runExcelPriceImporter({
            file: req.file.path,
            commit,
            limit,
            check: false,
            dbUrl: config.databaseUrl,
          });
          summary = summarizeExcelPriceImportResult(result);
        } else {
          result = await runImporter(importPayload);
          summary = summarizeImportResult(result);
        }

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
