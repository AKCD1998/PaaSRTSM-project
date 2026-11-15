"use strict";

const { Router } = require("express");

function notFound(res, req) {
  return res.status(404).json({ error: "Not found", request_id: req.requestId });
}

function toNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function groupUnitPrices(rows) {
  return rows.map((row) => ({
    channel: row.channel,
    unitSize: row.unit_size,
    priceLevel: Number(row.price_level),
    priceAmount: toNumber(row.price_amount),
    priceSource: row.price_source,
    unitName: row.unit_name || null,
    factor: toNumber(row.factor),
    allowBranchOverride: Boolean(row.allow_branch_override),
    sourceUpdatedAt: row.source_updated_at || null,
    sourceSyncedAt: row.source_synced_at || null,
  }));
}

function pickRetailPrice(unitPrices) {
  const exact = unitPrices.find((row) => row.channel === "retail" && row.priceLevel === 1 && row.unitSize === "S");
  if (exact) {
    return exact.priceAmount;
  }
  const fallback = unitPrices.find((row) => row.channel === "retail" && row.priceLevel === 1);
  return fallback ? fallback.priceAmount : null;
}

function createMobileProductsRouter({ config, db, requireMobileTokenMiddleware }) {
  const router = Router();

  router.use((req, res, next) => {
    if (!config.featureMobilePda) {
      return notFound(res, req);
    }
    return next();
  });

  router.use(requireMobileTokenMiddleware);

  // Lightweight polling contract for the PDA client. The installed APK in
  // this workspace has no matching source screen yet; keep the endpoint
  // branch-scoped so a future client can consume it without exposing customer
  // contact details or HQ-only receipt details to store devices.
  router.get("/preorder-notifications", async (req, res, next) => {
    if (!config.featureCustomerPreorders || !config.featurePreorderRoleWorkspace) {
      return notFound(res, req);
    }
    const branchCode = String(req.mobile?.branchCode || "");
    if (!/^\d{3}$/.test(branchCode)) return res.status(403).json({ error: "Forbidden", request_id: req.requestId });
    const afterId = Number(req.query.afterId || 0);
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(100, requestedLimit) : 30;
    if (!Number.isSafeInteger(afterId) || afterId < 0) return res.status(400).json({ error: "afterId is invalid", request_id: req.requestId });
    const hqView = branchCode === "000";
    try {
      const result = await db.query(
        `SELECT n.notification_id,n.notification_type,n.created_at,c.public_id,c.branch_code,c.intent,c.status,
                CASE WHEN $3 THEN e.payload_json ELSE '{}'::jsonb END AS event_payload,
                item_summary.items
         FROM customer_relations.preorder_notifications n
         JOIN customer_relations.preorder_cases c ON c.case_id=n.case_id
         LEFT JOIN customer_relations.preorder_events e ON e.case_id=n.case_id AND e.activity_seq=n.activity_seq
         LEFT JOIN LATERAL (
           SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'name',COALESCE(i.display_name_snapshot,i.original_description,'สินค้า'),
             'quantity',COALESCE(i.confirmed_qty,i.requested_qty),
             'unit',i.unit_snapshot
           ) ORDER BY i.position),'[]'::jsonb) AS items
           FROM customer_relations.preorder_items i WHERE i.case_id=c.case_id
         ) item_summary ON TRUE
         WHERE n.notification_id>$1
           AND (($3 AND n.recipient_role='admin' AND n.recipient_branch_code IS NULL)
             OR (NOT $3 AND n.recipient_role='staff' AND n.recipient_branch_code=$2))
         ORDER BY n.notification_id ASC LIMIT $4`,
        [afterId, branchCode, hqView, limit],
      );
      res.set("Cache-Control", "private, no-store");
      return res.json({ items: result.rows, nextAfterId: result.rows.at(-1)?.notification_id || afterId, pollingRecommendedSeconds: 30 });
    } catch (error) {
      return next(error);
    }
  });

  async function handleScan(req, res, next, barcode) {
    const normalizedBarcode = String(barcode || "").trim();
    if (!normalizedBarcode) {
      return res.status(400).json({ error: "barcode is required", request_id: req.requestId });
    }

    try {
      const productResult = await db.query(
        `
          SELECT
            pb.barcode,
            p.product_code,
            COALESCE(NULLIF(p.product_name_th, ''), NULLIF(p.product_name, ''), bss.product_name_thai) AS name_th,
            COALESCE(NULLIF(p.product_name, ''), bss.product_name_eng) AS name_en,
            p.unit_small,
            p.factor_small,
            p.unit_medium,
            p.factor_medium,
            p.unit_large,
            p.factor_large,
            CASE $2
              WHEN '000' THEN bss.qty_branch_000
              WHEN '001' THEN bss.qty_branch_001
              WHEN '002' THEN bss.qty_branch_002
              WHEN '003' THEN bss.qty_branch_003
              WHEN '004' THEN bss.qty_branch_004
              WHEN '005' THEN bss.qty_branch_005
              ELSE NULL
            END AS branch_qty,
            bss.qty_total_all_branches,
            CASE $2
              WHEN '000' THEN bss.cost_avg_branch_000
              WHEN '001' THEN bss.cost_avg_branch_001
              WHEN '002' THEN bss.cost_avg_branch_002
              WHEN '003' THEN bss.cost_avg_branch_003
              WHEN '004' THEN bss.cost_avg_branch_004
              WHEN '005' THEN bss.cost_avg_branch_005
              ELSE NULL
            END AS branch_cost
          FROM ada.product_barcodes pb
          JOIN ada.products p ON p.product_code = pb.product_code
          LEFT JOIN ada.branch_stock_snapshots bss ON bss.product_code = p.product_code
          WHERE pb.barcode = $1
          LIMIT 1
        `,
        [normalizedBarcode, req.mobile.branchCode],
      );

      if (!productResult.rows.length) {
        return res.status(404).json({ error: "Product not found", request_id: req.requestId });
      }

      const row = productResult.rows[0];
      const isManager = req.mobile?.role === "manager";
      const priceResult = await db.query(
        `
          SELECT
            channel,
            unit_size,
            price_level,
            price_amount,
            price_source,
            unit_name,
            factor,
            allow_branch_override,
            source_updated_at,
            source_synced_at
          FROM ada.product_effective_branch_prices
          WHERE branch_code = $1
            AND product_code = $2
            AND ($3 OR channel = 'retail')
          ORDER BY
            channel ASC,
            price_level ASC,
            CASE unit_size WHEN 'S' THEN 1 WHEN 'M' THEN 2 WHEN 'L' THEN 3 ELSE 9 END ASC
        `,
        [req.mobile.branchCode, row.product_code, isManager],
      );

      const unitPrices = groupUnitPrices(priceResult.rows);
      const stockByBranch = {
        [req.mobile.branchCode]: toNumber(row.branch_qty),
        total: toNumber(row.qty_total_all_branches),
      };

      return res.json({
        barcode: row.barcode,
        branchCode: req.mobile.branchCode,
        productCode: row.product_code || null,
        nameTh: row.name_th || null,
        nameEn: row.name_en || null,
        units: {
          small: { code: row.unit_small || null, factor: toNumber(row.factor_small) },
          medium: { code: row.unit_medium || null, factor: toNumber(row.factor_medium) },
          large: { code: row.unit_large || null, factor: toNumber(row.factor_large) },
        },
        retailPrice: pickRetailPrice(unitPrices),
        priceTiers: [],
        unitPrices,
        stockByBranch,
        ...(isManager
          ? {
              costByBranch: {
                [req.mobile.branchCode]: toNumber(row.branch_cost),
              },
            }
          : {}),
      });
    } catch (error) {
      return next(error);
    }
  }

  router.get("/products/by-barcode/:barcode", async (req, res, next) => {
    return handleScan(req, res, next, req.params.barcode);
  });

  router.get("/products/scan", async (req, res, next) => {
    return handleScan(req, res, next, req.query.barcode);
  });

  return router;
}

module.exports = { createMobileProductsRouter };
