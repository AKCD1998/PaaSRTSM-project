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

// Returns array of valid type strings, or null (= include all)
function parseTypes(value) {
  if (!value) return null;
  const VALID = new Set(["transfer_in", "transfer_out", "supplier_receipt", "sale_receipt", "sale_return"]);
  const types = String(value).split(",").map((t) => t.trim()).filter((t) => VALID.has(t));
  return types.length > 0 ? types : null;
}

function createMovementAnalyticsRouter(deps) {
  const { db, requireAuthMiddleware } = deps;
  const router = express.Router();

  // ── GET /api/admin/branch-sales-summary ─────────────────────────────────────
  // Cross-branch pivot: rows = products, columns = branches, values = sold qty.
  // Reads from analytics.product_sales_summary_periods, populated by BAT nightly sync.
  router.get("/branch-sales-summary", requireAuthMiddleware, async (req, res, next) => {
    const dateFrom = normalizeText(req.query.date_from) || null;
    const dateTo   = normalizeText(req.query.date_to)   || null;
    const search   = normalizeQuery(req.query.product_search || "");
    const sortBy   = normalizeText(req.query.sort_by) || "total_sold_qty";
    const sortDir  = normalizeText(req.query.sort_dir).toLowerCase() === "asc" ? "ASC" : "DESC";
    const limit    = parsePositiveInt(req.query.limit, 50);
    const offset   = parseNonNegativeInt(req.query.offset, 0);

    if (limit == null)  return res.status(400).json({ message: "limit must be a positive integer." });
    if (offset == null) return res.status(400).json({ message: "offset must be a non-negative integer." });

    const allowedSortCols = new Set(["total_sold_qty", "product_code", "product_name"]);
    const effectiveSortBy = allowedSortCols.has(sortBy) ? sortBy : "total_sold_qty";
    const effectiveLimit  = Math.min(limit, 200);

    try {
      const sql = `
        WITH sales_agg AS (
          SELECT
            p.product_code,
            p.branch_code,
            SUM(p.sold_qty_base)::numeric AS sold_qty
          FROM analytics.product_sales_summary_periods p
          WHERE ($1::date IS NULL OR p.period_end   >= $1::date)
            AND ($2::date IS NULL OR p.period_start <= $2::date)
          GROUP BY p.product_code, p.branch_code
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
            COALESCE(bss.product_name_thai, ap.product_name_th, ap.product_name, s.display_name) AS product_name,
            COALESCE(pcs.category_name, ap.category_name, s.category_name)                        AS category,
            pt.qty_001, pt.qty_002, pt.qty_003, pt.qty_004, pt.qty_005, pt.total_sold_qty
          FROM product_totals pt
          LEFT JOIN ada.branch_stock_snapshots bss  ON bss.product_code  = pt.product_code
          LEFT JOIN ada.products ap                  ON ap.product_code   = pt.product_code
          LEFT JOIN ada.product_category_states pcs  ON pcs.product_code  = pt.product_code
          LEFT JOIN public.skus s                    ON s.company_code    = pt.product_code
          WHERE (
            $3::text = ''
            OR pt.product_code ILIKE '%' || $3 || '%'
            OR COALESCE(bss.product_name_thai, ap.product_name_th, ap.product_name, s.display_name, '') ILIKE '%' || $3 || '%'
            OR COALESCE(pcs.category_name, ap.category_name, s.category_name, '') ILIKE '%' || $3 || '%'
          )
        )
        SELECT
          product_code, product_name, category,
          qty_001, qty_002, qty_003, qty_004, qty_005, total_sold_qty,
          COUNT(*) OVER()::int AS total_count
        FROM enriched
        ORDER BY ${effectiveSortBy} ${sortDir}, product_code ASC
        LIMIT $4 OFFSET $5
      `;

      const result = await db.query(sql, [dateFrom || null, dateTo || null, search, effectiveLimit, offset]);
      const total  = Number(result.rows[0]?.total_count || 0);

      const products = result.rows.map((row) => ({
        product_code:    row.product_code,
        product_name:    row.product_name || row.product_code,
        category:        row.category || "",
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
        branches:  SALES_BRANCHES.map((code) => ({ branch_code: code, branch_name: BRANCH_LABELS[code] })),
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

  // ── GET /api/admin/movement-transactions ─────────────────────────────────────
  // Ledger: one row per product-line event.
  // Sources: ada.transfer_lines, ada.approved_receipt_lines, ada.sales_lines
  router.get("/movement-transactions", requireAuthMiddleware, async (req, res, next) => {
    const branchCode  = normalizeText(req.query.branch_code);
    const dateFrom    = normalizeText(req.query.date_from) || null;
    const dateTo      = normalizeText(req.query.date_to)   || null;
    const docSearch   = normalizeText(req.query.doc_search);
    const productCode = normalizeText(req.query.product_code);
    const types       = parseTypes(req.query.types);       // string[] | null
    const limit       = parsePositiveInt(req.query.limit, 100);
    const offset      = parseNonNegativeInt(req.query.offset, 0);

    if (limit == null)  return res.status(400).json({ message: "limit must be a positive integer." });
    if (offset == null) return res.status(400).json({ message: "offset must be a non-negative integer." });

    const effectiveLimit = Math.min(limit, 500);

    try {
      const sql = `
        WITH transfer_events AS (
          SELECT
            tl.doc_no || '|' || th.branch_code || '|' || tl.line_no::text  AS event_id,
            th.doc_date::text                                                 AS event_date,
            CASE
              WHEN $1::text = ''            THEN 'transfer_out'
              WHEN th.branch_code = $1::text THEN 'transfer_out'
              ELSE 'transfer_in'
            END                                                               AS event_type,
            tl.doc_no                                                         AS document_no,
            th.source_table,
            th.branch_code                                                    AS branch_from,
            th.branch_code_to                                                 AS branch_to,
            tl.product_code,
            COALESCE(bss.product_name_thai, ap.product_name_th, ap.product_name, s.display_name, tl.product_code)
                                                                              AS product_name,
            COALESCE(tl.qty_base, tl.qty)                                     AS qty,
            tl.unit_name                                                       AS unit,
            NULL::numeric                                                      AS unit_price,
            NULL::numeric                                                      AS amount,
            NULL::text                                                         AS pos_code,
            NULL::text                                                         AS notes
          FROM ada.transfer_lines tl
          JOIN ada.transfer_headers th
            ON  th.doc_no      = tl.doc_no
            AND th.branch_code = tl.branch_code
            AND th.doc_type    = tl.doc_type
          LEFT JOIN ada.branch_stock_snapshots bss ON bss.product_code = tl.product_code
          LEFT JOIN ada.products ap                 ON ap.product_code  = tl.product_code
          LEFT JOIN public.skus s                   ON s.company_code   = tl.product_code
          WHERE ($1::text = '' OR th.branch_code = $1::text OR th.branch_code_to = $1::text)
            AND ($2::date IS NULL OR th.doc_date >= $2::date)
            AND ($3::date IS NULL OR th.doc_date <= $3::date)
            AND ($4::text = '' OR tl.doc_no      ILIKE '%' || $4::text || '%')
            AND ($5::text = '' OR tl.product_code ILIKE '%' || $5::text || '%')
        ),
        receipt_events AS (
          SELECT
            rl.doc_no || '|' || rh.branch_code || '|' || rl.seq_no::text AS event_id,
            rh.doc_date::text                                              AS event_date,
            'supplier_receipt'::text                                       AS event_type,
            rl.doc_no                                                      AS document_no,
            rh.source_table,
            COALESCE(rh.supplier_name, rh.supplier_code, 'Supplier')      AS branch_from,
            rh.branch_code                                                 AS branch_to,
            rl.product_code,
            COALESCE(rl.product_name, bss.product_name_thai, ap.product_name_th, ap.product_name, s.display_name, rl.product_code)
                                                                           AS product_name,
            COALESCE(rl.qty_base, rl.qty)                                  AS qty,
            rl.unit_name                                                    AS unit,
            rl.set_price                                                    AS unit_price,
            rl.net                                                          AS amount,
            NULL::text                                                      AS pos_code,
            COALESCE(rh.supplier_name, rh.supplier_code)                   AS notes
          FROM ada.approved_receipt_lines rl
          JOIN ada.approved_receipt_headers rh ON rh.doc_no = rl.doc_no
          LEFT JOIN ada.branch_stock_snapshots bss ON bss.product_code = rl.product_code
          LEFT JOIN ada.products ap                 ON ap.product_code  = rl.product_code
          LEFT JOIN public.skus s                   ON s.company_code   = rl.product_code
          WHERE ($1::text = '' OR rh.branch_code = $1::text)
            AND ($2::date IS NULL OR rh.doc_date >= $2::date)
            AND ($3::date IS NULL OR rh.doc_date <= $3::date)
            AND ($4::text = '' OR rl.doc_no      ILIKE '%' || $4::text || '%')
            AND ($5::text = '' OR rl.product_code ILIKE '%' || $5::text || '%')
        ),
        sale_events AS (
          SELECT
            sh.branch_code || '|' || sl.doc_no || '|' || sl.line_no::text AS event_id,
            sh.doc_date::text                                               AS event_date,
            'sale_receipt'::text                                            AS event_type,
            sl.doc_no                                                       AS document_no,
            sh.source_table,
            sh.branch_code                                                  AS branch_from,
            'Customer'::text                                                AS branch_to,
            sl.product_code,
            COALESCE(bss.product_name_thai, ap.product_name_th, ap.product_name, s.display_name, sl.product_code)
                                                                            AS product_name,
            COALESCE(sl.qty_base, sl.qty)                                   AS qty,
            NULL::text                                                       AS unit,
            sl.unit_price,
            sl.line_amount                                                   AS amount,
            sh.terminal_code                                                 AS pos_code,
            NULL::text                                                       AS notes
          FROM ada.sales_lines sl
          JOIN ada.sales_headers sh
            ON  sh.branch_code = sl.branch_code
            AND sh.doc_no      = sl.doc_no
          JOIN public.skus s ON s.company_code = sl.product_code
          LEFT JOIN ada.branch_stock_snapshots bss ON bss.product_code = sl.product_code
          LEFT JOIN ada.products ap                 ON ap.product_code  = sl.product_code
          WHERE ($1::text = '' OR sh.branch_code = $1::text)
            AND ($2::date IS NULL OR sh.doc_date >= $2::date)
            AND ($3::date IS NULL OR sh.doc_date <= $3::date)
            AND ($4::text = '' OR sl.doc_no      ILIKE '%' || $4::text || '%')
            AND ($5::text = '' OR sl.product_code ILIKE '%' || $5::text || '%')
        ),
        all_events AS (
          SELECT * FROM transfer_events
          UNION ALL
          SELECT * FROM receipt_events
          UNION ALL
          SELECT * FROM sale_events
        )
        SELECT *,
          COUNT(*) OVER()::int AS total_count
        FROM all_events
        WHERE ($6::text[] IS NULL OR event_type = ANY($6::text[]))
        ORDER BY event_date DESC, document_no ASC, event_id ASC
        LIMIT $7 OFFSET $8
      `;

      const result = await db.query(sql, [
        branchCode  || "",
        dateFrom    || null,
        dateTo      || null,
        docSearch   || "",
        productCode || "",
        types       || null,
        effectiveLimit,
        offset,
      ]);

      const total = Number(result.rows[0]?.total_count || 0);

      const transactions = result.rows.map((row) => ({
        event_id:     row.event_id,
        event_date:   row.event_date,
        event_type:   row.event_type,
        document_no:  row.document_no,
        source_table: row.source_table,
        branch_from:  row.branch_from,
        branch_to:    row.branch_to,
        product_code: row.product_code,
        product_name: row.product_name || row.product_code,
        qty:          Number(row.qty || 0),
        unit:         row.unit || null,
        unit_price:   row.unit_price != null ? Number(row.unit_price) : null,
        amount:       row.amount     != null ? Number(row.amount)     : null,
        pos_code:     row.pos_code   || null,
        notes:        row.notes      || null,
      }));

      return res.json({ transactions, total, offset, limit: effectiveLimit });
    } catch (error) {
      return next(error);
    }
  });

  // ── GET /api/admin/movement-documents ────────────────────────────────────────
  // Document-level list: one card per document header.
  // Click a document to load its line items via /:document_no/items.
  router.get("/movement-documents", requireAuthMiddleware, async (req, res, next) => {
    const branchCode = normalizeText(req.query.branch_code);
    const dateFrom   = normalizeText(req.query.date_from) || null;
    const dateTo     = normalizeText(req.query.date_to)   || null;
    const docSearch  = normalizeText(req.query.doc_search);
    const types      = parseTypes(req.query.types);
    const limit      = parsePositiveInt(req.query.limit, 100);
    const offset     = parseNonNegativeInt(req.query.offset, 0);

    if (limit == null)  return res.status(400).json({ message: "limit must be a positive integer." });
    if (offset == null) return res.status(400).json({ message: "offset must be a non-negative integer." });

    const effectiveLimit = Math.min(limit, 200);

    try {
      const sql = `
        WITH transfer_docs AS (
          SELECT
            th.doc_no                                                        AS document_no,
            CASE
              WHEN $1::text = ''             THEN 'transfer_out'
              WHEN th.branch_code = $1::text THEN 'transfer_out'
              ELSE 'transfer_in'
            END                                                              AS document_type,
            th.doc_date                                                      AS document_date,
            th.branch_code,
            NULL::text                                                       AS pos_code,
            COUNT(tl.line_no)::int                                           AS item_count,
            NULL::numeric                                                     AS total_amount,
            'completed'::text                                                 AS status
          FROM ada.transfer_headers th
          LEFT JOIN ada.transfer_lines tl
            ON  tl.doc_no      = th.doc_no
            AND tl.branch_code = th.branch_code
            AND tl.doc_type    = th.doc_type
          WHERE ($1::text = '' OR th.branch_code = $1::text OR th.branch_code_to = $1::text)
            AND ($2::date IS NULL OR th.doc_date >= $2::date)
            AND ($3::date IS NULL OR th.doc_date <= $3::date)
            AND ($4::text = '' OR th.doc_no ILIKE '%' || $4::text || '%')
          GROUP BY th.doc_no, th.doc_type, th.doc_date, th.branch_code, th.branch_code_to
        ),
        receipt_docs AS (
          SELECT
            rh.doc_no                                                        AS document_no,
            'supplier_receipt'::text                                         AS document_type,
            rh.doc_date                                                      AS document_date,
            rh.branch_code,
            NULL::text                                                       AS pos_code,
            COUNT(rl.seq_no)::int                                            AS item_count,
            rh.grand                                                         AS total_amount,
            'completed'::text                                                 AS status
          FROM ada.approved_receipt_headers rh
          LEFT JOIN ada.approved_receipt_lines rl ON rl.doc_no = rh.doc_no
          WHERE ($1::text = '' OR rh.branch_code = $1::text)
            AND ($2::date IS NULL OR rh.doc_date >= $2::date)
            AND ($3::date IS NULL OR rh.doc_date <= $3::date)
            AND ($4::text = '' OR rh.doc_no ILIKE '%' || $4::text || '%')
          GROUP BY rh.doc_no, rh.doc_date, rh.branch_code, rh.grand
        ),
        sale_docs AS (
          SELECT
            sh.doc_no                                                        AS document_no,
            'sale_receipt'::text                                             AS document_type,
            sh.doc_date                                                      AS document_date,
            sh.branch_code,
            sh.terminal_code                                                 AS pos_code,
            COUNT(sl.line_no)::int                                           AS item_count,
            sh.grand_amount                                                  AS total_amount,
            'completed'::text                                                 AS status
          FROM ada.sales_headers sh
          LEFT JOIN ada.sales_lines sl
            ON  sl.branch_code = sh.branch_code
            AND sl.doc_no      = sh.doc_no
          -- filter test/fake sales that were never in the product master
          WHERE EXISTS (
            SELECT 1 FROM ada.sales_lines sl2
            JOIN public.skus sk ON sk.company_code = sl2.product_code
            WHERE sl2.doc_no = sh.doc_no AND sl2.branch_code = sh.branch_code
          )
          AND ($1::text = '' OR sh.branch_code = $1::text)
          AND ($2::date IS NULL OR sh.doc_date >= $2::date)
          AND ($3::date IS NULL OR sh.doc_date <= $3::date)
          AND ($4::text = '' OR sh.doc_no ILIKE '%' || $4::text || '%')
          GROUP BY sh.doc_no, sh.doc_date, sh.branch_code, sh.terminal_code, sh.grand_amount
        ),
        all_docs AS (
          SELECT * FROM transfer_docs
          UNION ALL
          SELECT * FROM receipt_docs
          UNION ALL
          SELECT * FROM sale_docs
        )
        SELECT *,
          COUNT(*) OVER()::int AS total_count
        FROM all_docs
        WHERE ($5::text[] IS NULL OR document_type = ANY($5::text[]))
        ORDER BY document_date DESC, document_no ASC
        LIMIT $6 OFFSET $7
      `;

      const result = await db.query(sql, [
        branchCode || "",
        dateFrom   || null,
        dateTo     || null,
        docSearch  || "",
        types      || null,
        effectiveLimit,
        offset,
      ]);

      const total = Number(result.rows[0]?.total_count || 0);

      const documents = result.rows.map((row) => ({
        document_no:   row.document_no,
        document_type: row.document_type,
        document_date: row.document_date,
        branch_code:   row.branch_code,
        pos_code:      row.pos_code   || null,
        item_count:    Number(row.item_count || 0),
        total_amount:  row.total_amount != null ? Number(row.total_amount) : null,
        status:        row.status,
        items:         null,
      }));

      return res.json({ documents, total, offset, limit: effectiveLimit });
    } catch (error) {
      return next(error);
    }
  });

  // ── GET /api/admin/movement-documents/:document_no/items ─────────────────────
  // Returns line items for a given document number.
  // Searches across transfer_lines, approved_receipt_lines, and sales_lines.
  router.get("/movement-documents/:document_no/items", requireAuthMiddleware, async (req, res, next) => {
    const documentNo = normalizeText(req.params.document_no);
    if (!documentNo) return res.status(400).json({ message: "document_no is required." });

    try {
      const sql = `
        WITH transfer_items AS (
          SELECT
            tl.product_code,
            COALESCE(bss.product_name_thai, ap.product_name_th, ap.product_name, s.display_name, tl.product_code)
              AS product_name,
            COALESCE(tl.qty_base, tl.qty) AS qty,
            tl.unit_name                   AS unit,
            NULL::numeric                  AS unit_price,
            NULL::numeric                  AS amount
          FROM ada.transfer_lines tl
          LEFT JOIN ada.branch_stock_snapshots bss ON bss.product_code = tl.product_code
          LEFT JOIN ada.products ap                 ON ap.product_code  = tl.product_code
          LEFT JOIN public.skus s                   ON s.company_code   = tl.product_code
          WHERE tl.doc_no = $1::text
        ),
        receipt_items AS (
          SELECT
            rl.product_code,
            COALESCE(rl.product_name, bss.product_name_thai, ap.product_name_th, ap.product_name, s.display_name, rl.product_code)
              AS product_name,
            COALESCE(rl.qty_base, rl.qty) AS qty,
            rl.unit_name                   AS unit,
            rl.set_price                   AS unit_price,
            rl.net                         AS amount
          FROM ada.approved_receipt_lines rl
          LEFT JOIN ada.branch_stock_snapshots bss ON bss.product_code = rl.product_code
          LEFT JOIN ada.products ap                 ON ap.product_code  = rl.product_code
          LEFT JOIN public.skus s                   ON s.company_code   = rl.product_code
          WHERE rl.doc_no = $1::text
        ),
        sale_items AS (
          SELECT
            sl.product_code,
            COALESCE(bss.product_name_thai, ap.product_name_th, ap.product_name, s.display_name, sl.product_code)
              AS product_name,
            COALESCE(sl.qty_base, sl.qty) AS qty,
            NULL::text                     AS unit,
            sl.unit_price,
            sl.line_amount                 AS amount
          FROM ada.sales_lines sl
          JOIN public.skus s ON s.company_code = sl.product_code
          LEFT JOIN ada.branch_stock_snapshots bss ON bss.product_code = sl.product_code
          LEFT JOIN ada.products ap                 ON ap.product_code  = sl.product_code
          WHERE sl.doc_no = $1::text
        )
        SELECT * FROM transfer_items
        UNION ALL
        SELECT * FROM receipt_items
        UNION ALL
        SELECT * FROM sale_items
        ORDER BY product_code ASC
      `;

      const result = await db.query(sql, [documentNo]);

      const items = result.rows.map((row) => ({
        product_code: row.product_code,
        product_name: row.product_name || row.product_code,
        qty:          Number(row.qty || 0),
        unit:         row.unit       || null,
        unit_price:   row.unit_price != null ? Number(row.unit_price) : null,
        amount:       row.amount     != null ? Number(row.amount)     : null,
      }));

      return res.json({ document_no: documentNo, items });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createMovementAnalyticsRouter };
