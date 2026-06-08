"use strict";

const express = require("express");

const SVG_DATA_URL_PREFIX = "data:image/svg+xml;base64,";
const MAX_LOGO_DATA_URL_LENGTH = 450_000;

function normalizeText(value, maxLength = 255) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeSupplierLogoKey(value) {
  return normalizeText(value, 255)
    .toLowerCase()
    .replace(/[\s.-]+/g, "");
}

function mapSupplierLogoRow(row) {
  return {
    supplierKey: row.supplier_key,
    supplierName: row.supplier_name,
    logoDataUrl: row.logo_data_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function decodeBase64Svg(logoDataUrl) {
  const encoded = logoDataUrl.slice(SVG_DATA_URL_PREFIX.length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    return null;
  }
  return Buffer.from(encoded, "base64").toString("utf8");
}

function validateSupplierLogoPayload(body) {
  const supplierName = normalizeText(body?.supplierName, 255);
  const supplierKey = normalizeSupplierLogoKey(body?.supplierKey || supplierName);
  const logoDataUrl = String(body?.logoDataUrl || "").trim();

  if (!supplierName) {
    return { error: "supplierName is required." };
  }
  if (!supplierKey) {
    return { error: "supplierKey is required." };
  }
  if (!logoDataUrl.startsWith(SVG_DATA_URL_PREFIX)) {
    return { error: "logoDataUrl must be a base64 SVG data URL." };
  }
  if (logoDataUrl.length > MAX_LOGO_DATA_URL_LENGTH) {
    return { error: "SVG logo is too large." };
  }

  const svgText = decodeBase64Svg(logoDataUrl);
  if (!svgText) {
    return { error: "SVG logo is not valid base64." };
  }
  if (!/<svg[\s>]/i.test(svgText)) {
    return { error: "SVG logo must contain an <svg> element." };
  }
  if (/<script[\s>]/i.test(svgText) || /<foreignobject[\s>]/i.test(svgText) || /\son[a-z]+\s*=/i.test(svgText)) {
    return { error: "SVG logo contains unsafe markup." };
  }

  return {
    value: {
      supplierKey,
      supplierName,
      logoDataUrl,
    },
  };
}

async function listSupplierLogos(db) {
  const result = await db.query(
    `
      SELECT supplier_key, supplier_name, logo_data_url, created_at, updated_at
      FROM public.supplier_logos
      ORDER BY supplier_name ASC
    `,
  );
  return result.rows.map(mapSupplierLogoRow);
}

async function upsertSupplierLogo(db, { supplierKey, supplierName, logoDataUrl }) {
  const result = await db.query(
    `
      INSERT INTO public.supplier_logos (supplier_key, supplier_name, logo_data_url)
      VALUES ($1, $2, $3)
      ON CONFLICT (supplier_key)
      DO UPDATE SET
        supplier_name = EXCLUDED.supplier_name,
        logo_data_url = EXCLUDED.logo_data_url,
        updated_at = now()
      RETURNING supplier_key, supplier_name, logo_data_url, created_at, updated_at
    `,
    [supplierKey, supplierName, logoDataUrl],
  );
  return mapSupplierLogoRow(result.rows[0]);
}

function createSupplierLogosRouter(deps) {
  const { db, requireAuthMiddleware, requireCsrfMiddleware } = deps;
  const router = express.Router();

  router.get("/", requireAuthMiddleware, async (_req, res, next) => {
    try {
      return res.json({ ok: true, logos: await listSupplierLogos(db) });
    } catch (error) {
      return next(error);
    }
  });

  router.put("/", requireAuthMiddleware, requireCsrfMiddleware, async (req, res, next) => {
    const validation = validateSupplierLogoPayload(req.body || {});
    if (validation.error) {
      return res.status(400).json({ error: validation.error, request_id: req.requestId || null });
    }

    try {
      const logo = await upsertSupplierLogo(db, validation.value);
      return res.json({ ok: true, logo });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createSupplierLogosRouter,
  listSupplierLogos,
  upsertSupplierLogo,
  validateSupplierLogoPayload,
};
