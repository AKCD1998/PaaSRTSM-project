"use strict";
const express = require('express');
const { TARGETS, validMonth, buildRegistrationProgress } = require('../services/memberRegistrationTargets');

function createMemberRegistrationTargetsRouter({ config, requireAuthMiddleware, fetchImpl = global.fetch, timeoutMs = 15000 }) {
  const router = express.Router();
  router.get('/member-registration-targets', requireAuthMiddleware, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (Object.keys(req.query).some(key => key !== 'month') || !validMonth(req.query.month)) {
      return res.status(400).json({ error: 'กรุณาเลือกเดือนตั้งแต่พฤศจิกายน 2569' });
    }
    const branches = req.auth.role === 'admin' ? Object.keys(TARGETS) : [req.auth.effectiveBranchCode];
    if (branches.some(code => !Object.hasOwn(TARGETS, code))) return res.status(403).json({ error: 'บัญชีนี้ยังไม่ได้ระบุสาขา' });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    const disconnect = () => controller.abort(); res.on('close', disconnect);
    try {
      const base = new URL(config.crmMirrorBaseUrl);
      if (!config.crmMirrorInternalToken || base.username || base.password || (base.protocol !== 'https:'
        && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)))) throw Error('CRM not configured');
      const url = new URL('/internal/crm/member-registrations', base); url.searchParams.set('month', req.query.month);
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { 'x-internal-token': config.crmMirrorInternalToken, Accept: 'application/json' } });
      if (!response.ok) throw Error('CRM unavailable');
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 128 * 1024) { controller.abort(); throw Error('CRM response too large'); }
        chunks.push(Buffer.from(chunk));
      }
      const report = buildRegistrationProgress(JSON.parse(Buffer.concat(chunks).toString('utf8')), req.query.month, branches);
      return res.json({ ok: true, ...report });
    } catch {
      if (!res.destroyed) return res.status(503).json({ error: 'ยังโหลดข้อมูลสมัครสมาชิกจาก SCCRM ไม่ได้ กรุณาลองใหม่' });
    } finally { clearTimeout(timer); res.off('close', disconnect); }
  });
  return router;
}
module.exports = { createMemberRegistrationTargetsRouter };
