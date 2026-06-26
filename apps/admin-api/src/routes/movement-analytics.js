"use strict";

const express = require("express");

const SALES_BRANCHES = ["001", "002", "003", "004", "005"];

const BRANCH_LABELS = {
  "001": "สาขา 001",
  "002": "สาขา 002",
  "003": "สาขา 003",
  "004": "สาขา 004",
  "005": "สาขา 005",
};

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeQuery(value = "") {
  return normalizeText(value).toLowerCase();
}

function parsePositiveInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseNonNegativeInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function createMovementAnalyticsRouter(deps) {
  const { db, requireAuthMiddleware } = deps;
  const router = express.Router();

  // GET /branch-sales-summary
  // Mounted at /api/admin → full path: /api/admin/branch-sales-summary
  // Returns sold qty per product per branch for a given date range.
  router.get("/branch-sales-summary", requireAuthMiddleware, async (req, res, next) => {
    const dateFrom = normalizeText(req.query.date_from) || null;
    const dateTo   = normalizeText(req.query.date_to)   || null;
    const search   = normalizeQuery(req.query.product_search || "");

    const sortBy  = normalizeText(req.query.sort_by) || "total_sold_qty";
    const sortDir = normalizeText(req.query.sort_dir).toLowerCase() === "asc" ? "ASC" : "DESC";

    const limit  = parsePositiveInt(req.query.limit, 50);
    const offset = parseNonNegativeInt(req.query.offset, 0);

    if (limit == null)  return res.status(400).json({ message: "limit must be a positive integer." });
    if (offset == null) return res.status(400).json({ message: "offset must be a non-negative integer." });

    const allowedSortCols = new Set(["total_sold_qty", "product_code", "product_name"]);
    const effectiveSortBy = allowedSortCols.has(sortBy) ? sortBy : "total_sold_qty";

    try {
      const sql = `
        WITH sales_agg AS (
          SELECT
            sl.product_code,
            sh.branch_code,
            SUM(sl.qty) AS sold_qty
          FROM ada.sales_lines sl
          JOIN ada.sales_headers sh
            ON  sh.branch_code = sl.branch_code
            AND sh.doc_no      = sl.doc_no
          WHERE ($1::date IS NULL OR sh.doc_date >= $1::date)
            AND ($2::date IS NULL OR sh.doc_date <= $2::date)
          GROUP BY sl.product_code, sh.branch_code
        ),
        product_totals AS (
          SELECT
            product_code,
            SUM(CASE WHEN branch_code = '001' THEN sold_qty ELSE 0 END)::int AS qty_001,
            SUM(CASE WHEN branch_code = '002' THEN sold_qty ELSE 0 END)::int AS qty_002,
            SUM(CASE WHEN branch_code = '003' THEN sold_qty ELSE 0 END)::int AS qty_003,
            SUM(CASE WHEN branch_code = '004' THEN sold_qty ELSE 0 END)::int AS qty_004,
            SUM(CASE WHEN branch_code = '005' THEN sold_qty ELSE 0 END)::int AS qty_005,
            SUM(sold_qty)::int AS total_sold_qty
          FROM sales_agg
          GROUP BY product_code
        ),
        enriched AS (
          SELECT
            pt.product_code,
            COALESCE(bss.product_name_thai, p.product_name_th, p.product_name) AS product_name,
            COALESCE(pcs.category_name, p.category_name)                        AS category,
            pt.qty_001,
            pt.qty_002,
            pt.qty_003,
            pt.qty_004,
            pt.qty_005,
            pt.total_sold_qty
          FROM product_totals pt
          LEFT JOIN ada.branch_stock_snapshots bss ON bss.product_code = pt.product_code
          LEFT JOIN ada.products p                  ON p.product_code  = pt.product_code
          LEFT JOIN ada.product_category_states pcs ON pcs.product_code = pt.product_code
          WHERE (
            $3::text = ''
            OR pt.product_code ILIKE '%' || $3 || '%'
            OR COALESCE(bss.product_name_thai, p.product_name_th, p.product_name, '') ILIKE '%' || $3 || '%'
            OR COALESCE(pcs.category_name, p.category_name, '') ILIKE '%' || $3 || '%'
          )
        )
        SELECT
          product_code,
          product_name,
          category,
          qty_001,
          qty_002,
          qty_003,
          qty_004,
          qty_005,
          total_sold_qty,
          COUNT(*) OVER()::int AS total_count
        FROM enriched
        ORDER BY ${effectiveSortBy} ${sortDir}, product_code ASC
        LIMIT $4 OFFSET $5
      `;

      const effectiveLimit = Math.min(limit, 200);
      const result = await db.query(sql, [
        dateFrom || null,
        dateTo   || null,
        search,
        effectiveLimit,
        offset,
      ]);

      const total = Number(result.rows[0]?.total_count || 0);

      const products = result.rows.map((row) => ({
        product_code: row.product_code,
        product_name: row.product_name || row.product_code,
        category:     row.category || "",
        sales_by_branch: {
          "001": Number(row.qty_001 || 0),
          "002": Number(row.qty_002 || 0),
          "003": Number(row.qty_003 || 0),
          "004": Number(row.qty_004 || 0),
          "005": Number(row.qty_005 || 0),
        },
        total_sold_qty: Number(row.total_sold_qty || 0),
      }));

      return res.json({
        branches: SALES_BRANCHES.map((code) => ({
          branch_code: code,
          branch_name: BRANCH_LABELS[code],
        })),
        products,
        date_from: dateFrom,
        date_to:   dateTo,
        total,
        offset,
        limit: effectiveLimit,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createMovementAnalyticsRouter };
