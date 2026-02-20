"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

function generateCsrfToken() {
  return crypto.randomBytes(24).toString("base64url");
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
  signSessionToken,
  verifySessionToken,
  authCookieOptions,
};
