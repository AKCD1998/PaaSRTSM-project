"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

function generateCsrfToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function buildSessionPayload(identity) {
  return {
    sub: identity.userId,
    role: identity.role,
    branch_code: identity.effectiveBranchCode || null,
    actor_branch_code: identity.actorBranchCode || null,
    is_branch_override: Boolean(identity.isBranchOverride),
    csrf: identity.csrfToken,
  };
}

function signSessionToken(payload, config) {
  if (!config.authJwtSecret) {
    throw new Error("AUTH_JWT_SECRET is required");
  }
  return jwt.sign(payload, config.authJwtSecret, {
    expiresIn: `${config.sessionTtlHours}h`,
  });
}

function verifySessionToken(token, config) {
  if (!token || !config.authJwtSecret) {
    return null;
  }
  try {
    return jwt.verify(token, config.authJwtSecret);
  } catch (error) {
    return null;
  }
}

// Mobile PDA token: a narrow, Bearer-delivered JWT (not a cookie). It carries the
// enrollment_id so every request can be re-checked against ordering.enrolled_devices
// (revocation + expiry). kind:"mobile" keeps it distinguishable from web sessions.
function buildMobileTokenPayload(identity) {
  return {
    sub: String(identity.staffId),
    kind: "mobile",
    role: identity.role,
    branch_code: identity.branchCode || null,
    enrollment_id: identity.enrollmentId,
    device_id: identity.deviceId || null,
  };
}

function signMobileToken(payload, config, ttlHours = 24) {
  if (!config.authJwtSecret) {
    throw new Error("AUTH_JWT_SECRET is required");
  }
  return jwt.sign(payload, config.authJwtSecret, {
    expiresIn: `${ttlHours}h`,
  });
}

function authCookieOptions(config) {
  return {
    httpOnly: true,
    secure: Boolean(config.cookieSecure),
    sameSite: config.cookieSameSite || "lax",
    path: "/",
    maxAge: config.sessionTtlHours * 60 * 60 * 1000,
  };
}

module.exports = {
  generateCsrfToken,
  buildSessionPayload,
  signSessionToken,
  verifySessionToken,
  buildMobileTokenPayload,
  signMobileToken,
  authCookieOptions,
};
