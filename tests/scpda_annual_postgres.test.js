'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const XLSX = require('xlsx');
const annual = require('../apps/admin-api/src/services/scpdaAnnualCount');
const { mountAnnualRoutes } = require('../apps/admin-api/src/services/scpdaAnnualRoutes');
const { generateWorkbook } = require('../apps/admin-api/src/services/scpdaAnnualWorkbook');
const { insertEvent, prepareEvent } = require('../scripts/import_scpda_annual_event');

test('annual counts preserve zero and reject foreign items and extra points without a place', () => {
  assert.deepEqual(annual.normalizeCounts([{ row: 3 }], { 3: [{ quantityMilli: 0 }, null, null] }, true),
    { 3: [{ quantityMilli: 0 }, null, null] });
  assert.throws(() => annual.normalizeCounts([{ row: 3 }], { 4: [{ quantityMilli: 0 }, null, null] }, false),
    { code: 'ANNUAL_COUNTS_INVALID' });
  assert.throws(() => annual.normalizeCounts([{ row: 3 }], { 3: [null, null, null, { quantityMilli: 1 }] }, true),
    { code: 'ANNUAL_POINT_INVALID' });
  assert.throws(() => annual.normalizeCounts([{ row: 3 }], { 3: [null, null, null] }, true),
    { code: 'ANNUAL_PAGE_INCOMPLETE' });
});

const fixtureUrl = process.env.SCPDA_ANNUAL_TEST_URL;
const formsDir = process.env.SCPDA_ANNUAL_TEST_FORMS;
const mapFile = process.env.SCPDA_ANNUAL_TEST_PAGE_MAP;
const resultDir = process.env.SCPDA_ANNUAL_TEST_OUTPUT;

