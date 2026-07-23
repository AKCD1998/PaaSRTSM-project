"use strict";

const crypto = require("crypto");
const { FOCUS_TYPES, createHttpError } = require("./focusProducts");

const RETENTION_DAYS = 35;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 4000;

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeDate(value, field) {
  const text = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createHttpError(`${field} must be a date in YYYY-MM-DD format.`, 400);
  }
  return text;
}

function normalizeBranchCode(value) {
  const text = normalizeText(value);
  if (!/^\d{3}$/.test(text)) {
    throw createHttpError("branchCode must be a 3-digit branch code.", 400);
  }
  return text;
}

function decodePngDataUrl(value) {
  const text = normalizeText(value);
  const prefix = "data:image/png;base64,";
  if (!text.startsWith(prefix)) {
    throw createHttpError("imageDataUrl must be a PNG data URL.", 400);
  }
  const buffer = Buffer.from(text.slice(prefix.length), "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw createHttpError("imageDataUrl must decode to a PNG no larger than 5 MB.", 400);
  }
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!pngSignature.every((byte, index) => buffer[index] === byte)) {
    throw createHttpError("imageDataUrl is not a valid PNG.", 400);
  }
  return buffer;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function mapPackage(row, signedUrl = null, duplicate = false) {
  return {
    id: Number(row.id),
    packageKey: row.package_key,
    focusType: row.focus_type,
    branchCode: row.branch_code,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    ciCount: Number(row.ci_count),
    messageText: row.message_text,
    imageSha256: row.image_sha256,
    bucketName: row.bucket_name,
    objectKey: row.object_key,
    sizeBytes: Number(row.size_bytes),
    uploadState: row.upload_state,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    signedImageUrl: signedUrl,
    duplicate,
  };
}

function buildPackageKey({ focusType, branchCode, dateFrom, dateTo, ciCount, messageText, rowFingerprint, imageSha256 }) {
  return sha256Hex(JSON.stringify({
    focusType,
    branchCode,
    dateFrom,
    dateTo,
    ciCount,
    messageText,
    rowFingerprint,
    imageSha256,
  }));
}

