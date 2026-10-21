"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const { verifyCatalog, createPosReleaseCatalog } = require("../apps/admin-api/src/services/posReleaseCatalog");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
function release(version, publishedAt = "2026-10-21T12:00:00Z") {
  return { releaseId: `pos-${version}`, version, publishedAt, highlights: ["สมาชิกและประวัติการซื้อ"], deviceAccessVersion: 1,
    installer: { downloadUrl: `https://github.com/AKCD1998/SCCRMonPOS/releases/download/pos-${version}/SCCRMonPOS-Setup-${version}.exe`, sha256: "a".repeat(64), size: 2048 } };
}
function catalog(releases = [release("1.3.1")], recommendedReleaseId = releases[0].releaseId) {
  return { schemaVersion: 1, generatedAt: "2026-10-21T12:00:00Z", recommendedReleaseId, releases };
}
function envelope(value) {
  const payload = Buffer.from(JSON.stringify(value));
  return JSON.stringify({ payload: payload.toString("base64"), signature: sign("RSA-SHA256", payload, privateKey).toString("base64") });
}
test("signed publication promotes the recommended installer and archives the previous version", () => {
  const value = verifyCatalog(envelope(catalog([release("1.3.2"), release("1.3.1", "2026-10-20T12:00:00Z")])), publicKey);
  assert.equal(value.installer.version, "1.3.2");
  assert.equal(value.installer.isLatest, true);
  assert.deepEqual(value.previousReleases.map(r => r.version), ["1.3.1"]);
});
test("an intentional rollback remains recommended rather than being silently replaced by the highest version", () => {
  const value = verifyCatalog(envelope(catalog([release("1.3.2"), release("1.3.1", "2026-10-20T12:00:00Z")], "pos-1.3.1")), publicKey);
  assert.equal(value.installer.version, "1.3.1");
  assert.equal(value.installer.isLatest, false);
  assert.equal(value.previousReleases[0].version, "1.3.2");
});
test("tampered, unsigned, foreign, unrestricted, draft and incomplete releases cannot replace the catalog", () => {
  const original = envelope(catalog());
  const tampered = JSON.parse(original);
  tampered.payload = Buffer.from(JSON.stringify(catalog([release("9.0.0")]))).toString("base64");
  assert.throws(() => verifyCatalog(JSON.stringify(tampered), publicKey));
  assert.throws(() => verifyCatalog(JSON.stringify(catalog()), publicKey));
  for (const mutate of [
    value => { value.releases[0].installer.downloadUrl = "https://example.com/installer.exe"; },
    value => { value.releases[0].deviceAccessVersion = 0; },
    value => { value.releases[0].draft = true; },
    value => { value.releases[0].prerelease = true; },
    value => { value.releases[0].installer.sha256 = "wrong"; },
    value => { value.releases[0].installer = null; },
    value => { value.recommendedReleaseId = "missing"; },
    value => { value.releases.push(value.releases[0]); },
    value => { value.releases[0].publishedAt = "invalid date"; },
    value => { value.schemaVersion = 99; },
  ]) {
    const value = catalog(); mutate(value);
    assert.throws(() => verifyCatalog(envelope(value), publicKey));
  }
  assert.throws(() => verifyCatalog(" ".repeat(256 * 1024 + 1), publicKey));
});
test("unrestricted releases are historical notes with no download, and cannot be recommended", () => {
  const old = { ...release("1.2.0"), deviceAccessVersion: 0, installer: null };
  const value = catalog([release("1.3.1"), old]);
  assert.equal(verifyCatalog(envelope(value), publicKey).previousReleases[0].downloadUrl, null);
  value.recommendedReleaseId = old.releaseId;
  assert.throws(() => verifyCatalog(envelope(value), publicKey));
});
test("shared requests and TTL limit traffic; a subsequent publication updates without restarting the service", async () => {
  let calls = 0, clock = 100000, body = envelope(catalog());
  const service = createPosReleaseCatalog({ key: publicKey, now: () => clock, fetchText: async () => { calls++; return body; } });
  const responses = await Promise.all(Array.from({ length: 8 }, () => service.get()));
  assert.equal(calls, 1);
  assert.ok(responses.every(r => r.installer.version === "1.3.1"));
  await service.get(); assert.equal(calls, 1);
  body = envelope(catalog([release("1.3.2"), release("1.3.1", "2026-10-20T12:00:00Z")]));
  clock += 60001;
  const updated = await service.get();
  assert.equal(calls, 2);
  assert.equal(updated.installer.version, "1.3.2");
  assert.equal(updated.previousReleases[0].version, "1.3.1");
});
test("network or signature failures keep the last verified release and back off retries", async () => {
  let clock = 100000, body = envelope(catalog()), fail = false, calls = 0;
  const service = createPosReleaseCatalog({ key: publicKey, now: () => clock, fetchText: async () => { calls++; if (fail) throw new Error("Offline"); return body; } });
  const initial = await service.get();
  clock += 60001; fail = true;
  const offline = await service.get();
  assert.equal(offline.releaseSync.state, "stale");
  assert.equal(offline.installer.version, "1.3.1");
  assert.equal(offline.releaseSync.verifiedAt, initial.releaseSync.verifiedAt);
  await service.get(); assert.equal(calls, 2);
  clock += 30001; fail = false; body = "invalid signature";
  assert.equal((await service.get()).installer.version, "1.3.1");
  clock += 30001; body = envelope(catalog([release("1.3.2")]));
  assert.equal((await service.get()).releaseSync.state, "verified");
});
test("cold-start failure and a stalled request return the bundled reviewed installer", async () => {
  const service = createPosReleaseCatalog({ key: publicKey, timeoutMs: 15, fetchText: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("Timed out")), { once: true })) });
  const value = await service.get();
  assert.equal(value.releaseSync.state, "fallback");
  assert.equal(value.installer.version, "1.3.1");
});
