"use strict";

/**
 * @interface StorageProvider
 *
 * Contract every storage backend (local disk today; r2/S3-compatible in a future
 * phase) must implement. Nothing is exported here except this documentation —
 * concrete providers live in sibling files and are selected via storageRegistry.js.
 *
 * async uploadAsset({ key, buffer, mimeType })
 *   Persists `buffer` under `key`. Returns { storageKey: string }.
 *
 * async getSignedDownloadUrl({ key, expiresInSeconds })
 *   Returns a time-limited URL (string) a client can GET to retrieve the asset.
 *
 * async getSignedUploadUrl({ key, mimeType, expiresInSeconds })
 *   Returns a time-limited URL (string) a client can PUT the asset bytes to
 *   directly. Providers that don't support direct/presigned uploads (e.g. local
 *   disk) should throw a 400 createHttpError directing callers to the
 *   multer-based upload-complete route instead.
 *
 * async deleteAsset({ key })
 *   Removes the object at `key`. Resolves even if the object does not exist.
 *
 * async copyAsset({ fromKey, toKey })
 *   Copies an object to a new key within the same provider.
 *
 * async downloadAsset({ key })
 *   Reads the object at `key` back into memory. Returns { buffer: Buffer }.
 *   Used server-side (e.g. to forward an uploaded input image to a video
 *   provider) — never exposed directly to clients, unlike getSignedDownloadUrl.
 */

module.exports = {};
