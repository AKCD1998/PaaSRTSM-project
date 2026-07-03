"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const {
  createLocalDiskStorageProvider,
  verifyDownloadToken,
} = require("../apps/admin-api/src/services/storage/localDiskStorageProvider");

function buildConfig(dir) {
  return {
    videoStorageLocalDir: dir,
    videoSignedUrlSecret: "test-signed-url-secret",
  };
}

async function withTempDir(fn) {
  const dir = path.join(os.tmpdir(), `video-storage-test-${crypto.randomUUID()}`);
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("uploadAsset writes bytes and getSignedDownloadUrl round-trips through verifyDownloadToken", async () => {
  await withTempDir(async (dir) => {
    const config = buildConfig(dir);
    const provider = createLocalDiskStorageProvider(config);
    const buffer = Buffer.from("hello video studio");

    const uploadResult = await provider.uploadAsset({
      key: "content/generated_video/sample.mp4",
      buffer,
      mimeType: "video/mp4",
    });
    assert.equal(uploadResult.storageKey, "content/generated_video/sample.mp4");

    const onDiskPath = path.join(path.resolve(dir), "content/generated_video/sample.mp4");
    const onDiskContents = await fs.readFile(onDiskPath);
    assert.equal(onDiskContents.toString(), "hello video studio");

    const url = await provider.getSignedDownloadUrl({ key: "content/generated_video/sample.mp4", expiresInSeconds: 300 });
    const parsed = new URL(url, "http://localhost");
    const key = parsed.searchParams.get("key");
    const exp = parsed.searchParams.get("exp");
    const token = parsed.searchParams.get("token");

    assert.equal(verifyDownloadToken(config, { key, exp, token }), true);
  });
});

test("verifyDownloadToken rejects a tampered token", async () => {
  await withTempDir(async (dir) => {
    const config = buildConfig(dir);
    const provider = createLocalDiskStorageProvider(config);
    await provider.uploadAsset({ key: "content/x.mp4", buffer: Buffer.from("x"), mimeType: "video/mp4" });
    const url = await provider.getSignedDownloadUrl({ key: "content/x.mp4", expiresInSeconds: 300 });
    const parsed = new URL(url, "http://localhost");
    const key = parsed.searchParams.get("key");
    const exp = parsed.searchParams.get("exp");
    const tamperedToken = "0".repeat(64);

    assert.equal(verifyDownloadToken(config, { key, exp, token: tamperedToken }), false);
  });
});

test("verifyDownloadToken rejects an expired token", async () => {
  await withTempDir(async (dir) => {
    const config = buildConfig(dir);
    const provider = createLocalDiskStorageProvider(config);
    await provider.uploadAsset({ key: "content/y.mp4", buffer: Buffer.from("y"), mimeType: "video/mp4" });

    const key = "content/y.mp4";
    const expiredExp = Math.floor(Date.now() / 1000) - 60;
    const token = crypto
      .createHmac("sha256", config.videoSignedUrlSecret)
      .update(`${key}:${expiredExp}`)
      .digest("hex");

    assert.equal(verifyDownloadToken(config, { key, exp: expiredExp, token }), false);
  });
});

test("deleteAsset removes a file and copyAsset duplicates it", async () => {
  await withTempDir(async (dir) => {
    const config = buildConfig(dir);
    const provider = createLocalDiskStorageProvider(config);
    await provider.uploadAsset({ key: "content/z.mp4", buffer: Buffer.from("z"), mimeType: "video/mp4" });

    await provider.copyAsset({ fromKey: "content/z.mp4", toKey: "content/z-copy.mp4" });
    const copyContents = await fs.readFile(path.join(path.resolve(dir), "content/z-copy.mp4"));
    assert.equal(copyContents.toString(), "z");

    await provider.deleteAsset({ key: "content/z.mp4" });
    await assert.rejects(fs.access(path.join(path.resolve(dir), "content/z.mp4")));
  });
});

test("getSignedUploadUrl is not supported by the local provider", async () => {
  await withTempDir(async (dir) => {
    const config = buildConfig(dir);
    const provider = createLocalDiskStorageProvider(config);
    await assert.rejects(
      provider.getSignedUploadUrl({ key: "x", mimeType: "image/png", expiresInSeconds: 60 }),
      /not supported/i,
    );
  });
});
