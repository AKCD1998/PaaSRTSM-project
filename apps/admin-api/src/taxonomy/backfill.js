"use strict";

const PRODUCT_TYPES = [
  "drug",
  "supplement",
  "herb",
  "antiseptic",
  "cosmeceutical",
  "cosmetic",
  "device",
  "service",
  "other",
];

const PRODUCT_TYPE_SET = new Set(PRODUCT_TYPES);
const ENRICHMENT_STATUSES = ["missing", "partial", "verified", "not_applicable"];
const ENRICHMENT_STATUS_SET = new Set(ENRICHMENT_STATUSES);

const MATCHERS = {
  herb: /สมุนไพร|ยาสมุนไพร|herbal|herb/i,
  antiseptic: /แอลกอฮอล์|disinfect|antiseptic|น้ำยาฆ่าเชื้อ|ฆ่าเชื้อ|chlorhexidine|povidone|iodine/i,
  supplement: /วิตามิน|supplement|อาหารเสริม|nutrition|nutraceutical/i,
  drug: /ยา|pharma|drug|pharmaceutical/i,
  cosmeceutical: /เวชสำอาง|cosmeceutical/i,
  cosmetic: /เครื่องสำอาง|cosmetic|beauty|skincare/i,
};

const RULE_DEFINITIONS = [
  {
    ruleKey: "device_product_kind",
    productType: "device",
    reasonLabel: "product_kind = device_or_general_goods",
    match: (row) => normalizeText(row.product_kind) === "device_or_general_goods",
    enrichmentStatus: "not_applicable",
  },
  {
    ruleKey: "service_company_code",
    productType: "service",
    reasonLabel: "company_code LIKE IS-%",
    match: (row) => /^IS-/i.test(normalizeText(row.sku_code || row.company_code)),
    enrichmentStatus: "not_applicable",
  },
  {
    ruleKey: "ingredient_categories",
    productType: null,
    reasonLabel: "confirmed ingredient category",
    match: (row) => classifyIngredientCategories(row.ingredient_categories),
  },
  {
    ruleKey: "category_name_herb",
    productType: "herb",
    reasonLabel: "category_name regex",
    match: (row) => MATCHERS.herb.test(normalizeText(row.category_name)),
  },
  {
    ruleKey: "category_name_antiseptic",
    productType: "antiseptic",
    reasonLabel: "category_name regex",
    match: (row) => MATCHERS.antiseptic.test(normalizeText(row.category_name)),
  },
  {
    ruleKey: "category_name_supplement",
    productType: "supplement",
    reasonLabel: "category_name regex",
    match: (row) => MATCHERS.supplement.test(normalizeText(row.category_name)),
  },
  {
    ruleKey: "category_name_drug",
    productType: "drug",
    reasonLabel: "category_name regex",
    match: (row) => MATCHERS.drug.test(normalizeText(row.category_name)),
  },
  {
    ruleKey: "category_name_cosmetic",
    productType: "cosmetic",
    reasonLabel: "category_name regex",
    match: (row) => MATCHERS.cosmetic.test(normalizeText(row.category_name)),
  },
];

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

function normalizeNullableProductType(value) {
  if (value == null || value === "") {
    return null;
  }
  const normalized = normalizeText(value).toLowerCase();
  if (!PRODUCT_TYPE_SET.has(normalized)) {
    throw new Error(`product_type must be one of ${PRODUCT_TYPES.join("|")} or null`);
  }
  return normalized;
}

function normalizeEnrichmentStatus(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!ENRICHMENT_STATUS_SET.has(normalized)) {
    throw new Error(
      `enrichment_status must be one of ${ENRICHMENT_STATUSES.join("|")}`,
    );
  }
  return normalized;
}

