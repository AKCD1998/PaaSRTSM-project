"use strict";

const express = require("express");
const { requireAuth, requireRole, requireCsrf } = require("../auth/middleware");

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
  async function linking(req, res, kind) {
    const confirm = kind === 'confirm', pending = kind === 'pending';
    if (!pending && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid member ID.' });
    const query = new URLSearchParams();
    for (const key of Object.keys(req.query)) {
      if (!pending || !['page', 'limit'].includes(key) || typeof req.query[key] !== 'string' || !/^[1-9]\d*$/.test(req.query[key]) || Number(req.query[key]) > (key === 'limit' ? 100 : 100000)) return res.status(400).json({ error: 'Invalid pagination.' });
      query.set(key, req.query[key]);
    }
    if (confirm && (!req.body || Array.isArray(req.body) || Object.keys(req.body).some(k => !['adaCode', 'reviewToken'].includes(k)) ||
      typeof req.body.adaCode !== 'string' || req.body.adaCode.length > 20 || typeof req.body.reviewToken !== 'string' || req.body.reviewToken.length > 2048)) return res.status(400).json({ error: 'Invalid link request.' });
    if (confirm && !config.crmAdaLinkAdminToken) return res.status(503).json({ error: 'ระบบยืนยันรหัส Ada ยังไม่พร้อมใช้งาน' });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    const disconnected = () => controller.abort(); res.on('close', disconnected);
    try {
      const base = new URL(config.crmMirrorBaseUrl);
      if (!config.crmMirrorInternalToken || base.username || base.password || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)))) throw Error('CRM not configured');
      const path = '/internal/crm/member-directory/' + (pending ? 'ada-links' : encodeURIComponent(req.params.id) + '/ada-links');
      const response = await fetchImpl(new URL(path + (query.size ? '?' + query : ''), base), {
        method: confirm ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { 'x-internal-token': config.crmMirrorInternalToken, Accept: 'application/json', ...(confirm ? { 'Content-Type': 'application/json', 'x-ada-link-admin-token': config.crmAdaLinkAdminToken } : {}) },
        ...(confirm ? { body: JSON.stringify({ adaCode: req.body.adaCode, reviewToken: req.body.reviewToken, actor: { id: String(req.auth.userId), role: 'admin' } }) } : {}),
      });
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 1024 * 1024) throw Error('CRM response too large'); chunks.push(Buffer.from(chunk)); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if ([400, 404, 409].includes(response.status)) {
        const codes = { INVALID_LINK: 'ข้อมูลการผูกไม่ถูกต้อง กรุณาโหลดรายการใหม่', MEMBER_NOT_FOUND: 'ไม่พบสมาชิกนี้', MEMBER_ALREADY_LINKED: 'สมาชิกนี้ผูกกับรหัส Ada แล้ว กรุณาโหลดรายการใหม่', ADA_ALREADY_LINKED: 'รหัส Ada นี้ผูกกับสมาชิกคนอื่นแล้ว', PHONE_CHANGED: 'ข้อมูลลูกค้าเปลี่ยนแล้ว กรุณาโหลดรายการใหม่และตรวจสอบอีกครั้ง', OPTIONS_EXPIRED: 'รายการนี้หมดอายุ กรุณาโหลดรายการใหม่', BILL_OWNER_CONFLICT: 'มีบิลที่ผูกกับสมาชิกอื่นอยู่ ต้องตรวจสอบก่อนผูก' };
        return res.status(response.status).json({ error: codes[body.code] || 'ข้อมูลเปลี่ยนหรือไม่พบสมาชิก กรุณาโหลดรายการใหม่', ...(codes[body.code] ? { code: body.code } : {}) });
      }
      if (!response.ok || !body.ok || (pending && !Array.isArray(body.members)) || (kind === 'options' && (body.member?.id !== req.params.id || !Array.isArray(body.candidates))) || (confirm && (body.memberId !== req.params.id || body.adaCode !== req.body.adaCode))) throw Error('Invalid CRM response');
      return res.json(body);
    } catch { if (!res.destroyed) return res.status(503).json({ error: 'ระบบเชื่อมสมาชิกไม่พร้อมใช้งาน กรุณาลองใหม่' }); }
    finally { clearTimeout(timer); res.off('close', disconnected); }
  }
  router.get('/ada-links', (req, res) => linking(req, res, 'pending'));
  router.get('/:id/ada-links', (req, res) => linking(req, res, 'options'));
  router.post('/:id/ada-links', requireCsrf, (req, res) => linking(req, res, 'confirm'));
  router.get("/:id/purchase-history", (req, res) => read(req, res, true));
  return router;
}
module.exports = { createSccrmMemberDirectoryRouter };
