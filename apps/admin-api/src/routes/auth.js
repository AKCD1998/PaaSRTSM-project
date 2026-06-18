"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { auditLog } = require("../audit");
const { auditBase } = require("../utils/audit-payload");
const {
  normalizeUserId,
  normalizeBranchCode,
  resolveConfiguredUserAccount,
  findBranchRecordByCode,
} = require("../auth/users");
const {
  generateCsrfToken,
  buildSessionPayload,
  signSessionToken,
  authCookieOptions,
} = require("../auth/session");

function buildSessionIdentity(account, csrfToken, options = {}) {
  const actorBranchCode =
    options.actorBranchCode !== undefined
      ? options.actorBranchCode
      : account.role === "branch"
        ? account.branchCode || null
        : null;
  const effectiveBranchCode =
    options.effectiveBranchCode !== undefined ? options.effectiveBranchCode : actorBranchCode;

  return {
    userId: account.userId,
    role: account.role,
    csrfToken,
    actorBranchCode,
    effectiveBranchCode,
    isBranchOverride: Boolean(options.isBranchOverride),
  };
}

function setAuthCookie(res, sessionIdentity, config) {
  const token = signSessionToken(buildSessionPayload(sessionIdentity), config);
  res.cookie(config.cookieName, token, authCookieOptions(config));
}

