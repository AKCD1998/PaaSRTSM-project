"use strict";

const crypto = require("crypto");
const express = require("express");
const { auditLog } = require("../audit");
const { auditBase } = require("../utils/audit-payload");
const { buildMobileTokenPayload, signMobileToken } = require("../auth/session");

function generateEnrollmentCode() {
  // ~14 chars, URL-safe; the QR carries exactly this string.
  return crypto.randomBytes(10).toString("base64url");
}

function normalizeDeviceId(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 200) {
    return null;
  }
  return text;
}

function notFound(res, req) {
  return res.status(404).json({ error: "Not found", request_id: req.requestId });
}

function hasBearerAuthorization(req) {
  const header = String(req.headers?.authorization || "").trim();
  return /^Bearer\s+\S+/i.test(header);
}

function createEnrollStartAccessMiddleware(deps) {
  const {
    requireAuthMiddleware,
    requireRoleMiddleware,
    requireCsrfMiddleware,
    requireMobileTokenMiddleware,
    requireMobileRoleMiddleware,
  } = deps;

  const webBranchFlow = [
    requireAuthMiddleware,
    requireRoleMiddleware("branch"),
    requireCsrfMiddleware,
  ];
  const mobileManagerFlow = [
    requireMobileTokenMiddleware,
    requireMobileRoleMiddleware("manager"),
  ];

  return async function enrollStartAccessMiddleware(req, res, next) {
    const chain = hasBearerAuthorization(req) ? mobileManagerFlow : webBranchFlow;
    let index = 0;

    const dispatch = async (error) => {
      if (error) {
        return next(error);
      }
      const middleware = chain[index];
      index += 1;
      if (!middleware) {
        return next();
      }
      return middleware(req, res, dispatch);
    };

    return dispatch();
  };
}

function getEnrollStartIdentity(req) {
  if (req.mobile?.branchCode) {
    return {
      branchCode: req.mobile.branchCode,
      issuedBy: `staff:${req.mobile.staffId}`,
    };
  }
  return {
    branchCode: req.auth?.effectiveBranchCode || null,
    issuedBy: req.auth?.userId || null,
  };
}

/**
 * Mobile PDA enrollment router (person-lite model).
 * Mounted at /api/mobile and gated by config.featureMobilePda.
 */
