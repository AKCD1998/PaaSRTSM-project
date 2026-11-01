"use strict";

const TARGETS = { '001': 500, '003': 500, '004': 250, '005': 250 };
function thaiDate(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function validMonth(month) {
  return typeof month === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(month) && month >= '2026-11';
}
function buildRegistrationProgress(body, month, branches) {
  if (!body?.ok || body.month !== month || body.timeZone !== 'Asia/Bangkok' || !Array.isArray(body.counts)
    || body.counts.length > 155 || !Number.isFinite(Date.parse(body.generatedAt))
    || !Number.isFinite(Date.parse(body.trackingStartedAt))) throw Error('Invalid CRM report');
  const today = thaiDate(body.generatedAt), trackingDay = thaiDate(body.trackingStartedAt);
  const [year, m] = month.split('-').map(Number), days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const counts = new Map();
  for (const row of body.counts) {
    const day = Number(String(row.date).slice(-2));
    const key = `${row.date}:${row.branchCode}`;
    if (typeof row.date !== 'string' || !row.date.startsWith(month + '-') || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)
      || day < 1 || day > days || row.date > today || row.date < trackingDay
      || (row.branchCode !== null && !Object.hasOwn(TARGETS, row.branchCode))
      || !Number.isSafeInteger(row.count) || row.count < 0 || counts.has(key)) throw Error('Invalid CRM counts');
    counts.set(key, row.count);
  }
  const daily = Array.from({ length: days }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    const recorded = date <= today && date >= trackingDay;
    return { date, status: date > today ? 'future' : date < trackingDay ? 'untracked' : 'recorded',
      byBranch: Object.fromEntries(branches.map(code => [code, recorded ? (counts.get(`${date}:${code}`) || 0) : null])),
      ...(branches.length === 4 ? { unassigned: recorded ? counts.get(`${date}:null`) || 0 : null } : {}),
    };
  });
  const summaries = branches.map(branchCode => {
    const total = daily.reduce((sum, row) => sum + (row.byBranch[branchCode] || 0), 0);
    const target = TARGETS[branchCode];
    return { branchCode, target, total, today: daily.find(row => row.date === today)?.byBranch[branchCode] ?? null,
      remaining: Math.max(0, target - total), percent: Math.round(total / target * 1000) / 10 };
  });
  return { month, timeZone: 'Asia/Bangkok', asOfDate: today, generatedAt: body.generatedAt,
    trackingStartedAt: body.trackingStartedAt, partialMonth: Date.parse(body.trackingStartedAt) > Date.parse(`${month}-01T00:00:00+07:00`),
    branches: summaries, daily,
    ...(branches.length === 4 ? { unassignedTotal: daily.reduce((sum, row) => sum + (row.unassigned || 0), 0) } : {}),
  };
}
module.exports = { TARGETS, thaiDate, validMonth, buildRegistrationProgress };
