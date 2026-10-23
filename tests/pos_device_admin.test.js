"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const cookies = require("cookie-parser");
const request = require("supertest");
const { signSessionToken } = require("../apps/admin-api/src/auth/session");
const { createPosDeviceAdminRouter } = require("../apps/admin-api/src/routes/pos-device-admin");
const config = { cookieName: "test-pos-session", authJwtSecret: "synthetic-pos-admin-test-secret", sessionTtlHours: 1 };
const policy = require("../apps/admin-api/src/data/pos-device-policy.json");
function app(catalog = { get: async () => ({ installer: policy.installer, previousReleases: policy.previousReleases }) }) {
  const result = express();
  result.use(cookies());
  result.use("/api/admin/pos-devices", createPosDeviceAdminRouter({ config, catalog }));
  return result;
}
function session(role) {
  return `${config.cookieName}=${signSessionToken({ sub: "synthetic-user", role, csrf: "fixture" }, config)}`;
}
test("anonymous requests cannot enumerate POS devices", async () => {
  const response = await request(app()).get("/api/admin/pos-devices");
  assert.equal(response.status, 401);
  assert.equal(response.body.devices, undefined);
});

test("release refresh runs only after admin authorization and can change the recommended version without a deploy", async () => {
  let calls = 0;
  const catalog = { get: async () => { calls++; return { installer: { version: "9.0.0" }, previousReleases: [], releaseSync: { state: "verified" } }; } };
  await request(app(catalog)).get("/api/admin/pos-devices");
  await request(app(catalog)).get("/api/admin/pos-devices").set("Cookie", session("staff"));
  assert.equal(calls, 0);
  const response = await request(app(catalog)).get("/api/admin/pos-devices").set("Cookie", session("admin"));
  assert.equal(response.body.installer.version, "9.0.0");
  assert.equal(response.body.releaseSync.state, "verified");
  assert.equal(calls, 1);
});
test("staff accounts cannot enumerate POS devices even with a session", async () => {
  const response = await request(app()).get("/api/admin/pos-devices").set("Cookie", session("staff"));
  assert.equal(response.status, 403);
  assert.equal(response.body.devices, undefined);
});
test("admins receive the reviewed inventory and verified restricted installer", async () => {
  const response = await request(app()).get("/api/admin/pos-devices").set("Cookie", session("admin"));
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(response.body.devices.filter(d => d.status === "approved").length, 7);
  const pos2 = response.body.devices.find(d => d.nodeId === "nEdQXowQ4t11CNTRL");
  assert.equal(pos2.hostname, "POS2");
  assert.equal(pos2.ipv4, "100.93.254.58");
  assert.equal(pos2.status, "approved");
  assert.equal(pos2.adaVersion, "4.6006.0032");
  const branch004Pos2 = response.body.devices.find(d => d.nodeId === "noJJCWPrL221CNTRL");
  assert.equal(branch004Pos2.hostname, "POS002");
  assert.equal(branch004Pos2.ipv4, "100.73.76.18");
  assert.equal(branch004Pos2.status, "approved");
  assert.equal(branch004Pos2.adaVersion, "4.6006.0032");
  assert.match(branch004Pos2.reason, /1\.3\.8/);
  assert.equal(response.body.devices.find(d => d.hostname === "ScProductDev").status, "denied");
  assert.equal(response.body.installer.legacyRestricted, false);
  assert.equal(response.body.installer.version, "1.3.1");
  assert.equal(response.body.installer.downloadUrl, "https://github.com/AKCD1998/SCCRMonPOS/releases/download/pos-1.3.1/SCCRMonPOS-Setup-1.3.1.exe");
  assert.equal(response.body.installer.sha256, "515663cc8b058959d28644f880201dd3316c52b797dd3692352b9b238e7331da");
  assert.equal(response.body.installer.publishedAt, "2026-10-21T11:49:10Z");
  assert.ok(response.body.installer.highlights.length > 0);
  assert.deepEqual(response.body.previousReleases.map(release => release.version), ["1.3.0", "1.2.0", "1.1.0"]);
  assert.ok(response.body.previousReleases.every(release => release.publishedAt && release.highlights.length > 0));
  assert.ok(response.body.previousReleases.find(release => release.version === "1.3.0").downloadUrl.endsWith("SCCRMonPOS-Setup-1.3.0.exe"));
  assert.ok(response.body.previousReleases.filter(release => ["1.2.0", "1.1.0"].includes(release.version)).every(release => release.downloadUrl === null));
  assert.ok(response.body.devices.every(d => !d.adaPaths));
});
