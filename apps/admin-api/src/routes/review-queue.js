"use strict";

const express = require("express");

// ── helpers ───────────────────────────────────────────────────────────────────

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * For each product_code, find the top-K most similar CONFIRMED categories
 * using cosine similarity on ada.product_category_embeddings.
 * Returns a Map<product_code, [{category_name, similarity, matched_code}]>
 */
async function fetchSimilarityOptions(db, productCodes, topK = 5) {
  if (!productCodes.length) return new Map();

  const { rows } = await db.query(
    `
    WITH q AS (
      SELECT pce.product_code, pce.embedding
      FROM ada.product_category_embeddings pce
      WHERE pce.product_code = ANY($1)
        AND pce.embedding IS NOT NULL
    )
    SELECT DISTINCT ON (q.product_code, r.category_name)
      q.product_code,
      r.category_name,
      r.matched_code,
      ROUND((1 - (q.embedding <=> r.embedding))::numeric, 4) AS similarity
    FROM q
    CROSS JOIN LATERAL (
      SELECT
        pcs2.category_name,
        pcs2.product_code AS matched_code,
        pce2.embedding
      FROM ada.product_category_states pcs2
      JOIN ada.product_category_embeddings pce2
             ON pce2.product_code = pcs2.product_code
      WHERE pcs2.review_status = 'confirmed'
        AND pcs2.category_name IS NOT NULL
        AND pcs2.category_name <> ''
        AND pce2.embedding IS NOT NULL
      ORDER BY q.embedding <=> pce2.embedding
      LIMIT $2
    ) r
    ORDER BY q.product_code, r.category_name, similarity DESC
    `,
    [productCodes, topK * 3], // over-fetch then deduplicate by category below
  );

  // Deduplicate: keep best similarity per (product_code, category_name), then top-K
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.product_code) || [];
    if (!list.find((x) => x.category_name === row.category_name)) {
      list.push({
        category_name: row.category_name,
        similarity: Number(row.similarity),
        matched_code: row.matched_code,
      });
    }
    map.set(row.product_code, list);
  }

  // Sort each list by similarity desc and trim to topK
  for (const [code, list] of map.entries()) {
    map.set(
      code,
      list.sort((a, b) => b.similarity - a.similarity).slice(0, topK),
    );
  }

  return map;
}

// ── router factory ────────────────────────────────────────────────────────────