test('annual request, exclusive approval, draft, receipt retry and the three original XLSX layouts', {
  skip: !(fixtureUrl && formsDir && mapFile),
}, async () => {
  const target = new URL(fixtureUrl);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.username, 'scpda_fixture');
  const db = new Pool({ connectionString: fixtureUrl, ssl: false });
  const branchCode = '005';
  const groups = { common: 'สามัญ', normal: 'ปกติ', pharma: 'เภสัช' };
  const files = Object.fromEntries(Object.entries(groups).map(([key, label]) =>
    [key, path.join(formsDir, `005-001_ธันวาคม-2569_${label}.xlsx`)]));
  let eventId;
  try {
    await db.query('CREATE SCHEMA IF NOT EXISTS ordering');
    await db.query(await fs.readFile(path.join(__dirname, '../migrations/093_add_scpda_annual_count.sql'), 'utf8'));
    await db.query(await fs.readFile(path.join(__dirname, '../migrations/094_queue_scpda_annual_pages.sql'), 'utf8'));
    const pageMap = JSON.parse((await fs.readFile(mapFile, 'utf8')).replace(/^\uFEFF/, ''));
    const event = await prepareEvent({ label: 'Fixture 005', branch: branchCode, warehouse: '001', pageMap, files });
    assert.equal(event.pages.length, 74);
    assert.equal(event.pages.flatMap(page => page.items).length, 3035);
    eventId = await insertEvent(db, event);
    const app = express();
    app.use(express.json());
    const config = { featureScpdaAnnual005: false, featureScpdaDaily005: true, featureScpdaBranch005: true };
    mountAnnualRoutes({
      router: app, config, db, settings: { operators: new Map() },
      authenticate: async req => ({ operator: { operatorCode: req.get('fixture-operator'), branchCode: req.get('fixture-branch') }, claims: { app_version: Number(req.get('fixture-version') || 22) } }),
      envelope: (data, branchCode) => ({ contract: 'scpda-read-005-v1', branchCode, ...data }),
      run: handler => (req, res, next) => handler(req, res).catch(next),
    });
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }));
    const testActor = (method, route, actor, branch = '005') =>
      request(app)[method](route).set('fixture-operator', actor).set('fixture-branch', branch);
    await testActor('get','/annual','02005').expect(404, { code: 'ANNUAL_DISABLED' });
    config.featureScpdaAnnual005 = true;
    await testActor('get','/annual','02005').set('fixture-version',21).expect(409, { code: 'ANNUAL_UPDATE_REQUIRED' });
    await testActor('get','/annual','02004','004').expect(403, { code: 'ANNUAL_SCOPE_DENIED' });
    await testActor('post','/annual/export','02005').send({ eventId }).expect(403, { code: 'ANNUAL_ROLE_DENIED' });
    const chosen = { branchCode, eventId, category: 'normal', pageNo: 11 };
    const helpers = ['02005', '03005'];
    const posted = await testActor('post','/annual/request',helpers[0]).send(chosen).expect(200);
    assert.equal(posted.body.contract, 'scpda-read-005-v1');
    assert.equal(posted.body.state, 'requested');
    await annual.requestPage(db, { ...chosen, operator: helpers[1] });
    const awaiting = await annual.overview(db, { branchCode, operator: helpers[0], manager: false });
    assert.equal(awaiting.assigned, null);
    assert.equal(awaiting.pending.pageNo, 11);
    assert.equal(awaiting.free.some(page => page.pageNo === 1 && page.category === 'normal'), true);
    const outcomes = await Promise.allSettled(helpers.map(operator => annual.assignPage(db, { ...chosen, operator, approve: true })));
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find(result => result.status === 'rejected').reason.code, 'ANNUAL_PAGE_TAKEN');
    const operator = helpers[outcomes.findIndex(result => result.status === 'fulfilled')];
    const other = helpers.find(code => code !== operator);
    const assigned = (await annual.overview(db, { branchCode, operator, manager: false })).assigned;
    const waiting = await annual.overview(db, { branchCode, operator: other, manager: false });
    assert.equal(waiting.assigned, null);
    assert.equal(waiting.free.some(page => page.category === 'normal' && page.pageNo === 11), false);
    // A second page queues on the same installation without replacing page11.
    const another = { ...chosen, pageNo: 1, operator };
    await annual.assignPage(db, another);
    let queued = await annual.overview(db, { branchCode, operator, manager: false });
    assert.equal(queued.assigned.pageNo, 11);
    assert.deepEqual(queued.assignedPages.map(page => page.pageNo), [11, 1]);
    assert.equal(queued.assignedPages.some(page => page.items || page.counts), false);
    const selected = await testActor('get','/annual?category=normal&pageNo=1',operator).expect(200);
    assert.equal(selected.body.assigned.pageNo, 1);
    await testActor('get','/annual?category=normal&pageNo=1',other).expect(404);
    await testActor('get','/annual?category=normal&pageNo=2',operator).expect(404);
    await annual.assignPage(db, another); // replay does not add duplicate queue entries
    await db.query(await fs.readFile(path.join(__dirname, '../migrations/093_add_scpda_annual_count.sql'), 'utf8'));
    await db.query(await fs.readFile(path.join(__dirname, '../migrations/094_queue_scpda_annual_pages.sql'), 'utf8'));
    queued = await annual.overview(db, { branchCode, operator, manager: false });
    assert.deepEqual(queued.assignedPages.map(page => page.pageNo), [11, 1]);
    const firstRow = assigned.items[0].row;
    const draft = { ...chosen, operator, revision: 0, mutationId: randomUUID(), submit: false,
      counts: { [firstRow]: [{ quantityMilli: 2000 }, null, null] } };
    await assert.rejects(annual.savePage(db, { ...draft, operator: other }), { code: 'ANNUAL_PAGE_MISSING' });
    assert.equal((await annual.savePage(db, draft)).revision, 1);
    assert.equal((await annual.savePage(db, draft)).revision, 1);
    assert.equal((await annual.overview(db, { branchCode, manager: true })).pages.find(
      page => page.category === 'normal' && page.pageNo === 11).countedRows, 1);
    await assert.rejects(annual.completedCategory(db, chosen), { code: 'ANNUAL_EVENT_INCOMPLETE' });

    function filled(page) {
      return Object.fromEntries(page.items.map((item, index) => [item.row, index === 0 ?
        [{ quantityMilli: 0 }, { quantityMilli: 1250 }, null, { quantityMilli: 2000, place: 'หลังร้าน B & C' }] :
        [{ quantityMilli: 0 }, null, null]]));
    }
    const primaryPage = { branchCode, eventId, category: 'common', pageNo: 1 };
    await testActor('post','/annual/participant','01005').send({ eventId, displayName: 'เครื่องแม่ทดสอบ' }).expect(200);
    await testActor('post','/annual/assign','01005').send({ ...primaryPage, operator: '01005', approve: false }).expect(200);
    const mine = await testActor('get','/annual?view=mine','01005').expect(200);
    assert.equal(mine.body.manager, false); assert.equal(mine.body.canManage, true);
    assert.equal(mine.body.assigned.pageNo, 1);
    const ownReceipt = await testActor('post','/annual/save','01005').send({ ...primaryPage, revision: 0, mutationId: randomUUID(), counts: filled(mine.body.assigned), submit: true }).expect(200);
    assert.equal(ownReceipt.body.state, 'submitted');
    const team = await testActor('get','/annual',operator).expect(200);
    assert.equal(team.body.team.find(page => page.operator === '01005').displayName, 'เครื่องแม่ทดสอบ');
    assert.equal(team.body.team.some(page => page.items || page.counts), false);
    await testActor('get','/annual?category=common&pageNo=1',operator).expect(404);
    assert.ok((await db.query("SELECT actor_name FROM ordering.scpda_annual_count_audit WHERE event_id=$1 AND operator_code='01005'",[eventId])).rows.every(row => row.actor_name === 'เครื่องแม่ทดสอบ'));
    const submit = { ...draft, revision: 1, mutationId: randomUUID(), submit: true, counts: filled(assigned) };
    const receipt = await annual.savePage(db, submit);
    assert.equal(receipt.state, 'submitted');
    assert.equal((await annual.overview(db, { branchCode, operator, manager: false })).assigned.pageNo, 1);
    assert.equal((await annual.savePage(db, submit)).receiptId, receipt.receiptId);
    await assert.rejects(annual.savePage(db, { ...submit, mutationId: randomUUID() }), { code: 'ANNUAL_PAGE_CHANGED' });
    for (const page of event.pages.filter(page => !(page.category === 'normal' && page.pageNo === 11) && !(page.category === 'common' && page.pageNo === 1))) {
      const job = { branchCode, eventId, operator, category: page.category, pageNo: page.pageNo };
      await annual.assignPage(db, job);
      await annual.savePage(db, { ...job, revision: 0, mutationId: randomUUID(), counts: filled(page), submit: true });
    }
    const summary = await annual.overview(db, { branchCode, manager: true });
    assert.equal(summary.pages.every(page => page.state === 'submitted'), true);
    for (const [category, thai] of Object.entries(groups)) {
      const completed = await annual.completedCategory(db, { branchCode, eventId, category });
      const result = generateWorkbook(completed.source, completed.pages);
      assert.equal(result.filename.endsWith('.xlsx'), true);
      const bytes = Buffer.from(result.base64, 'base64');
      const parsed = XLSX.read(bytes, { type: 'buffer', WTF: true });
      assert.equal(parsed.SheetNames.length, 2);
      assert.equal(parsed.Sheets[parsed.SheetNames[0]].H3.v, 3.25);
      assert.equal(parsed.Sheets[parsed.SheetNames[0]].I3.v, 0);
      assert.equal(parsed.Sheets[parsed.SheetNames[0]].J3.v, 1.25);
      assert.equal(parsed.Sheets[parsed.SheetNames[0]].K3, undefined);
      assert.equal(parsed.Sheets['จุดนับเพิ่มเติม'].G2.v, 'หลังร้าน B & C');
      assert.equal(parsed.Sheets['จุดนับเพิ่มเติม'].H2.v, 2);
      const zipOriginal = XLSX.CFB.read(await fs.readFile(files[category]), { type: 'buffer' });
      const zipExport = XLSX.CFB.read(bytes, { type: 'buffer' });
      const raw = (zip, name) => Buffer.from(XLSX.CFB.find(zip, name).content);
      assert.deepEqual(raw(zipExport, '/xl/styles.xml'), raw(zipOriginal, '/xl/styles.xml'));
      assert.deepEqual(raw(zipExport, '/xl/sharedStrings.xml'), raw(zipOriginal, '/xl/sharedStrings.xml'));
      const detail = zip => raw(zip, '/xl/worksheets/sheet1.xml').toString().split('</sheetData>')[1];
      assert.equal(detail(zipExport), detail(zipOriginal));
      assert.doesNotMatch(raw(zipExport, '/xl/worksheets/sheet1.xml').toString(), /<row\b[^>]*hidden="1"/);
      assert.doesNotMatch(raw(zipExport, '/xl/tables/table1.xml').toString(), /<filterColumn/);
      const titles = zip => raw(zip, '/xl/workbook.xml').toString().match(/<definedNames>[^]*?<\/definedNames>/)[0];
      assert.equal(titles(zipExport), titles(zipOriginal));
      if (resultDir) await fs.writeFile(path.join(resultDir, `fixture-${thai}.xlsx`), bytes);
    }
  } finally {
    if (eventId) await db.query('UPDATE ordering.scpda_annual_events SET closed_at=now() WHERE id=$1', [eventId]);
    await db.end();
  }
});
