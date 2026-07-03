"use strict";

const ROLE_PERMISSIONS = {
  admin: new Set([
    "content.video.create",
    "content.video.view",
    "content.video.download",
    "content.video.approve",
    "content.video.reject",
    "content.video.retry",
    "content.video.admin",
  ]),
  staff: new Set([
    "content.video.create",
    "content.video.view",
    "content.video.download",
    "content.video.retry",
  ]),
  branch: new Set(["content.video.view"]),
};

function requirePermission(...requiredPermissions) {
  return function requirePermissionMiddleware(req, res, next) {
    const role = req.auth && req.auth.role;
    const granted = ROLE_PERMISSIONS[role] || new Set();
    const ok = requiredPermissions.every((permission) => granted.has(permission));
    if (!ok) {
      return res.status(403).json({
        error: "Forbidden",
        request_id: req.requestId || null,
      });
    }
    return next();
  };
}

module.exports = {
  ROLE_PERMISSIONS,
  requirePermission,
};
