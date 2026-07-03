"use strict";

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

function createHttpError(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

function resolveBaseDir(config) {
  return path.resolve(config.videoStorageLocalDir || "./data/video-studio");
}

function resolveKeyPath(baseDir, key) {
  // Keys are server-generated (content/<assetType>/<publicId><ext>) so this is
  // defense in depth against a malformed key ever escaping the base dir.
  const resolved = path.resolve(baseDir, key);
  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
    throw createHttpError("Invalid storage key", 400);
  }
  return resolved;
}

function createLocalDiskStorageProvider(config) {
  const baseDir = resolveBaseDir(config);

  async function ensureBaseDir() {
    await fs.mkdir(baseDir, { recursive: true });
  }

  return {
    async uploadAsset({ key, buffer, mimeType: _mimeType }) {
      await ensureBaseDir();
      const filePath = resolveKeyPath(baseDir, key);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, buffer);
      return { storageKey: key };
    },

    async getSignedDownloadUrl({ key, expiresInSeconds }) {
      const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + Number(expiresInSeconds || 300);
      const hmac = crypto
        .createHmac("sha256", config.videoSignedUrlSecret)
        .update(`${key}:${expiresAtEpochSeconds}`)
        .digest("hex");
      const query = new URLSearchParams({
        key,
        exp: String(expiresAtEpochSeconds),
        token: hmac,
      });
      return `/api/content/assets/binary?${query.toString()}`;
    },

    async getSignedUploadUrl(_args) {
      throw createHttpError(
        "Direct upload URLs are not supported by the local storage provider; use /assets/upload-complete",
        400,
      );
    },

    async downloadAsset({ key }) {
      const filePath = resolveKeyPath(baseDir, key);
      try {
        const buffer = await fs.readFile(filePath);
        return { buffer };
      } catch (error) {
        if (error && error.code === "ENOENT") {
          throw createHttpError("Asset not found in storage", 404);
        }
        throw error;
      }
    },

    async deleteAsset({ key }) {
      const filePath = resolveKeyPath(baseDir, key);
      await fs.rm(filePath, { force: true });
    },

    async copyAsset({ fromKey, toKey }) {
      await ensureBaseDir();
      const fromPath = resolveKeyPath(baseDir, fromKey);
      const toPath = resolveKeyPath(baseDir, toKey);
      await fs.mkdir(path.dirname(toPath), { recursive: true });
      await fs.copyFile(fromPath, toPath);
    },
  };
}

function verifyDownloadToken(config, { key, exp, token }) {
  const expiresAtEpochSeconds = Number(exp);
  if (!key || !Number.isFinite(expiresAtEpochSeconds) || !token) {
    return false;
  }
  if (expiresAtEpochSeconds < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expectedHmac = crypto
    .createHmac("sha256", config.videoSignedUrlSecret)
    .update(`${key}:${expiresAtEpochSeconds}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedHmac, "hex");
  const providedBuffer = Buffer.from(String(token), "hex");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

module.exports = {
  createLocalDiskStorageProvider,
  verifyDownloadToken,
  resolveBaseDir,
};
