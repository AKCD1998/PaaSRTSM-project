'use strict';

const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const categories = ['common', 'normal', 'pharma'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const maxMilli = 999999999;

function reject(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}

function validatePageKey(category, pageNo) {
  if (!categories.includes(category) || !Number.isInteger(pageNo) || pageNo < 1 || pageNo > 999) {
    reject(400, 'ANNUAL_PAGE_INVALID', 'เลขหน้าหรือหมวดไม่ถูกต้อง');
  }
}

function normalizeCounts(items, values, complete) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    reject(400, 'ANNUAL_COUNTS_INVALID', 'ข้อมูลผลนับไม่ถูกต้อง');
  }
  const rows = new Set(items.map(item => String(item.row)));
  const result = {};
  for (const [row, points] of Object.entries(values)) {
    if (!rows.has(row) || !Array.isArray(points) || points.length < 3 || points.length > 200) {
      reject(400, 'ANNUAL_COUNTS_INVALID', 'รายการหรือจุดนับไม่ตรงกับหน้านี้');
    }
    const cleaned = points.map((point, index) => {
      if (point === null && index < 3) return null;
      const quantity = point?.quantityMilli;
      const place = typeof point?.place === 'string' ? point.place.trim() : '';
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > maxMilli ||
          (index >= 3 && (!place || place.length > 120))) {
        reject(400, 'ANNUAL_POINT_INVALID', 'ตรวจจำนวนและระบุตำแหน่งสำหรับจุดนับเพิ่มเติม');
      }
      return index < 3 ? { quantityMilli: quantity } : { quantityMilli: quantity, place };
    });
    if (cleaned.some(point => point !== null)) result[row] = cleaned;
  }
  if (complete && Object.keys(result).length !== items.length) {
    reject(409, 'ANNUAL_PAGE_INCOMPLETE', 'ยังมีสินค้าที่ยังไม่นับ กรอก 0 เมื่อไม่พบสินค้า');
  }
  return result;
}

function pageSummary(page) {
  return {
    category: page.category,
    pageNo: page.page_no,
    totalRows: page.items.length,
    countedRows: Object.keys(page.counts).length,
    state: page.submitted_at ? 'submitted' : page.assignee ? 'assigned' : 'free',
  };
}

function pageResult(page) {
  return {
    ...pageSummary(page),
    revision: page.revision,
    mutationId: page.mutation_id,
    receiptId: page.receipt_id,
    receivedAt: page.submitted_at,
    savedAt: page.last_saved_at ?? null,
  };
}

async function inEvent(db, branchCode, eventId, work) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [event] } = await client.query(
      'SELECT id FROM ordering.scpda_annual_events WHERE id=$1 AND branch_code=$2 AND closed_at IS NULL FOR UPDATE',
      [eventId, branchCode],
    );
    if (!event) reject(404, 'ANNUAL_EVENT_MISSING', 'ไม่พบอีเวนท์ที่เปิดสำหรับสาขานี้');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function currentPage(client, eventId, category, pageNo) {
  const { rows: [page] } = await client.query(
    'SELECT * FROM ordering.scpda_annual_pages WHERE event_id=$1 AND category=$2 AND page_no=$3',
    [eventId, category, pageNo],
  );
  if (!page) reject(404, 'ANNUAL_PAGE_MISSING', 'ไม่พบใบนับ');
  return page;
}

async function availableToOperator(client, eventId, operator, page) {
  if (page.assignee) reject(409, 'ANNUAL_PAGE_TAKEN', 'หน้านี้มีคนรับแล้ว กรุณาเลือกหน้าอื่น');

}

