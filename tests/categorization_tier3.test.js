"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runCategorizationBatch } = require("../apps/admin-api/src/categorization");
const { runTier3 } = require("../apps/admin-api/src/categorization/tier3");

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function createTier3QueryMockDb() {
  const state = {
    queries: [],
  };

  const db = {
    state,
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);
      state.queries.push({ normalized, params });

      assert.match(normalized, /with eligible_products as/);
      assert.match(normalized, /pcs\.review_status = 'needs_review'/);
      assert.match(
        normalized,
        /string_agg\(distinct rm\.canonical_name, ', ' order by rm\.canonical_name\) as matched_ingredients/,
      );
      assert.match(
        normalized,
        /row_number\(\) over \( partition by cc\.product_code order by cc\.max_priority desc, cc\.category_name asc \) as candidate_rank/,
      );
      assert.deepEqual(params, [["IC-001", "IC-002"]]);

      return {
        rows: [
          {
            product_code: "IC-001",
            clean_category: "วิตามิน",
            reason: "ingredient_rule_match",
            matched_ingredients: "psyllium",
          },
          {
            product_code: "IC-002",
            clean_category: "แอลกอฮอล์",
            reason: "ingredient_rule_conflict_resolved",
            matched_ingredients: "ethanol",
          },
        ],
      };
    },
  };

  return db;
}

function createCategorizationBatchMockDb() {
  const state = {
    tier3QueryCount: 0,
    writeHistory: [],
    categoryStates: new Map([
      [
        "IC-003",
        {
          product_code: "IC-003",
          category_name: null,
          review_status: "needs_review",
          source_kind: null,
          source_reference: null,
          source_match_level: null,
          previous_category_name: null,
          previous_review_status: null,
          rationale: null,
          imported_by: null,
        },
      ],
    ]),
  };

  function selectCategoryStates(productCodes) {
    return productCodes
      .map((productCode) => state.categoryStates.get(productCode))
      .filter(Boolean)
      .map((row) => ({
        product_code: row.product_code,
        category_name: row.category_name,
        review_status: row.review_status,
      }));
  }

  function applyCategoryStateUpsert(mode, params) {
    const sourceConfig = {
      tier0: {
        reviewStatus: "imported_exact_match",
        sourceKind: "taxonomy_workbook",
        sourceReference: "taxonomy_batch/tier0",
        sourceMatchLevel: "exact_code",
      },
      tier1: {
        sourceKind: "rules_batch",
        sourceReference: "taxonomy_batch/tier1",
      },
      tier3: {
        sourceKind: "ingredient_rules",
        sourceReference: "taxonomy_batch/tier3",
      },
    };

    const source = sourceConfig[mode];
    const productCodes = params[0] || [];
    const categoryNames = params[1] || [];

    for (let index = 0; index < productCodes.length; index += 1) {
      const productCode = productCodes[index];
      const existing = state.categoryStates.get(productCode) || { product_code: productCode };

      if (mode === "tier0") {
        state.categoryStates.set(productCode, {
          ...existing,
          product_code: productCode,
          category_name: categoryNames[index] || null,
          review_status: source.reviewStatus,
          rationale: params[2][index] || null,
          source_kind: source.sourceKind,
          source_reference: source.sourceReference,
          source_match_level: source.sourceMatchLevel,
          previous_category_name: params[3][index] || null,
          previous_review_status: params[4][index] || null,
          imported_by: params[5][index] || null,
        });
        continue;
      }

      state.categoryStates.set(productCode, {
        ...existing,
        product_code: productCode,
        category_name: categoryNames[index] || null,
        review_status: params[2][index] || null,
        rationale: params[3][index] || null,
        source_kind: source.sourceKind,
        source_reference: source.sourceReference,
        source_match_level: params[4][index] || null,
        previous_category_name: params[5][index] || null,
        previous_review_status: params[6][index] || null,
        imported_by: params[7][index] || null,
      });
    }

    state.writeHistory.push({
      mode,
      productCodes: [...productCodes],
      sourceReference: source.sourceReference,
    });
  }

  const db = {
    state,
    async connect() {
      return {
        query: db.query.bind(db),
        async release() {},
      };
    },
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);

      if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes("from ada.branch_stock_snapshots bs")) {
        return {
          rowCount: 1,
          rows: [
            {
              product_code: "IC-003",
              raw_category_name: "Mystery Category",
              existing_status: "needs_review",
            },
          ],
        };
      }

      if (normalized.includes("from public.taxonomy_map")) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes("from public.typo_aliases")) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes("from public.category_shelf_rules")) {
        return { rowCount: 0, rows: [] };
      }

      if (
        normalized.startsWith("select product_code, category_name, review_status") &&
        normalized.includes("from ada.product_category_states")
      ) {
        return {
          rowCount: (params[0] || []).length,
          rows: selectCategoryStates(params[0] || []),
        };
      }

      if (normalized.includes("with query_set as")) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes("with eligible_products as")) {
        state.tier3QueryCount += 1;
        assert.deepEqual(params[0], ["IC-003"]);

        const current = state.categoryStates.get("IC-003");
        assert.equal(current.category_name, "Mystery Category");
        assert.equal(current.review_status, "needs_review");
        assert.equal(current.source_reference, "taxonomy_batch/tier1");

        return {
          rowCount: 1,
          rows: [
            {
              product_code: "IC-003",
              clean_category: "วิตามิน",
              reason: "ingredient_rule_match",
              matched_ingredients: "psyllium",
            },
          ],
        };
      }

      if (normalized.startsWith("insert into ada.product_category_states")) {
        if (normalized.includes("'taxonomy_batch/tier0'")) {
          applyCategoryStateUpsert("tier0", params);
        } else if (normalized.includes("'taxonomy_batch/tier1'")) {
          applyCategoryStateUpsert("tier1", params);
        } else if (normalized.includes("'taxonomy_batch/tier3'")) {
          applyCategoryStateUpsert("tier3", params);
        } else {
          throw new Error(`Unhandled category-state upsert: ${normalized}`);
        }

        return { rowCount: (params[0] || []).length, rows: [] };
      }

      throw new Error(`Unhandled mock query: ${normalized}`);
    },
  };

  return db;
}

