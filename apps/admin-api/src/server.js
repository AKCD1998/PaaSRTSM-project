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
} = require("./auth/middleware");
const { createHealthRouter } = require("./routes/health");
const { createAuthRouter } = require("./routes/auth");
const { createMeRouter } = require("./routes/me");
const { createProductsRouter } = require("./routes/products");
const { createImportsRouter } = require("./routes/imports");
const { createEnrichmentRouter } = require("./routes/enrichment");

function createApp(overrides = {}) {
  const config = overrides.config || loadConfig(process.env);
  const db = overrides.db || createDbPool(config);
  const runImporter =
    overrides.runImporter || require("../../../scripts/import_adapos_csv").runImporter;
  const runRuleApplication =
    overrides.runRuleApplication || require("../../../scripts/apply_enrichment_rules").runRuleApplication;

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

  const shutdown = async () => {
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
