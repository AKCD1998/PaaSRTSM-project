"use strict";

const MESSAGE_MAX_CHARS = 4000;
const META_MAX_BYTES = 64 * 1024;
const ALLOWED_ROLES = new Set(["admin", "staff", "system"]);

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passphrase/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /authorization/i,
  /cookie/i,
  /set-cookie/i,
  /refresh[_-]?token/i,
  /access[_-]?token/i,
  /jwt/i,
];

function truncateText(value, maxChars) {
  if (typeof value !== "string") {
    return null;
  }
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 14)}...[truncated]`;
}

function sanitizeMessage(message) {
  const text = String(message || "");
  if (!text) {
    return null;
  }

  // Redact common secret-like key/value fragments in free text.
  const redacted = text
    .replace(/(password\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(passphrase\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(token\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(secret\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(authorization\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [redacted]");

  return truncateText(redacted, MESSAGE_MAX_CHARS);
}

function isSensitiveKey(key) {
  const text = String(key || "");
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(text));
}

function sanitizeMeta(value, depth = 0) {
  if (depth > 8) {
    return "[depth-truncated]";
  }
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return truncateText(value, 2000);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => sanitizeMeta(item, depth + 1));
  }
  if (typeof value === "object") {
    const result = {};
    const keys = Object.keys(value).slice(0, 200);
    for (const key of keys) {
      if (isSensitiveKey(key)) {
        result[key] = "[redacted]";
      } else {
        result[key] = sanitizeMeta(value[key], depth + 1);
      }
    }
    return result;
  }
  return String(value);
}

function fitMetaSize(metaObj) {
  if (metaObj == null) {
    return null;
  }
  let current = metaObj;
  let encoded = Buffer.from(JSON.stringify(current), "utf8");
  if (encoded.length <= META_MAX_BYTES) {
    return current;
  }

  // Keep shrinking until we fit; preserve signal that truncation happened.
  if (Array.isArray(current)) {
    while (current.length > 0) {
      current = current.slice(0, Math.max(1, Math.floor(current.length / 2)));
      encoded = Buffer.from(JSON.stringify(current), "utf8");
      if (encoded.length <= META_MAX_BYTES) {
        return current;
      }
    }
    return ["[meta-truncated]"];
  }

  if (typeof current === "object") {
    const entries = Object.entries(current);
    let keep = entries.length;
    while (keep > 1) {
      keep = Math.floor(keep / 2);
      current = Object.fromEntries(entries.slice(0, keep));
      current.__meta_truncated = true;
      encoded = Buffer.from(JSON.stringify(current), "utf8");
      if (encoded.length <= META_MAX_BYTES) {
        return current;
      }
    }
    return { __meta_truncated: true };
  }

  return { __meta_truncated: true };
}

function normalizeRole(role) {
  const normalized = String(role || "system").trim().toLowerCase();
  return ALLOWED_ROLES.has(normalized) ? normalized : "system";
}

function normalizeAction(action) {
  const text = String(action || "").trim();
  if (!text) {
    throw new Error("auditLog payload.action is required");
  }
  return text;
}

function normalizeNullableText(value, maxChars = 512) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  return truncateText(text, maxChars);
}

/**
 * Insert an audit log row into public.audit_logs.
 * @param {{ query: (sql: string, params?: any[]) => Promise<any> }} db pg Client/Pool-like object
 * @param {{
 *   actor_role?: string,
 *   actor_id?: string,
 *   action: string,
 *   target_type?: string,
 *   target_id?: string,
 *   success?: boolean,
 *   message?: string,
 *   meta?: any,
 *   request_id?: string,
 *   ip?: string,
 *   user_agent?: string,
 * }} payload
 */
async function auditLog(db, payload) {
  if (!db || typeof db.query !== "function") {
    throw new Error("auditLog requires a db object with query(sql, params)");
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("auditLog payload is required");
  }

  const actorRole = normalizeRole(payload.actor_role);
  const action = normalizeAction(payload.action);
  const safeMessage = sanitizeMessage(payload.message);
  const sanitizedMeta = fitMetaSize(sanitizeMeta(payload.meta));

  const query = `
    INSERT INTO public.audit_logs (
      actor_role,
      actor_id,
      action,
      target_type,
      target_id,
      success,
      message,
      meta,
      request_id,
      ip,
      user_agent
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
    RETURNING audit_id, event_time
  `;

  const params = [
    actorRole,
    normalizeNullableText(payload.actor_id, 256),
    action,
    normalizeNullableText(payload.target_type, 128),
    normalizeNullableText(payload.target_id, 256),
    payload.success !== false,
    safeMessage || null,
    sanitizedMeta ? JSON.stringify(sanitizedMeta) : null,
    normalizeNullableText(payload.request_id, 256),
    normalizeNullableText(payload.ip, 128),
    normalizeNullableText(payload.user_agent, 1024),
  ];

  const result = await db.query(query, params);
  return result.rows[0];
}

module.exports = {
  auditLog,
  sanitizeMeta,
};
