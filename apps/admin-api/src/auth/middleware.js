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
    const effectiveBranchCode = decoded.branch_code || null;
    const actorBranchCode =
      decoded.actor_branch_code != null
        ? decoded.actor_branch_code || null
        : decoded.role === "branch"
          ? effectiveBranchCode
          : null;

    req.auth = {
      userId: decoded.sub,
      role: decoded.role,
      csrf: decoded.csrf || "",
      branchCode: effectiveBranchCode,
      actorBranchCode,
      effectiveBranchCode,
      isBranchOverride: Boolean(decoded.is_branch_override),
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

function getBearerToken(req) {
  const header = String(req.headers["authorization"] || "");
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

// Auth for the mobile PDA app. Verifies the Bearer mobile token AND re-checks the
// backing ordering.enrolled_devices row on every request, so revocation (revoked_at)
// or expiry takes effect immediately. Deliberately narrow: it only populates req.mobile
// and is mounted on PDA endpoints only — it never grants the admin/CRM surface.
function requireMobileToken({ config, db }) {
  return async function mobileAuthMiddleware(req, res, next) {
    const token = getBearerToken(req);
    const decoded = verifySessionToken(token, config);
    if (
      !decoded ||
      decoded.kind !== "mobile" ||
      !decoded.sub ||
      !decoded.enrollment_id
    ) {
      return res.status(401).json({
        error: "Unauthorized",
        request_id: req.requestId,
      });
    }

    let row;
    try {
      const result = await db.query(
        `
          SELECT enrollment_id, device_id, branch_code, staff_id, role, revoked_at, expires_at
          FROM ordering.enrolled_devices
          WHERE enrollment_id = $1
        `,
        [decoded.enrollment_id],
      );
      row = result.rows[0] || null;
    } catch (error) {
      return res.status(503).json({
        error: "Authorization check failed",
        request_id: req.requestId,
      });
    }

    const expiresAtMs = row?.expires_at ? new Date(row.expires_at).getTime() : 0;
    if (!row || row.revoked_at || !expiresAtMs || expiresAtMs <= Date.now()) {
      return res.status(401).json({
        error: "Device enrollment revoked or expired",
        request_id: req.requestId,
      });
    }

    req.mobile = {
      staffId: String(row.staff_id),
      role: row.role,
      branchCode: row.branch_code,
      enrollmentId: row.enrollment_id,
      deviceId: decoded.device_id || row.device_id || null,
    };
    return next();
  };
}

function requireMobileRole(...allowedRoles) {
  const allowed = new Set(allowedRoles);
  return function mobileRoleMiddleware(req, res, next) {
    const role = req.mobile?.role;
    if (!role || !allowed.has(role)) {
      return res.status(403).json({
        error: "Forbidden",
        request_id: req.requestId,
      });
    }
    return next();
  };
}

function getAuthenticatedBranch(req) {
  return req.auth?.effectiveBranchCode || null;
}

function requireBranchIdentity(req, res, next) {
  if (!getAuthenticatedBranch(req)) {
    return res.status(403).json({
      error: "Branch identity required",
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
  getBearerToken,
  requireMobileToken,
  requireMobileRole,
  getAuthenticatedBranch,
  requireBranchIdentity,
};