async function overview(db, { branchCode, operator, manager, selected, workOnly = false }) {
  if (selected) validatePageKey(selected.category, selected.pageNo);
  const { rows: [event] } = await db.query(
    'SELECT id,label,warehouse_code FROM ordering.scpda_annual_events WHERE branch_code=$1 AND closed_at IS NULL',
    [branchCode],
  );
  if (!event) return { event: null, manager };
  const { rows: pages } = await db.query(
    'SELECT * FROM ordering.scpda_annual_pages WHERE event_id=$1 ORDER BY category,page_no',
    [event.id],
  );
  const { rows: people } = await db.query('SELECT operator_code,display_name FROM ordering.scpda_annual_participants WHERE event_id=$1',[event.id]);
  const names = new Map(people.map(person => [person.operator_code, person.display_name]));
  const team = pages.filter(page => page.assignee).map(page => ({ ...pageSummary(page), operator: page.assignee, displayName: names.get(page.assignee) || null, primary: page.assignee === '01005' }));
  const result = { event: { id: event.id, label: event.label, warehouseCode: event.warehouse_code }, manager: manager && !workOnly,
    canManage: manager, team, myDisplayName: names.get(operator) || '', myWorkCount: pages.filter(page => page.assignee === operator && !page.submitted_at).length };
  if (manager && !workOnly) {
    const { rows: requests } = await db.query(
      'SELECT category,page_no AS "pageNo",operator_code AS operator FROM ordering.scpda_annual_requests WHERE event_id=$1 ORDER BY requested_at',
      [event.id],
    );
    return { ...result, pages: pages.map(page => ({ ...pageSummary(page), assignee: page.assignee })), requests };
  }
  const owned = pages.filter(page => page.assignee === operator);
  const queue = owned.filter(page => !page.submitted_at).sort((a, b) =>
    (+new Date(a.assigned_at || 0) - +new Date(b.assigned_at || 0)) || a.category.localeCompare(b.category) || a.page_no-b.page_no);
  const chosen = selected && owned.find(page => page.category === selected.category && page.page_no === selected.pageNo);
  if (selected && !chosen) reject(404, 'ANNUAL_PAGE_MISSING', 'ไม่พบใบนับที่มอบหมายให้คุณ');
  const assigned = chosen && !chosen.submitted_at ? chosen : queue[0];
  const { rows: [pending] } = await db.query(
    'SELECT category,page_no AS "pageNo" FROM ordering.scpda_annual_requests WHERE event_id=$1 AND operator_code=$2',
    [event.id, operator],
  );
  return {
    ...result,
    assigned: assigned ? { ...pageResult(assigned), items: assigned.items, counts: assigned.counts } : null,
    assignedPages: queue.map(pageResult),
    pending: pending ?? null,
    free: pages.filter(page => !page.assignee).map(({ category, page_no: pageNo }) => ({ category, pageNo })),
    receipts: pages.filter(page => page.assignee === operator && page.submitted_at).map(pageResult),
  };
}

async function requestPage(db, { branchCode, operator, eventId, category, pageNo }) {
  validatePageKey(category, pageNo);
  return inEvent(db, branchCode, eventId, async client => {
    const page = await currentPage(client, eventId, category, pageNo);
    await availableToOperator(client, eventId, operator, page);
    await client.query(
      `INSERT INTO ordering.scpda_annual_requests (event_id,category,page_no,operator_code)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (event_id,operator_code) DO UPDATE
         SET category=EXCLUDED.category,page_no=EXCLUDED.page_no,requested_at=now()`,
      [eventId, category, pageNo, operator],
    );
    return { category, pageNo, state: 'requested' };
  });
}

async function assignPage(db, { branchCode, eventId, category, pageNo, operator, approve }) {
  validatePageKey(category, pageNo);
  return inEvent(db, branchCode, eventId, async client => {
    const page = await currentPage(client, eventId, category, pageNo);
    if (page.assignee === operator) return pageResult(page);
    await availableToOperator(client, eventId, operator, page);
    if (approve) {
      const { rowCount } = await client.query(
        'SELECT 1 FROM ordering.scpda_annual_requests WHERE event_id=$1 AND category=$2 AND page_no=$3 AND operator_code=$4',
        [eventId, category, pageNo, operator],
      );
      if (!rowCount) reject(409, 'ANNUAL_REQUEST_CHANGED', 'คำขอนี้เปลี่ยนแล้ว กรุณารีเฟรช');
    }
    const { rows: [updated] } = await client.query(
      'UPDATE ordering.scpda_annual_pages SET assignee=$4 WHERE event_id=$1 AND category=$2 AND page_no=$3 RETURNING *',
      [eventId, category, pageNo, operator],
    );
    await client.query(
      'DELETE FROM ordering.scpda_annual_requests WHERE event_id=$1 AND ((category=$2 AND page_no=$3) OR operator_code=$4)',
      [eventId, category, pageNo, operator],
    );
    return pageResult(updated);
  });
}

