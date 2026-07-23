"use strict";

const express = require("express");
const cookieParser = require("cookie-parser");
const { loadConfig } = require("./config");
const { createDbPool } = require("./db");
const {
  requestContextMiddleware,
  createLoginRateLimiter,
  registerLoginFailure,
  clearLoginFailures,
  requireAuth,
  requireRole,
  requireCsrf,
  requireMobileToken,
  requireMobileRole,
} = require("./auth/middleware");
const { createHealthRouter } = require("./routes/health");
const { createAuthRouter } = require("./routes/auth");
const { createMeRouter } = require("./routes/me");
const { createCipdataRouter } = require("./routes/cipdata");
const { createProductsRouter } = require("./routes/products");
const { createTaxonomyRouter } = require("./routes/taxonomy");
const { createTaxonomyReviewRouter } = require("./routes/taxonomy-review");
const { createImportsRouter } = require("./routes/imports");
const { createEnrichmentRouter } = require("./routes/enrichment");
const { createSearchRouter } = require("./routes/search");
const { createLoyaltyRouter } = require("./routes/loyalty");
const { createMembersRouter } = require("./routes/members");
const { createOrderingRouter } = require("./routes/ordering");
const { createStockRequestsRouter } = require("./routes/stock-requests");
const { createStockRequestDraftsRouter } = require("./routes/stock-request-drafts");
const { createSupplierLogosRouter } = require("./routes/supplier-logos");
const { createReconciliationRouter } = require("./routes/reconciliation");
const { createAdaSyncRouter } = require("./routes/sync-ada");
const { createSyncRouter } = require("./routes/sync");
const { createBranchStockRouter } = require("./routes/branch-stock");
const { createReviewQueueRouter } = require("./routes/review-queue");
const { createMovementAnalyticsRouter } = require("./routes/movement-analytics");
const { createStockRecommendationsRouter } = require("./routes/stock-recommendations");
const { createIngredientKnowledgeRouter } = require("./routes/ingredient-knowledge");
const { createIngredientAdminRouter } = require("./routes/ingredient-admin");
const { createFocusProductsRouter, createFocusProductsAdminRouter } = require("./routes/focus-products");
const { createSalesTargetsRouter } = require("./routes/sales-targets");
const {
  createMobileEnrollRouter,
  createBranchStaffRouter,
} = require("./routes/mobile-enroll");
const { createMobileProductsRouter } = require("./routes/mobile-products");
const { createVideoContentRouter } = require("./routes/video-content");
const { createCustomerPreordersRouter } = require("./routes/customer-preorders");
const { createR2PreorderStorageProvider } = require("./services/storage/r2PreorderStorageProvider");
const { getVideoProvider } = require("./services/video-providers/providerRegistry");
const { getStorageProvider } = require("./services/storage/storageRegistry");
const { createVideoJobRunner } = require("./services/videoJobRunner");
const { startAssetCleanupSchedule } = require("./services/videoAssetCleanup");
const { startPreorderAttachmentCleanupSchedule } = require("./services/preorderAttachmentCleanup");
const { startStockRecommendationSchedule } = require("./services/stockRecommendationSchedule");
const { startFocusLinePackageCleanupSchedule } = require("./services/focusLineChatPackages");
const { createCrmMirrorClient } = require("./integrations/currentScCrm");

function appendVaryHeader(res, value) {
  const existing = String(res.getHeader("Vary") || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!existing.includes(value)) {
    existing.push(value);
    res.setHeader("Vary", existing.join(", "));
  }
}

