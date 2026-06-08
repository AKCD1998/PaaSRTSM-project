"use strict";

/**
 * Ingredient Dictionary Admin API (Phase 5A).
 *
 * Lets pharmacists curate the knowledge.* dictionary: ingredients, synonyms,
 * drug classes, indications and category rules, plus read-only supervision views
 * (matched products, potential discoveries).
 *
 * Safety:
 *   - Additive only. No destructive deletes anywhere — "disable" sets status to
 *     'deprecated'/'inactive'/'rejected'; "reactivate" sets it back.
 *   - Every mutation writes a public.audit_logs row with old + new values.
 *   - Category rules can only reference an EXISTING confirmed/imported category
 *     name; the API never invents categories and never writes to
 *     ada.product_category_states (review-queue / category confirmation untouched).
 *   - All routes require admin auth + role; mutations also require CSRF.
 */

const express = require("express");
const path = require("path");
const { auditLog } = require("../audit");
const { auditBase } = require("../utils/audit-payload");

// Reuse the single source of truth for name-scan coverage discovery.
// eslint-disable-next-line import/no-dynamic-require
const coverage = require(path.join(__dirname, "..", "..", "..", "..", "scripts", "ingredient_discovery_coverage"));

const INGREDIENT_STATUSES = new Set(["active", "needs_review", "deprecated"]);
const MAPPING_STATUSES = new Set(["proposed", "confirmed", "rejected", "needs_review"]);
const RULE_STATUSES = new Set(["active", "inactive", "needs_review", "deprecated"]);

function text(value) {
  return String(value == null ? "" : value).trim();
}

function toNumberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(value) {
  const n = toNumberOrNull(value);
  return n == null ? null : Math.trunc(n);
}

function clampLimit(value, fallback, max) {
  const n = toIntOrNull(value);
  if (n == null || n <= 0) return fallback;
  return Math.min(n, max);
}

function badRequest(res, req, message) {
  return res.status(400).json({ error: message, request_id: req.requestId || null });
}

function notFound(res, req, message) {
  return res.status(404).json({ error: message, request_id: req.requestId || null });
}

// ── audit helper ─────────────────────────────────────────────────────────────
async function audit(db, req, { action, targetType, targetId, success = true, message, before, after }) {
  await auditLog(
    db,
    auditBase(req, {
      action,
      target_type: targetType,
      target_id: targetId == null ? null : String(targetId),
      success,
      message: message || null,
      meta: { before: before ?? null, after: after ?? null },
    }),
  );
}

// ── potential-discovery cache (name scan is catalog-wide) ────────────────────
let discoveryCache = { at: 0, tokens: null, total: 0 };
const DISCOVERY_TTL_MS = 5 * 60 * 1000;

async function getDiscoveryTokens(db) {
  if (discoveryCache.tokens && Date.now() - discoveryCache.at < DISCOVERY_TTL_MS) {
    return discoveryCache;
  }
  const [synonyms, products] = await Promise.all([coverage.loadSynonyms(db), coverage.loadProducts(db)]);
  const scan = coverage.runScan(products, synonyms);
  const tokens = [...scan.unmatchedTokenDocFreq.entries()]
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token));
  discoveryCache = { at: Date.now(), tokens, total: scan.total };
  return discoveryCache;
}

// ── shared selects ───────────────────────────────────────────────────────────
async function fetchIngredientRow(db, ingredientId) {
  const r = await db.query(
    `SELECT ingredient_id, canonical_name, display_name, status, created_at, updated_at
     FROM knowledge.ingredients WHERE ingredient_id = $1`,
    [ingredientId],
  );
  return r.rows[0] || null;
}

function mapIngredientDetail(ingredient, synonyms, drugClasses, indications, rules) {
  return {
    ingredientId: Number(ingredient.ingredient_id),
    canonicalName: ingredient.canonical_name,
    displayName: ingredient.display_name,
    status: ingredient.status,
    createdAt: ingredient.created_at,
    updatedAt: ingredient.updated_at,
    synonyms: synonyms.map((s) => ({
      synonymId: Number(s.synonym_id),
      synonymText: s.synonym_text,
      language: s.language || null,
      source: s.source || null,
      status: s.status,
      updatedAt: s.updated_at,
    })),
    drugClasses: drugClasses.map((d) => ({
      drugClassId: Number(d.drug_class_id),
      name: d.name,
      confidence: toNumberOrNull(d.confidence),
      source: d.source || null,
      status: d.status,
      updatedAt: d.updated_at,
    })),
    indications: indications.map((i) => ({
      indicationId: Number(i.indication_id),
      name: i.name,
      source: i.source || null,
      status: i.status,
      updatedAt: i.updated_at,
    })),
    categoryRules: rules.map((rule) => ({
      ruleId: Number(rule.rule_id),
      categoryName: rule.category_name,
      drugClassId: rule.drug_class_id == null ? null : Number(rule.drug_class_id),
      drugClassName: rule.drug_class_name || null,
      indicationId: rule.indication_id == null ? null : Number(rule.indication_id),
      indicationName: rule.indication_name || null,
      priority: Number(rule.priority),
      ruleStatus: rule.rule_status,
      note: rule.note || null,
      updatedAt: rule.updated_at,
    })),
  };
}

