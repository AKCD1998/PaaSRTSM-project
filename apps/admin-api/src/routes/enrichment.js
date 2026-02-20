"use strict";

const express = require("express");
const { auditLog } = require("../audit");
const { auditBase } = require("../utils/audit-payload");

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function parsePositiveInt(value, fallback, maxValue = null) {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  if (maxValue != null && parsed > maxValue) {
    return maxValue;
  }
  return parsed;
}

function parseBoolean(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const normalized = normalizeText(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseTopSellersQuery(query) {
  const top = parsePositiveInt(query.top, 200, 1000);
  if (top == null) {
    throw new Error("top must be a positive integer");
  }

  const since = normalizeText(query.since);
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error("since must be in YYYY-MM-DD format");
  }

  return {
    top,
    since: since || null,
  };
}

async function queryTopSellers(db, options) {
  const query = `
    WITH sales AS (
      SELECT
        company_code,
        SUM(qty) AS total_qty,
        SUM(amount) AS total_amount
      FROM public.sales_daily
      WHERE ($1::date IS NULL OR sale_date >= $1::date)
      GROUP BY company_code
    )
    SELECT
      s.sku_id,
      s.company_code,
      s.display_name,
      s.category_name,
      s.supplier_code,
      COALESCE(s.enrichment_status, 'missing') AS enrichment_status,
      s.generic_name,
      s.strength_text,
      s.form,
      s.route,
      sales.total_qty,
      sales.total_amount
    FROM sales
    JOIN public.skus s
      ON s.company_code = sales.company_code
    WHERE COALESCE(s.enrichment_status, 'missing') <> 'verified'
    ORDER BY sales.total_qty DESC, sales.total_amount DESC, s.sku_id ASC
    LIMIT $2
  `;
  const result = await db.query(query, [options.since, options.top]);
  return result.rows;
}

function parseApplyRulesBody(body) {
  const commit = parseBoolean(body?.commit, false);
  const limit = parsePositiveInt(body?.limit, null);
  const onlyStatus = normalizeText(body?.only_status || body?.onlyStatus).toLowerCase();
  const force = parseBoolean(body?.force, false);

  if (limit === null && body?.limit) {
    throw new Error("limit must be a positive integer");
  }
  if (onlyStatus && !["missing", "partial"].includes(onlyStatus)) {
    throw new Error("only_status must be missing or partial");
  }

  return {
    commit,
    dryRun: !commit,
    limit,
    onlyStatus: onlyStatus || null,
    force,
  };
}

function createEnrichmentRouter(deps) {
  const {
    config,
    db,
    runRuleApplication,
    requireAuthMiddleware,
    requireRoleMiddleware,
    requireCsrfMiddleware,
  } = deps;

  const router = express.Router();

  router.get(
    "/top-sellers",
    requireAuthMiddleware,
    requireRoleMiddleware("admin", "staff"),
    async (req, res, next) => {
      try {
        const options = parseTopSellersQuery(req.query || {});
        const rows = await queryTopSellers(db, options);
        return res.json({
          ok: true,
          request_id: req.requestId,
          filters: options,
          rows,
        });
      } catch (error) {
        if (error.message.includes("must be")) {
          return res.status(400).json({
            error: error.message,
            request_id: req.requestId,
          });
        }
        if (error.code === "42P01") {
          return res.status(400).json({
            error: "sales_daily table not found. Run migrations/005_add_sales_daily.sql first.",
            request_id: req.requestId,
          });
        }
        return next(error);
      }
    },
  );

  router.post(
    "/apply-rules",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    requireCsrfMiddleware,
    async (req, res, next) => {
      let options = null;
      try {
        options = parseApplyRulesBody(req.body || {});
      } catch (error) {
        return res.status(400).json({
          error: error.message,
          request_id: req.requestId,
        });
      }

      const payload = {
        ...options,
        dbUrl: config.databaseUrl,
      };

      try {
        if (options.commit) {
          await auditLog(
            db,
            auditBase(req, {
              action: "enrichment.apply_rules.commit_started",
              target_type: "enrichment",
              target_id: req.requestId,
              meta: {
                limit: options.limit,
                only_status: options.onlyStatus,
                force: options.force,
              },
            }),
          );
        }

        const summary = await runRuleApplication(payload);
        const eventName = options.commit
          ? "enrichment.apply_rules.commit_succeeded"
          : "enrichment.apply_rules.dry_run";

        await auditLog(
          db,
          auditBase(req, {
            action: eventName,
            target_type: "enrichment",
            target_id: req.requestId,
            success: true,
            meta: {
              limit: options.limit,
              only_status: options.onlyStatus,
              force: options.force,
              totals: summary.totals,
              rules_loaded: summary.rules_loaded,
              per_rule: summary.ruleSummaries,
            },
          }),
        );

        return res.json({
          ok: true,
          request_id: req.requestId,
          summary,
        });
      } catch (error) {
        if (options.commit) {
          await auditLog(
            db,
            auditBase(req, {
              action: "enrichment.apply_rules.commit_failed",
              target_type: "enrichment",
              target_id: req.requestId,
              success: false,
              message: error.message,
              meta: {
                limit: options.limit,
                only_status: options.onlyStatus,
                force: options.force,
              },
            }),
          );
        }
        return next(error);
      }
    },
  );

  return router;
}

module.exports = {
  createEnrichmentRouter,
};