function normalizeOrigin(origin) {
  return String(origin || "")
    .trim()
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function createCorsMiddleware(config) {
  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin ? String(req.headers.origin) : "";
    if (!origin) {
      return next();
    }

    const normalizedOrigin = normalizeOrigin(origin);
    const allowOrigin = config.corsAllowAllOrigins || config.corsAllowedOrigins.has(normalizedOrigin);
    if (!allowOrigin) {
      if (req.method === "OPTIONS") {
        return res.status(403).json({
          error: "CORS origin not allowed",
          request_id: req.requestId || null,
        });
      }
      return next();
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-CSRF-Token, X-Requested-With, X-Request-Id",
      "Content-Type, X-CSRF-Token, X-Requested-With, X-Request-Id, X-API-Key",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    appendVaryHeader(res, "Origin");
    appendVaryHeader(res, "Access-Control-Request-Method");
    appendVaryHeader(res, "Access-Control-Request-Headers");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    return next();
  };
}

function createApp(overrides = {}) {
  const config = overrides.config || loadConfig(process.env);
  const db = overrides.db || createDbPool(config);
  const runImporter =
    overrides.runImporter || require("../../../scripts/import_adapos_csv").runImporter;
  const runExcelPriceImporter =
    overrides.runExcelPriceImporter ||
    require("../../../scripts/import_adapos_prices_from_excel_dataonly").runImport;
  const runRuleApplication =
    overrides.runRuleApplication || require("../../../scripts/apply_enrichment_rules").runRuleApplication;
  const searchEmbeddingProvider = overrides.searchEmbeddingProvider || null;
  const searchEmbeddingSyncJobRunner = overrides.searchEmbeddingSyncJobRunner || null;
  const crmMirrorClient =
    overrides.crmMirrorClient || createCrmMirrorClient(config, overrides.fetchImpl || global.fetch);
  const videoStorageProvider = overrides.videoStorageProvider || getStorageProvider(config);
  const hasR2Config = Boolean(config.r2AccessKeyId && config.r2SecretAccessKey && config.r2Endpoint && config.r2BucketName);
  const r2StorageProvider = overrides.r2StorageProvider || (hasR2Config ? createR2PreorderStorageProvider(config) : null);
  const preorderStorageProvider = overrides.preorderStorageProvider ||
    (config.featureCustomerPreorders ? r2StorageProvider : null);
  const videoJobRunner =
    overrides.videoJobRunner ||
    createVideoJobRunner({
      db,
      config,
      getVideoProviderFn: getVideoProvider,
      storageProvider: videoStorageProvider,
      logger: console,
    });

  const requireAuthMiddleware = requireAuth(config);
  const loginRateLimitMiddleware =
    overrides.loginRateLimitMiddleware || createLoginRateLimiter(config);

  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) {
    app.set("trust proxy", 1);
  }

  app.use(requestContextMiddleware);
  app.use((req, res, next) => {
    res.set("x-request-id", req.requestId);
    next();
  });
  app.use(createCorsMiddleware(config));
  // Raw AdaAcc sync payloads (bulk sales/transfer/receipt backfills) run well past
  // the 1mb default used everywhere else — scope a larger limit to just this path
  // instead of raising it app-wide. Body-parser marks the request body as already
  // parsed, so the app-wide express.json() below is a no-op for these requests.
  app.use("/api/sync/ada", express.json({ limit: "10mb" }));
  app.use("/api/admin/focus-products/line-packages", express.json({ limit: "8mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(cookieParser());

  app.use("/admin/health", createHealthRouter());
  app.use(
    "/admin/auth",
    createAuthRouter({
      config,
      db,
      loginRateLimitMiddleware,
      requireAuthMiddleware,
      requireCsrfMiddleware: requireCsrf,
      registerLoginFailure,
      clearLoginFailures,
    }),
  );
  app.use(
    "/admin/me",
    createMeRouter({
      requireAuthMiddleware,
      config,
    }),
  );
  app.use(
    "/admin/products",
    createProductsRouter({
      db,
      requireAuthMiddleware,
      requireRoleMiddleware: requireRole,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/admin/import",
    createImportsRouter({
      config,
      db,
      runImporter,
      runExcelPriceImporter,
      requireAuthMiddleware,
      requireRoleMiddleware: requireRole,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/admin/enrichment",
    createEnrichmentRouter({
      config,
      db,
      runRuleApplication,
      requireAuthMiddleware,
      requireRoleMiddleware: requireRole,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/api/cipdata",
    createCipdataRouter({
      config,
      fetchImpl: overrides.fetchImpl,
    }),
  );
  app.use(
    "/api/members",
    createMembersRouter({
      config,
      db,
    }),
  );
  app.use(
    "/api/loyalty",
    createLoyaltyRouter({
      config,
      db,
    }),
  );
  app.use(
    "/api/search",
    createSearchRouter({
      config,
      db,
      requireAuthMiddleware,
      requireRoleMiddleware: requireRole,
      requireCsrfMiddleware: requireCsrf,
      embeddingProvider: searchEmbeddingProvider,
      embeddingSyncJobRunner: searchEmbeddingSyncJobRunner,
    }),
  );
  app.use(
    "/api/products",
    createTaxonomyRouter({
      db,
      requireAuthMiddleware,
      requireRoleMiddleware: requireRole,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/api/admin/reconciliation",
    createReconciliationRouter({
      db,
      requireAuthMiddleware,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/api",
    createBranchStockRouter({
      config,
      db,
      requireAuthMiddleware,
      requireRoleMiddleware: requireRole,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/api",
    createReviewQueueRouter({
      db,
      requireAuthMiddleware,
      requireRoleMiddleware: requireRole,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/api/admin",
    createIngredientKnowledgeRouter({
      db,
      requireAuthMiddleware,
      requireRoleMiddleware: requireRole,
    }),
  );
  app.use(
    "/api/admin",
    createMovementAnalyticsRouter({
      db,
      requireAuthMiddleware,
    }),
  );
  app.use(
    "/api/admin",
    createStockRecommendationsRouter({
      db,
      requireAuthMiddleware,
    }),
  );
  app.use(
    "/api/admin",
    createTaxonomyReviewRouter({
      db,
      requireAuthMiddleware,
      requireRoleMiddleware: requireRole,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/api/admin/ingredient-dictionary",
    createIngredientAdminRouter({
      db,
      requireAuthMiddleware,
      requireRoleMiddleware: requireRole,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/api",
    createFocusProductsRouter({
      db,
      requireAuthMiddleware,
    }),
  );
  app.use(
    "/api/admin",
    createFocusProductsAdminRouter({
      db,
      config,
      storageProvider: r2StorageProvider,
      requireAuthMiddleware,
      requireRoleMiddleware: requireRole,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/api/admin",
    createSalesTargetsRouter({
      db,
      requireAuthMiddleware,
      requireRoleMiddleware: requireRole,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/api",
    createStockRequestsRouter({
      config,
      db,
      requireAuthMiddleware,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/api",
    createStockRequestDraftsRouter({
      config,
      db,
      requireAuthMiddleware,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/api",
    createOrderingRouter({
      config,
      db,
      requireAuthMiddleware,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/api/admin/supplier-logos",
    createSupplierLogosRouter({
      db,
      requireAuthMiddleware,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/supplier-logos",
    createSupplierLogosRouter({
      db,
      requireAuthMiddleware,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  const requireMobileTokenMiddleware = requireMobileToken({ config, db });
  app.use(
    "/api/mobile",
    createMobileEnrollRouter({
      config,
      db,
      requireAuthMiddleware,
      requireRoleMiddleware: requireRole,
      requireCsrfMiddleware: requireCsrf,
      requireMobileTokenMiddleware,
      requireMobileRoleMiddleware: requireMobileRole,
    }),
  );
  app.use(
    "/api/mobile",
    createMobileProductsRouter({
      config,
      db,
      requireMobileTokenMiddleware,
    }),
  );
  app.use(
    "/api/pda",
    createMobileProductsRouter({
      config,
      db,
      requireMobileTokenMiddleware,
    }),
  );
  app.use(
    "/api/admin/branch-staff",
    createBranchStaffRouter({
      db,
      requireAuthMiddleware,
      requireRoleMiddleware: requireRole,
      requireCsrfMiddleware: requireCsrf,
    }),
  );
  app.use(
    "/api/customer-preorders",
    createCustomerPreordersRouter({
      config,
      db,
      requireAuthMiddleware,
      requireCsrfMiddleware: requireCsrf,
      storageProvider: preorderStorageProvider,
    }),
  );
  app.use(
    "/api/content",
    createVideoContentRouter({
      config,
      db,
      requireAuthMiddleware,
      requireCsrfMiddleware: requireCsrf,
      videoJobRunner,
      storageProvider: videoStorageProvider,
    }),
  );
  app.use(
    "/api/sync/ada",
    createAdaSyncRouter({
      config,
      db,
      crmMirrorClient,
    }),
  );
  app.use(
    "/api/sync",
    createSyncRouter({
      config,
      db,
    }),
  );

  app.use((req, res) => {
    return res.status(404).json({
      error: "Not found",
      request_id: req.requestId || null,
    });
  });

  app.use((error, req, res, _next) => {
    const status = error.statusCode || error.status || 500;
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(`[admin-api:${req.requestId}]`, error);
    }
    return res.status(status).json({
      error: status >= 500 ? "Internal server error" : error.message,
      request_id: req.requestId || null,
    });
  });

  return { app, db, config };
}

async function startServer() {
  const { app, config, db } = createApp();
  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`admin-api listening on port ${config.port}`);
  });

  // Only scheduled for the real running process (never for createApp() calls made
  // directly by tests) — periodically deletes old video-studio files from local
  // disk since it isn't durable storage. No-ops if the feature flag is off, the
  // storage provider isn't "local", or the interval is set to 0.
  const assetCleanupTimer = startAssetCleanupSchedule({
    db,
    storageProvider: getStorageProvider(config),
    config,
    logger: console,
  });
  const preorderAttachmentCleanupTimer = startPreorderAttachmentCleanupSchedule({
    db,
    storageProvider: config.featureCustomerPreorders ? createR2PreorderStorageProvider(config) : null,
    config,
    logger: console,
  });
  const focusLinePackageCleanupTimer = startFocusLinePackageCleanupSchedule({
    db,
    storageProvider: config.r2AccessKeyId && config.r2SecretAccessKey && config.r2Endpoint && config.r2BucketName
      ? createR2PreorderStorageProvider(config)
      : null,
    config,
    logger: console,
  });

  // Nightly ordering.stock_recommendation_snapshots refresh. No-ops unless
  // FEATURE_STOCK_RECOMMENDATION_CRON is set — see stockRecommendationSchedule.js.
  const stockRecommendationCronTask = startStockRecommendationSchedule({
    db,
    config,
    logger: console,
  });

  const shutdown = async () => {
    if (assetCleanupTimer) clearInterval(assetCleanupTimer);
    if (preorderAttachmentCleanupTimer) clearInterval(preorderAttachmentCleanupTimer);
    if (focusLinePackageCleanupTimer) clearInterval(focusLinePackageCleanupTimer);
    if (stockRecommendationCronTask) stockRecommendationCronTask.stop();
    server.close(async () => {
      if (db && typeof db.end === "function") {
        await db.end();
      }
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`Failed to start admin-api: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createApp,
  startServer,
};
