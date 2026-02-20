"use strict";

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

function auditBase(req, overrides = {}) {
  return {
    actor_role: req.auth?.role || "system",
    actor_id: req.auth?.userId || null,
    request_id: req.requestId || null,
    ip: getClientIp(req),
    user_agent: req.get("user-agent") || null,
    ...overrides,
  };
}

module.exports = {
  auditBase,
  getClientIp,
};
