"use strict";

const crypto = require("crypto");
const { verifySessionToken } = require("./session");

function requestContextMiddleware(req, res, next) {
  req.requestId = crypto.randomUUID();
  req.receivedAt = Date.now();
  next();
}

function getRequestIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "";
}

function createLoginRateLimiter(config) {
  const bucket = new Map();

  return function loginRateLimit(req, res, next) {
    const now = Date.now();
    const user = String(req.body?.username || req.body?.email || "").toLowerCase();
    const ip = getRequestIp(req);
    const key = `${ip}|${user}`;

    const current = bucket.get(key) || { count: 0, resetAt: now + config.loginRateLimitWindowMs };
    if (now > current.resetAt) {
      current.count = 0;
      current.resetAt = now + config.loginRateLimitWindowMs;
    }

    if (current.count >= config.loginRateLimitMax) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "Too many login attempts",
        request_id: req.requestId,
      });
    }

    req.loginRateLimitKey = key;
    req.loginRateLimitState = current;
    bucket.set(key, current);
    return next();
  };
}

function registerLoginFailure(req) {
  if (!req.loginRateLimitState) {
    return;
  }
  req.loginRateLimitState.count += 1;
}

function clearLoginFailures(req) {
  if (!req.loginRateLimitState) {
    return;
  }
  req.loginRateLimitState.count = 0;
}

function requireAuth(config) {
  return function authMiddleware(req, res, next) {
    const token = req.cookies?.[config.cookieName];
    const decoded = verifySessionToken(token, config);
    if (!decoded || !decoded.sub || !decoded.role) {
      return res.status(401).json({
        error: "Unauthorized",
        request_id: req.requestId,
      });
    }
    req.auth = {
      userId: decoded.sub,
      role: decoded.role,
      csrf: decoded.csrf || "",
    };
    return next();
  };
}

function requireRole(...allowedRoles) {
  const allowed = new Set(allowedRoles);
  return function roleMiddleware(req, res, next) {
    const role = req.auth?.role;
    if (!role || !allowed.has(role)) {
      return res.status(403).json({
        error: "Forbidden",
        request_id: req.requestId,
      });
    }
    return next();
  };
}

function requireCsrf(req, res, next) {
  const token = String(req.headers["x-csrf-token"] || "");
  if (!token || token !== req.auth?.csrf) {
    return res.status(403).json({
      error: "CSRF token invalid",
      request_id: req.requestId,
    });
  }
  return next();
}

module.exports = {
  requestContextMiddleware,
  getRequestIp,
  createLoginRateLimiter,
  registerLoginFailure,
  clearLoginFailures,
  requireAuth,
  requireRole,
  requireCsrf,
};