function createMobileEnrollRouter(deps) {
  const {
    config,
    db,
    requireAuthMiddleware,
    requireRoleMiddleware,
    requireCsrfMiddleware,
    requireMobileTokenMiddleware,
    requireMobileRoleMiddleware,
  } = deps;

  const router = express.Router();
  const requireEnrollStartAccess = createEnrollStartAccessMiddleware(deps);

  router.use((req, res, next) => {
    if (!config.featureMobilePda) {
      return notFound(res, req);
    }
    return next();
  });

  // POST /api/mobile/enroll/start — branch master mints a single-use QR code.
  router.post(
    "/enroll/start",
    requireEnrollStartAccess,
    async (req, res, next) => {
      const { branchCode, issuedBy } = getEnrollStartIdentity(req);
      if (!branchCode) {
        return res.status(403).json({
          error: "Branch identity required",
          request_id: req.requestId,
        });
      }

      const ttlSeconds = config.mobileEnrollCodeTtlSeconds || 60;
      try {
        let inserted = null;
        // Retry a couple of times on the (vanishingly unlikely) unique collision.
        for (let attempt = 0; attempt < 3 && !inserted; attempt += 1) {
          const code = generateEnrollmentCode();
          try {
            const result = await db.query(
              `
                INSERT INTO ordering.enrollment_codes (code, branch_code, issued_by, expires_at)
                VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)
                RETURNING code, expires_at
              `,
              [code, branchCode, issuedBy, String(ttlSeconds)],
            );
            inserted = result.rows[0];
          } catch (error) {
            if (error && error.code === "23505") {
              continue; // duplicate code, try again
            }
            throw error;
          }
        }

        if (!inserted) {
          return res.status(500).json({
            error: "Could not allocate enrollment code",
            request_id: req.requestId,
          });
        }

        await auditLog(
          db,
          auditBase(req, {
            action: "mobile.enroll_started",
            target_type: "branch",
            target_id: branchCode,
            success: true,
          }),
        );

        return res.status(201).json({
          code: inserted.code,
          branchCode,
          expiresAt: inserted.expires_at,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  // GET /api/mobile/enroll/roster?code=... — after scanning, the phone fetches the
  // branch's self-enrollable staff list (active + non-probationary) to "tap your name".
  router.get("/enroll/roster", async (req, res, next) => {
    const code = String(req.query.code || "").trim();
    if (!code) {
      return res.status(400).json({ error: "code is required", request_id: req.requestId });
    }
    try {
      const codeResult = await db.query(
        `
          SELECT branch_code
          FROM ordering.enrollment_codes
          WHERE code = $1 AND used_at IS NULL AND expires_at > now()
        `,
        [code],
      );
      const codeRow = codeResult.rows[0];
      if (!codeRow) {
        return res.status(404).json({
          error: "Enrollment code is invalid or expired",
          request_id: req.requestId,
        });
      }

      const staffResult = await db.query(
        `
          SELECT staff_id, display_name, role
          FROM core.branch_staff
          WHERE branch_code = $1 AND is_active = TRUE AND is_probationary = FALSE
          ORDER BY display_name ASC
        `,
        [codeRow.branch_code],
      );

      return res.json({
        branchCode: codeRow.branch_code,
        staff: staffResult.rows.map((row) => ({
          staffId: String(row.staff_id),
          displayName: row.display_name,
          role: row.role,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  // POST /api/mobile/enroll/redeem { code, staffId, deviceId, deviceLabel? }
  // Validates and consumes the code in one transaction, then issues a 24h mobile token.
  router.post("/enroll/redeem", async (req, res, next) => {
    const code = String(req.body?.code || "").trim();
    const staffId = String(req.body?.staffId || "").trim();
    const deviceId = normalizeDeviceId(req.body?.deviceId);
    const deviceLabel =
      req.body?.deviceLabel != null ? String(req.body.deviceLabel).trim().slice(0, 200) : null;

    if (!code || !staffId || !deviceId) {
      return res.status(400).json({
        error: "code, staffId and deviceId are required",
        request_id: req.requestId,
      });
    }
    if (!/^\d+$/.test(staffId)) {
      return res.status(400).json({ error: "Invalid staffId", request_id: req.requestId });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const codeResult = await client.query(
        `
          SELECT code_id, branch_code
          FROM ordering.enrollment_codes
          WHERE code = $1 AND used_at IS NULL AND expires_at > now()
          FOR UPDATE
        `,
        [code],
      );
      const codeRow = codeResult.rows[0];
      if (!codeRow) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          error: "Enrollment code is invalid or expired",
          request_id: req.requestId,
        });
      }

      const staffResult = await client.query(
        `
          SELECT staff_id, display_name, role
          FROM core.branch_staff
          WHERE staff_id = $1
            AND branch_code = $2
            AND is_active = TRUE
            AND is_probationary = FALSE
        `,
        [staffId, codeRow.branch_code],
      );
      const staffRow = staffResult.rows[0];
      if (!staffRow) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          error: "Staff not eligible for enrollment at this branch",
          request_id: req.requestId,
        });
      }

      const ttlHours = config.mobileTokenTtlHours || 24;
      const deviceResult = await client.query(
        `
          INSERT INTO ordering.enrolled_devices
            (device_id, branch_code, staff_id, role, enrolled_by, device_label, expires_at)
          VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' hours')::interval)
          RETURNING enrollment_id, expires_at
        `,
        [
          deviceId,
          codeRow.branch_code,
          staffRow.staff_id,
          staffRow.role,
          codeRow.branch_code, // enrolled under the branch master's branch context
          deviceLabel,
          String(ttlHours),
        ],
      );
      const deviceRow = deviceResult.rows[0];

      await client.query(
        `
          UPDATE ordering.enrollment_codes
          SET used_at = now(), redeemed_staff_id = $2, redeemed_device_id = $3
          WHERE code_id = $1
        `,
        [codeRow.code_id, staffRow.staff_id, deviceId],
      );

      await client.query("COMMIT");

      const token = signMobileToken(
        buildMobileTokenPayload({
          staffId: staffRow.staff_id,
          role: staffRow.role,
          branchCode: codeRow.branch_code,
          enrollmentId: deviceRow.enrollment_id,
          deviceId,
        }),
        config,
        ttlHours,
      );

      await auditLog(
        db,
        auditBase(req, {
          actor_role: "branch",
          actor_id: String(staffRow.staff_id),
          action: "mobile.enroll_redeemed",
          target_type: "enrolled_device",
          target_id: String(deviceRow.enrollment_id),
          success: true,
          meta: { branch_code: codeRow.branch_code, role: staffRow.role },
        }),
      );

      return res.status(201).json({
        token,
        expiresAt: deviceRow.expires_at,
        role: staffRow.role,
        branchCode: codeRow.branch_code,
        staffId: String(staffRow.staff_id),
        staffName: staffRow.display_name,
        deviceId,
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        // ignore rollback failure; surface the original error
      }
      return next(error);
    } finally {
      client.release();
    }
  });

  // GET /api/mobile/devices — a branch Manager lists active devices at their branch.
  router.get(
    "/devices",
    requireMobileTokenMiddleware,
    requireMobileRoleMiddleware("manager"),
    async (req, res, next) => {
      try {
        const result = await db.query(
          `
            SELECT d.enrollment_id, d.device_id, d.device_label, d.role,
                   d.staff_id, s.display_name AS staff_name,
                   d.enrolled_at, d.expires_at, d.last_seen_at, d.revoked_at
            FROM ordering.enrolled_devices d
            LEFT JOIN core.branch_staff s ON s.staff_id = d.staff_id
            WHERE d.branch_code = $1
            ORDER BY d.enrolled_at DESC
          `,
          [req.mobile.branchCode],
        );
        return res.json({
          branchCode: req.mobile.branchCode,
          devices: result.rows.map((row) => ({
            enrollmentId: row.enrollment_id,
            deviceId: row.device_id,
            deviceLabel: row.device_label,
            role: row.role,
            staffId: String(row.staff_id),
            staffName: row.staff_name,
            enrolledAt: row.enrolled_at,
            expiresAt: row.expires_at,
            lastSeenAt: row.last_seen_at,
            revokedAt: row.revoked_at,
          })),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  // POST /api/mobile/enroll/revoke { enrollmentId } — Manager cuts off a device now.
  router.post(
    "/enroll/revoke",
    requireMobileTokenMiddleware,
    requireMobileRoleMiddleware("manager"),
    async (req, res, next) => {
      const enrollmentId = String(req.body?.enrollmentId || "").trim();
      if (!/^\d+$/.test(enrollmentId)) {
        return res.status(400).json({ error: "Invalid enrollmentId", request_id: req.requestId });
      }
      try {
        const result = await db.query(
          `
            UPDATE ordering.enrolled_devices
            SET revoked_at = now(), revoked_by = $2
            WHERE enrollment_id = $1 AND branch_code = $3 AND revoked_at IS NULL
            RETURNING enrollment_id
          `,
          [enrollmentId, `staff:${req.mobile.staffId}`, req.mobile.branchCode],
        );
        if (!result.rows[0]) {
          return res.status(404).json({
            error: "Enrollment not found at this branch",
            request_id: req.requestId,
          });
        }

        await auditLog(
          db,
          auditBase(req, {
            actor_role: "branch",
            actor_id: req.mobile.staffId,
            action: "mobile.enroll_revoked",
            target_type: "enrolled_device",
            target_id: enrollmentId,
            success: true,
            meta: { branch_code: req.mobile.branchCode },
          }),
        );

        return res.json({ ok: true, enrollmentId, request_id: req.requestId });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

/**
 * Admin-managed branch staff roster.
 * Mounted at /api/admin/branch-staff. Read = admin/staff; write = admin + CSRF.
 */
function createBranchStaffRouter(deps) {
  const { db, requireAuthMiddleware, requireRoleMiddleware, requireCsrfMiddleware } = deps;
  const router = express.Router();

  router.get(
    "/",
    requireAuthMiddleware,
    requireRoleMiddleware("admin", "staff"),
    async (req, res, next) => {
      const branchCode = req.query.branchCode ? String(req.query.branchCode).trim() : null;
      try {
        const params = [];
        let where = "";
        if (branchCode) {
          params.push(branchCode);
          where = "WHERE branch_code = $1";
        }
        const result = await db.query(
          `
            SELECT staff_id, branch_code, display_name, role, is_active, is_probationary, note
            FROM core.branch_staff
            ${where}
            ORDER BY branch_code ASC, display_name ASC
          `,
          params,
        );
        return res.json({
          staff: result.rows.map((row) => ({
            staffId: String(row.staff_id),
            branchCode: row.branch_code,
            displayName: row.display_name,
            role: row.role,
            isActive: row.is_active,
            isProbationary: row.is_probationary,
            note: row.note,
          })),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    requireCsrfMiddleware,
    async (req, res, next) => {
      const branchCode = String(req.body?.branchCode || "").trim();
      const displayName = String(req.body?.displayName || "").trim();
      const role = String(req.body?.role || "sales").trim();
      const isProbationary = Boolean(req.body?.isProbationary);
      const note = req.body?.note ? String(req.body.note).trim().slice(0, 255) : null;

      if (!/^\d{3}$/.test(branchCode)) {
        return res.status(400).json({ error: "Invalid branchCode", request_id: req.requestId });
      }
      if (!displayName) {
        return res.status(400).json({ error: "displayName is required", request_id: req.requestId });
      }
      if (!["sales", "manager"].includes(role)) {
        return res.status(400).json({ error: "Invalid role", request_id: req.requestId });
      }

      try {
        const result = await db.query(
          `
            INSERT INTO core.branch_staff (branch_code, display_name, role, is_probationary, note)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING staff_id, branch_code, display_name, role, is_active, is_probationary, note
          `,
          [branchCode, displayName, role, isProbationary, note],
        );
        const row = result.rows[0];

        await auditLog(
          db,
          auditBase(req, {
            action: "branch_staff.created",
            target_type: "branch_staff",
            target_id: String(row.staff_id),
            success: true,
            meta: { branch_code: branchCode, role },
          }),
        );

        return res.status(201).json({
          staff: {
            staffId: String(row.staff_id),
            branchCode: row.branch_code,
            displayName: row.display_name,
            role: row.role,
            isActive: row.is_active,
            isProbationary: row.is_probationary,
            note: row.note || null,
          },
        });
      } catch (error) {
        if (error && error.code === "23503") {
          return res.status(400).json({ error: "Unknown branchCode", request_id: req.requestId });
        }
        return next(error);
      }
    },
  );

  router.patch(
    "/:staffId",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    requireCsrfMiddleware,
    async (req, res, next) => {
      const staffId = String(req.params.staffId || "").trim();
      if (!/^\d+$/.test(staffId)) {
        return res.status(400).json({ error: "Invalid staffId", request_id: req.requestId });
      }

      const sets = [];
      const params = [];
      let idx = 1;
      if (req.body?.displayName != null) {
        const displayName = String(req.body.displayName).trim();
        if (!displayName) {
          return res.status(400).json({ error: "displayName cannot be empty", request_id: req.requestId });
        }
        sets.push(`display_name = $${idx}`);
        params.push(displayName);
        idx += 1;
      }
      if (req.body?.role != null) {
        const role = String(req.body.role).trim();
        if (!["sales", "manager"].includes(role)) {
          return res.status(400).json({ error: "Invalid role", request_id: req.requestId });
        }
        sets.push(`role = $${idx}`);
        params.push(role);
        idx += 1;
      }
      if (req.body?.isActive != null) {
        sets.push(`is_active = $${idx}`);
        params.push(Boolean(req.body.isActive));
        idx += 1;
      }
      if (req.body?.isProbationary != null) {
        sets.push(`is_probationary = $${idx}`);
        params.push(Boolean(req.body.isProbationary));
        idx += 1;
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: "No updatable fields provided", request_id: req.requestId });
      }

      params.push(staffId);
      try {
        const result = await db.query(
          `
            UPDATE core.branch_staff
            SET ${sets.join(", ")}, updated_at = now()
            WHERE staff_id = $${idx}
            RETURNING staff_id, branch_code, display_name, role, is_active, is_probationary
          `,
          params,
        );
        const row = result.rows[0];
        if (!row) {
          return res.status(404).json({ error: "Staff not found", request_id: req.requestId });
        }

        await auditLog(
          db,
          auditBase(req, {
            action: "branch_staff.updated",
            target_type: "branch_staff",
            target_id: staffId,
            success: true,
          }),
        );

        return res.json({
          staff: {
            staffId: String(row.staff_id),
            branchCode: row.branch_code,
            displayName: row.display_name,
            role: row.role,
            isActive: row.is_active,
            isProbationary: row.is_probationary,
          },
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

module.exports = {
  createMobileEnrollRouter,
  createBranchStaffRouter,
};