async function saveFocusLineChatPackage({ db, config, storageProvider, auth, body }) {
  if (!storageProvider) {
    throw createHttpError("R2 storage is unavailable.", 503);
  }

  const focusType = normalizeText(body?.focusType);
  if (!FOCUS_TYPES.has(focusType)) throw createHttpError("focusType is invalid.", 400);
  const branchCode = normalizeBranchCode(body?.branchCode);
  const dateFrom = normalizeDate(body?.dateFrom, "dateFrom");
  const dateTo = normalizeDate(body?.dateTo, "dateTo");
  if (dateTo < dateFrom) throw createHttpError("dateTo must not be before dateFrom.", 400);
  const ciCount = Number(body?.ciCount);
  if (!Number.isInteger(ciCount) || ciCount < 0 || ciCount > 999999) {
    throw createHttpError("ciCount must be a non-negative integer.", 400);
  }
  const messageText = normalizeText(body?.messageText);
  if (!messageText || messageText.length > MAX_MESSAGE_CHARS) {
    throw createHttpError(`messageText must be 1-${MAX_MESSAGE_CHARS} characters.`, 400);
  }
  const rowFingerprint = normalizeText(body?.rowFingerprint);
  if (!rowFingerprint || rowFingerprint.length > 4000) {
    throw createHttpError("rowFingerprint is required.", 400);
  }
  const image = decodePngDataUrl(body?.imageDataUrl);
  const imageSha256 = sha256Hex(image);
  const packageKey = buildPackageKey({ focusType, branchCode, dateFrom, dateTo, ciCount, messageText, rowFingerprint, imageSha256 });

  const existing = await db.query(
    `SELECT * FROM focus.line_chat_packages WHERE package_key = $1`,
    [packageKey],
  );
  if (existing.rows[0]) {
    const url = await storageProvider.createSignedGetUrl(existing.rows[0].object_key);
    return mapPackage(existing.rows[0], url, true);
  }

  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const objectKey = `focus-line-packages/${config.nodeEnv || "production"}/${dateFrom}_${dateTo}/${branchCode}/${packageKey}.png`;
  const checksumSha256 = Buffer.from(imageSha256, "hex").toString("base64");
  const put = await storageProvider.putObject({
    key: objectKey,
    body: image,
    contentType: "image/png",
    checksumSha256,
    expiresAt,
    metadata: {
      "package-key": packageKey,
      "focus-type": focusType,
      "branch-code": branchCode,
      "expires-at": expiresAt.toISOString(),
    },
  });
  const head = typeof storageProvider.headObject === "function" ? await storageProvider.headObject(objectKey) : null;
  if (head?.ContentLength != null && Number(head.ContentLength) !== image.length) {
    throw new Error("R2 object size verification failed");
  }

  const inserted = await db.query(
    `INSERT INTO focus.line_chat_packages
       (package_key, focus_type, branch_code, date_from, date_to, ci_count, message_text,
        row_fingerprint, image_sha256, bucket_name, object_key, mime_type, size_bytes, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'image/png',$12,$13,$14)
     ON CONFLICT (package_key) DO NOTHING
     RETURNING *`,
    [
      packageKey,
      focusType,
      branchCode,
      dateFrom,
      dateTo,
      ciCount,
      messageText,
      rowFingerprint,
      imageSha256,
      config.r2BucketName,
      objectKey,
      image.length,
      auth?.userId || null,
      expiresAt,
    ],
  );

  if (!inserted.rows[0]) {
    const duplicate = await db.query(`SELECT * FROM focus.line_chat_packages WHERE package_key = $1`, [packageKey]);
    return mapPackage(duplicate.rows[0], await storageProvider.createSignedGetUrl(duplicate.rows[0].object_key), true);
  }

  return mapPackage(inserted.rows[0], await storageProvider.createSignedGetUrl(objectKey), false);
}

async function cleanupExpiredFocusLineChatPackages({ db, storageProvider, logger = console, limit = 100 }) {
  if (!storageProvider) return { scanned: 0, deleted: 0 };
  const expired = await db.query(
    `UPDATE focus.line_chat_packages
     SET upload_state = 'cleanup_pending'
     WHERE id IN (
       SELECT id
       FROM focus.line_chat_packages
       WHERE upload_state = 'ready' AND expires_at <= now()
       ORDER BY expires_at ASC
       LIMIT $1
     )
     RETURNING id, object_key`,
    [limit],
  );

  let deleted = 0;
  for (const row of expired.rows) {
    try {
      await storageProvider.deleteObject(row.object_key);
      await db.query(
        `UPDATE focus.line_chat_packages SET upload_state = 'deleted' WHERE id = $1`,
        [row.id],
      );
      deleted += 1;
    } catch (error) {
      logger.warn?.(`[focus-line-packages] failed to delete expired object ${row.object_key}: ${error.message}`);
      await db.query(
        `UPDATE focus.line_chat_packages SET upload_state = 'ready' WHERE id = $1 AND upload_state = 'cleanup_pending'`,
        [row.id],
      ).catch(() => {});
    }
  }
  return { scanned: expired.rows.length, deleted };
}

function startFocusLinePackageCleanupSchedule({ db, storageProvider, config, logger = console }) {
  const intervalMs = Number(config.focusLinePackageCleanupIntervalMs || 0);
  if (!intervalMs || intervalMs <= 0 || !storageProvider) return null;
  const run = () => cleanupExpiredFocusLineChatPackages({ db, storageProvider, logger })
    .catch((error) => logger.warn?.(`[focus-line-packages] cleanup failed: ${error.message}`));
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  run();
  return timer;
}

module.exports = {
  RETENTION_DAYS,
  buildPackageKey,
  saveFocusLineChatPackage,
  cleanupExpiredFocusLineChatPackages,
  startFocusLinePackageCleanupSchedule,
};
