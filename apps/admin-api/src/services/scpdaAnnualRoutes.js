'use strict';

const annual = require('./scpdaAnnualCount');
const { generateWorkbook } = require('./scpdaAnnualWorkbook');
const { dailyRequired, pairFor } = require('./scpdaDailyPolicy');
const { listCompanions } = require('./scpdaCompanions');

function mountAnnualRoutes({ router, config, db, settings, run, authenticate, envelope }) {
  const reply = (res, payload) => res.json(envelope(payload, '005'));
  async function actor(req, requiredRole) {
    if (!config.featureScpdaAnnual005) annual.reject(404, 'ANNUAL_DISABLED', 'ยังไม่เปิดอีเวนท์นับสต๊อก');
    const { operator, claims } = await authenticate(req);
    const code = operator.operatorCode;
    if (operator.branchCode !== '005' || !dailyRequired(config, code) || pairFor(code)?.primaryOperatorCode !== '01005') {
      annual.reject(403, 'ANNUAL_SCOPE_DENIED', 'บัญชีนี้ไม่ได้อยู่ในงานนับของสาขา 005');
    }
    if (!Number.isSafeInteger(claims?.app_version) || claims.app_version < 22) {
      annual.reject(409, 'ANNUAL_UPDATE_REQUIRED', 'อัปเดต SCPDA เป็น R22 แล้วเข้าสู่ระบบอีกครั้งเพื่อใช้งานใบนับ');
    }
    const manager = code === '01005';
    if ((requiredRole === 'manager' && !manager) || (requiredRole === 'helper' && manager)) {
      annual.reject(403, 'ANNUAL_ROLE_DENIED', 'บัญชีนี้ไม่มีสิทธิ์ทำรายการ');
    }
    return { operator: code, branchCode: '005', manager };
  }
  function eventId(req) {
    const value = req.body?.eventId;
    if (!annual.uuid.test(value ?? '')) annual.reject(400, 'ANNUAL_EVENT_INVALID', 'อีเวนท์ไม่ถูกต้อง');
    return value;
  }
  router.get('/annual', run(async (req, res) => {
    const who = await actor(req);
    const hasSelection = req.query?.category !== undefined || req.query?.pageNo !== undefined;
    const selected = hasSelection ? { category: req.query.category, pageNo: Number(req.query.pageNo) } : undefined;
    const result = await annual.overview(db, { ...who, selected, workOnly: req.query?.view === 'mine' });
    if (result.manager && result.event) {
      const operators = await listCompanions(config, settings, db, who.operator);
      result.helpers = operators.filter(device => device.paired).map(device => device.operatorCode);
    }
    reply(res, result);
  }));
  router.post('/annual/request', run(async (req, res) => {
    const who = await actor(req, 'helper');
    const { category, pageNo } = req.body || {};
    reply(res, await annual.requestPage(db, { ...who, eventId: eventId(req), category, pageNo }));
  }));
  router.post('/annual/assign', run(async (req, res) => {
    const who = await actor(req, 'manager');
    const { category, pageNo, operator, approve } = req.body || {};
    const permitted = operator === who.operator || (await listCompanions(config, settings, db, who.operator))
      .some(device => device.operatorCode === operator && device.paired);
    if (!permitted || typeof approve !== 'boolean') annual.reject(400, 'ANNUAL_ASSIGNEE_INVALID', 'เลือกเครื่องลูกที่ผูกแล้ว');
    reply(res, await annual.assignPage(db, { branchCode: who.branchCode, eventId: eventId(req), category, pageNo, operator, approve }));
  }));
  router.post('/annual/save', run(async (req, res) => {
    const who = await actor(req);
    const { category, pageNo, revision, mutationId, counts, submit } = req.body || {};
    reply(res, await annual.savePage(db, { ...who, eventId: eventId(req), category, pageNo, revision, mutationId, counts, submit }));
  }));
  router.post('/annual/participant', run(async (req,res) => {
    const who = await actor(req);
    reply(res, await annual.nameParticipant(db, { ...who, eventId: eventId(req), displayName: req.body?.displayName }));
  }));
  router.post('/annual/export', run(async (req, res) => {
    const who = await actor(req, 'manager');
    const { source, pages } = await annual.completedCategory(db, { ...who, eventId: eventId(req), category: req.body?.category });
    reply(res, generateWorkbook(source, pages));
  }));
}

module.exports = { mountAnnualRoutes };
