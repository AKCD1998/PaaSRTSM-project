"use strict";

const { Router } = require("express");

/**
 * Mounted at /api/mobile. Requires requireMobileTokenMiddleware on the parent.
 * GET /api/mobile/products/by-barcode/:barcode
 */
function createMobileProductsRouter({ db, requireMobileRoleMiddleware }) {
  const router = Router();

  router.get(
    "/products/by-barcode/:barcode",
    async (req, res, next) => {
      const barcode = String(req.params.barcode || "").trim();
      if (!barcode) {
        return res.status(400).json({ error: "barcode is required", request_id: req.requestId });
      }

      try {
        const productResult = await db.query(
          `
            SELECT
              b.barcode,
              s.company_code   AS product_code,
              s.display_name   AS name_th,
              i.generic_name   AS name_en,
              s.uom            AS unit,
              sup.id           AS price_id,
              sup.retail_price,
              bss.qty_branch_000, bss.qty_branch_001, bss.qty_branch_002,
              bss.qty_branch_003, bss.qty_branch_004, bss.qty_branch_005,
              bss.qty_total_all_branches,
              bss.cost_avg_branch_000, bss.cost_avg_branch_001, bss.cost_avg_branch_002,
              bss.cost_avg_branch_003, bss.cost_avg_branch_004, bss.cost_avg_branch_005
            FROM public.barcodes b
            JOIN public.skus s ON s.sku_id = b.sku_id
            JOIN public.items i ON i.item_id = s.item_id
            LEFT JOIN public.sku_unit_prices sup
              ON sup.sku_id = s.sku_id AND sup.is_active = true
            LEFT JOIN ada.branch_stock_snapshots bss
              ON bss.product_code = s.company_code
            WHERE b.barcode = $1
            LIMIT 1
          `,
          [barcode],
        );

        if (!productResult.rows.length) {
          return res.status(404).json({ error: "Product not found", request_id: req.requestId });
        }

        const row = productResult.rows[0];

        let priceTiers = [];
        if (row.price_id) {
          const tiersResult = await db.query(
            `
              SELECT tier, price
              FROM public.sku_unit_price_tiers
              WHERE sku_unit_price_id = $1 AND is_active = true
              ORDER BY tier ASC
            `,
            [row.price_id],
          );
          priceTiers = tiersResult.rows.map((t) => ({
            tier: t.tier,
            price: t.price !== null ? Number(t.price) : null,
          }));
        }

        const toNum = (v) => (v !== null && v !== undefined ? Number(v) : null);

        const stockByBranch = {
          "000": toNum(row.qty_branch_000),
          "001": toNum(row.qty_branch_001),
          "002": toNum(row.qty_branch_002),
          "003": toNum(row.qty_branch_003),
          "004": toNum(row.qty_branch_004),
          "005": toNum(row.qty_branch_005),
          total: toNum(row.qty_total_all_branches),
        };

        const isManager = req.mobile?.role === "manager";
        const costByBranch = isManager
          ? {
              "000": toNum(row.cost_avg_branch_000),
              "001": toNum(row.cost_avg_branch_001),
              "002": toNum(row.cost_avg_branch_002),
              "003": toNum(row.cost_avg_branch_003),
              "004": toNum(row.cost_avg_branch_004),
              "005": toNum(row.cost_avg_branch_005),
            }
          : undefined;

        return res.json({
          barcode: row.barcode,
          productCode: row.product_code || null,
          nameTh: row.name_th || null,
          nameEn: row.name_en || null,
          unit: row.unit || null,
          retailPrice: toNum(row.retail_price),
          priceTiers,
          stockByBranch,
          ...(costByBranch !== undefined && { costByBranch }),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

module.exports = { createMobileProductsRouter };
