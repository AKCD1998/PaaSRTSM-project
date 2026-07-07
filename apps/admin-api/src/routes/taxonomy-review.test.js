"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const {
  createTaxonomyReviewRouter,
  parseReviewListQuery,
  parseReviewPatchBody,
} = require("./taxonomy-review");

function allow(_req, _res, next) {
  next();
}

test("parseReviewListQuery applies defaults", () => {
  assert.deepEqual(parseReviewListQuery({}), {
    productType: null,
    reviewStatus: "auto",
    page: 1,
    limit: 50,
    offset: 0,
  });
});

test("parseReviewPatchBody validates payload", () => {
  assert.deepEqual(parseReviewPatchBody({
    taxonomy_review_status: "confirmed",
    product_type: "drug",
  }), {
    taxonomyReviewStatus: "confirmed",
    productType: "drug",
  });

  assert.throws(
    () => parseReviewPatchBody({ taxonomy_review_status: "bad-status" }),
    /review_status must be auto, confirmed, or needs_review/,
  );
});

test("GET /taxonomy-review returns paginated items and counts", async () => {
  const db = {
    async query(sql, params = []) {
      if (sql.includes("GROUP BY COALESCE(taxonomy_review_status, 'unreviewed')")) {
        return {
          rows: [
            { review_status: "auto", count: 12 },
            { review_status: "confirmed", count: 3 },
            { review_status: "needs_review", count: 1 },
          ],
        };
      }
      if (sql.includes("SELECT COUNT(*)::integer AS total")) {
        assert.deepEqual(params, ["active", "auto", "drug"]);
        return { rows: [{ total: 12 }] };
      }
      if (sql.includes("SELECT") && sql.includes("s.taxonomy_note")) {
        assert.deepEqual(params, ["active", "auto", "drug", 20, 20]);
        return {
          rows: [
            {
              company_code: "IC-001",
              display_name: "ตัวอย่าง",
              product_type: "drug",
              taxonomy_note: "เหตุผล",
              taxonomy_review_status: "auto",
            },
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const app = express();
  app.use(
    createTaxonomyReviewRouter({
      db,
      requireAuthMiddleware: allow,
      requireRoleMiddleware: () => allow,
      requireCsrfMiddleware: allow,
    }),
  );

  const response = await request(app).get("/taxonomy-review?product_type=drug&page=2&limit=20");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    total: 12,
    page: 2,
    limit: 20,
    counts: {
      auto: 12,
      confirmed: 3,
      needs_review: 1,
    },
    items: [
      {
        company_code: "IC-001",
        display_name: "ตัวอย่าง",
        product_type: "drug",
        taxonomy_note: "เหตุผล",
        taxonomy_review_status: "auto",
      },
    ],
  });
});

test("PATCH /taxonomy-review/:company_code updates status and type", async () => {
  let seenUpdateParams = null;
  const db = {
    async query(sql, params = []) {
      if (sql.includes("SELECT company_code")) {
        assert.deepEqual(params, ["IC-001"]);
        return { rowCount: 1, rows: [{ company_code: "IC-001" }] };
      }
      if (sql.includes("UPDATE public.skus")) {
        seenUpdateParams = params;
        return {
          rows: [
            {
              company_code: "IC-001",
              display_name: "ตัวอย่าง",
              product_type: "herb",
              taxonomy_note: "เหตุผล",
              taxonomy_review_status: "confirmed",
            },
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    createTaxonomyReviewRouter({
      db,
      requireAuthMiddleware: allow,
      requireRoleMiddleware: () => allow,
      requireCsrfMiddleware: allow,
    }),
  );

  const response = await request(app)
    .patch("/taxonomy-review/IC-001")
    .send({
      taxonomy_review_status: "confirmed",
      product_type: "herb",
    });

  assert.equal(response.status, 200);
  assert.deepEqual(seenUpdateParams, ["IC-001", "confirmed", "herb"]);
  assert.deepEqual(response.body, {
    company_code: "IC-001",
    display_name: "ตัวอย่าง",
    product_type: "herb",
    taxonomy_note: "เหตุผล",
    taxonomy_review_status: "confirmed",
  });
});
