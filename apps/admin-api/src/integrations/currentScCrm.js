"use strict";

// The CRM mirror is a secondary, best-effort side effect after the Ada sync
// transaction has committed. Keep it from holding the primary sync response
// open long enough for the branch agent's 60-second request timeout to mark
// the whole run failed.
const CRM_MIRROR_TIMEOUT_MS = 30_000;

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function createCrmMirrorClient(config, fetchImpl = global.fetch) {
  const baseUrl = normalizeBaseUrl(config.crmMirrorBaseUrl);
  const internalToken = String(config.crmMirrorInternalToken || "").trim();
  const configuredTimeoutMs = Number(config.crmMirrorTimeoutMs);
  const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? Math.floor(configuredTimeoutMs)
    : CRM_MIRROR_TIMEOUT_MS;
  const enabled = Boolean(baseUrl && internalToken && typeof fetchImpl === "function");

  async function post(path, payload) {
    if (!enabled) {
      return { ok: false, skipped: true };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": internalToken,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      // Keep the timeout active through body reading too; a CRM server can
      // send headers promptly and then stall while streaming its response.
      const text = await response.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { raw: text };
      }
      if (!response.ok) {
        const error = new Error(body.error || body.message || `CRM mirror request failed: ${response.status}`);
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return { ok: true, body };
    } catch (cause) {
      if (cause?.name === "AbortError" || cause?.code === "ABORT_ERR") {
        const error = new Error(`CRM mirror request timed out after ${timeoutMs}ms`);
        error.code = "CRM_MIRROR_TIMEOUT";
        throw error;
      }
      throw cause;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    enabled,
    async mirrorSales(records) {
      return post("/internal/crm/pos/sales", { records });
    },
    async mirrorRefunds(records) {
      return post("/internal/crm/pos/refunds", { records });
    },
  };
}

module.exports = {
  createCrmMirrorClient,
};
