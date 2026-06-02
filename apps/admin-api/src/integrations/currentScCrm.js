"use strict";

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function createCrmMirrorClient(config, fetchImpl = global.fetch) {
  const baseUrl = normalizeBaseUrl(config.crmMirrorBaseUrl);
  const internalToken = String(config.crmMirrorInternalToken || "").trim();
  const enabled = Boolean(baseUrl && internalToken && typeof fetchImpl === "function");

  async function post(path, payload) {
    if (!enabled) {
      return { ok: false, skipped: true };
    }
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": internalToken,
      },
      body: JSON.stringify(payload),
    });

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
