"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

const {
  checksumRecords,
  createInternalProductCatalogRouter,
} = require("./internal-product-catalog");

function createTestApp({ token = "catalog-test-token", rows = [] } = {}) {
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows };
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/internal/product-catalog", createInternalProductCatalogRouter({
    config: { erpProductCatalogInternalToken: token },
    db,
  }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  return { app, queries };
}

test("fails closed when the integration token is missing or incorrect", async () => {
  const disabled = createTestApp({ token: "" });
  const disabledResponse = await request(disabled.app)
    .post("/internal/product-catalog/resolve")
    .send({ companySkus: ["IC-000001"] });
  assert.equal(disabledResponse.status, 503);
  assert.equal(disabled.queries.length, 0);

  const enabled = createTestApp();
  const unauthorized = await request(enabled.app)
    .post("/internal/product-catalog/resolve")
    .set("x-internal-token", "wrong-token")
    .send({ companySkus: ["IC-000001"] });
  assert.equal(unauthorized.status, 401);
  assert.equal(enabled.queries.length, 0);
});

test("resolves only requested Company SKUs and returns a deterministic contract", async () => {
  const rows = [{
    barcodes: ["8850000000002", "8850000000001"],
    company_code: "IC-000001",
    display_name: "Example product",
    product_kind: "medicine",
    updated_at: new Date("2026-08-28T01:02:03.000Z"),
  }];
  const { app, queries } = createTestApp({ rows });
  const response = await request(app)
    .post("/internal/product-catalog/resolve")
    .set("x-internal-token", "catalog-test-token")
    .send({ companySkus: ["IC-000002", "IC-000001", "IC-000001"] });

  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(queries[0].params, [["IC-000001", "IC-000002"]]);
  assert.deepEqual(response.body.records, [{
    barcodes: ["8850000000001", "8850000000002"],
    companySku: "IC-000001",
    displayName: "Example product",
    productKind: "medicine",
    updatedAt: "2026-08-28T01:02:03.000Z",
  }]);
  assert.deepEqual(response.body.missingCompanySkus, ["IC-000002"]);
  assert.equal(response.body.sourceChecksum, checksumRecords(response.body.records));
});

test("rejects empty, oversized, or malformed SKU requests before querying", async () => {
  const { app, queries } = createTestApp();
  for (const companySkus of [[], Array.from({ length: 501 }, (_, index) => `SKU-${index}`), ["bad\nvalue"]]) {
    // eslint-disable-next-line no-await-in-loop
    const response = await request(app)
      .post("/internal/product-catalog/resolve")
      .set("x-internal-token", "catalog-test-token")
      .send({ companySkus });
    assert.equal(response.status, 400);
  }
  assert.equal(queries.length, 0);
});