function createReviewQueueRouter(deps) {
  const { db, requireAuthMiddleware, requireRoleMiddleware, requireCsrfMiddleware } = deps;
  const router = express.Router();

  /**
   * GET /api/admin/review-queue
   * Returns a page of products needing human review with pre-ranked category options.
   *
   * Query params:
   *   limit   default 30
   *   offset  default 0
   *   status  "proposed" | "needs_review" | "all"  default "all"
   *   top_k   number of category options per product  default 5
   */
  router.get(
    "/admin/review-queue",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    async (req, res, next) => {
      try {
        const limit   = toInt(req.query.limit, 30);
        const offset  = toInt(req.query.offset, 0) || 0;
        const topK    = toInt(req.query.top_k, 5);
        const status  = req.query.status || "all";

        const statusFilter =
          status === "proposed"     ? `AND pcs.review_status = 'proposed'` :
          status === "needs_review" ? `AND pcs.review_status = 'needs_review'` :
          `AND pcs.review_status IN ('proposed', 'needs_review')`;

        // Total count
        const { rows: countRows } = await db.query(
          `SELECT COUNT(*) AS total
           FROM ada.product_category_states pcs
           WHERE 1=1 ${statusFilter}`,
        );
        const total = Number(countRows[0].total);

        // Products page
        const { rows: products } = await db.query(
          `
          SELECT
            pcs.product_code,
            pcs.category_name    AS current_category,
            pcs.review_status,
            pcs.source_kind,
            pcs.source_match_level,
            COALESCE(bs.product_name_thai, s.display_name, pcs.product_code) AS product_name_thai,
            bs.product_name_eng,
            COALESCE(
              (SELECT pb.barcode FROM ada.product_barcodes pb
               WHERE pb.product_code = pcs.product_code
               ORDER BY pb.id LIMIT 1),
              bs.barcode
            ) AS barcode
          FROM ada.product_category_states pcs
          LEFT JOIN ada.branch_stock_snapshots bs  ON bs.product_code  = pcs.product_code
          LEFT JOIN public.skus s                  ON s.company_code   = pcs.product_code
          WHERE 1=1 ${statusFilter}
          ORDER BY
            CASE pcs.review_status WHEN 'proposed' THEN 0 ELSE 1 END,
            pcs.updated_at DESC
          LIMIT $1 OFFSET $2
          `,
          [limit, offset],
        );

        // Fetch similarity options for this page
        const codes = products.map((p) => p.product_code);
        const optionsMap = await fetchSimilarityOptions(db, codes, topK);

        // All known categories for the search/fallback list
        const { rows: allCatRows } = await db.query(
          `SELECT DISTINCT category_name
           FROM ada.product_category_states
           WHERE review_status = 'confirmed'
             AND category_name IS NOT NULL AND category_name <> ''
           ORDER BY category_name`,
        );
        const allCategories = allCatRows.map((r) => r.category_name);

        const records = products.map((p) => ({
          productCode:     p.product_code,
          productNameThai: p.product_name_thai || p.product_code,
          productNameEng:  p.product_name_eng  || "",
          barcode:         p.barcode            || "",
          currentCategory: p.current_category  || null,
          reviewStatus:    p.review_status,
          sourceKind:      p.source_kind        || null,
          sourceMatchLevel:p.source_match_level || null,
          options:         optionsMap.get(p.product_code) || [],
        }));

        return res.json({
          total,
          limit,
          offset,
          records,
          allCategories,
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * POST /api/admin/review-queue/confirm-batch
   * Writes N confirmed category decisions at once.
   *
   * Body: { decisions: [{ productCode, categoryName, isNewCategory? }] }
   * Each decision writes review_status = 'confirmed', source = 'human'.
   */
  router.post(
    "/admin/review-queue/confirm-batch",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    requireCsrfMiddleware,
    async (req, res, next) => {
      try {
        const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : [];
        if (decisions.length === 0) {
          return res.status(400).json({ error: "decisions array is required and must not be empty" });
        }

        const userId = req.auth?.userId || "admin";
        const client = await db.connect();

        try {
          await client.query("BEGIN");

          for (const d of decisions) {
            const { productCode, categoryName } = d;
            if (!productCode || !categoryName) continue;

            await client.query(
              `
              INSERT INTO ada.product_category_states
                (product_code, category_name, review_status, rationale,
                 source_kind, source_reference, source_match_level,
                 previous_category_name, previous_review_status,
                 imported_at, imported_by, updated_at)
              VALUES ($1, $2, 'confirmed',
                'Human review via review queue',
                'human', 'review_queue', 'human_review',
                (SELECT category_name  FROM ada.product_category_states WHERE product_code = $1),
                (SELECT review_status  FROM ada.product_category_states WHERE product_code = $1),
                now(), $3, now())
              ON CONFLICT (product_code) DO UPDATE SET
                category_name          = EXCLUDED.category_name,
                review_status          = 'confirmed',
                rationale              = EXCLUDED.rationale,
                source_kind            = EXCLUDED.source_kind,
                source_reference       = EXCLUDED.source_reference,
                source_match_level     = EXCLUDED.source_match_level,
                previous_category_name = EXCLUDED.previous_category_name,
                previous_review_status = EXCLUDED.previous_review_status,
                imported_at            = EXCLUDED.imported_at,
                imported_by            = EXCLUDED.imported_by,
                updated_at             = now()
              `,
              [productCode, categoryName, userId],
            );
          }

          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        return res.json({ ok: true, confirmed: decisions.length });
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * GET /api/admin/categories
   * Returns all known confirmed category names + their shelf rules.
   */
  router.get(
    "/admin/categories",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    async (req, res, next) => {
      try {
        const { rows } = await db.query(
          `
          SELECT
            pcs.category_name,
            COUNT(*) AS confirmed_count,
            csr.allowed_shelves,
            csr.is_cold_chain_possible,
            csr.is_controlled,
            csr.always_human_confirm
          FROM ada.product_category_states pcs
          LEFT JOIN public.category_shelf_rules csr
                 ON csr.clean_category = pcs.category_name
          WHERE pcs.review_status = 'confirmed'
            AND pcs.category_name IS NOT NULL AND pcs.category_name <> ''
          GROUP BY pcs.category_name, csr.allowed_shelves,
                   csr.is_cold_chain_possible, csr.is_controlled, csr.always_human_confirm
          ORDER BY confirmed_count DESC, pcs.category_name
          `,
        );

        return res.json({
          categories: rows.map((r) => ({
            name:             r.category_name,
            confirmedCount:   Number(r.confirmed_count),
            allowedShelves:   r.allowed_shelves || [],
            isColdChain:      Boolean(r.is_cold_chain_possible),
            isControlled:     Boolean(r.is_controlled),
            alwaysHumanConfirm: Boolean(r.always_human_confirm),
          })),
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * POST /api/admin/categories
   * Create a new category and add it to public.category_shelf_rules.
   *
   * Body: { name, allowedShelves?, isColdChain?, isControlled?, alwaysHumanConfirm? }
   */
  router.post(
    "/admin/categories",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    requireCsrfMiddleware,
    async (req, res, next) => {
      try {
        const name = String(req.body?.name || "").trim();
        if (!name) return res.status(400).json({ error: "name is required" });

        const allowedShelves    = Array.isArray(req.body.allowedShelves)
          ? req.body.allowedShelves.map(Number).filter(Number.isFinite)
          : [];
        const isColdChain       = Boolean(req.body.isColdChain);
        const isControlled      = Boolean(req.body.isControlled);
        const alwaysHumanConfirm = Boolean(req.body.alwaysHumanConfirm);

        await db.query(
          `
          INSERT INTO public.category_shelf_rules
            (clean_category, allowed_shelves, allowed_unprefixed,
             is_cold_chain_possible, is_controlled, always_human_confirm)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (clean_category) DO UPDATE SET
            allowed_shelves       = EXCLUDED.allowed_shelves,
            is_cold_chain_possible= EXCLUDED.is_cold_chain_possible,
            is_controlled         = EXCLUDED.is_controlled,
            always_human_confirm  = EXCLUDED.always_human_confirm,
            updated_at            = now()
          `,
          [name, allowedShelves, allowedShelves.length === 0, isColdChain, isControlled, alwaysHumanConfirm],
        );

        return res.json({ ok: true, name });
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}

module.exports = { createReviewQueueRouter };