function buildUserResponse(sessionIdentity) {
  return {
    id: sessionIdentity.userId,
    role: sessionIdentity.role,
    branch_code: sessionIdentity.effectiveBranchCode || null,
    actor_branch_code: sessionIdentity.actorBranchCode || null,
    effective_branch_code: sessionIdentity.effectiveBranchCode || null,
    is_branch_override: Boolean(sessionIdentity.isBranchOverride),
  };
}

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

    const account = resolveConfiguredUserAccount(username, config);
    if (!account || !account.passwordHash) {
      registerLoginFailure(req);
      await auditLog(
        db,
        auditBase(req, {
          actor_role: account?.role || "system",
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

    if (account.role === "branch" && !config.featureStockRequests) {
      registerLoginFailure(req);
      await auditLog(
        db,
        auditBase(req, {
          actor_role: "branch",
          actor_id: username,
          action: "auth.login_failed",
          success: false,
          message: "Branch authentication disabled",
        }),
      );
      return res.status(403).json({
        error: "Branch authentication disabled",
        request_id: req.requestId,
      });
    }

    const isValid = await bcrypt.compare(password, account.passwordHash);
    if (!isValid) {
      registerLoginFailure(req);
      await auditLog(
        db,
        auditBase(req, {
          actor_role: account.role,
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

    let resolvedBranch = null;
    if (account.role === "branch") {
      resolvedBranch = await findBranchRecordByCode(db, account.branchCode);
      if (!resolvedBranch) {
        await auditLog(
          db,
          auditBase(req, {
            actor_role: account.role,
            actor_id: username,
            action: "auth.login_failed",
            success: false,
            message: "Branch assignment not found",
            meta: {
              branch_code: account.branchCode,
            },
          }),
        );
        return res.status(403).json({
          error: "Branch access denied",
          request_id: req.requestId,
        });
      }
      if (!resolvedBranch.isActive) {
        await auditLog(
          db,
          auditBase(req, {
            actor_role: account.role,
            actor_id: username,
            action: "auth.login_failed",
            success: false,
            message: "Branch inactive",
            meta: {
              branch_code: resolvedBranch.branchCode,
            },
          }),
        );
        return res.status(403).json({
          error: "Branch inactive",
          request_id: req.requestId,
        });
      }
    }

    clearLoginFailures(req);
    const csrfToken = generateCsrfToken();
    const sessionIdentity = buildSessionIdentity(
      {
        ...account,
        branchCode: resolvedBranch?.branchCode || null,
      },
      csrfToken,
    );
    setAuthCookie(res, sessionIdentity, config);

    await auditLog(
      db,
      auditBase(req, {
        actor_role: account.role,
        actor_id: username,
        action: "auth.login_success",
        success: true,
        meta: {
          branch_code: sessionIdentity.effectiveBranchCode,
        },
      }),
    );

    return res.json({
      ok: true,
      request_id: req.requestId,
      user: buildUserResponse(sessionIdentity),
      csrf_token: csrfToken,
    });
  });

  router.post("/branch-override", requireAuthMiddleware, requireCsrfMiddleware, async (req, res) => {
    if (!config.featureStockRequests) {
      return res.status(404).json({
        error: "Not found",
        request_id: req.requestId,
      });
    }

    if (req.auth.role !== "admin") {
      await auditLog(
        db,
        auditBase(req, {
          action: "auth.branch_override_denied",
          success: false,
          message: "Only admins can override branch context",
          meta: {
            requested_branch_code: req.body?.branchCode || req.body?.branch_code || null,
          },
        }),
      );
      return res.status(403).json({
        error: "Forbidden",
        request_id: req.requestId,
      });
    }

    const requestedBranchCode = normalizeBranchCode(req.body?.branchCode || req.body?.branch_code);
    if (!requestedBranchCode) {
      return res.status(400).json({
        error: "Invalid branch code",
        request_id: req.requestId,
      });
    }

    const branch = await findBranchRecordByCode(db, requestedBranchCode);
    if (!branch) {
      return res.status(400).json({
        error: "Invalid branch code",
        request_id: req.requestId,
      });
    }
    if (!branch.isActive) {
      return res.status(403).json({
        error: "Branch inactive",
        request_id: req.requestId,
      });
    }

    const sessionIdentity = buildSessionIdentity(
      {
        userId: req.auth.userId,
        role: req.auth.role,
        branchCode: null,
      },
      req.auth.csrf,
      {
        actorBranchCode: req.auth.actorBranchCode || null,
        effectiveBranchCode: branch.branchCode,
        isBranchOverride: true,
      },
    );
    setAuthCookie(res, sessionIdentity, config);

    await auditLog(
      db,
      auditBase(req, {
        action: "auth.branch_override_set",
        success: true,
        meta: {
          branch_code: branch.branchCode,
          branch_name: branch.branchName,
          is_hq: branch.isHq,
        },
      }),
    );

    return res.json({
      ok: true,
      request_id: req.requestId,
      user: buildUserResponse(sessionIdentity),
      csrf_token: req.auth.csrf,
    });
  });

  router.delete("/branch-override", requireAuthMiddleware, requireCsrfMiddleware, async (req, res) => {
    if (!config.featureStockRequests) {
      return res.status(404).json({
        error: "Not found",
        request_id: req.requestId,
      });
    }

    if (req.auth.role !== "admin") {
      await auditLog(
        db,
        auditBase(req, {
          action: "auth.branch_override_denied",
          success: false,
          message: "Only admins can clear branch context overrides",
        }),
      );
      return res.status(403).json({
        error: "Forbidden",
        request_id: req.requestId,
      });
    }

    const sessionIdentity = buildSessionIdentity(
      {
        userId: req.auth.userId,
        role: req.auth.role,
        branchCode: null,
      },
      req.auth.csrf,
      {
        actorBranchCode: req.auth.actorBranchCode || null,
        effectiveBranchCode: null,
        isBranchOverride: false,
      },
    );
    setAuthCookie(res, sessionIdentity, config);

    await auditLog(
      db,
      auditBase(req, {
        action: "auth.branch_override_cleared",
        success: true,
      }),
    );

    return res.json({
      ok: true,
      request_id: req.requestId,
      user: buildUserResponse(sessionIdentity),
      csrf_token: req.auth.csrf,
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
        meta: {
          branch_code: req.auth.effectiveBranchCode || null,
          is_branch_override: Boolean(req.auth.isBranchOverride),
        },
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
