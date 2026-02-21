"use strict";

const express = require("express");
const { auditLog } = require("../audit");
const { auditBase } = require("../utils/audit-payload");

const VALID_RULE_STATUS = new Set(["missing", "partial", "verified"]);

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized === "" ? null : normalized;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function readBodyValue(body, aliases) {
  for (const alias of aliases) {
    if (hasOwn(body, alias)) {
      return {
        present: true,
        value: body[alias],
      };
    }
  }
  return {
    present: false,
    value: undefined,
  };
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

function parseRuleId(rawRuleId) {
  const ruleId = parsePositiveInt(rawRuleId, null);
  if (ruleId == null) {
    throw new Error("rule_id must be a positive integer");
  }
  return ruleId;
}

function parseRuleWriteBody(body, options = {}) {
  const isUpdate = Boolean(options.isUpdate);
  const payload = {};
  const textFieldAliases = [
    { aliases: ["match_name_regex", "matchNameRegex"], column: "match_name_regex" },
    { aliases: ["match_category_regex", "matchCategoryRegex"], column: "match_category_regex" },
    { aliases: ["match_supplier_regex", "matchSupplierRegex"], column: "match_supplier_regex" },
    { aliases: ["set_generic_name", "setGenericName"], column: "set_generic_name" },
    { aliases: ["set_strength_text", "setStrengthText"], column: "set_strength_text" },
    { aliases: ["set_form", "setForm"], column: "set_form" },
    { aliases: ["set_route", "setRoute"], column: "set_route" },
    { aliases: ["set_product_kind", "setProductKind"], column: "set_product_kind" },
    { aliases: ["note"], column: "note" },
  ];

  for (const field of textFieldAliases) {
    const resolved = readBodyValue(body, field.aliases);
    if (isUpdate && !resolved.present) {
      continue;
    }
    payload[field.column] = normalizeNullableText(resolved.value);
  }

  const enabledValue = readBodyValue(body, ["is_enabled", "isEnabled"]);
  if (!isUpdate || enabledValue.present) {
    payload.is_enabled = parseBoolean(enabledValue.value, true);
  }

  const priorityValue = readBodyValue(body, ["priority"]);
  if (!isUpdate || priorityValue.present) {
    const priority = parsePositiveInt(priorityValue.value, 100, 100000);
    if (priority == null) {
      throw new Error("priority must be a positive integer");
    }
    payload.priority = priority;
  }

  const setStatusValue = readBodyValue(body, ["set_status", "setStatus"]);
  if (!isUpdate || setStatusValue.present) {
    const status = normalizeText(setStatusValue.value).toLowerCase() || "partial";
    if (!VALID_RULE_STATUS.has(status)) {
      throw new Error("set_status must be one of missing|partial|verified");
    }
    payload.set_status = status;
  }

  if (!isUpdate) {
    const hasMatcher =
      Boolean(payload.match_name_regex) ||
      Boolean(payload.match_category_regex) ||
      Boolean(payload.match_supplier_regex);
    if (!hasMatcher) {
      throw new Error("at least one matcher is required (name/category/supplier regex)");
    }
  }

  if (isUpdate && Object.keys(payload).length === 0) {
    throw new Error("no updatable fields provided");
  }

  return payload;
}

async function listRules(db) {
  const result = await db.query(
    `
      SELECT
        rule_id,
        is_enabled,
        priority,
        match_name_regex,
        match_category_regex,
        match_supplier_regex,
        set_generic_name,
        set_strength_text,
        set_form,
        set_route,
        set_product_kind,
        set_status,
        note,
        created_at,
        updated_at
      FROM public.enrichment_rules
      ORDER BY priority ASC, rule_id ASC
    `,
  );
  return result.rows;
}

async function createRule(db, payload) {
  const result = await db.query(
    `
      INSERT INTO public.enrichment_rules (
        is_enabled,
        priority,
        match_name_regex,
        match_category_regex,
        match_supplier_regex,
        set_generic_name,
        set_strength_text,
        set_form,
        set_route,
        set_product_kind,
        set_status,
        note,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now()
      )
      RETURNING
        rule_id,
        is_enabled,
        priority,
        match_name_regex,
        match_category_regex,
        match_supplier_regex,
        set_generic_name,
        set_strength_text,
        set_form,
        set_route,
        set_product_kind,
        set_status,
        note,
        created_at,
        updated_at
    `,
    [
      payload.is_enabled,
      payload.priority,
      payload.match_name_regex,
      payload.match_category_regex,
      payload.match_supplier_regex,
      payload.set_generic_name,
      payload.set_strength_text,
      payload.set_form,
      payload.set_route,
      payload.set_product_kind,
      payload.set_status,
      payload.note,
    ],
  );
  return result.rows[0];
}

async function updateRule(db, ruleId, payload) {
  const updates = [];
  const params = [];
  let idx = 1;
  for (const [column, value] of Object.entries(payload)) {
    updates.push(`${column} = $${idx}`);
    params.push(value);
    idx += 1;
  }
  updates.push("updated_at = now()");
  params.push(ruleId);

  const result = await db.query(
    `
      UPDATE public.enrichment_rules
      SET ${updates.join(", ")}
      WHERE rule_id = $${idx}
      RETURNING
        rule_id,
        is_enabled,
        priority,
        match_name_regex,
        match_category_regex,
        match_supplier_regex,
        set_generic_name,
        set_strength_text,
        set_form,
        set_route,
        set_product_kind,
        set_status,
        note,
        created_at,
        updated_at
    `,
    params,
  );
  return result.rows[0] || null;
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
    "/rules",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    async (req, res, next) => {
      try {
        const rows = await listRules(db);
        return res.json({
          ok: true,
          request_id: req.requestId,
          rows,
        });
      } catch (error) {
        if (error.code === "42P01") {
          return res.status(400).json({
            error: "enrichment_rules table not found. Run migrations/004_add_enrichment_workflow.sql first.",
            request_id: req.requestId,
          });
        }
        return next(error);
      }
    },
  );

  router.post(
    "/rules",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    requireCsrfMiddleware,
    async (req, res, next) => {
      let payload = null;
      try {
        payload = parseRuleWriteBody(req.body || {}, { isUpdate: false });
      } catch (error) {
        return res.status(400).json({
          error: error.message,
          request_id: req.requestId,
        });
      }

      try {
        const row = await createRule(db, payload);
        return res.status(201).json({
          ok: true,
          request_id: req.requestId,
          row,
        });
      } catch (error) {
        if (error.code === "42P01") {
          return res.status(400).json({
            error: "enrichment_rules table not found. Run migrations/004_add_enrichment_workflow.sql first.",
            request_id: req.requestId,
          });
        }
        return next(error);
      }
    },
  );

  router.put(
    "/rules/:rule_id",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    requireCsrfMiddleware,
    async (req, res, next) => {
      let ruleId = null;
      let payload = null;
      try {
        ruleId = parseRuleId(req.params.rule_id);
        payload = parseRuleWriteBody(req.body || {}, { isUpdate: true });
      } catch (error) {
        return res.status(400).json({
          error: error.message,
          request_id: req.requestId,
        });
      }

      try {
        const row = await updateRule(db, ruleId, payload);
        if (!row) {
          return res.status(404).json({
            error: "Rule not found",
            request_id: req.requestId,
          });
        }
        return res.json({
          ok: true,
          request_id: req.requestId,
          row,
        });
      } catch (error) {
        if (error.code === "42P01") {
          return res.status(400).json({
            error: "enrichment_rules table not found. Run migrations/004_add_enrichment_workflow.sql first.",
            request_id: req.requestId,
          });
        }
        return next(error);
      }
    },
  );

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