async function loadIngredientDetail(db, ingredientId) {
  const ingredient = await fetchIngredientRow(db, ingredientId);
  if (!ingredient) return null;

  const [syn, dc, ind, rules] = await Promise.all([
    db.query(
      `SELECT synonym_id, synonym_text, language, source, status, updated_at
       FROM knowledge.ingredient_synonyms WHERE ingredient_id = $1
       ORDER BY (status <> 'deprecated') DESC, synonym_text ASC`,
      [ingredientId],
    ),
    db.query(
      `SELECT dc.drug_class_id, dc.name, idc.confidence, idc.source, idc.status, idc.updated_at
       FROM knowledge.ingredient_drug_classes idc
       JOIN knowledge.drug_classes dc ON dc.drug_class_id = idc.drug_class_id
       WHERE idc.ingredient_id = $1
       ORDER BY (idc.status <> 'rejected') DESC, dc.name ASC`,
      [ingredientId],
    ),
    db.query(
      `SELECT ind.indication_id, ind.name, ii.source, ii.status, ii.updated_at
       FROM knowledge.ingredient_indications ii
       JOIN knowledge.indications ind ON ind.indication_id = ii.indication_id
       WHERE ii.ingredient_id = $1
       ORDER BY (ii.status <> 'rejected') DESC, ind.name ASC`,
      [ingredientId],
    ),
    db.query(
      `SELECT r.rule_id, r.category_name, r.drug_class_id, dc.name AS drug_class_name,
              r.indication_id, ind.name AS indication_name, r.priority, r.rule_status, r.note, r.updated_at
       FROM knowledge.ingredient_category_rules r
       LEFT JOIN knowledge.drug_classes dc ON dc.drug_class_id = r.drug_class_id
       LEFT JOIN knowledge.indications ind ON ind.indication_id = r.indication_id
       WHERE r.ingredient_id = $1
       ORDER BY r.priority ASC, r.rule_id ASC`,
      [ingredientId],
    ),
  ]);

  return mapIngredientDetail(ingredient, syn.rows, dc.rows, ind.rows, rules.rows);
}

