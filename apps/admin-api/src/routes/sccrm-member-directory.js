"use strict";

const express = require("express");
const { requireAuth, requireRole } = require("../auth/middleware");

function createSccrmMemberDirectoryRouter({ config, fetchImpl = global.fetch, timeoutMs = 15000 }) {
  const router = express.Router();
  router.use(requireAuth(config), requireRole("admin"));
  router.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });

  async function read(req, res, history) {
    const query = new URLSearchParams();
    for (const key of history ? ["limit", "cursor"] : ["search", "page", "limit"]) {
      const value = req.query[key];
      if (value === undefined) continue;
      const maximum = key === "cursor" ? 2048 : key === "search" ? 100 : 6;
      if (typeof value !== "string" || value.length > maximum ||
          (["page", "limit"].includes(key) && (!/^[1-9]\d*$/.test(value) || Number(value) > (key === "limit" ? 100 : 100000)))) {
        return res.status(400).json({ error: "Invalid search or pagination." });
      }
      query.set(key, value);
    }
    if (history && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid member ID." });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const disconnected = () => controller.abort();
    res.on("close", disconnected);
    try {
      const base = new URL(config.crmMirrorBaseUrl);
      if (!config.crmMirrorInternalToken || base.username || base.password ||
          (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))) throw Error("CRM is not configured");
      const path = "/internal/crm/member-directory" + (history ? `/${encodeURIComponent(req.params.id)}/purchase-history` : "");
      const response = await fetchImpl(new URL(`${path}?${query}`, base), {
        method: "GET", headers: { "x-internal-token": config.crmMirrorInternalToken, Accept: "application/json" },
        signal: controller.signal, redirect: "error", cache: "no-store",
      });
      if (response.status === 404) return res.status(404).json({ error: "Member not found." });
      if (response.status === 400) return res.status(400).json({ error: "Invalid search or pagination." });
      if (!response.ok) throw Error("CRM unavailable");
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) { controller.abort(); throw Error("CRM response too large"); }
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Array.isArray(history ? body.purchases : body.members)) throw Error("Invalid CRM response");
      return res.json(body);
    } catch {
      if (!res.destroyed) return res.status(503).json({ error: "Member service is temporarily unavailable." });
    } finally { clearTimeout(timer); res.off("close", disconnected); }
  }
  router.get("/", (req, res) => read(req, res, false));
  router.get("/:id/purchase-history", (req, res) => read(req, res, true));
  return router;
}
module.exports = { createSccrmMemberDirectoryRouter };
