"use strict";

const { inferEmbeddingDimension } = require("./embeddings/provider");

function parseBool(value, fallback) {
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

function parseIntWithFallback(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function parseAllowlist(value) {
  if (!value) {
    return new Set();
  }
  return new Set(
    String(value)
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function normalizeOrigin(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function parseCsvSet(value, options = {}) {
  if (!value) {
    return new Set();
  }
  const lowercase = Boolean(options.lowercase);
  const normalizer = typeof options.normalizer === "function" ? options.normalizer : null;
  return new Set(
    String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        if (normalizer) {
          return normalizer(entry);
        }
        return lowercase ? entry.toLowerCase() : entry;
      }),
  );
}

function parseCookieSameSite(value, fallback = "lax") {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (["lax", "strict", "none"].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function parseOptionalPositiveInt(value, fallback = null) {
  if (value == null || value === "") {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const cookieSecure = parseBool(env.COOKIE_SECURE, nodeEnv === "production");
  const cookieSameSite = parseCookieSameSite(env.COOKIE_SAME_SITE, "lax");
  const embeddingProvider = String(env.EMBEDDING_PROVIDER || "mock").trim().toLowerCase();
  const embeddingModel = String(
    env.EMBEDDING_MODEL || (embeddingProvider === "openai" ? "text-embedding-3-small" : "mock-embedding-model"),
  ).trim();
  const embeddingDimension =
    parseOptionalPositiveInt(env.EMBEDDING_DIM, null) || inferEmbeddingDimension(embeddingModel) || 1536;

  return {
    nodeEnv,
    port: parseIntWithFallback(env.PORT, 3001),
    databaseUrl: env.DATABASE_URL || "",
    authJwtSecret: env.AUTH_JWT_SECRET || "",
    cookieName: env.COOKIE_NAME || "admin_session",
    cookieSecure,
    cookieSameSite,
    sessionTtlHours: parseIntWithFallback(env.SESSION_TTL_HOURS, 12),
    trustProxy: parseBool(env.TRUST_PROXY, true),
    corsAllowedOrigins: parseCsvSet(env.CORS_ALLOWED_ORIGINS || "", {
      normalizer: normalizeOrigin,
    }),
    corsAllowAllOrigins: parseBool(env.CORS_ALLOW_ALL, false),
    loginRateLimitMax: parseIntWithFallback(env.LOGIN_RATE_LIMIT_MAX, 10),
    loginRateLimitWindowMs: parseIntWithFallback(env.LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    maxUploadBytes: parseIntWithFallback(env.MAX_UPLOAD_MB, 25) * 1024 * 1024,
    embeddingProvider,
    embeddingModel,
    embeddingDimension,
    embeddingTimeoutMs: parseIntWithFallback(env.EMBEDDING_TIMEOUT_MS, 30_000),
    embeddingOpenAiBaseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    adminUsers: parseAllowlist(env.ADMIN_USERS),
    staffUsers: parseAllowlist(env.STAFF_USERS),
    adminPasswordHash: env.ADMIN_PASSWORD_HASH || "",
    staffPasswordHash: env.STAFF_PASSWORD_HASH || "",
  };
}

module.exports = {
  loadConfig,
};
