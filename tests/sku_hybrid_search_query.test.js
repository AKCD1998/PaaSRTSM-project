"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildHybridSearchQuery,
  buildFiltersOnlySearchQuery,
  parseSearchFilters,
} = require("../apps/admin-api/src/services/sku-hybrid-search");

test("buildFiltersOnlySearchQuery applies metadata and sku filters", () => {
  const filters = parseSearchFilters({
    product_kind: "medicine",
    level: "base",
    supplier_code: "TT",
  });
  const statement = buildFiltersOnlySearchQuery({
    filters,
    topK: 15,
  });
  const normalizedSql = statement.sql.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalizedSql, /s\.product_kind = \$1/);
  assert.match(normalizedSql, /s\.supplier_code ilike \$2/);
  assert.match(normalizedSql, /coalesce\(e\.metadata->>'level', ''\) = \$3/);
  assert.equal(statement.params[0], "medicine");
  assert.equal(statement.params[1], "%TT%");
  assert.equal(statement.params[2], "base");
  assert.equal(statement.params[3], 15);
});

test("buildHybridSearchQuery includes vector similarity and keyword boost", () => {
  const statement = buildHybridSearchQuery({
    queryEmbedding: [0.11, -0.22, 0.33],
    queryText: "amoxicillin",
    filters: parseSearchFilters({ product_kind: "medicine" }),
    topK: 5,
  });
  const normalizedSql = statement.sql.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalizedSql, /e\.embedding <=> \$1::vector/);
  assert.match(normalizedSql, /display_name ilike \$2/);
  assert.match(normalizedSql, /order by \(\(1 - \(e\.embedding <=> \$1::vector\)\)::double precision \+/);
  assert.equal(statement.params[0], "[0.11,-0.22,0.33]");
  assert.equal(statement.params[1], "%amoxicillin%");
  assert.equal(statement.params[2], "medicine");
  assert.equal(statement.params[3], 5);
});