function createIngredientAdminRouter(deps) {
  const { db, requireAuthMiddleware, requireRoleMiddleware, requireCsrfMiddleware } = deps;
  const router = express.Router();

  const auth = [requireAuthMiddleware, requireRoleMiddleware("admin")];
  const write = [requireAuthMiddleware, requireRoleMiddleware("admin"), requireCsrfMiddleware];

  // ── LIST / SEARCH ingredients ───────────────────────────────────────────────
  router.get("/ingredients", auth, async (req, res, next) => {
    try {
      const search = text(req.query.search).slice(0, 120);
      const status = text(req.query.status);
      const limit = clampLimit(req.query.limit, 50, 200);
      const offset = Math.max(0, toIntOrNull(req.query.offset) || 0);

      const params = [];
      const where = [];
      if (search) {
        params.push(`%${search}%`);
        const p = `$${params.length}`;
        where.push(`(
          i.canonical_name ILIKE ${p} OR i.display_name ILIKE ${p}
          OR EXISTS (SELECT 1 FROM knowledge.ingredient_synonyms s WHERE s.ingredient_id = i.ingredient_id AND s.synonym_text ILIKE ${p})
          OR EXISTS (SELECT 1 FROM knowledge.ingredient_drug_classes idc JOIN knowledge.drug_classes dc ON dc.drug_class_id = idc.drug_class_id WHERE idc.ingredient_id = i.ingredient_id AND dc.name ILIKE ${p})
          OR EXISTS (SELECT 1 FROM knowledge.ingredient_indications ii JOIN knowledge.indications ind ON ind.indication_id = ii.indication_id WHERE ii.ingredient_id = i.ingredient_id AND ind.name ILIKE ${p})
        )`);
      }
      if (status && INGREDIENT_STATUSES.has(status)) {
        params.push(status);
        where.push(`i.status = $${params.length}`);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const countResult = await db.query(
        `SELECT COUNT(*)::int AS total FROM knowledge.ingredients i ${whereSql}`,
        params,
      );

      const listParams = params.slice();
      listParams.push(limit, offset);
      const rows = await db.query(
        `SELECT i.ingredient_id, i.canonical_name, i.display_name, i.status, i.updated_at,
                (SELECT COUNT(*) FROM knowledge.ingredient_synonyms s WHERE s.ingredient_id = i.ingredient_id AND s.status <> 'deprecated')::int AS synonym_count,
                (SELECT COUNT(*) FROM knowledge.ingredient_drug_classes idc WHERE idc.ingredient_id = i.ingredient_id AND idc.status <> 'rejected')::int AS drug_class_count,
                (SELECT COUNT(*) FROM knowledge.ingredient_indications ii WHERE ii.ingredient_id = i.ingredient_id AND ii.status <> 'rejected')::int AS indication_count,
                (SELECT COUNT(*) FROM knowledge.ingredient_category_rules r WHERE r.ingredient_id = i.ingredient_id AND r.rule_status = 'active')::int AS category_rule_count,
                COALESCE((SELECT string_agg(dc.name, ', ' ORDER BY dc.name)
                          FROM knowledge.ingredient_drug_classes idc JOIN knowledge.drug_classes dc ON dc.drug_class_id = idc.drug_class_id
                          WHERE idc.ingredient_id = i.ingredient_id AND idc.status <> 'rejected'), '') AS drug_class_names,
                COALESCE((SELECT string_agg(ind.name, ', ' ORDER BY ind.name)
                          FROM knowledge.ingredient_indications ii JOIN knowledge.indications ind ON ind.indication_id = ii.indication_id
                          WHERE ii.ingredient_id = i.ingredient_id AND ii.status <> 'rejected'), '') AS indication_names
         FROM knowledge.ingredients i
         ${whereSql}
         ORDER BY i.display_name ASC, i.canonical_name ASC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return res.json({
        ok: true,
        total: countResult.rows[0].total,
        limit,
        offset,
        records: rows.rows.map((r) => ({
          ingredientId: Number(r.ingredient_id),
          canonicalName: r.canonical_name,
          displayName: r.display_name,
          status: r.status,
          synonymCount: r.synonym_count,
          drugClassCount: r.drug_class_count,
          indicationCount: r.indication_count,
          categoryRuleCount: r.category_rule_count,
          drugClassNames: r.drug_class_names,
          indicationNames: r.indication_names,
          updatedAt: r.updated_at,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  // ── INGREDIENT detail ────────────────────────────────────────────────────────
  router.get("/ingredients/:id", auth, async (req, res, next) => {
    try {
      const id = toIntOrNull(req.params.id);
      if (!id) return badRequest(res, req, "Invalid ingredient id");
      const detail = await loadIngredientDetail(db, id);
      if (!detail) return notFound(res, req, "Ingredient not found");
      return res.json({ ok: true, ingredient: detail });
    } catch (error) {
      return next(error);
    }
  });

  // ── CREATE ingredient ─────────────────────────────────────────────────────────
  router.post("/ingredients", write, async (req, res, next) => {
    try {
      const canonicalName = text(req.body?.canonicalName).toLowerCase();
      const displayName = text(req.body?.displayName) || canonicalName;
      if (!canonicalName) return badRequest(res, req, "canonicalName is required");

      const existing = await db.query(
        `SELECT ingredient_id FROM knowledge.ingredients WHERE LOWER(BTRIM(canonical_name)) = $1`,
        [canonicalName],
      );
      if (existing.rows[0]) {
        return res.status(409).json({ error: "Ingredient already exists", ingredientId: Number(existing.rows[0].ingredient_id), request_id: req.requestId || null });
      }

      const inserted = await db.query(
        `INSERT INTO knowledge.ingredients (canonical_name, display_name, status, updated_at)
         VALUES ($1, $2, 'active', now()) RETURNING ingredient_id`,
        [canonicalName, displayName],
      );
      const ingredientId = Number(inserted.rows[0].ingredient_id);
      await audit(db, req, {
        action: "ingredient_dictionary.ingredient.create",
        targetType: "ingredient", targetId: ingredientId,
        after: { canonicalName, displayName, status: "active" },
      });
      const detail = await loadIngredientDetail(db, ingredientId);
      return res.status(201).json({ ok: true, ingredient: detail });
    } catch (error) {
      return next(error);
    }
  });

  // ── UPDATE ingredient (status / display name) ─────────────────────────────────
  router.patch("/ingredients/:id", write, async (req, res, next) => {
    try {
      const id = toIntOrNull(req.params.id);
      if (!id) return badRequest(res, req, "Invalid ingredient id");
      const before = await fetchIngredientRow(db, id);
      if (!before) return notFound(res, req, "Ingredient not found");

      const nextStatus = req.body?.status === undefined ? before.status : text(req.body.status);
      const nextDisplay = req.body?.displayName === undefined ? before.display_name : text(req.body.displayName);
      if (!INGREDIENT_STATUSES.has(nextStatus)) return badRequest(res, req, "Invalid status");
      if (!nextDisplay) return badRequest(res, req, "displayName cannot be empty");

      const updated = await db.query(
        `UPDATE knowledge.ingredients SET status = $2, display_name = $3, updated_at = now()
         WHERE ingredient_id = $1 RETURNING ingredient_id`,
        [id, nextStatus, nextDisplay],
      );
      if (!updated.rows[0]) return notFound(res, req, "Ingredient not found");

      await audit(db, req, {
        action: "ingredient_dictionary.ingredient.update",
        targetType: "ingredient", targetId: id,
        before: { status: before.status, displayName: before.display_name },
        after: { status: nextStatus, displayName: nextDisplay },
      });
      const detail = await loadIngredientDetail(db, id);
      return res.json({ ok: true, ingredient: detail });
    } catch (error) {
      return next(error);
    }
  });

  // ── SYNONYMS ──────────────────────────────────────────────────────────────────
  router.post("/ingredients/:id/synonyms", write, async (req, res, next) => {
    try {
      const id = toIntOrNull(req.params.id);
      if (!id) return badRequest(res, req, "Invalid ingredient id");
      const synonymText = text(req.body?.synonymText);
      const language = text(req.body?.language) || null;
      if (!synonymText) return badRequest(res, req, "synonymText is required");
      if (!(await fetchIngredientRow(db, id))) return notFound(res, req, "Ingredient not found");

      const dup = await db.query(
        `SELECT synonym_id, ingredient_id, status FROM knowledge.ingredient_synonyms
         WHERE LOWER(BTRIM(synonym_text)) = LOWER(BTRIM($1))`,
        [synonymText],
      );
      if (dup.rows[0]) {
        return res.status(409).json({
          error: "Synonym already exists (synonyms are globally unique)",
          synonymId: Number(dup.rows[0].synonym_id),
          ingredientId: Number(dup.rows[0].ingredient_id),
          request_id: req.requestId || null,
        });
      }

      const inserted = await db.query(
        `INSERT INTO knowledge.ingredient_synonyms (ingredient_id, synonym_text, language, source, status, updated_at)
         VALUES ($1, $2, $3, $4, 'active', now()) RETURNING synonym_id`,
        [id, synonymText, language, `admin:${req.auth?.userId || "admin"}`],
      );
      const synonymId = Number(inserted.rows[0].synonym_id);
      await audit(db, req, {
        action: "ingredient_dictionary.synonym.add",
        targetType: "ingredient_synonym", targetId: synonymId,
        after: { ingredientId: id, synonymText, language, status: "active" },
      });
      discoveryCache = { at: 0, tokens: null, total: 0 }; // dictionary changed
      const detail = await loadIngredientDetail(db, id);
      return res.status(201).json({ ok: true, ingredient: detail });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/synonyms/:synonymId", write, async (req, res, next) => {
    try {
      const synonymId = toIntOrNull(req.params.synonymId);
      if (!synonymId) return badRequest(res, req, "Invalid synonym id");
      const nextStatus = text(req.body?.status);
      if (!INGREDIENT_STATUSES.has(nextStatus)) return badRequest(res, req, "Invalid status (active|needs_review|deprecated)");

      const before = await db.query(
        `SELECT synonym_id, ingredient_id, synonym_text, status FROM knowledge.ingredient_synonyms WHERE synonym_id = $1`,
        [synonymId],
      );
      if (!before.rows[0]) return notFound(res, req, "Synonym not found");

      await db.query(
        `UPDATE knowledge.ingredient_synonyms SET status = $2, updated_at = now() WHERE synonym_id = $1`,
        [synonymId, nextStatus],
      );
      await audit(db, req, {
        action: "ingredient_dictionary.synonym.status",
        targetType: "ingredient_synonym", targetId: synonymId,
        before: { status: before.rows[0].status },
        after: { status: nextStatus },
      });
      discoveryCache = { at: 0, tokens: null, total: 0 };
      const detail = await loadIngredientDetail(db, Number(before.rows[0].ingredient_id));
      return res.json({ ok: true, ingredient: detail });
    } catch (error) {
      return next(error);
    }
  });

  // ── DRUG CLASSES ────────────────────────────────────────────────────────────
  router.get("/drug-classes", auth, async (req, res, next) => {
    try {
      const search = text(req.query.search).slice(0, 120);
      const params = [];
      let whereSql = "WHERE status <> 'deprecated'";
      if (search) {
        params.push(`%${search}%`);
        whereSql += ` AND name ILIKE $${params.length}`;
      }
      const rows = await db.query(
        `SELECT drug_class_id, name, status FROM knowledge.drug_classes ${whereSql} ORDER BY name ASC LIMIT 100`,
        params,
      );
      return res.json({ ok: true, records: rows.rows.map((r) => ({ drugClassId: Number(r.drug_class_id), name: r.name, status: r.status })) });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/drug-classes", write, async (req, res, next) => {
    try {
      const name = text(req.body?.name);
      if (!name) return badRequest(res, req, "name is required");
      const inserted = await db.query(
        `INSERT INTO knowledge.drug_classes (name, status, updated_at)
         VALUES ($1, 'active', now())
         ON CONFLICT (name) DO UPDATE SET updated_at = knowledge.drug_classes.updated_at
         RETURNING drug_class_id, (xmax = 0) AS inserted`,
        [name],
      );
      const drugClassId = Number(inserted.rows[0].drug_class_id);
      if (inserted.rows[0].inserted) {
        await audit(db, req, {
          action: "ingredient_dictionary.drug_class.create",
          targetType: "drug_class", targetId: drugClassId, after: { name, status: "active" },
        });
      }
      return res.status(inserted.rows[0].inserted ? 201 : 200).json({ ok: true, drugClassId, name, created: inserted.rows[0].inserted });
    } catch (error) {
      return next(error);
    }
  });

  // link ingredient -> drug class (create class on the fly if name supplied)
  router.post("/ingredients/:id/drug-classes", write, async (req, res, next) => {
    try {
      const id = toIntOrNull(req.params.id);
      if (!id) return badRequest(res, req, "Invalid ingredient id");
      if (!(await fetchIngredientRow(db, id))) return notFound(res, req, "Ingredient not found");

      let drugClassId = toIntOrNull(req.body?.drugClassId);
      const name = text(req.body?.name);
      const source = text(req.body?.source) || `admin:${req.auth?.userId || "admin"}`;
      const confidence = toNumberOrNull(req.body?.confidence);
      if (confidence != null && (confidence < 0 || confidence > 1)) return badRequest(res, req, "confidence must be between 0 and 1");

      if (!drugClassId) {
        if (!name) return badRequest(res, req, "drugClassId or name is required");
        const cls = await db.query(
          `INSERT INTO knowledge.drug_classes (name, status, updated_at) VALUES ($1, 'active', now())
           ON CONFLICT (name) DO UPDATE SET updated_at = knowledge.drug_classes.updated_at
           RETURNING drug_class_id`,
          [name],
        );
        drugClassId = Number(cls.rows[0].drug_class_id);
      } else {
        const exists = await db.query(`SELECT 1 FROM knowledge.drug_classes WHERE drug_class_id = $1`, [drugClassId]);
        if (!exists.rows[0]) return badRequest(res, req, "drugClassId not found");
      }

      const before = await db.query(
        `SELECT status FROM knowledge.ingredient_drug_classes WHERE ingredient_id = $1 AND drug_class_id = $2`,
        [id, drugClassId],
      );
      await db.query(
        `INSERT INTO knowledge.ingredient_drug_classes (ingredient_id, drug_class_id, confidence, source, status, confirmed_by, confirmed_at, updated_at)
         VALUES ($1, $2, $3, $4, 'confirmed', $5, now(), now())
         ON CONFLICT (ingredient_id, drug_class_id) DO UPDATE SET
           confidence = EXCLUDED.confidence, source = EXCLUDED.source, status = 'confirmed',
           confirmed_by = EXCLUDED.confirmed_by, updated_at = now()`,
        [id, drugClassId, confidence, source, req.auth?.userId || "admin"],
      );
      await audit(db, req, {
        action: "ingredient_dictionary.drug_class.link",
        targetType: "ingredient_drug_class", targetId: `${id}:${drugClassId}`,
        before: before.rows[0] ? { status: before.rows[0].status } : null,
        after: { ingredientId: id, drugClassId, confidence, source, status: "confirmed" },
      });
      const detail = await loadIngredientDetail(db, id);
      return res.status(201).json({ ok: true, ingredient: detail });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/ingredients/:id/drug-classes/:drugClassId", write, async (req, res, next) => {
    try {
      const id = toIntOrNull(req.params.id);
      const drugClassId = toIntOrNull(req.params.drugClassId);
      if (!id || !drugClassId) return badRequest(res, req, "Invalid id");
      const nextStatus = text(req.body?.status);
      if (!MAPPING_STATUSES.has(nextStatus)) return badRequest(res, req, "Invalid status (proposed|confirmed|rejected|needs_review)");

      const before = await db.query(
        `SELECT status FROM knowledge.ingredient_drug_classes WHERE ingredient_id = $1 AND drug_class_id = $2`,
        [id, drugClassId],
      );
      if (!before.rows[0]) return notFound(res, req, "Mapping not found");

      await db.query(
        `UPDATE knowledge.ingredient_drug_classes SET status = $3, updated_at = now()
         WHERE ingredient_id = $1 AND drug_class_id = $2`,
        [id, drugClassId, nextStatus],
      );
      await audit(db, req, {
        action: "ingredient_dictionary.drug_class.status",
        targetType: "ingredient_drug_class", targetId: `${id}:${drugClassId}`,
        before: { status: before.rows[0].status }, after: { status: nextStatus },
      });
      const detail = await loadIngredientDetail(db, id);
      return res.json({ ok: true, ingredient: detail });
    } catch (error) {
      return next(error);
    }
  });

  // ── INDICATIONS ───────────────────────────────────────────────────────────────
  router.get("/indications", auth, async (req, res, next) => {
    try {
      const search = text(req.query.search).slice(0, 120);
      const params = [];
      let whereSql = "WHERE status <> 'deprecated'";
      if (search) {
        params.push(`%${search}%`);
        whereSql += ` AND name ILIKE $${params.length}`;
      }
      const rows = await db.query(
        `SELECT indication_id, name, status FROM knowledge.indications ${whereSql} ORDER BY name ASC LIMIT 100`,
        params,
      );
      return res.json({ ok: true, records: rows.rows.map((r) => ({ indicationId: Number(r.indication_id), name: r.name, status: r.status })) });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/indications", write, async (req, res, next) => {
    try {
      const name = text(req.body?.name);
      if (!name) return badRequest(res, req, "name is required");
      const inserted = await db.query(
        `INSERT INTO knowledge.indications (name, status, updated_at)
         VALUES ($1, 'active', now())
         ON CONFLICT (name) DO UPDATE SET updated_at = knowledge.indications.updated_at
         RETURNING indication_id, (xmax = 0) AS inserted`,
        [name],
      );
      const indicationId = Number(inserted.rows[0].indication_id);
      if (inserted.rows[0].inserted) {
        await audit(db, req, {
          action: "ingredient_dictionary.indication.create",
          targetType: "indication", targetId: indicationId, after: { name, status: "active" },
        });
      }
      return res.status(inserted.rows[0].inserted ? 201 : 200).json({ ok: true, indicationId, name, created: inserted.rows[0].inserted });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/ingredients/:id/indications", write, async (req, res, next) => {
    try {
      const id = toIntOrNull(req.params.id);
      if (!id) return badRequest(res, req, "Invalid ingredient id");
      if (!(await fetchIngredientRow(db, id))) return notFound(res, req, "Ingredient not found");

      let indicationId = toIntOrNull(req.body?.indicationId);
      const name = text(req.body?.name);
      const source = text(req.body?.source) || `admin:${req.auth?.userId || "admin"}`;

      if (!indicationId) {
        if (!name) return badRequest(res, req, "indicationId or name is required");
        const ind = await db.query(
          `INSERT INTO knowledge.indications (name, status, updated_at) VALUES ($1, 'active', now())
           ON CONFLICT (name) DO UPDATE SET updated_at = knowledge.indications.updated_at
           RETURNING indication_id`,
          [name],
        );
        indicationId = Number(ind.rows[0].indication_id);
      } else {
        const exists = await db.query(`SELECT 1 FROM knowledge.indications WHERE indication_id = $1`, [indicationId]);
        if (!exists.rows[0]) return badRequest(res, req, "indicationId not found");
      }

      const before = await db.query(
        `SELECT status FROM knowledge.ingredient_indications WHERE ingredient_id = $1 AND indication_id = $2`,
        [id, indicationId],
      );
      await db.query(
        `INSERT INTO knowledge.ingredient_indications (ingredient_id, indication_id, source, status, confirmed_by, confirmed_at, updated_at)
         VALUES ($1, $2, $3, 'confirmed', $4, now(), now())
         ON CONFLICT (ingredient_id, indication_id) DO UPDATE SET
           source = EXCLUDED.source, status = 'confirmed', confirmed_by = EXCLUDED.confirmed_by, updated_at = now()`,
        [id, indicationId, source, req.auth?.userId || "admin"],
      );
      await audit(db, req, {
        action: "ingredient_dictionary.indication.link",
        targetType: "ingredient_indication", targetId: `${id}:${indicationId}`,
        before: before.rows[0] ? { status: before.rows[0].status } : null,
        after: { ingredientId: id, indicationId, source, status: "confirmed" },
      });
      const detail = await loadIngredientDetail(db, id);
      return res.status(201).json({ ok: true, ingredient: detail });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/ingredients/:id/indications/:indicationId", write, async (req, res, next) => {
    try {
      const id = toIntOrNull(req.params.id);
      const indicationId = toIntOrNull(req.params.indicationId);
      if (!id || !indicationId) return badRequest(res, req, "Invalid id");
      const nextStatus = text(req.body?.status);
      if (!MAPPING_STATUSES.has(nextStatus)) return badRequest(res, req, "Invalid status");

      const before = await db.query(
        `SELECT status FROM knowledge.ingredient_indications WHERE ingredient_id = $1 AND indication_id = $2`,
        [id, indicationId],
      );
      if (!before.rows[0]) return notFound(res, req, "Mapping not found");

      await db.query(
        `UPDATE knowledge.ingredient_indications SET status = $3, updated_at = now()
         WHERE ingredient_id = $1 AND indication_id = $2`,
        [id, indicationId, nextStatus],
      );
      await audit(db, req, {
        action: "ingredient_dictionary.indication.status",
        targetType: "ingredient_indication", targetId: `${id}:${indicationId}`,
        before: { status: before.rows[0].status }, after: { status: nextStatus },
      });
      const detail = await loadIngredientDetail(db, id);
      return res.json({ ok: true, ingredient: detail });
    } catch (error) {
      return next(error);
    }
  });

  // ── CATEGORIES (existing confirmed/imported names only — read-only picker) ────
  router.get("/categories", auth, async (req, res, next) => {
    try {
      const search = text(req.query.search).slice(0, 120);
      const params = [];
      let whereSql = `WHERE review_status IN ('confirmed','imported_exact_match') AND category_name IS NOT NULL AND BTRIM(category_name) <> ''`;
      if (search) {
        params.push(`%${search}%`);
        whereSql += ` AND category_name ILIKE $${params.length}`;
      }
      const rows = await db.query(
        `SELECT category_name, COUNT(*)::int AS product_count
         FROM ada.product_category_states ${whereSql}
         GROUP BY category_name ORDER BY category_name ASC LIMIT 500`,
        params,
      );
      return res.json({ ok: true, records: rows.rows.map((r) => ({ categoryName: r.category_name, productCount: r.product_count })) });
    } catch (error) {
      return next(error);
    }
  });

  // ── CATEGORY RULES ─────────────────────────────────────────────────────────────
  router.post("/ingredients/:id/category-rules", write, async (req, res, next) => {
    try {
      const id = toIntOrNull(req.params.id);
      if (!id) return badRequest(res, req, "Invalid ingredient id");
      if (!(await fetchIngredientRow(db, id))) return notFound(res, req, "Ingredient not found");

      const categoryName = text(req.body?.categoryName);
      const drugClassId = toIntOrNull(req.body?.drugClassId);
      const indicationId = toIntOrNull(req.body?.indicationId);
      const priority = toIntOrNull(req.body?.priority) ?? 100;
      const note = text(req.body?.note) || null;
      if (!categoryName) return badRequest(res, req, "categoryName is required");

      // Never invent categories: the name must already exist as confirmed/imported.
      const catExists = await db.query(
        `SELECT 1 FROM ada.product_category_states
         WHERE category_name = $1 AND review_status IN ('confirmed','imported_exact_match') LIMIT 1`,
        [categoryName],
      );
      if (!catExists.rows[0]) {
        return badRequest(res, req, "categoryName must match an existing confirmed/imported category (cannot invent categories)");
      }

      const dup = await db.query(
        `SELECT rule_id FROM knowledge.ingredient_category_rules
         WHERE ingredient_id = $1 AND category_name = $2
           AND COALESCE(drug_class_id, -1) = COALESCE($3::bigint, -1)
           AND COALESCE(indication_id, -1) = COALESCE($4::bigint, -1)`,
        [id, categoryName, drugClassId, indicationId],
      );
      if (dup.rows[0]) {
        return res.status(409).json({ error: "An identical rule already exists", ruleId: Number(dup.rows[0].rule_id), request_id: req.requestId || null });
      }

      const inserted = await db.query(
        `INSERT INTO knowledge.ingredient_category_rules
           (ingredient_id, drug_class_id, indication_id, category_name, priority, rule_status, note, created_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, now())
         RETURNING rule_id`,
        [id, drugClassId, indicationId, categoryName, priority, note, `admin:${req.auth?.userId || "admin"}`],
      );
      const ruleId = Number(inserted.rows[0].rule_id);
      await audit(db, req, {
        action: "ingredient_dictionary.category_rule.create",
        targetType: "ingredient_category_rule", targetId: ruleId,
        after: { ingredientId: id, categoryName, drugClassId, indicationId, priority, ruleStatus: "active", note },
      });
      const detail = await loadIngredientDetail(db, id);
      return res.status(201).json({ ok: true, ingredient: detail });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/category-rules/:ruleId", write, async (req, res, next) => {
    try {
      const ruleId = toIntOrNull(req.params.ruleId);
      if (!ruleId) return badRequest(res, req, "Invalid rule id");
      const before = await db.query(
        `SELECT rule_id, ingredient_id, priority, rule_status FROM knowledge.ingredient_category_rules WHERE rule_id = $1`,
        [ruleId],
      );
      if (!before.rows[0]) return notFound(res, req, "Rule not found");

      const nextPriority = req.body?.priority === undefined ? before.rows[0].priority : toIntOrNull(req.body.priority);
      const nextStatus = req.body?.ruleStatus === undefined ? before.rows[0].rule_status : text(req.body.ruleStatus);
      if (nextPriority == null) return badRequest(res, req, "Invalid priority");
      if (!RULE_STATUSES.has(nextStatus)) return badRequest(res, req, "Invalid ruleStatus (active|inactive|needs_review|deprecated)");

      await db.query(
        `UPDATE knowledge.ingredient_category_rules SET priority = $2, rule_status = $3, updated_at = now() WHERE rule_id = $1`,
        [ruleId, nextPriority, nextStatus],
      );
      await audit(db, req, {
        action: "ingredient_dictionary.category_rule.update",
        targetType: "ingredient_category_rule", targetId: ruleId,
        before: { priority: before.rows[0].priority, ruleStatus: before.rows[0].rule_status },
        after: { priority: nextPriority, ruleStatus: nextStatus },
      });
      const detail = await loadIngredientDetail(db, Number(before.rows[0].ingredient_id));
      return res.json({ ok: true, ingredient: detail });
    } catch (error) {
      return next(error);
    }
  });

  // ── MATCHED PRODUCTS (supervision, paginated) ─────────────────────────────────
  router.get("/matched-products", auth, async (req, res, next) => {
    try {
      const search = text(req.query.search).slice(0, 120);
      const limit = clampLimit(req.query.limit, 50, 200);
      const offset = Math.max(0, toIntOrNull(req.query.offset) || 0);

      const params = [];
      const where = ["pi.status <> 'rejected'"];
      if (search) {
        params.push(`%${search}%`);
        const p = `$${params.length}`;
        where.push(`(pi.product_code ILIKE ${p} OR i.display_name ILIKE ${p} OR bs.product_name_thai ILIKE ${p} OR bs.product_name_eng ILIKE ${p})`);
      }
      const whereSql = `WHERE ${where.join(" AND ")}`;

      const countResult = await db.query(
        `SELECT COUNT(*)::int AS total
         FROM knowledge.product_ingredients pi
         JOIN knowledge.ingredients i ON i.ingredient_id = pi.ingredient_id
         LEFT JOIN ada.branch_stock_snapshots bs ON bs.product_code = pi.product_code
         ${whereSql}`,
        params,
      );

      const listParams = params.slice();
      listParams.push(limit, offset);
      const rows = await db.query(
        `SELECT pi.product_code, pi.ingredient_id, i.display_name AS ingredient, pi.source AS match_source, pi.status,
                pi.strength_value, pi.strength_unit,
                COALESCE(bs.product_name_thai, bs.product_name_eng, pi.product_code) AS product_name
         FROM knowledge.product_ingredients pi
         JOIN knowledge.ingredients i ON i.ingredient_id = pi.ingredient_id
         LEFT JOIN ada.branch_stock_snapshots bs ON bs.product_code = pi.product_code
         ${whereSql}
         ORDER BY pi.product_code ASC, i.display_name ASC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return res.json({
        ok: true,
        total: countResult.rows[0].total,
        limit,
        offset,
        records: rows.rows.map((r) => ({
          productCode: r.product_code,
          ingredientId: Number(r.ingredient_id),
          productName: r.product_name,
          matchedIngredient: r.ingredient,
          matchSource: r.match_source,
          ingredientStatus: r.status,
          strengthValue: toNumberOrNull(r.strength_value),
          strengthUnit: r.strength_unit || null,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  // ── PRODUCT-INGREDIENT confirmation (proposed -> confirmed/rejected) ──────────
  // The human review action for backfilled / proposed product ingredients.
  // Never auto-runs; always an explicit pharmacist click.
  async function setProductIngredientStatus(req, productCode, ingredientId, nextStatus) {
    const before = await db.query(
      `SELECT status, source, confirmed_by FROM knowledge.product_ingredients
       WHERE product_code = $1 AND ingredient_id = $2`,
      [productCode, ingredientId],
    );
    if (!before.rows[0]) return { notFound: true };

    const userId = req.auth?.userId || "admin";
    const resolved = nextStatus === "confirmed" || nextStatus === "rejected";
    await db.query(
      `UPDATE knowledge.product_ingredients
       SET status = $3,
           confirmed_by = CASE WHEN $4 THEN $5 ELSE confirmed_by END,
           confirmed_at = CASE WHEN $4 THEN now() ELSE confirmed_at END,
           updated_at = now()
       WHERE product_code = $1 AND ingredient_id = $2`,
      [productCode, ingredientId, nextStatus, resolved, userId],
    );

    // Resolve the open suggestion-audit entry (designed home for resolution).
    const auditStatus = nextStatus === "confirmed" ? "accepted" : nextStatus === "rejected" ? "rejected" : "proposed";
    if (auditStatus !== "proposed") {
      await db.query(
        `UPDATE knowledge.ingredient_suggestion_audit
         SET status = $3, resolved_by = $4, resolved_at = now()
         WHERE product_code = $1 AND suggestion_type = 'ingredient'
           AND (suggested_payload->>'ingredientId')::bigint = $2 AND status = 'proposed'`,
        [productCode, ingredientId, auditStatus, userId],
      );
    }

    await audit(db, req, {
      action: "ingredient_dictionary.product_ingredient.status",
      targetType: "product_ingredient", targetId: `${productCode}:${ingredientId}`,
      before: { status: before.rows[0].status, source: before.rows[0].source },
      after: { status: nextStatus, confirmedBy: resolved ? userId : before.rows[0].confirmed_by },
    });
    return { ok: true };
  }

  router.patch("/product-ingredients/:productCode/:ingredientId", write, async (req, res, next) => {
    try {
      const productCode = text(req.params.productCode);
      const ingredientId = toIntOrNull(req.params.ingredientId);
      const nextStatus = text(req.body?.status);
      if (!productCode || !ingredientId) return badRequest(res, req, "Invalid product/ingredient id");
      if (!MAPPING_STATUSES.has(nextStatus)) return badRequest(res, req, "Invalid status (proposed|confirmed|rejected|needs_review)");

      const result = await setProductIngredientStatus(req, productCode, ingredientId, nextStatus);
      if (result.notFound) return notFound(res, req, "Product ingredient not found");
      return res.json({ ok: true, productCode, ingredientId, status: nextStatus });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/product-ingredients/confirm-batch", write, async (req, res, next) => {
    try {
      const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : null;
      if (!decisions || decisions.length === 0) return badRequest(res, req, "decisions[] is required");
      if (decisions.length > 500) return badRequest(res, req, "Too many decisions (max 500)");

      let updated = 0;
      let notFound = 0;
      const errors = [];
      for (const d of decisions) {
        const productCode = text(d?.productCode);
        const ingredientId = toIntOrNull(d?.ingredientId);
        const nextStatus = text(d?.status);
        if (!productCode || !ingredientId || !MAPPING_STATUSES.has(nextStatus)) {
          errors.push({ productCode, ingredientId, reason: "invalid" });
          continue;
        }
        const result = await setProductIngredientStatus(req, productCode, ingredientId, nextStatus);
        if (result.notFound) notFound += 1; else updated += 1;
      }
      return res.json({ ok: true, updated, notFound, errors });
    } catch (error) {
      return next(error);
    }
  });

  // ── POTENTIAL DISCOVERIES (unmatched recurring tokens) ────────────────────────
  router.get("/potential-discoveries", auth, async (req, res, next) => {
    try {
      const limit = clampLimit(req.query.limit, 100, 500);
      const minCount = Math.max(2, toIntOrNull(req.query.minCount) || 3);
      const { tokens, total } = await getDiscoveryTokens(db);
      const records = tokens
        .filter((t) => t.count >= minCount)
        .slice(0, limit)
        .map((t) => ({ token: t.token, productCount: t.count, coveragePct: total ? (t.count / total) * 100 : 0 }));
      return res.json({ ok: true, totalProducts: total, minCount, records });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createIngredientAdminRouter,
  loadIngredientDetail,
};