function classifyIngredientCategories(categories) {
  for (const categoryName of categories || []) {
    const normalized = normalizeText(categoryName);
    if (!normalized) {
      continue;
    }
    if (MATCHERS.herb.test(normalized)) {
      return { productType: "herb" };
    }
    if (MATCHERS.antiseptic.test(normalized)) {
      return { productType: "antiseptic" };
    }
    if (MATCHERS.supplement.test(normalized)) {
      return { productType: "supplement" };
    }
    if (MATCHERS.cosmeceutical.test(normalized)) {
      return { productType: "cosmeceutical" };
    }
    if (MATCHERS.drug.test(normalized)) {
      return { productType: "drug" };
    }
    if (MATCHERS.cosmetic.test(normalized)) {
      return { productType: "cosmetic" };
    }
  }
  return null;
}

async function loadBackfillCandidates(db, options = {}) {
  const limit = parsePositiveInt(options.limit, null, 100000);
  if (limit == null && options.limit != null && options.limit !== "") {
    throw new Error("limit must be a positive integer");
  }

  const params = [];
  let limitSql = "";
  if (limit != null) {
    params.push(limit);
    limitSql = `LIMIT $${params.length}`;
  }

  const result = await db.query(
    `
      WITH ingredient_category_matches AS (
        SELECT
          pi.product_code,
          icr.category_name,
          MAX(icr.priority) AS max_priority
        FROM knowledge.product_ingredients pi
        JOIN knowledge.ingredient_category_rules icr
          ON icr.ingredient_id = pi.ingredient_id
        WHERE pi.status = 'confirmed'
          AND icr.rule_status = 'active'
          AND icr.category_name IS NOT NULL
          AND BTRIM(icr.category_name) <> ''
        GROUP BY pi.product_code, icr.category_name
      ),
      ingredient_category_rollup AS (
        SELECT
          product_code,
          ARRAY_AGG(category_name ORDER BY max_priority DESC, category_name ASC) AS ingredient_categories
        FROM ingredient_category_matches
        GROUP BY product_code
      )
      SELECT
        s.sku_id,
        s.company_code AS sku_code,
        s.display_name AS name,
        s.product_kind,
        COALESCE(s.enrichment_status, 'missing') AS enrichment_status,
        s.category_name,
        COALESCE(icr.ingredient_categories, ARRAY[]::text[]) AS ingredient_categories
      FROM public.skus s
      LEFT JOIN ingredient_category_rollup icr
        ON icr.product_code = s.company_code
      WHERE s.product_type IS NULL
      ORDER BY s.sku_id ASC
      ${limitSql}
    `,
    params,
  );

  return result.rows.map((row) => ({
    sku_id: row.sku_id,
    sku_code: row.sku_code,
    name: row.name,
    product_kind: row.product_kind,
    enrichment_status: normalizeEnrichmentStatus(row.enrichment_status || "missing"),
    category_name: row.category_name,
    ingredient_categories: Array.isArray(row.ingredient_categories)
      ? row.ingredient_categories
      : [],
  }));
}

function classifyCandidate(row) {
  for (const rule of RULE_DEFINITIONS) {
    const decision = rule.match(row);
    if (!decision) {
      continue;
    }

    if (typeof decision === "object" && !Array.isArray(decision)) {
      return {
        skuCode: row.sku_code,
        name: row.name,
        productType: decision.productType,
        enrichmentStatus: decision.enrichmentStatus || rule.enrichmentStatus || null,
        reasonKey: rule.ruleKey,
        reasonLabel: rule.reasonLabel,
      };
    }

    return {
      skuCode: row.sku_code,
      name: row.name,
      productType: rule.productType,
      enrichmentStatus: rule.enrichmentStatus || null,
      reasonKey: rule.ruleKey,
      reasonLabel: rule.reasonLabel,
    };
  }

  return null;
}

