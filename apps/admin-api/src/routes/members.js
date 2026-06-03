"use strict";

const express = require("express");
const { requirePosApiKey } = require("./loyalty");

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function parseOptionalDob(value) {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const error = new Error("dob must be in YYYY-MM-DD format");
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function buildMemberResponse(row) {
  return {
    id: row.id,
    member_code: row.member_code,
    display_name: row.display_name,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
    email: row.email,
    sex: row.sex,
    dob: row.dob,
    remark: row.remark,
    thai_id: row.thai_id,
    current_points: row.current_points,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function createMembersRouter(deps) {
  const { config, db } = deps;
  const router = express.Router();
  const requirePosApiKeyMiddleware = requirePosApiKey(config);

  router.get("/:id", requirePosApiKeyMiddleware, async (req, res, next) => {
    const memberId = normalizeText(req.params.id);
    if (!memberId) {
      return res.status(400).json({
        error: "id is required",
        request_id: req.requestId || null,
      });
    }

    try {
      const result = await db.query(
        `
          SELECT
            id,
            member_code,
            display_name,
            first_name,
            last_name,
            phone,
            email,
            sex,
            dob,
            remark,
            thai_id,
            current_points,
            created_at,
            updated_at
          FROM public.members
          WHERE id = $1
          LIMIT 1
        `,
        [memberId],
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          error: "Member not found",
          request_id: req.requestId || null,
        });
      }

      return res.json({
        ok: true,
        request_id: req.requestId || null,
        member: buildMemberResponse(result.rows[0]),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.put("/:id", requirePosApiKeyMiddleware, async (req, res, next) => {
    const memberId = normalizeText(req.params.id);
    if (!memberId) {
      return res.status(400).json({
        error: "id is required",
        request_id: req.requestId || null,
      });
    }

    try {
      const displayName = normalizeNullableText(req.body?.displayName ?? req.body?.name);
      const phone = normalizeNullableText(req.body?.phone);
      const email = normalizeNullableText(req.body?.email);
      const sex = normalizeNullableText(req.body?.sex);
      const dob = parseOptionalDob(req.body?.dob);
      const remark = normalizeNullableText(req.body?.remark);

      if (
        displayName == null
        && phone == null
        && email == null
        && sex == null
        && dob == null
        && remark == null
      ) {
        return res.status(400).json({
          error: "At least one member field must be provided",
          request_id: req.requestId || null,
        });
      }

      const result = await db.query(
        `
          UPDATE public.members
          SET
            display_name = COALESCE($2, display_name),
            phone = COALESCE($3, phone),
            email = COALESCE($4, email),
            sex = COALESCE($5, sex),
            dob = COALESCE($6::date, dob),
            remark = COALESCE($7, remark),
            updated_at = now()
          WHERE id = $1
          RETURNING
            id,
            member_code,
            display_name,
            first_name,
            last_name,
            phone,
            email,
            sex,
            dob,
            remark,
            thai_id,
            current_points,
            created_at,
            updated_at
        `,
        [memberId, displayName, phone, email, sex, dob, remark],
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          error: "Member not found",
          request_id: req.requestId || null,
        });
      }

      return res.json({
        ok: true,
        request_id: req.requestId || null,
        member: buildMemberResponse(result.rows[0]),
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createMembersRouter,
};