test("runTier3 uses one bulk query and maps ranked ingredient-rule winners", async () => {
  const db = createTier3QueryMockDb();

  const results = await runTier3(db, ["IC-001", "IC-002"], { dryRun: true });

  assert.equal(db.state.queries.length, 1);
  assert.deepEqual(results, [
    {
      product_code: "IC-001",
      clean_category: "วิตามิน",
      shelf_no: null,
      source: "ingredient_rules",
      review_status: "proposed",
      reason: "ingredient_rule_match",
      matched_ingredients: "psyllium",
    },
    {
      product_code: "IC-002",
      clean_category: "แอลกอฮอล์",
      shelf_no: null,
      source: "ingredient_rules",
      review_status: "proposed",
      reason: "ingredient_rule_conflict_resolved",
      matched_ingredients: "ethanol",
    },
  ]);
});

test("runCategorizationBatch applies Tier 3 after Tier 1 writes remaining needs_review rows", async () => {
  const db = createCategorizationBatchMockDb();

  const metrics = await runCategorizationBatch(db, {
    productCodes: ["IC-003"],
    triggeredBy: "unit-test",
  });

  const finalState = db.state.categoryStates.get("IC-003");

  assert.equal(db.state.tier3QueryCount, 1);
  assert.deepEqual(
    db.state.writeHistory.map((entry) => entry.sourceReference),
    ["taxonomy_batch/tier1", "taxonomy_batch/tier3"],
  );
  assert.equal(finalState.category_name, "วิตามิน");
  assert.equal(finalState.review_status, "proposed");
  assert.equal(finalState.source_kind, "ingredient_rules");
  assert.equal(finalState.source_reference, "taxonomy_batch/tier3");
  assert.equal(finalState.source_match_level, "ingredient_rule_match");
  assert.equal(finalState.previous_category_name, "Mystery Category");
  assert.equal(finalState.previous_review_status, "needs_review");
  assert.equal(finalState.rationale, "Tier 3 ingredient rule: psyllium. By: unit-test");

  assert.equal(metrics.totalProcessed, 1);
  assert.equal(metrics.tier0Exact, 0);
  assert.equal(metrics.tier1Rules, 0);
  assert.equal(metrics.tier2Similarity, 0);
  assert.equal(metrics.tier3Ingredients, 1);
  assert.equal(metrics.needsReview, 0);
  assert.deepEqual(metrics.examples.tier3Ingredients, [
    {
      product_code: "IC-003",
      category_name: "วิตามิน",
      reason: "ingredient_rule_match",
      matched_ingredients: "psyllium",
    },
  ]);
});

test("runCategorizationBatch skipTier3 leaves Tier 1 needs_review rows untouched", async () => {
  const db = createCategorizationBatchMockDb();

  const metrics = await runCategorizationBatch(db, {
    productCodes: ["IC-003"],
    skipTier3: true,
    triggeredBy: "unit-test",
  });

  const finalState = db.state.categoryStates.get("IC-003");

  assert.equal(db.state.tier3QueryCount, 0);
  assert.equal(finalState.category_name, "Mystery Category");
  assert.equal(finalState.review_status, "needs_review");
  assert.equal(finalState.source_reference, "taxonomy_batch/tier1");
  assert.equal(metrics.tier3Ingredients, 0);
  assert.equal(metrics.needsReview, 1);
});
