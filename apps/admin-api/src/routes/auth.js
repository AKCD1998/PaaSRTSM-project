"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { auditLog } = require("../audit");
const { auditBase } = require("../utils/audit-payload");
const { normalizeUserId, resolveUserRole, getPasswordHashForRole } = require("../auth/users");
const { generateCsrfToken, signSessionToken, authCookieOptions } = require("../auth/session");

function createAuthRouter(deps) {
  const {
    config,
    db,
    loginRateLimitMiddleware,
    requireAuthMiddleware,
    requireCsrfMiddleware,
    registerLoginFailure,
    clearLoginFailures,
  } = deps;

  const router = express.Router();

  router.post("/login", loginRateLimitMiddleware, async (req, res) => {
    const username = normalizeUserId(req.body?.username || req.body?.email);
    const password = String(req.body?.password || "");

    if (!username || !password) {
      registerLoginFailure(req);
      await auditLog(
        db,
        auditBase(req, {
          actor_role: "system",
          actor_id: username || null,
          action: "auth.login_failed",
          success: false,
          message: "Missing username or password",
        }),
      );
      return res.status(400).json({
        error: "Missing username or password",
        request_id: req.requestId,
      });
    }

    const role = resolveUserRole(username, config);
    const hash = getPasswordHashForRole(role, config);
    if (!role || !hash) {
      registerLoginFailure(req);
      await auditLog(
        db,
        auditBase(req, {
          actor_role: role || "system",
          actor_id: username,
          action: "auth.login_failed",
          success: false,
          message: "Invalid credentials",
        }),
      );
      return res.status(401).json({
        error: "Invalid credentials",
        request_id: req.requestId,
      });
    }

    const isValid = await bcrypt.compare(password, hash);
    if (!isValid) {
      registerLoginFailure(req);
      await auditLog(
        db,
        auditBase(req, {
          actor_role: role,
          actor_id: username,
          action: "auth.login_failed",
          success: false,
          message: "Invalid credentials",
        }),
      );
      return res.status(401).json({
        error: "Invalid credentials",
        request_id: req.requestId,
      });
    }

    clearLoginFailures(req);
    const csrfToken = generateCsrfToken();
    const token = signSessionToken(
      {
        sub: username,
        role,
        csrf: csrfToken,
      },
      config,
    );

    res.cookie(config.cookieName, token, authCookieOptions(config));

    await auditLog(
      db,
      auditBase(req, {
        actor_role: role,
        actor_id: username,
        action: "auth.login_success",
        success: true,
      }),
    );

    return res.json({
      ok: true,
      request_id: req.requestId,
      user: {
        id: username,
        role,
      },
      csrf_token: csrfToken,
    });
  });

  router.post("/logout", requireAuthMiddleware, requireCsrfMiddleware, async (req, res) => {
    const role = req.auth.role;
    const actorId = req.auth.userId;

    res.clearCookie(config.cookieName, {
      httpOnly: true,
      secure: Boolean(config.cookieSecure),
      sameSite: config.cookieSameSite || "lax",
      path: "/",
    });

    await auditLog(
      db,
      auditBase(req, {
        actor_role: role,
        actor_id: actorId,
        action: "auth.logout",
        success: true,
      }),
    );

    return res.json({
      ok: true,
      request_id: req.requestId,
    });
  });

  return router;
}

module.exports = {
  createAuthRouter,
};
