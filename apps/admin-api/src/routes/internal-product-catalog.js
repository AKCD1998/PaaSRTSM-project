"use strict";

const crypto = require("node:crypto");
const express = require("express");

const MAX_SKUS_PER_REQUEST = 500;
const MAX_SKU_LENGTH = 64;

function normalizeSku(value) {
  return String(value || "").normalize("NFKC").trim();
}

function timingSafeEqualStrings(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseRequestedSkus(body) {
  if (!Array.isArray(body?.companySkus)) {
    const error = new Error("companySkus must be an array.");
    error.status = 400;
    throw error;
  }
  if (!body.companySkus.length || body.companySkus.length > MAX_SKUS_PER_REQUEST) {
    const error = new Error(`companySkus must contain between 1 and ${MAX_SKUS_PER_REQUEST} values.`);
    error.status = 400;
    throw error;
  }

  const unique = [];
  const seen = new Set();
  body.companySkus.forEach((value) => {
    const companySku = normalizeSku(value);
    if (!companySku || companySku.length > MAX_SKU_LENGTH || /[\u0000-\u001f\u007f]/u.test(companySku)) {
      const error = new Error("companySkus contains an invalid value.");
      error.status = 400;
      throw error;
    }
    if (!seen.has(companySku)) {
      seen.add(companySku);
      unique.push(companySku);
    }
  });
  return unique.sort((left, right) => left.localeCompare(right, "en"));
}

function canonicalRecord(row) {
  return {
    barcodes: Array.isArray(row.barcodes) ? row.barcodes.map(String).sort() : [],
    companySku: normalizeSku(row.company_code),
    displayName: String(row.display_name || "").trim(),
    productKind: String(row.product_kind || "").trim() || null,
    updatedAt: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : (row.updated_at ? new Date(row.updated_at).toISOString() : null),
  };
}

function checksumRecords(records) {
  return crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

function createInternalProductCatalogRouter({ config, db }) {
  const router = express.Router();
  const expectedToken = String(config.erpProductCatalogInternalToken || "").trim();

  router.post("/resolve", async (req, res, next) => {
    try {
      if (!expectedToken) {
        return res.status(503).json({ error: "Product catalog integration is not configured." });
      }
      if (!timingSafeEqualStrings(req.get("x-internal-token"), expectedToken)) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const companySkus = parseRequestedSkus(req.body);
      const result = await db.query(
        `
          SELECT
            s.company_code,
            s.display_name,
            s.product_kind,
            s.updated_at,
            COALESCE(
              array_agg(b.barcode ORDER BY b.is_primary DESC, b.barcode ASC)
                FILTER (WHERE b.barcode IS NOT NULL),
              ARRAY[]::text[]
            ) AS barcodes
          FROM public.skus s
          LEFT JOIN public.barcodes b ON b.sku_id = s.sku_id
          WHERE s.company_code = ANY($1::text[])
          GROUP BY s.sku_id, s.company_code, s.display_name, s.product_kind, s.updated_at
          ORDER BY s.company_code ASC
        `,
        [companySkus],
      );
      const records = result.rows.map(canonicalRecord);
      const resolved = new Set(records.map((record) => record.companySku));
      const missingCompanySkus = companySkus.filter((companySku) => !resolved.has(companySku));

      res.set("Cache-Control", "no-store");
      return res.json({
        schemaVersion: 1,
        source: "sc-erp-product-master",
        sourceChecksum: checksumRecords(records),
        requestedCount: companySkus.length,
        resolvedCount: records.length,
        missingCompanySkus,
        records,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  MAX_SKUS_PER_REQUEST,
  checksumRecords,
  createInternalProductCatalogRouter,
  parseRequestedSkus,
  timingSafeEqualStrings,
};
