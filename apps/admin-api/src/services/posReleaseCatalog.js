"use strict";

const { createPublicKey, verify } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const policy = require("../data/pos-device-policy.json");
const CATALOG_URL = "https://raw.githubusercontent.com/AKCD1998/SCCRMonPOS/master/releases/web-catalog.json";
const REPOSITORY_URL = "https://github.com/AKCD1998/SCCRMonPOS/releases/download/";
const MAX_BYTES = 256 * 1024;

function publicKeyFromXml(xml) {
  const part = name => {
    const match = xml.match(new RegExp(`<${name}>([A-Za-z0-9+/=\\s]+)</${name}>`));
    if (!match) throw new Error("Invalid POS public key");
    return Buffer.from(match[1], "base64").toString("base64url");
  };
  return createPublicKey({ key: { kty: "RSA", n: part("Modulus"), e: part("Exponent") }, format: "jwk" });
}
const publicKey = publicKeyFromXml(readFileSync(join(__dirname, "../data/pos-update-public-key.xml"), "utf8"));

function verifyCatalog(json, key = publicKey) {
  if (typeof json !== "string" || Buffer.byteLength(json) > MAX_BYTES) throw new Error("Catalog too large");
  const envelope = JSON.parse(json);
  if (typeof envelope.payload !== "string" || typeof envelope.signature !== "string") throw new Error("Missing signature");
  const bytes = Buffer.from(envelope.payload, "base64");
  if (!verify("RSA-SHA256", bytes, key, Buffer.from(envelope.signature, "base64"))) throw new Error("Invalid signature");
  const catalog = JSON.parse(bytes.toString("utf8"));
  if (catalog.schemaVersion !== 1 || !Number.isFinite(Date.parse(catalog.generatedAt)) ||
      !Array.isArray(catalog.releases) || !catalog.releases.length || catalog.releases.length > 100) throw new Error("Invalid catalog");
  const ids = new Set();
  const releases = catalog.releases.map(release => {
    if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(release.version) || release.releaseId !== `pos-${release.version}` ||
        ids.has(release.releaseId) || !Number.isFinite(Date.parse(release.publishedAt)) || release.draft || release.prerelease ||
        !Array.isArray(release.highlights) || !release.highlights.length || release.highlights.length > 4 ||
        release.highlights.some(line => typeof line !== "string" || !line.trim() || line.length > 240) ||
        ![0, 1].includes(release.deviceAccessVersion)) throw new Error("Invalid release");
    ids.add(release.releaseId);
    let installer = null;
    if (release.deviceAccessVersion === 1) {
      const setup = release.installer;
      const expected = `${REPOSITORY_URL}${release.releaseId}/SCCRMonPOS-Setup-${release.version}.exe`;
      if (!setup || setup.downloadUrl !== expected || !/^[a-f0-9]{64}$/.test(setup.sha256) ||
          !Number.isSafeInteger(setup.size) || setup.size < 1024 || setup.size > 50 * 1024 * 1024) throw new Error("Invalid installer");
      installer = { downloadUrl: expected, sha256: setup.sha256, size: setup.size };
    } else if (release.installer) throw new Error("Unrestricted installer cannot be offered");
    return { releaseId: release.releaseId, version: release.version, publishedAt: release.publishedAt,
      highlights: release.highlights, installer, downloadNote: installer ? null : "รุ่นนี้ยังไม่มีระบบตรวจสิทธิ์เครื่องบริษัท จึงไม่เปิดดาวน์โหลดจากหน้านี้" };
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const selected = releases.find(release => release.releaseId === catalog.recommendedReleaseId);
  if (!selected?.installer) throw new Error("Recommended release is unavailable");
  return {
    generatedAt: catalog.generatedAt,
    installer: { ...selected.installer, version: selected.version, status: "published", publishedAt: selected.publishedAt,
      highlights: selected.highlights, isLatest: releases[0].releaseId === selected.releaseId },
    previousReleases: releases.filter(release => release !== selected).map(({ installer, releaseId, ...release }) => ({ ...release, ...(installer || { downloadUrl: null }) })),
  };
}

async function fetchCatalogText(url, { signal }) {
  const response = await fetch(url, { signal, redirect: "error", headers: { Accept: "application/json", "Cache-Control": "no-cache" } });
  if (!response.ok || Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Catalog unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Catalog too large");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString("utf8");
}

function createPosReleaseCatalog({ fetchText = fetchCatalogText, key = publicKey, now = Date.now, ttlMs = 60000, retryMs = 30000, timeoutMs = 4000, fallback = policy } = {}) {
  let lastGood = null;
  let nextFetchAt = 0;
  let checkedAt = null;
  let verifiedAt = null;
  let failed = false;
  let inFlight = null;
  function snapshot() {
    return { ...(lastGood || { installer: fallback.installer, previousReleases: fallback.previousReleases || [] }),
      releaseSync: { state: lastGood ? (failed ? "stale" : "verified") : "fallback", checkedAt, verifiedAt } };
  }
  async function refresh() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    checkedAt = new Date(now()).toISOString();
    try {
      // One fixed public origin. The minute bucket avoids an old CDN copy after
      // an announcement; the process cache and shared promise bound traffic.
      const json = await fetchText(`${CATALOG_URL}?v=${Math.floor(now() / 60000)}`, { signal: controller.signal });
      lastGood = verifyCatalog(json, key);
      verifiedAt = checkedAt;
      failed = false;
      nextFetchAt = now() + ttlMs;
    } catch {
      failed = true;
      nextFetchAt = now() + retryMs;
    } finally { clearTimeout(timer); }
    return snapshot();
  }
  return { async get() {
    if (inFlight) return inFlight;
    if (now() < nextFetchAt) return snapshot();
    inFlight = refresh().finally(() => { inFlight = null; });
    return inFlight;
  } };
}

module.exports = { createPosReleaseCatalog, verifyCatalog, publicKeyFromXml };
