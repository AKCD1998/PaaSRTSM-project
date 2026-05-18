"use strict";

const express = require("express");

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function requirePosApiKey(config) {
  return function posApiKeyMiddleware(req, res, next) {
    const token = normalizeText(req.headers["x-pos-api-key"]);
    if (!token || !config?.posApiKeys || !config.posApiKeys.has(token)) {
      return res.status(401).json({
        error: "Unauthorized",
        request_id: req.requestId || null,
      });
    }
    return next();
  };
}

function buildLoyaltyDecision(product) {
  const productKind = normalizeNullableText(product?.product_kind);
  if (!productKind) {
    return {
      eligible: false,
      reason: "unknown_product_kind",
    };
  }

  if (productKind.toLowerCase() === "medicine") {
    return {
      eligible: false,
      reason: "medicine_blocked",
    };
  }

  return {
    eligible: true,
    reason: "non_medicine_allowed",
  };
}

async function lookupByBarcode(db, barcode) {
  const sql = `
    SELECT
      s.sku_id,
      s.company_code,
      s.display_name,
      s.category_name,
      s.product_kind,
      b.barcode
    FROM public.barcodes b
    INNER JOIN public.skus s
      ON s.sku_id = b.sku_id
    WHERE b.barcode = $1
    ORDER BY b.is_primary DESC, b.updated_at DESC NULLS LAST, b.barcode ASC
    LIMIT 1
  `;
  const result = await db.query(sql, [barcode]);
  return result.rows[0] || null;
}

async function lookupByCompanyCode(db, companyCode) {
  const sql = `
    SELECT
      s.sku_id,
      s.company_code,
      s.display_name,
      s.category_name,
      s.product_kind,
      NULL::text AS barcode
    FROM public.skus s
    WHERE s.company_code = $1
    ORDER BY s.sku_id DESC
    LIMIT 1
  `;
  const result = await db.query(sql, [companyCode]);
  return result.rows[0] || null;
}

function createLoyaltyRouter(deps) {
  const { config, db } = deps;
  const router = express.Router();
  const requirePosApiKeyMiddleware = requirePosApiKey(config);

  router.get("/products/eligibility", requirePosApiKeyMiddleware, async (req, res, next) => {
    const barcode = normalizeNullableText(req.query?.barcode);
    const companyCode = normalizeNullableText(req.query?.company_code);

    if (!barcode && !companyCode) {
      return res.status(400).json({
        error: "barcode or company_code is required",
        request_id: req.requestId || null,
      });
    }

    try {
      const product = barcode
        ? await lookupByBarcode(db, barcode)
        : await lookupByCompanyCode(db, companyCode);

      if (!product) {
        return res.status(404).json({
          error: "Product not found",
          request_id: req.requestId || null,
        });
      }

      const loyalty = buildLoyaltyDecision(product);
      return res.json({
        ok: true,
        request_id: req.requestId || null,
        matched_by: barcode ? "barcode" : "company_code",
        product,
        loyalty,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createLoyaltyRouter,
  buildLoyaltyDecision,
  requirePosApiKey,
};
