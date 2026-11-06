"use strict";

const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const test = require("node:test");
const express = require("express");
const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const { createBranchStockRouter } = require("./branch-stock");

const endpoint = "/api/codex/v1/branch-stock";
const identity = {
  clientId: "example.apps.googleusercontent.com",
  subject: "123456789012345678901",
  email: "stock-owner@example.com",
};
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const unrelatedKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

function googleToken(claims = {}, key = privateKey) {
  return jwt.sign({
    aud: identity.clientId,
    iss: "https://accounts.google.com",
    sub: identity.subject,
    email: identity.email,
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  }, key, { algorithm: "RS256", keyid: "test-key" });
}

function setup(codexBranchStockIdentity = identity) {
  const codexGoogleAuth = new OAuth2Client();
  codexGoogleAuth.getFederatedSignonCertsAsync = async () => ({
    certs: { "test-key": publicKey.export({ format: "pem", type: "spki" }) },
  });
  const queries = [];
  const app = express();
  app.use("/api", createBranchStockRouter({
    config: { codexBranchStockIdentity },
    codexGoogleAuth,
    db: {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes("COUNT(*)")) return { rows: [{ total: 1 }] };
        return { rows: [{ product_code: "A123", qty_branch_005: 7 }] };
      },
    },
    requireAuthMiddleware: (_req, res) => res.sendStatus(401),
    requireRoleMiddleware: () => (_req, res) => res.sendStatus(403),
    requireCsrfMiddleware: (_req, res) => res.sendStatus(403),
  }));
  return { app, queries };
}

test("reads the branch-stock page only for the configured Google identity", async () => {
  const { app, queries } = setup();
  const token = googleToken();
  const res = await request(app).get(endpoint)
    .query({ search: "A123", limit: 10, offset: 0 })
    .set("Authorization", `Bearer ${token}`)
    .expect(200)
    .expect("Cache-Control", "no-store");

  assert.equal(res.body.records[0].productCode, "A123");
  assert.equal(res.body.records[0].qtyBranch005, 7);
  assert.deepEqual(res.body.pagination, { limit: 10, offset: 0, total: 1 });
  assert.deepEqual(queries.map(({ params }) => params), [["a123"], ["a123", 10, 0]]);
  await request(app).get("/api/branch-stock").set("Authorization", `Bearer ${token}`).expect(401);
  await request(app).get(`${endpoint}/history`).set("Authorization", `Bearer ${token}`).expect(404);
  await request(app).post(endpoint).set("Authorization", `Bearer ${token}`).expect(404);
  assert.equal(queries.length, 2);
});

test("rejects missing, forged, expired, wrong-audience and wrong-issuer tokens", async () => {
  const { app, queries } = setup();
  await request(app).get(endpoint).query({ token: googleToken() })
    .expect(401).expect("Cache-Control", "no-store");
  for (const token of [
    "garbage",
    googleToken({}, unrelatedKey),
    googleToken({ exp: Math.floor(Date.now() / 1000) - 1 }),
    googleToken({ aud: "different.apps.googleusercontent.com" }),
    googleToken({ iss: "https://example.com" }),
  ]) {
    await request(app).get(endpoint).set("Authorization", `Bearer ${token}`).expect(401);
  }
  assert.equal(queries.length, 0);
});

test("rejects different Google subjects and unverified or different emails", async () => {
  const { app, queries } = setup();
  for (const claims of [
    { sub: "another-user" },
    { email: "someone-else@example.com" },
    { email_verified: false },
  ]) {
    await request(app).get(endpoint).set("Authorization", `Bearer ${googleToken(claims)}`).expect(403);
  }
  assert.equal(queries.length, 0);
});

test("fails closed with incomplete configuration and bounds authorized queries", async () => {
  const disabled = setup({ ...identity, subject: "" });
  const enabled = setup();
  const token = googleToken();
  await request(disabled.app).get(endpoint).set("Authorization", `Bearer ${token}`).expect(404);
  for (const query of [
    "limit=201",
    "limit=0",
    "offset=1000000",
    "search=a&search=b",
    "search=%00",
  ]) {
    await request(enabled.app).get(`${endpoint}?${query}`).set("Authorization", `Bearer ${token}`).expect(400);
  }
  assert.equal(disabled.queries.length, 0);
  assert.equal(enabled.queries.length, 0);
});