async function savePage(db, { branchCode, eventId, category, pageNo, operator, revision, mutationId, counts, submit }) {
  validatePageKey(category, pageNo);
  if (!Number.isInteger(revision) || revision < 0 || !uuid.test(mutationId ?? '') || typeof submit !== 'boolean') {
    reject(400, 'ANNUAL_VERSION_INVALID', 'ข้อมูลรุ่นผลนับไม่ถูกต้อง');
  }
  return inEvent(db, branchCode, eventId, async client => {
    const page = await currentPage(client, eventId, category, pageNo);
    if (page.assignee !== operator) reject(404, 'ANNUAL_PAGE_MISSING', 'ไม่พบใบนับที่มอบหมายให้คุณ');
    const normalized = normalizeCounts(page.items, counts, submit);
    if (page.mutation_id === mutationId && page.revision === revision + 1 &&
        isDeepStrictEqual(page.counts, normalized) && Boolean(page.submitted_at) === submit) {
      return pageResult(page);
    }
    if (page.submitted_at || page.revision !== revision || page.mutation_id === mutationId) {
      reject(409, 'ANNUAL_PAGE_CHANGED', 'ใบนับเปลี่ยนแล้ว กรุณาตรวจผลก่อนส่งซ้ำ');
    }
    const changes = [];
    for (const row of new Set([...Object.keys(page.counts), ...Object.keys(normalized)])) {
      const before = page.counts[row] ?? null;
      const after = normalized[row] ?? null;
      if (!isDeepStrictEqual(before, after)) changes.push({ row: Number(row), before, after });
    }
    const { rows: [updated] } = await client.query(
      `UPDATE ordering.scpda_annual_pages SET counts=$4::jsonb,revision=revision+1,mutation_id=$5,receipt_id=$6,
          submitted_at=CASE WHEN $6::uuid IS NULL THEN NULL ELSE now() END,last_saved_at=clock_timestamp()
       WHERE event_id=$1 AND category=$2 AND page_no=$3 RETURNING *`,
      [eventId, category, pageNo, JSON.stringify(normalized), mutationId, submit ? randomUUID() : null],
    );
    if (changes.length) {
      await client.query(
        `INSERT INTO ordering.scpda_annual_count_audit (event_id,category,page_no,revision,operator_code,changes,actor_name)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,(SELECT display_name FROM ordering.scpda_annual_participants WHERE event_id=$1 AND operator_code=$5))`,
        [eventId, category, pageNo, updated.revision, operator, JSON.stringify(changes)],
      );
    }
    return pageResult(updated);
  });
}

async function completedCategory(db, { branchCode, eventId, category }) {
  if (!categories.includes(category)) reject(400, 'ANNUAL_PAGE_INVALID', 'หมวดไม่ถูกต้อง');
  return inEvent(db, branchCode, eventId, async client => {
    const { rows: [event] } = await client.query(
      'SELECT source_files->$2::text AS source FROM ordering.scpda_annual_events WHERE id=$1',
      [eventId, category],
    );
    const { rows: [progress] } = await client.query(
      'SELECT count(*)::int total,count(submitted_at)::int submitted FROM ordering.scpda_annual_pages WHERE event_id=$1',
      [eventId],
    );
    if (!progress.total || progress.submitted !== progress.total) {
      reject(409, 'ANNUAL_EVENT_INCOMPLETE', 'รอรับผลครบทุกหน้าก่อนสร้าง Excel');
    }
    const { rows } = await client.query(
      'SELECT page_no,items,counts FROM ordering.scpda_annual_pages WHERE event_id=$1 AND category=$2 ORDER BY page_no',
      [eventId, category],
    );
    if (!event.source || !rows.length) reject(404, 'ANNUAL_SOURCE_MISSING', 'ไม่พบต้นแบบของหมวดนี้');
    return { source: event.source, pages: rows };
  });
}

async function nameParticipant(db, { branchCode, eventId, operator, displayName }) {
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 80 || /[\u0000-\u001f]/.test(displayName)) reject(400, 'ANNUAL_NAME_INVALID', 'ระบุชื่อที่ใช้ในงานนับ ไม่เกิน 80 ตัวอักษร');
  return inEvent(db, branchCode, eventId, async client => {
    await client.query(`INSERT INTO ordering.scpda_annual_participants(event_id,operator_code,display_name)
      VALUES($1,$2,$3) ON CONFLICT(event_id,operator_code) DO UPDATE SET display_name=EXCLUDED.display_name,updated_at=now()`, [eventId,operator,displayName.trim()]);
    return { displayName: displayName.trim() };
  });
}

function startAuditExpiry({ db, config, logger }) {
  const expire = () => db.query("DELETE FROM ordering.scpda_annual_count_audit WHERE recorded_at < now() - interval '60 days'")
    .catch(error => logger.error('SCPDA annual audit expiry failed', { code: error.code }));
  void expire();
  return setInterval(expire, 24 * 60 * 60 * 1000).unref();
}

module.exports = { nameParticipant, assignPage, completedCategory, normalizeCounts, overview, reject, requestPage, savePage, startAuditExpiry, uuid };
