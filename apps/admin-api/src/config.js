"use strict";

const { inferEmbeddingDimension } = require("./embeddings/provider");
const { DEFAULT_USD_TO_THB_RATE } = require("./services/video-providers/videoStudioConstants");

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

function parseFloatWithFallback(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n;
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

// Parse STAFF_BRANCH_ALLOWLISTS: "user1@example.com:001|002;user2@example.com:003"
// Returns Map<userId, Set<branchCode>>
function parseMultiValueMap(value, options = {}) {
  if (!value) {
    return new Map();
  }
  const normalizeKey = typeof options.normalizeKey === "function" ? options.normalizeKey : (k) => k;
  const normalizeItem = typeof options.normalizeItem === "function" ? options.normalizeItem : (v) => v;
  const entrySeparator = options.entrySeparator || ";";
  const valueSeparator = options.valueSeparator || "|";

  const map = new Map();
  for (const rawEntry of String(value).split(entrySeparator)) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) continue;
    const key = normalizeKey(entry.slice(0, separatorIndex).trim());
    if (!key) continue;
    const items = new Set(
      entry
        .slice(separatorIndex + 1)
        .trim()
        .split(valueSeparator)
        .map((v) => normalizeItem(v.trim()))
        .filter(Boolean),
    );
    if (items.size > 0) {
      map.set(key, items);
    }
  }
  return map;
}

function parseKeyValueMap(value, options = {}) {
  if (!value) {
    return new Map();
  }
  const normalizeKey = typeof options.normalizeKey === "function" ? options.normalizeKey : (entry) => entry;
  const normalizeValue =
    typeof options.normalizeValue === "function" ? options.normalizeValue : (entry) => entry;

  const map = new Map();
  for (const rawEntry of String(value).split(",")) {
    const entry = rawEntry.trim();
    if (!entry) {
      continue;
    }
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      continue;
    }
    const key = normalizeKey(entry.slice(0, separatorIndex).trim());
    const parsedValue = normalizeValue(entry.slice(separatorIndex + 1).trim());
    if (!key || parsedValue == null || parsedValue === "") {
      continue;
    }
    map.set(key, parsedValue);
  }
  return map;
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
    cipdataSupabaseUrl: env.CIPDATA_SUPABASE_URL || "",
    cipdataSupabaseServiceRoleKey: env.CIPDATA_SUPABASE_SERVICE_ROLE_KEY || "",
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
    defaultPeriodDays: parseIntWithFallback(env.DEFAULT_PERIOD_DAYS, 30),
    featureStockRequests: parseBool(env.FEATURE_STOCK_REQUESTS, false),
    featureMobilePda: parseBool(env.FEATURE_MOBILE_PDA, false),
    mobileEnrollCodeTtlSeconds: parseIntWithFallback(env.MOBILE_ENROLL_CODE_TTL_SECONDS, 60),
    mobileTokenTtlHours: parseIntWithFallback(env.MOBILE_TOKEN_TTL_HOURS, 24),
    embeddingProvider,
    embeddingModel,
    embeddingDimension,
    embeddingTimeoutMs: parseIntWithFallback(env.EMBEDDING_TIMEOUT_MS, 30_000),
    embeddingOpenAiBaseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    adminUsers: parseAllowlist(env.ADMIN_USERS),
    staffUsers: parseAllowlist(env.STAFF_USERS),
    branchUsers: parseAllowlist(env.BRANCH_USERS),
    adminPasswordHash: env.ADMIN_PASSWORD_HASH || "",
    staffPasswordHash: env.STAFF_PASSWORD_HASH || "",
    branchUserBranches: parseKeyValueMap(env.BRANCH_USER_BRANCHES || "", {
      normalizeKey: (entry) => String(entry || "").trim().toLowerCase(),
      normalizeValue: (entry) => String(entry || "").trim(),
    }),
    branchUserPasswordHashes: parseKeyValueMap(env.BRANCH_USER_PASSWORD_HASHES || "", {
      normalizeKey: (entry) => String(entry || "").trim().toLowerCase(),
      normalizeValue: (entry) => String(entry || "").trim(),
    }),
    posApiKeys: parseCsvSet(env.POS_API_KEYS || ""),
    crmMirrorBaseUrl: env.CRM_MIRROR_BASE_URL || "",
    crmMirrorInternalToken: env.CRM_MIRROR_INTERNAL_TOKEN || "",
    staffBranchAllowlists: parseMultiValueMap(env.STAFF_BRANCH_ALLOWLISTS || "", {
      normalizeKey: (k) => String(k || "").trim().toLowerCase(),
      normalizeItem: (v) => (/^\d{3}$/.test(String(v || "").trim()) ? String(v).trim() : null),
    }),

    // AI Video Content Studio (Phase 1)
    featureVideoStudio: parseBool(env.FEATURE_VIDEO_STUDIO, false),
    videoProviderDefault: env.VIDEO_PROVIDER_DEFAULT || "mock",
    videoProviderEnabled: parseCsvSet(env.VIDEO_PROVIDER_ENABLED || "mock,openai", {
      lowercase: true,
    }),
    videoProviderApiKey:
      env.VIDEO_PROVIDER_API_KEY || (env.VIDEO_PROVIDER_DEFAULT === "openai" ? env.OPENAI_API_KEY || "" : "") || "",
    videoProviderModel: env.VIDEO_PROVIDER_MODEL || "sora-2",
    // Reserved, unused this phase: will authenticate provider webhook callbacks once
    // Phase 2 moves off polling.
    videoProviderWebhookSecret: env.VIDEO_PROVIDER_WEBHOOK_SECRET || "",
    videoStorageProvider: env.VIDEO_STORAGE_PROVIDER || "local",
    videoStorageLocalDir: env.VIDEO_STORAGE_LOCAL_DIR || "./data/video-studio",
    // Reserved for an r2 storage adapter (not implemented this phase).
    videoStorageBucket: env.VIDEO_STORAGE_BUCKET || "",
    videoStoragePublicBaseUrl: env.VIDEO_STORAGE_PUBLIC_BASE_URL || "",
    videoSignedUrlSecret: env.VIDEO_SIGNED_URL_SECRET || env.AUTH_JWT_SECRET || "",
    videoMaxPromptLength: parseIntWithFallback(env.VIDEO_MAX_PROMPT_LENGTH, 2000),
    videoMaxUploadBytes: parseIntWithFallback(env.VIDEO_MAX_UPLOAD_MB, 50) * 1024 * 1024,
    videoMaxJobsPerUserPerDay: parseIntWithFallback(env.VIDEO_MAX_JOBS_PER_USER_PER_DAY, 20),
    videoMaxConcurrentJobsPerUser: parseIntWithFallback(env.VIDEO_MAX_CONCURRENT_JOBS_PER_USER, 3),
    videoMaxRetries: parseIntWithFallback(env.VIDEO_MAX_RETRIES, 3),
    videoPollIntervalMs: parseIntWithFallback(env.VIDEO_POLL_INTERVAL_MS, 10000),
    videoMaxPollMinutes: parseIntWithFallback(env.VIDEO_MAX_POLL_MINUTES, 30),
    // Display-only conversion for the Usage & Cost dashboard — not a live FX rate,
    // update manually via env var when it drifts too far from reality.
    usdToThbRate: parseFloatWithFallback(env.USD_TO_THB_RATE, DEFAULT_USD_TO_THB_RATE),
  };
}

module.exports = {
  loadConfig,
};
