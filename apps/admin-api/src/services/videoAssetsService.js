"use strict";

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { ASSET_TYPES, MAX_UPLOAD_MIME_TYPES } = require("./video-providers/videoStudioConstants");

function createHttpError(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function parsePositiveInt(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function mapAssetRow(row) {
  return {
    assetId: Number(row.asset_id),
    assetPublicId: row.asset_public_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : null,
    assetType: row.asset_type,
    checksum: row.checksum,
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
    metadata: row.metadata_json || {},
  };
}

async function safelyDeleteFile(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (_error) {
    // Ignore temp cleanup errors.
  }
}

async function loadAssetRow(db, assetId) {
  const result = await db.query(`SELECT * FROM content.video_assets WHERE asset_id = $1`, [assetId]);
  return result.rows[0] || null;
}

async function initAssetUpload({ db, config, auth, body }) {
  const mimeType = normalizeText(body?.mimeType);
  const assetType = normalizeText(body?.assetType);

  if (!MAX_UPLOAD_MIME_TYPES.includes(mimeType)) {
    throw createHttpError(`mimeType must be one of: ${MAX_UPLOAD_MIME_TYPES.join(", ")}.`, 400);
  }
  if (!ASSET_TYPES.includes(assetType)) {
    throw createHttpError(`assetType must be one of: ${ASSET_TYPES.join(", ")}.`, 400);
  }

  const assetPublicId = crypto.randomUUID();
  const storageProvider = config.videoStorageProvider || "local";

  const insertResult = await db.query(
    `INSERT INTO content.video_assets (
       asset_public_id, created_by, storage_provider, storage_key, asset_type,
       original_filename, mime_type
     )
     VALUES ($1, $2, $3, '', $4, $5, $6)
     RETURNING *`,
    [
      assetPublicId,
      auth.userId,
      storageProvider,
      assetType,
      normalizeText(body?.originalFilename) || null,
      mimeType,
    ],
  );
  const row = insertResult.rows[0];
  return { assetId: Number(row.asset_id), assetPublicId: row.asset_public_id };
}

function extensionForMimeType(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "video/mp4") return ".mp4";
  return "";
}

async function finalizeAssetUpload({ db, storageProvider, auth, assetId, tempFilePath, originalFilename, mimeType, fileSizeBytes }) {
  const normalizedAssetId = parsePositiveInt(assetId, null);
  if (normalizedAssetId == null) {
    await safelyDeleteFile(tempFilePath);
    throw createHttpError("assetId is invalid.", 400);
  }

  try {
    const assetRow = await loadAssetRow(db, normalizedAssetId);
    if (!assetRow) {
      throw createHttpError("Not found", 404);
    }
    if (assetRow.created_by !== auth.userId && auth.role !== "admin") {
      throw createHttpError("Forbidden", 403);
    }

    const buffer = await fs.readFile(tempFilePath);
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const ext = extensionForMimeType(mimeType || assetRow.mime_type) || path.extname(originalFilename || "");
    const storageKey = `content/${assetRow.asset_type}/${assetRow.asset_public_id}${ext}`;

    await storageProvider.uploadAsset({ key: storageKey, buffer, mimeType: mimeType || assetRow.mime_type });

    const updateResult = await db.query(
      `UPDATE content.video_assets
       SET storage_key = $2, file_size_bytes = $3, checksum = $4, mime_type = $5, original_filename = $6
       WHERE asset_id = $1
       RETURNING *`,
      [
        normalizedAssetId,
        storageKey,
        fileSizeBytes != null ? fileSizeBytes : buffer.length,
        checksum,
        mimeType || assetRow.mime_type,
        originalFilename || assetRow.original_filename,
      ],
    );

    return mapAssetRow(updateResult.rows[0]);
  } finally {
    await safelyDeleteFile(tempFilePath);
  }
}

async function getAssetForDownload({ db, auth, assetId }) {
  const normalizedAssetId = parsePositiveInt(assetId, null);
  if (normalizedAssetId == null) {
    throw createHttpError("Not found", 404);
  }

  const assetRow = await loadAssetRow(db, normalizedAssetId);
  if (!assetRow) {
    throw createHttpError("Not found", 404);
  }

  if (assetRow.created_by === auth.userId || auth.role === "admin") {
    return { asset: mapAssetRow(assetRow), storageKey: assetRow.storage_key };
  }

  if (assetRow.asset_type === "generated_video") {
    const jobResult = await db.query(
      `SELECT status FROM content.video_jobs WHERE output_asset_id = $1 LIMIT 1`,
      [normalizedAssetId],
    );
    const job = jobResult.rows[0];
    if (job && job.status === "approved") {
      return { asset: mapAssetRow(assetRow), storageKey: assetRow.storage_key };
    }
  }

  throw createHttpError("Not found", 404);
}

module.exports = {
  initAssetUpload,
  finalizeAssetUpload,
  getAssetForDownload,
  mapAssetRow,
  safelyDeleteFile,
  loadAssetRow,
};