function buildBackfillPlan(rows) {
  const proposals = [];
  const countsByProductType = Object.fromEntries(PRODUCT_TYPES.map((type) => [type, 0]));
  const countsByRule = {};

  for (const row of rows) {
    const proposal = classifyCandidate(row);
    if (!proposal) {
      continue;
    }
    proposals.push(proposal);
    countsByProductType[proposal.productType] += 1;
    if (!countsByRule[proposal.reasonKey]) {
      countsByRule[proposal.reasonKey] = {
        productType: proposal.productType,
        reasonLabel: proposal.reasonLabel,
        count: 0,
      };
    }
    countsByRule[proposal.reasonKey].count += 1;
  }

  return {
    evaluated: rows.length,
    classified: proposals.length,
    unclassified: rows.length - proposals.length,
    proposals,
    countsByProductType,
    countsByRule,
  };
}

async function applyBackfillUpdates(db, proposals) {
  if (!proposals || proposals.length === 0) {
    return 0;
  }

  let updated = 0;
  const chunkSize = 500;
  for (let i = 0; i < proposals.length; i += chunkSize) {
    const chunk = proposals.slice(i, i + chunkSize);
    const values = [];
    const params = [];

    chunk.forEach((proposal, index) => {
      const base = index * 3;
      values.push(
        `($${base + 1}::text, $${base + 2}::text, $${base + 3}::text)`,
      );
      params.push(
        proposal.skuCode,
        proposal.productType,
        proposal.enrichmentStatus,
      );
    });

    const result = await db.query(
      `
        UPDATE public.skus AS s
        SET
          product_type = v.product_type,
          enrichment_status = COALESCE(v.enrichment_status, s.enrichment_status),
          updated_at = now()
        FROM (
          VALUES ${values.join(", ")}
        ) AS v(sku_code, product_type, enrichment_status)
        WHERE s.company_code = v.sku_code
          AND s.product_type IS NULL
      `,
      params,
    );
    updated += result.rowCount || 0;
  }

  return updated;
}

function buildBackfillResponse(plan, options = {}) {
  const mode = options.commit ? "COMMIT" : "DRY RUN";
  const lines = [`[${mode}] Product type backfill`, `Rules evaluated: ${plan.evaluated} SKUs`];

  const orderedRuleKeys = RULE_DEFINITIONS.map((rule) => rule.ruleKey);
  for (const ruleKey of orderedRuleKeys) {
    const entry = plan.countsByRule[ruleKey];
    if (!entry || entry.count === 0) {
      continue;
    }
    lines.push(
      `  -> ${entry.productType.padEnd(14)} ${String(entry.count).padStart(5)}  (${entry.reasonLabel})`,
    );
  }

  lines.push(
    `  -> ${"unclassified".padEnd(14)} ${String(plan.unclassified).padStart(5)}  (no rule matched)`,
  );
  if (!options.commit) {
    lines.push("Run with --commit to apply.");
  }

  return {
    mode: options.commit ? "commit" : "dry_run",
    evaluated: plan.evaluated,
    classified: plan.classified,
    unclassified: plan.unclassified,
    countsByProductType: plan.countsByProductType,
    countsByRule: plan.countsByRule,
    lines,
  };
}

async function previewBackfill(db, options = {}) {
  const rows = await loadBackfillCandidates(db, options);
  const plan = buildBackfillPlan(rows);
  return buildBackfillResponse(plan, { commit: false });
}

async function commitBackfill(db, options = {}) {
  const rows = await loadBackfillCandidates(db, options);
  const plan = buildBackfillPlan(rows);
  const updated = await applyBackfillUpdates(db, plan.proposals);
  const response = buildBackfillResponse(plan, { commit: true });
  response.updated = updated;
  return response;
}

module.exports = {
  PRODUCT_TYPES,
  PRODUCT_TYPE_SET,
  ENRICHMENT_STATUSES,
  ENRICHMENT_STATUS_SET,
  normalizeNullableProductType,
  normalizeEnrichmentStatus,
  parsePositiveInt,
  loadBackfillCandidates,
  classifyCandidate,
  buildBackfillPlan,
  applyBackfillUpdates,
  buildBackfillResponse,
  previewBackfill,
  commitBackfill,
};
