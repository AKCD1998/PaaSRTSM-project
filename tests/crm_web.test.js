"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { loadConfig } = require("../apps/admin-api/src/config");
const { createApp } = require("../apps/admin-api/src/server");

function createTestApp() {
  const config = loadConfig({ NODE_ENV: "test", AUTH_JWT_SECRET: "crm-web-test-only" });
  const db = {
    async query() { throw new Error("Public CRM entry must not query the database"); },
  };
  return createApp({
    config, db,
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
  }).app;
}

test("public CRM entry serves both URL forms without database access or login", async () => {
  const app = createTestApp();
  for (const url of ["/sccrm", "/sccrm/"]) {
    const response = await request(app).get(url).expect(200).expect("Content-Type", /text\/html/);
    assert.match(response.text, /name="viewport"/);
    assert.match(response.text, /href="https:\/\/sc-official-website\.onrender\.com\/join"/);
    assert.match(response.text, /href="https:\/\/sccrmv2\.onrender\.com"/);
    assert.equal((response.text.match(/<a /g) || []).length, 2);
    assert.doesNotMatch(response.text, /<script|<form|google|line\.me|type="password"/i);
    assert.match(response.headers["content-security-policy"], /default-src 'none'/);
    assert.match(response.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["cache-control"], "no-cache");
    assert.equal(response.headers["set-cookie"], undefined);
  }
});

test("only named CRM assets are public and the entry has no write endpoint", async () => {
  const app = createTestApp();
  await request(app).get("/sccrm/styles.css").expect(200).expect("Content-Type", /text\/css/);
  await request(app).get("/sccrm/icon.svg").expect(200).expect("Content-Type", /image\/svg\+xml/);
  for (const url of ["/sccrm/.env", "/sccrm/server.js", "/sccrm/package.json", "/sccrm/not-found"]) {
    await request(app).get(url).expect(404);
  }
  await request(app).post("/sccrm").send({ phone: "synthetic" }).expect(404);
});

test("public entry leaves existing health and protected admin routes unchanged", async () => {
  const app = createTestApp();
  const health = await request(app).get("/admin/health").expect(200);
  assert.equal(health.body.ok, true);
  await request(app).get("/admin/me").expect(401);
});
