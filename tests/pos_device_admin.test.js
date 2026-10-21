"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const cookies = require("cookie-parser");
const request = require("supertest");
const { signSessionToken } = require("../apps/admin-api/src/auth/session");
const { createPosDeviceAdminRouter } = require("../apps/admin-api/src/routes/pos-device-admin");
const config = { cookieName: "test-pos-session", authJwtSecret: "synthetic-pos-admin-test-secret", sessionTtlHours: 1 };
function app() {
  const result = express();
  result.use(cookies());
  result.use("/api/admin/pos-devices", createPosDeviceAdminRouter({ config }));
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
test("staff accounts cannot enumerate POS devices even with a session", async () => {
  const response = await request(app()).get("/api/admin/pos-devices").set("Cookie", session("staff"));
  assert.equal(response.status, 403);
  assert.equal(response.body.devices, undefined);
});
test("admins receive the reviewed inventory and verified restricted installer", async () => {
  const response = await request(app()).get("/api/admin/pos-devices").set("Cookie", session("admin"));
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(response.body.devices.filter(d => d.status === "approved").length, 5);
  assert.equal(response.body.installer.legacyRestricted, false);
  assert.equal(response.body.installer.version, "1.3.1");
  assert.equal(response.body.installer.downloadUrl, "https://github.com/AKCD1998/SCCRMonPOS/releases/download/pos-1.3.1/SCCRMonPOS-Setup-1.3.1.exe");
  assert.equal(response.body.installer.sha256, "515663cc8b058959d28644f880201dd3316c52b797dd3692352b9b238e7331da");
  assert.ok(response.body.devices.every(d => !d.adaPaths));
});
